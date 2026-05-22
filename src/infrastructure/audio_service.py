"""Audio playback service for Moon-TTS.

Provides cross-platform audio device enumeration and WAV playback.
On Linux, uses native PipeWire/PulseAudio commands (pactl/wpctl/paplay/pw-play)
for accurate device listing and volume controls.
On Windows/macOS/other, uses sounddevice.
"""

from __future__ import annotations

import logging
import re
import sys
import subprocess
import threading
from typing import Any

import numpy as np
import sounddevice as sd
import soundfile as sf

logger = logging.getLogger("Moon-TTS.AudioService")


class AudioService:
    """Handles audio device discovery and WAV file playback."""

    # ------------------------------------------------------------------
    # Device enumeration
    # ------------------------------------------------------------------

    @staticmethod
    def get_devices() -> list[dict[str, Any]]:
        """Return a list of available output audio devices.

        Each entry is a dict with:
            * ``id``   – string or integer device identifier.
            * ``name`` – human-readable device name.
        """
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
                        if dev.get("max_output_channels", 0) > 0:  # type: ignore[union-attr]
                            devices.append({"id": idx, "name": dev["name"]})  # type: ignore[index]
                except Exception as e:
                    logger.warning(f"Fallback sounddevice query failed: {e}")

        else:
            # Windows/macOS/other: Use sounddevice directly
            try:
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

                        # On Windows, filter out non-WASAPI devices to prevent duplicates and legacy name truncation
                        if is_windows and has_wasapi and api_name != "Windows WASAPI":
                            continue

                        name = dev["name"]
                        devices.append({"id": idx, "name": name})  # type: ignore[index]
            except Exception as e:
                logger.error(f"Failed to query sounddevice: {e}")

        return devices

    # ------------------------------------------------------------------
    # Playback helper
    # ------------------------------------------------------------------

    def _play_on_device(
        self,
        file_path: str,
        device_id: Any,
        volume: float,
    ) -> None:
        """Play WAV file on a target device using appropriate backend."""
        if sys.platform == "linux":
            vol_int = int(volume * 65536)

            # Target specific device
            if device_id and device_id != "default":
                # Try paplay
                try:
                    subprocess.run(
                        ["paplay", "-d", str(device_id), f"--volume={vol_int}", file_path],
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    return
                except Exception:
                    pass

                # Try pw-play
                try:
                    subprocess.run(
                        ["pw-play", "--target", str(device_id), f"--volume={volume}", file_path],
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    return
                except Exception:
                    pass

                # Try aplay
                try:
                    subprocess.run(
                        ["aplay", "-D", str(device_id), file_path],
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    return
                except Exception:
                    pass

            # Default device playback
            try:
                subprocess.run(
                    ["paplay", f"--volume={vol_int}", file_path],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except Exception:
                pass

            try:
                subprocess.run(
                    ["pw-play", f"--volume={volume}", file_path],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except Exception:
                pass

            try:
                subprocess.run(
                    ["aplay", file_path],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except Exception:
                pass

            logger.warning("All Linux CLI playback utilities failed. Falling back to sounddevice.")

        # Fallback (Linux defaults) or primary (macOS/Windows) sounddevice playback
        try:
            data, samplerate = sf.read(file_path, dtype="float32")
            
            # Resolve device ID to integer for PortAudio
            resolved_dev = None
            if device_id and device_id != "default":
                try:
                    resolved_dev = int(device_id)
                except (TypeError, ValueError):
                    resolved_dev = None

            # Query target device native sample rate to avoid PaErrorCode -9997 (Invalid sample rate)
            try:
                dev_info = sd.query_devices(device=resolved_dev, kind="output")
                target_sr = int(dev_info.get("default_samplerate", samplerate))
            except Exception:
                target_sr = samplerate

            if target_sr != samplerate:
                logger.info(f"Resampling audio from {samplerate}Hz to native device rate {target_sr}Hz")
                duration = len(data) / samplerate
                num_samples = int(duration * target_sr)
                x_old = np.linspace(0, duration, len(data), endpoint=False)
                x_new = np.linspace(0, duration, num_samples, endpoint=False)
                data = np.interp(x_new, x_old, data)
                samplerate = target_sr

            sd.play(data * volume, samplerate=samplerate, device=resolved_dev)
            sd.wait()
        except Exception as e:
            logger.error(f"sounddevice playback failed: {e}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

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
        """Read a WAV file and play it on one or two devices."""
        need_monitor = monitoring and monitoring_device_id is not None

        if playback and need_monitor:
            primary_thread = threading.Thread(
                target=self._play_on_device,
                args=(file_path, device_id, volume),
                daemon=True,
            )
            monitor_thread = threading.Thread(
                target=self._play_on_device,
                args=(file_path, monitoring_device_id, monitoring_volume),
                daemon=True,
            )
            primary_thread.start()
            monitor_thread.start()
            primary_thread.join()
            monitor_thread.join()

        elif playback:
            self._play_on_device(file_path, device_id, volume)

        elif need_monitor:
            self._play_on_device(file_path, monitoring_device_id, monitoring_volume)
