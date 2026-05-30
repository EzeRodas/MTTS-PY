"""
Application controller coordinating TTS, settings, audio, history, and hotkeys.
Port of the TypeScript AppController.ts.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class AppController:
    """
    Facade coordinating the core domain services of the TTS application.
    Decouples UI layers (both CLI and Qt frontend) from underlying business logic.
    """

    def __init__(self, tts_service, settings_manager, audio_service, hotkey_manager, history_manager):
        self._tts_service = tts_service
        self._settings_manager = settings_manager
        self._audio_service = audio_service
        self._hotkey_manager = hotkey_manager
        self._history_manager = history_manager
        self._available_models = ["kokoro"]
        self._active_model = "kokoro"

    # =========================================================================
    # TTS
    # =========================================================================

    def process_input(self, text: str) -> None:
        """Synthesize and play back the given text."""
        try:
            self._tts_service.speak(text)
        except Exception as e:
            logger.error(f"Error processing TTS input: {e}")

    # =========================================================================
    # Models
    # =========================================================================

    def list_models(self) -> list[str]:
        """Return available TTS engine identifiers."""
        models = []
        if hasattr(self._tts_service, "is_available") and self._tts_service.is_available():
            models.append("kokoro")
        return models

    def get_active_model(self) -> str:
        """Return the currently selected model name if available, else empty string."""
        active = self._active_model
        if active in self.list_models():
            return active
        return ""

    def set_model(self, model_name: str) -> bool:
        """Set the active model if it exists."""
        if model_name in self.list_models():
            self._active_model = model_name
            return True
        return False

    # =========================================================================
    # Voices
    # =========================================================================

    def list_voices(self) -> list[str]:
        """Return voice IDs from the active TTS provider."""
        try:
            return self._tts_service.get_voices()
        except Exception as e:
            logger.error(f"Failed to list voices: {e}")
            return []

    def get_active_voice(self) -> str:
        """Return the currently active voice ID from engine config."""
        try:
            config = self._settings_manager.get_engine_config("kokoro", {"voiceId": "af_heart"})
            return config.get("voiceId", "af_heart")
        except Exception:
            return "af_heart"

    def set_voice(self, voice_id: str) -> None:
        """Set the active voice."""
        try:
            self._tts_service.set_voice(voice_id)
        except Exception as e:
            logger.error(f"Failed to set voice: {e}")

    def get_speed(self) -> float:
        """Return the synthesis speed from Kokoro configuration."""
        try:
            config = self._settings_manager.get_engine_config("kokoro", {"speed": 1.0})
            return float(config.get("speed", 1.0))
        except Exception:
            return 1.0

    def set_speed(self, speed: float) -> None:
        """Set the synthesis speed in Kokoro configuration."""
        try:
            self._settings_manager.update_engine_config("kokoro", {"speed": speed})
            if hasattr(self._tts_service, "kokoro_config"):
                self._tts_service.kokoro_config["speed"] = speed
        except Exception as e:
            logger.error(f"Failed to set speed: {e}")

    # =========================================================================
    # Settings
    # =========================================================================

    def get_app_config(self) -> dict:
        """Return the current application configuration."""
        return self._settings_manager.get_app_config()

    def update_app_config(self, config: dict) -> None:
        """Update partial app configuration."""
        self._settings_manager.update_app_config(config)

    # =========================================================================
    # Audio Devices
    # =========================================================================

    def get_devices(self) -> list[dict]:
        """Return available audio output devices."""
        return self._audio_service.get_devices()

    # =========================================================================
    # History
    # =========================================================================

    def get_history(self) -> list[str]:
        """Return synthesis history texts."""
        return self._history_manager.get_history()

    def play_history(self, history_id: int) -> None:
        """Play a historical recording."""
        self._history_manager.play_history(history_id)

    def delete_history(self, history_id: int) -> None:
        """Delete a history entry."""
        self._history_manager.delete_history(history_id)

    def clear_history(self) -> None:
        """Clear all history."""
        self._history_manager.clear_history()

    # =========================================================================
    # Hotkeys
    # =========================================================================

    def list_hotkeys(self) -> list[dict]:
        """Return assigned hotkey entries."""
        return self._hotkey_manager.list_hotkeys()

    def assign_hotkey(self, hotkey: str, text: str) -> None:
        """Assign a hotkey to a phrase."""
        self._hotkey_manager.assign_hotkey(hotkey, text)

    def play_hotkey(self, hotkey_id: int) -> None:
        """Play a hotkeyed phrase."""
        self._hotkey_manager.play_hotkey(hotkey_id)

    def delete_hotkey(self, hotkey_id: int) -> None:
        """Delete a hotkey entry."""
        self._hotkey_manager.delete_hotkey(hotkey_id)

    def clear_hotkeys(self) -> None:
        """Clear all hotkeys."""
        self._hotkey_manager.clear_hotkeys()
