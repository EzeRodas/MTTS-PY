"""Audio playback service for Moon-TTS.

Provides cross-platform audio device enumeration and gapless in-memory WAV playback
using sounddevice and a background queue.
"""

from __future__ import annotations

import logging
import sys
import threading
import queue
import numpy as np
import sounddevice as sd
from typing import Any

logger = logging.getLogger("Moon-TTS.AudioService")


class AudioService:
    """Handles audio device discovery and gapless playback."""

    _cached_devices: list[dict[str, Any]] = [
        {"id": "default", "name": "System Default"},
    ]
    _is_querying: bool = False
    _lock = threading.Lock()

    def __init__(self):
        self._play_queue = queue.Queue()
        self._stop_event = threading.Event()
        self._samplerate = 24000
        self._worker_thread = threading.Thread(target=self._playback_worker, daemon=True)
        self._worker_thread.start()

    # ------------------------------------------------------------------
    # Device enumeration
    # ------------------------------------------------------------------

    @staticmethod
    def get_devices() -> list[dict[str, Any]]:
        """Return a list of available output audio devices."""
        with AudioService._lock:
            if not AudioService._is_querying:
                AudioService._is_querying = True
                threading.Thread(target=AudioService._query_devices_background, daemon=True).start()
            return list(AudioService._cached_devices)

    @staticmethod
    def _query_devices_background() -> None:
        try:
            import re
            import subprocess
            devices: list[dict[str, Any]] = [
                {"id": "default", "name": "System Default"},
            ]
            
            if sys.platform == "linux":
                # Priority 1: Parse pactl list sinks
                try:
                    res = subprocess.run(
                        ["pactl", "list", "sinks"],
                        capture_output=True,
                        text=True,
                        errors="ignore",
                        check=False,
                    )
                    if res.returncode == 0:
                        current_name = None
                        for line in res.stdout.splitlines():
                            if line.strip().startswith("Name:"):
                                current_name = line.split("Name:", 1)[1].strip()
                            elif line.strip().startswith("Description:") and current_name:
                                desc = line.split("Description:", 1)[1].strip()
                                devices.append({"id": current_name, "name": desc})
                                current_name = None
                except Exception as e:
                    logger.debug(f"pactl sinks query failed: {e}")

                # Priority 2: Parse wpctl status
                if len(devices) <= 1:
                    try:
                        res = subprocess.run(
                            ["wpctl", "status"],
                            capture_output=True,
                            text=True,
                            errors="ignore",
                            check=False,
                        )
                        if res.returncode == 0 and "Sinks:" in res.stdout:
                            sinks_part = res.stdout.split("Sinks:")[1].split("Sources:")[0]
                            for line in sinks_part.splitlines():
                                match = re.search(r'(?:[*\s]*?)(\d+)\.\s+(.*?)(?:\s+\[vol|$)', line)
                                if match:
                                    devices.append({
                                        "id": match.group(1),
                                        "name": match.group(2).strip(),
                                    })
                    except Exception as e:
                        logger.debug(f"wpctl sinks query failed: {e}")

                # Fallback to sounddevice if no devices found
                if len(devices) <= 1:
                    try:
                        all_devs = sd.query_devices()
                        for idx, dev in enumerate(all_devs):
                            if dev.get("max_output_channels", 0) > 0:
                                devices.append({"id": idx, "name": dev["name"]})
                    except Exception as e:
                        logger.warning(f"Fallback sounddevice query failed: {e}")

            else:
                all_devs = sd.query_devices()
                try:
                    host_apis = sd.query_hostapis()
                except Exception:
                    host_apis = []

                is_windows = sys.platform.startswith("win")
                has_wasapi = False
                if is_windows:
                    has_wasapi = any(api.get("name") == "Windows WASAPI" for api in host_apis)

                for idx, dev in enumerate(all_devs):
                    if dev.get("max_output_channels", 0) > 0:  # type: ignore[union-attr]
                        api_idx = dev.get("hostapi", 0)
                        api_name = ""
                        if 0 <= api_idx < len(host_apis):
                            api_name = host_apis[api_idx].get("name", "")

                        if is_windows and has_wasapi and api_name != "Windows WASAPI":
                            continue

                        devices.append({"id": idx, "name": dev["name"]})

            with AudioService._lock:
                AudioService._cached_devices = devices
        except Exception as e:
            logger.error(f"Error in background device query: {e}")
        finally:
            with AudioService._lock:
                AudioService._is_querying = False

    # ------------------------------------------------------------------
    # Playback helper
    # ------------------------------------------------------------------

    def enqueue_chunk(
        self,
        chunk: np.ndarray,
        samplerate: int,
        device_id: Any = None,
        volume: float = 1.0,
    ) -> None:
        """Enqueue an in-memory NumPy array for gapless playback."""
        # Resample to 24000Hz if needed
        if samplerate != self._samplerate:
            duration = len(chunk) / samplerate
            num_samples = int(duration * self._samplerate)
            
            X = np.fft.fft(chunk)
            new_X = np.zeros(num_samples, dtype=X.dtype)
            keep = min(len(chunk), num_samples)
            mid = keep // 2
            if keep % 2 == 0:
                new_X[:mid] = X[:mid]
                new_X[-mid+1:] = X[-mid+1:]
                nyquist = X[mid] if mid < len(X) else 0.0
                new_X[mid] += nyquist * 0.5
                if num_samples % 2 == 0 and num_samples - mid < num_samples:
                    new_X[num_samples - mid] += nyquist * 0.5
            else:
                new_X[:mid+1] = X[:mid+1]
                new_X[-mid:] = X[-mid:]
            y = np.fft.ifft(new_X)
            chunk = np.real(y) * (float(num_samples) / len(chunk))
            chunk = chunk.astype(np.float32)

        # Apply volume
        chunk = chunk * volume

        self._play_queue.put((chunk, device_id))

    def flush(self):
        """Wait for all currently enqueued chunks to finish playing."""
        self._play_queue.join()

    def _playback_worker(self):
        """Background thread that continuously writes chunks to the output stream."""
        import subprocess
        stream = None
        proc = None
        current_device = None

        def close_streams():
            nonlocal stream, proc
            if stream:
                try:
                    stream.stop()
                    stream.close()
                except Exception:
                    pass
                stream = None
            if proc:
                try:
                    proc.stdin.close()
                    proc.wait(timeout=1.0)
                except Exception:
                    pass
                proc = None

        while not self._stop_event.is_set():
            try:
                item = self._play_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            if item is None:
                close_streams()
                self._play_queue.task_done()
                continue

            chunk, device_id = item

            if (stream is None and proc is None) or current_device != device_id:
                close_streams()
                current_device = device_id
                
                # Check if we should use paplay (Linux)
                use_paplay = False
                if sys.platform == "linux":
                    import shutil
                    if shutil.which("paplay"):
                        use_paplay = True
                        cmd = ["paplay", "--raw", "--channels=1", f"--rate={self._samplerate}", "--format=float32le"]
                        if device_id and str(device_id).lower() != "default":
                            cmd.extend(["-d", str(device_id)])
                        try:
                            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
                        except Exception as e:
                            logger.error(f"Failed to start paplay stream: {e}")
                            proc = None
                            use_paplay = False

                # Fallback to sounddevice
                if not use_paplay:
                    resolved_dev = None
                    if device_id and str(device_id).lower() != "default":
                        try:
                            resolved_dev = int(device_id)
                        except ValueError:
                            pass
                    try:
                        stream = sd.OutputStream(
                            samplerate=self._samplerate,
                            channels=1,
                            device=resolved_dev,
                            dtype='float32'
                        )
                        stream.start()
                    except Exception as e:
                        logger.error(f"Failed to open audio stream: {e}")
                        self._play_queue.task_done()
                        continue

            try:
                if proc and proc.stdin:
                    proc.stdin.write(chunk.tobytes())
                    proc.stdin.flush()
                elif stream:
                    stream.write(chunk)
            except Exception as e:
                logger.error(f"Error writing to audio stream: {e}")
                close_streams()

            self._play_queue.task_done()

    def stop(self) -> None:
        """Stop playback immediately by clearing the queue."""
        with self._play_queue.mutex:
            self._play_queue.queue.clear()
        self._play_queue.put(None)

    def play_with_config(self, file_path: str, config: dict[str, Any]) -> None:
        """Legacy helper to read a WAV file and enqueue it."""
        if not config.get("playback", True):
            return
            
        import soundfile as sf
        try:
            data, samplerate = sf.read(file_path, dtype="float32")
            if len(data.shape) > 1:
                # convert stereo to mono
                data = data.mean(axis=1)
                
            self.enqueue_chunk(
                data, 
                samplerate, 
                config.get("playbackDevice", "default"), 
                config.get("volume", 0.8)
            )
            # We don't join here because it blocks UI. The background thread handles it.
        except Exception as e:
            logger.error(f"Failed to read/play file {file_path}: {e}")

    def play(
        self,
        file_path: str,
        playback: bool,
        device_id: Any = None,
        volume: float = 1.0,
        monitoring: bool = False,
        monitoring_device_id: Any = None,
        monitoring_volume: float = 1.0,
    ) -> None:
        """Legacy play method wrapper."""
        if not playback and not monitoring:
            return
            
        import soundfile as sf
        try:
            data, samplerate = sf.read(file_path, dtype="float32")
            if len(data.shape) > 1:
                data = data.mean(axis=1)
                
            if playback:
                self.enqueue_chunk(data, samplerate, device_id, volume)
                
            if monitoring and monitoring_device_id is not None:
                # We enqueue monitoring separately. Note: queue processes sequentially.
                # True simultaneous playback to two devices requires two output streams.
                # For now, we queue it sequentially to keep it simple.
                self.enqueue_chunk(data, samplerate, monitoring_device_id, monitoring_volume)
        except Exception as e:
            logger.error(f"Failed to read/play file {file_path}: {e}")
