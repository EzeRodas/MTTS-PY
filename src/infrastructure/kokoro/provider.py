"""Kokoro TTS provider for Moon-TTS.

Wraps the ``kokoro-onnx`` Python package to provide text-to-speech
synthesis with automatic language resolution from voice prefixes.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any

from .language_map import get_language_for_voice

logger = logging.getLogger(__name__)

# Voices known to ship with Kokoro-82M-v1.0.
_FALLBACK_VOICES: list[str] = [
    "af_heart",
    "af_sarah",
    "af_nova",
    "af_sky",
    "af_nicole",
    "am_adam",
    "am_michael",
    "bf_emma",
    "bf_isabella",
    "bm_george",
    "bm_lewis",
    "ef_dora",
    "ff_siwis",
    "jf_alpha",
    "zf_xiaoxiao",
    "if_sara",
    "pf_dora",
    "hf_alpha",
]


class KokoroTTSProvider:
    """Text-to-speech provider backed by Kokoro-82M via ONNX.

    Supports multilingual text-to-speech synthesis by mapping the selected
    voice's prefix to the corresponding language code (e.g. 'ef_dora' -> 'es').
    """

    MODEL_REPO_ID: str = "fastrtc/kokoro-onnx"
    MODEL_FILENAME: str = "kokoro-v1.0.onnx"
    VOICES_FILENAME: str = "voices-v1.0.bin"

    def __init__(
        self,
        settings_manager: Any,
        audio_service: Any,
        history_manager: Any,
    ) -> None:
        """Initialise the provider.

        Parameters
        ----------
        settings_manager:
            Application settings accessor (used to read app-level paths
            and user preferences).
        audio_service:
            :class:`~infrastructure.audio_service.AudioService` instance
            used for WAV playback.
        history_manager:
            History tracker for logging generated utterances.
        """
        self.settings_manager = settings_manager
        self.audio_service = audio_service
        self.history_manager = history_manager

        self.tts_instance: Any = None

        self.kokoro_config: dict[str, Any] = self.settings_manager.get_engine_config(
            "kokoro",
            {
                "voiceId": "af_heart",
                "speed": 1.0,
            }
        )

    def preload_model(self) -> None:
        """Synchronously load the TTS model (designed to be run in a background thread)."""
        try:
            self._get_tts_instance()
        except Exception as e:
            logger.error(f"Error preloading TTS model: {e}")

    # ------------------------------------------------------------------
    # Lazy model loading
    # ------------------------------------------------------------------

    def _resolve_model_paths(self) -> tuple[Path | None, Path | None]:
        """Resolve the model and voices files from configured or default paths."""
        # 1. Check path from settings
        config = self.settings_manager.get_app_config()
        settings_models_path = config.get("modelsPath", "")
        
        search_paths = []
        if settings_models_path:
            p = Path(settings_models_path)
            search_paths.append(p / "kokoro")
            search_paths.append(p)
            
        # 2. Check app data models folder
        app_dir = Path(self.settings_manager.get_app_directory())
        search_paths.append(app_dir / "models" / "kokoro")
        search_paths.append(app_dir / "models")
        
        # 3. Check project models folder (relative to this file)
        src_dir = Path(__file__).resolve().parent.parent.parent
        search_paths.append(src_dir / "models" / "kokoro")
        search_paths.append(src_dir.parent / "models")
        
        # Remove duplicates while preserving order
        unique_paths = []
        for path in search_paths:
            if path not in unique_paths:
                unique_paths.append(path)

        for path in unique_paths:
            m_path = path / self.MODEL_FILENAME
            v_path = path / self.VOICES_FILENAME
            if m_path.exists() and v_path.exists():
                return m_path, v_path

        return None, None

    def is_available(self) -> bool:
        """Return True if the model and voices files are present."""
        m, v = self._resolve_model_paths()
        return m is not None and v is not None

    def _get_tts_instance(self) -> Any:
        """Return the lazily-loaded :class:`Kokoro` instance from local files.

        Looks for the ONNX model and voice pack in search paths.
        Raises FileNotFoundError if not found.
        """
        if self.tts_instance is not None:
            return self.tts_instance

        model_path, voices_path = self._resolve_model_paths()
        if not model_path or not voices_path:
            raise FileNotFoundError(
                f"Could not find '{self.MODEL_FILENAME}' and '{self.VOICES_FILENAME}' "
                "in configured or default directories."
            )

        from kokoro_onnx import Kokoro
        self.tts_instance = Kokoro(str(model_path), str(voices_path))
        return self.tts_instance

    # ------------------------------------------------------------------
    # Voice management
    # ------------------------------------------------------------------

    def get_voices(self) -> list[str]:
        """Return the list of available voice identifiers.

        Falls back to a hardcoded list if the runtime query fails.
        """
        try:
            tts = self._get_tts_instance()
            return list(tts.get_voices())
        except Exception as e:
            logger.exception("Failed to load/initialize TTS engine:")
            return list(_FALLBACK_VOICES)

    def set_voice(self, voice_id: str) -> None:
        """Set the active voice for subsequent synthesis calls.

        Parameters
        ----------
        voice_id:
            A voice identifier such as ``'af_heart'`` or ``'am_adam'``.
        """
        self.kokoro_config["voiceId"] = voice_id
        self.settings_manager.update_engine_config("kokoro", {"voiceId": voice_id})

    # ------------------------------------------------------------------
    # Synthesis
    # ------------------------------------------------------------------

    def speak(self, text: str) -> None:
        """Synthesise *text* and play it through the audio service.

        The generated audio is written to a temporary WAV file, added to
        the history manager, played via the configured audio service, and
        then cleaned up.

        Parameters
        ----------
        text:
            The text to synthesise.
        """
        tts = self._get_tts_instance()
        config = self.settings_manager.get_engine_config(
            "kokoro",
            {
                "voiceId": "af_heart",
                "speed": 1.0,
            }
        )
        self.kokoro_config = config

        voice_id = config.get("voiceId", "af_heart")
        speed = config.get("speed", 1.0)
        # Determine language automatically from voice prefix
        lang = get_language_for_voice(voice_id)

        logger.info(f"Synthesizing text with voice='{voice_id}' (resolved lang='{lang}')")
        samples, sample_rate = tts.create(
            text,
            voice=voice_id,
            speed=speed,
            lang=lang,
        )

        # Write to a temporary WAV file.
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        os.close(tmp_fd)

        try:
            import soundfile as sf
            sf.write(tmp_path, samples, sample_rate)

            # Record in history (best-effort).
            try:
                self.history_manager.add_entry(text, tmp_path)
            except Exception as e:
                logger.error(f"Failed to record history: {e}")

            # Retrieve playback settings from settings_manager.
            app_config = self.settings_manager.get_app_config()
            playback = app_config.get("playback", True)
            device_id = app_config.get("playbackDevice", "default")
            volume = app_config.get("volume", 0.8)
            monitoring = app_config.get("monitoring", False)
            monitoring_device_id = app_config.get("monitoringDevice", "default")
            monitoring_volume = app_config.get("monitoringVolume", 0.8)

            self.audio_service.play(
                file_path=tmp_path,
                playback=playback,
                device_id=device_id,
                volume=volume,
                monitoring=monitoring,
                monitoring_device_id=monitoring_device_id,
                monitoring_volume=monitoring_volume,
            )
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def preview_spelling(self, spelling: str) -> None:
        """Synthesize *spelling* and play it ONLY through the monitoring device.
        Does not record history.
        """
        tts = self._get_tts_instance()
        config = self.kokoro_config

        voice_id = config.get("voiceId", "af_heart")
        speed = config.get("speed", 1.0)
        lang = get_language_for_voice(voice_id)

        samples, sample_rate = tts.create(
            spelling,
            voice=voice_id,
            speed=speed,
            lang=lang,
        )

        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        os.close(tmp_fd)

        try:
            import soundfile as sf
            sf.write(tmp_path, samples, sample_rate)

            app_config = self.settings_manager.get_app_config()
            monitoring = app_config.get("monitoring", False)
            if not monitoring:
                logger.warning("Monitoring is disabled, preview will not play.")
                return

            monitoring_device_id = app_config.get("monitoringDevice", "default")
            monitoring_volume = app_config.get("monitoringVolume", 0.8)

            self.audio_service.play(
                file_path=tmp_path,
                playback=False,
                monitoring=True,
                monitoring_device_id=monitoring_device_id,
                monitoring_volume=monitoring_volume,
            )
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def generate_to_file(self, text: str, file_path: str) -> None:
        """Synthesise *text* and write the result directly to *file_path*.

        Parameters
        ----------
        text:
            The text to synthesise.
        file_path:
            Destination path for the output WAV file.
        """
        tts = self._get_tts_instance()
        config = self.settings_manager.get_engine_config(
            "kokoro",
            {
                "voiceId": "af_heart",
                "speed": 1.0,
            }
        )
        self.kokoro_config = config

        voice_id = config.get("voiceId", "af_heart")
        speed = config.get("speed", 1.0)
        # Determine language automatically from voice prefix
        lang = get_language_for_voice(voice_id)

        samples, sample_rate = tts.create(
            text,
            voice=voice_id,
            speed=speed,
            lang=lang,
        )

        # Ensure parent directory exists.
        Path(file_path).parent.mkdir(parents=True, exist_ok=True)
        sf.write(file_path, samples, sample_rate)
