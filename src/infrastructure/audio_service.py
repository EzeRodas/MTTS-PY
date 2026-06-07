"""Audio playback service for Moon-TTS.

Provides cross-platform audio device enumeration and gapless in-memory WAV playback
using sounddevice and a background queue.
"""

from __future__ import annotations

import logging
import sys
import threading
import queue
import subprocess
import numpy as np
import sounddevice as sd
from typing import Any

logger = logging.getLogger("Moon-TTS.AudioService")


class AudioPlayer:
    """Base class/interface for audio players."""
    def start_stream(self, device_id: Any, samplerate: int) -> None:
        pass
    def write(self, data: np.ndarray) -> None:
        pass
    def pause(self) -> None:
        pass
    def resume(self) -> None:
        pass
    def stop(self) -> None:
        pass
    def close(self) -> None:
        pass
    def wait_finished(self) -> None:
        pass


class LinuxSubprocessPlayer(AudioPlayer):
    """Linux-specific player using paplay for robust Pipewire/PulseAudio routing."""
    def __init__(self, samplerate: int = 24000):
        self.samplerate = samplerate
        self.proc: subprocess.Popen | None = None
        self.paused = False

    def start_stream(self, device_id: Any, samplerate: int) -> None:
        self.close()
        self.samplerate = samplerate
        self.paused = False
        cmd = ["paplay", "--raw", "--channels=1", f"--rate={samplerate}", "--format=float32le", "--latency-msec=150"]
        if device_id and str(device_id).lower() != "default":
            cmd.extend(["-d", str(device_id)])
        try:
            self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except Exception as e:
            logger.error(f"Failed to start paplay: {e}")
            self.proc = None
            raise

    def write(self, data: np.ndarray) -> None:
        if self.proc and self.proc.stdin:
            self.proc.stdin.write(data.tobytes())
            self.proc.stdin.flush()

    def pause(self) -> None:
        if self.proc:
            import signal
            try:
                self.proc.send_signal(signal.SIGSTOP)
            except Exception:
                pass
            self.paused = True

    def resume(self) -> None:
        if self.proc:
            import signal
            try:
                self.proc.send_signal(signal.SIGCONT)
            except Exception:
                pass
            self.paused = False

    def stop(self) -> None:
        p = self.proc
        if p:
            try:
                p.kill()
            except Exception:
                pass
        self.close()

    def close(self) -> None:
        p = self.proc
        if p:
            try:
                p.stdin.close()
            except Exception:
                pass
            # Async wait so we don't block the calling thread
            def _wait_proc(proc_obj):
                try:
                    proc_obj.wait(timeout=5.0)
                except Exception:
                    try:
                        proc_obj.kill()
                    except Exception:
                        pass
            threading.Thread(target=_wait_proc, args=(p,), daemon=True).start()
            self.proc = None

    def wait_finished(self) -> None:
        p = self.proc
        if p:
            try:
                p.stdin.close()
            except Exception:
                pass
            while p.poll() is None:
                import time
                time.sleep(0.05)


class PortAudioPlayer(AudioPlayer):
    """PortAudio-based player using sounddevice in non-blocking callback mode."""
    def __init__(self, samplerate: int = 24000):
        self.samplerate = samplerate
        self.stream: sd.OutputStream | None = None
        self.buffer = bytearray()
        self.lock = threading.Lock()
        self.paused = False

    def callback(self, outdata: np.ndarray, frames: int, time_info: Any, status: Any) -> None:
        with self.lock:
            if self.paused or len(self.buffer) == 0:
                outdata.fill(0)
                return

            bytes_needed = frames * 4  # float32 is 4 bytes
            chunk = self.buffer[:bytes_needed]
            del self.buffer[:bytes_needed]

            if len(chunk) < bytes_needed:
                outdata[:len(chunk)//4] = np.frombuffer(chunk, dtype=np.float32).reshape(-1, 1)
                outdata[len(chunk)//4:] = 0
            else:
                outdata[:] = np.frombuffer(chunk, dtype=np.float32).reshape(-1, 1)

    def start_stream(self, device_id: Any, samplerate: int) -> None:
        self.close()
        self.samplerate = samplerate
        resolved_dev = None
        if device_id and str(device_id).lower() != "default":
            try:
                resolved_dev = int(device_id)
            except ValueError:
                pass
        self.stream = sd.OutputStream(
            samplerate=samplerate,
            channels=1,
            device=resolved_dev,
            dtype='float32',
            callback=self.callback
        )
        self.stream.start()

    def write(self, data: np.ndarray) -> None:
        # Keep buffer to at most ~4 seconds of audio to avoid unbounded memory growth
        while True:
            with self.lock:
                if len(self.buffer) < 96000 * 4:
                    break
            import time
            time.sleep(0.1)

        with self.lock:
            self.buffer.extend(data.tobytes())

    def pause(self) -> None:
        with self.lock:
            self.paused = True

    def resume(self) -> None:
        with self.lock:
            self.paused = False

    def stop(self) -> None:
        with self.lock:
            self.buffer.clear()
        self.close()

    def close(self) -> None:
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None

    def wait_finished(self) -> None:
        while True:
            with self.lock:
                if not self.stream or len(self.buffer) == 0:
                    break
            import time
            time.sleep(0.05)
        if self.stream:
            import time
            time.sleep(0.15)


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
        self._current_player: AudioPlayer | None = None
        self._paused = False
        self._pause_event = threading.Event()
        self._pause_event.set()
        self._state_changed_callback = None
        self._worker_thread = threading.Thread(target=self._playback_worker, daemon=True)
        self._worker_thread.start()

    def set_state_changed_callback(self, callback) -> None:
        self._state_changed_callback = callback

    def _notify_state_changed(self) -> None:
        if self._state_changed_callback:
            try:
                self._state_changed_callback()
            except Exception:
                pass

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
        self._notify_state_changed()

    def enqueue_sentinel(self) -> None:
        """Enqueue a sentinel (None) to indicate the end of the current utterance."""
        self._play_queue.put(None)
        self._notify_state_changed()

    def flush(self) -> None:
        """Wait for all currently enqueued chunks to finish playing."""
        self._play_queue.join()

    def _playback_worker(self) -> None:
        """Background thread that continuously writes chunks to the output stream."""
        player = None
        current_device = None

        def close_player():
            nonlocal player
            if player:
                player.close()
                player = None
                self._current_player = None
                self._notify_state_changed()

        while not self._stop_event.is_set():
            if self._paused:
                self._pause_event.wait(timeout=0.1)
                continue

            try:
                item = self._play_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            if item is None:
                if player:
                    try:
                        player.wait_finished()
                    except Exception as e:
                        logger.error(f"Error waiting for player to finish: {e}")
                close_player()
                self._play_queue.task_done()
                continue

            chunk, device_id = item

            if player is None or current_device != device_id:
                close_player()
                current_device = device_id

                # Check if we should use paplay (Linux)
                use_paplay = False
                if sys.platform == "linux":
                    import shutil
                    if shutil.which("paplay"):
                        use_paplay = True
                        try:
                            player = LinuxSubprocessPlayer(self._samplerate)
                            player.start_stream(device_id, self._samplerate)
                            self._current_player = player
                            self._notify_state_changed()
                        except Exception:
                            use_paplay = False
                            player = None

                # Fallback to sounddevice (non-blocking)
                if not use_paplay:
                    try:
                        player = PortAudioPlayer(self._samplerate)
                        player.start_stream(device_id, self._samplerate)
                        self._current_player = player
                        self._notify_state_changed()
                    except Exception as e:
                        logger.error(f"Failed to open audio stream: {e}")
                        self._play_queue.task_done()
                        continue

            try:
                player.write(chunk)
            except OSError as e:
                if e.errno == 32:  # Broken pipe is normal on stop/abort
                    logger.debug(f"Audio stream pipe closed: {e}")
                else:
                    logger.error(f"Error writing to audio stream: {e}")
                close_player()
            except Exception as e:
                logger.error(f"Error writing to audio stream: {e}")
                close_player()

            self._play_queue.task_done()

    def stop(self) -> None:
        """Stop playback immediately by clearing the queue and active streams."""
        self._paused = False
        self._pause_event.set()

        player = self._current_player
        if player:
            try:
                player.stop()
            except Exception:
                pass
            self._current_player = None

        with self._play_queue.mutex:
            self._play_queue.queue.clear()

        self._play_queue.put(None)
        self._notify_state_changed()

    def pause(self) -> None:
        """Pause playback."""
        self._paused = True
        self._pause_event.clear()

        player = self._current_player
        if player:
            try:
                player.pause()
            except Exception as e:
                logger.error(f"Error pausing player: {e}")
        self._notify_state_changed()

    def resume(self) -> None:
        """Resume playback."""
        self._paused = False
        self._pause_event.set()

        player = self._current_player
        if player:
            try:
                player.resume()
            except Exception as e:
                logger.error(f"Error resuming player: {e}")
        self._notify_state_changed()

    def is_paused(self) -> bool:
        """Return True if playback is currently paused."""
        return self._paused

    def is_playing(self) -> bool:
        """Return True if there is audio currently playing or enqueued."""
        player = self._current_player
        if player:
            if isinstance(player, LinuxSubprocessPlayer) and player.proc and player.proc.poll() is not None:
                self._current_player = None

        has_audio = False
        with self._play_queue.mutex:
            has_audio = any(item is not None for item in self._play_queue.queue)

        return has_audio or self._current_player is not None

    def play_with_config(self, file_path: str, config: dict[str, Any]) -> None:
        """Legacy helper to read a WAV file and enqueue it."""
        self.resume()
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
            self.enqueue_sentinel()
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
        self.resume()
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
                self.enqueue_chunk(data, samplerate, monitoring_device_id, monitoring_volume)

            if playback or (monitoring and monitoring_device_id is not None):
                self.enqueue_sentinel()
        except Exception as e:
            logger.error(f"Failed to read/play file {file_path}: {e}")
