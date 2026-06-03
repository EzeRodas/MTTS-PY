"""
Application controller coordinating TTS, settings, audio, history, and hotkeys.
Port of the TypeScript AppController.ts.
"""
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


from src.core.dictionary_manager import DictionaryManager

class AppController:
    """
    Facade coordinating the core domain services of the TTS application.
    Decouples UI layers (both CLI and Qt frontend) from underlying business logic.
    """

    def __init__(
        self,
        tts_service: Any,
        settings_manager: Any,
        audio_service: Any,
        hotkey_manager: Any,
        history_manager: Any,
        model_manager: Any = None
    ) -> None:
        """Initialise the application controller.

        Args:
            tts_service: The core Text-to-Speech provider.
            settings_manager: System for reading/writing configuration.
            audio_service: Audio playback subsystem.
            hotkey_manager: Service for handling global shortcut actions.
            history_manager: Logging system for synthesized text history.
            model_manager: Handles downloading and managing TTS models.
        """
        self._tts_service = tts_service
        self._settings_manager = settings_manager
        self._audio_service = audio_service
        self._hotkey_manager = hotkey_manager
        self._history_manager = history_manager
        self._model_manager = model_manager
        self._dictionary_manager = DictionaryManager(settings_manager)
        self._available_models = self.list_models()
        saved_active = self._settings_manager.get_app_config().get("activeModel", "")
        if saved_active in self._available_models:
            self._active_model = saved_active
        else:
            self._active_model = self._available_models[0] if self._available_models else ""

    # =========================================================================
    # TTS
    # =========================================================================

    def process_input(self, text: str) -> None:
        """Synthesize and play back the given text."""
        try:
            # Apply dictionary replacements
            processed_text = self._dictionary_manager.replace_text(text)
            self._tts_service.speak(processed_text)
        except Exception as e:
            logger.error(f"Error processing TTS input: {e}")

    # =========================================================================
    # Models
    # =========================================================================

    def list_models(self) -> list[str]:
        """Return available TTS engine identifiers with precision suffix."""
        if hasattr(self._tts_service, "is_available") and self._tts_service.is_available():
            if self._model_manager and hasattr(self._model_manager, "get_installed_precisions"):
                precisions = self._model_manager.get_installed_precisions()
                if precisions:
                    return [f"kokoro_{p}" for p in precisions]
            config = self._settings_manager.get_app_config()
            precision = config.get("kokoroPrecision", "")
            name = f"kokoro_{precision}" if precision else "kokoro"
            return [name]
        return []

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
            self._settings_manager.update_app_config({"activeModel": model_name})
            if hasattr(self._tts_service, "reload_model"):
                self._tts_service.reload_model()
            return True
        return False

    def reload_engine(self) -> None:
        """Re-check engine availability and preload if a model is now present."""
        if hasattr(self._tts_service, "is_available") and self._tts_service.is_available():
            try:
                if hasattr(self._tts_service, "reload_model"):
                    self._tts_service.reload_model()
                else:
                    self._tts_service.preload_model()
                models = self.list_models()
                saved_active = self._settings_manager.get_app_config().get("activeModel", "")
                if saved_active in models:
                    self._active_model = saved_active
                elif models:
                    self._active_model = models[0]
                logger.info(f"Engine reloaded. Active model: {self._active_model}")
            except Exception as e:
                logger.error(f"Failed to reload engine: {e}")

    # =========================================================================
    # Voices
    # =========================================================================

    def list_voices(self) -> list[str]:
        """Return voice IDs from the active TTS provider."""
        if hasattr(self._tts_service, "is_available") and not self._tts_service.is_available():
            return []
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

        if "openOnStartup" in config:
            import sys
            if sys.platform == "win32":
                self._handle_windows_startup(config["openOnStartup"])

    def _handle_windows_startup(self, enable: bool) -> None:
        try:
            import winreg
            import sys
            from pathlib import Path
            
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, 
                r"Software\Microsoft\Windows\CurrentVersion\Run", 
                0, 
                winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE
            )
            
            app_name = "MoonTTS"
            
            if enable:
                main_script = Path(sys.argv[0]).resolve()
                if main_script.suffix == ".py":
                    cmd = f'"{sys.executable}" "{main_script}"'
                else:
                    cmd = f'"{sys.executable}"'
                
                winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, cmd)
            else:
                try:
                    winreg.DeleteValue(key, app_name)
                except FileNotFoundError:
                    pass
            winreg.CloseKey(key)
        except Exception as e:
            logger.error(f"Failed to set Windows startup registry: {e}")

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

    def set_hotkeys_changed_callback(self, callback) -> None:
        """Set a callback to be invoked when hotkeys change."""
        self._hotkey_manager.set_hotkeys_changed_callback(callback)

    def list_hotkeys(self) -> list[dict]:
        """Return assigned hotkey entries."""
        return self._hotkey_manager.list_hotkeys()

    def assign_hotkey(self, hotkey: str, text: str) -> None:
        """Assign a hotkey to a phrase."""
        self._hotkey_manager.assign_hotkey(hotkey, text)

    def play_hotkey(self, hotkey_id: str) -> None:
        """Play a saved hotkey phrase."""
        self._hotkey_manager.play_hotkey(hotkey_id)

    def delete_hotkey(self, hotkey_id: str) -> None:
        """Delete a saved hotkey phrase."""
        self._hotkey_manager.delete_hotkey(hotkey_id)

    def clear_hotkeys(self) -> None:
        """Clear all hotkeys."""
        self._hotkey_manager.clear_hotkeys()

    # =========================================================================
    # Dictionary
    # =========================================================================

    def get_dictionary(self) -> list[dict]:
        return self._dictionary_manager.get_dictionary()

    def add_dictionary_entry(self, original: str, spelling: str, case_sensitive: bool) -> bool:
        return self._dictionary_manager.add_entry(original, spelling, case_sensitive)

    def update_dictionary_entry(self, index: int, original: str, spelling: str, case_sensitive: bool) -> bool:
        return self._dictionary_manager.update_entry(index, original, spelling, case_sensitive)

    def delete_dictionary_entry(self, index: int) -> bool:
        return self._dictionary_manager.delete_entry(index)

    def preview_dictionary_spelling(self, spelling: str) -> None:
        if hasattr(self._tts_service, "preview_spelling"):
            self._tts_service.preview_spelling(spelling)
        else:
            logger.warning("preview_spelling not supported by active TTS service.")



    # =========================================================================
    # Model Management
    # =========================================================================

    def get_model_manager(self) -> Any:
        return self._model_manager

    def check_tts_engine_status(self) -> bool:
        """Check if TTS engine is available."""
        if hasattr(self._tts_service, "is_available"):
            return self._tts_service.is_available()
        return True
