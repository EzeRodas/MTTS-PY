"""
QWebChannel bridge exposing Python backend methods to the JS frontend.
Replaces Electron's preload.ts + ipcMain handler pattern.
"""
import json
import logging
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
from functools import wraps

from PySide6.QtCore import QObject, Slot, Signal

logger = logging.getLogger(__name__)

# Global thread pool for offloading blocking tasks
_executor = ThreadPoolExecutor(max_workers=4)

def background_task(func):
    """
    Decorator to run a bridge method in a background thread.
    Useful for heavy operations (I/O, network) to avoid freezing the UI.
    """
    @wraps(func)
    def wrapper(self, *args, **kwargs):
        _executor.submit(func, self, *args, **kwargs)
    return wrapper


class Bridge(QObject):
    """
    QObject exposed to QWebEngineView via QWebChannel.
    JS code calls methods on `window.api` which map to @Slot methods here.
    
    All complex data is serialized as JSON strings across the bridge boundary,
    since QWebChannel only supports primitive types natively.
    """

    # Signals emitted to the UI layer (Qt side)
    close_app_requested = Signal()
    quit_app_requested = Signal()
    open_settings_requested = Signal(str)  # JSON string of button bounds
    close_settings_requested = Signal()
    expand_settings_requested = Signal(bool)
    drag_start_requested = Signal(int, int)  # screenX, screenY
    drag_move_requested = Signal(int, int)   # screenX, screenY
    app_shortcut_changed = Signal(str)       # New shortcut string
    escape_pressed = Signal()
    default_monitor_changed = Signal(int)    # Default monitor changed
    app_ready = Signal()                     # Emitted when initialization is done
    backend_initialized = Signal(object)     # Emitted from bg thread with AppController
    shortcut_updated_by_os = Signal(str)     # Emitted when OS changes the shortcut
    
    # Model download & setup signals
    download_progress = Signal(int, int, str) # bytes_read, total_bytes, filename
    download_complete = Signal(bool, str)     # success, error_msg
    setup_finished = Signal()                 # Emitted when setup is completed or skipped
    settings_updated = Signal()               # Emitted when any settings change

    def __init__(self, app_controller=None, parent=None, event_bus=None):
        super().__init__(parent)
        self._controller = app_controller
        self._model_manager = None
        self._event_bus = event_bus
        self.is_dialog_open = False
        self.is_ready = False
        
        import threading
        self._synth_lock = threading.Lock()
        self._synthesizing = False
        
        if self._event_bus:
            self._event_bus.subscribe("settings_changed", self._on_settings_changed)

    def _on_settings_changed(self, data):
        self.settings_updated.emit()

    def set_model_manager(self, mm):
        """Set the model manager directly (available before controller)."""
        self._model_manager = mm
        mm.add_progress_callback(self.download_progress.emit)
        mm.add_complete_callback(self._on_download_complete)

    def _on_download_complete(self, success: bool, error: str):
        """Forward download_complete and reload engine if successful."""
        self.download_complete.emit(success, error)
        if success and self._controller:
            try:
                self._controller.reload_engine()
            except Exception as e:
                logger.error(f"Failed to reload engine after download: {e}")

    def set_controller(self, controller):
        """Set the app controller after construction (for deferred init)."""
        self._controller = controller


    # =========================================================================
    # TTS Actions
    # =========================================================================

    @Slot(str)
    def submitText(self, text: str):
        """Synthesize and play the given text."""
        if not self._controller:
            return
            
        with self._synth_lock:
            if self._synthesizing:
                return
            self._synthesizing = True
            
        def _run_synth():
            try:
                self._controller.process_input(text)
            except Exception as e:
                logger.error(f"submitText failed: {e}")
            finally:
                with self._synth_lock:
                    self._synthesizing = False

        import threading
        threading.Thread(target=_run_synth, daemon=True).start()

    @Slot(result=bool)
    def isBusy(self) -> bool:
        """Check if synthesis is active or audio is currently playing."""
        synthesis_active = False
        with self._synth_lock:
            synthesis_active = self._synthesizing
            
        playback_active = False
        if self._controller and self._controller._audio_service:
            playback_active = self._controller._audio_service.is_playing()
            
        return synthesis_active or playback_active

    @Slot()
    def stop(self):
        """Abort current synthesis and playback immediately."""
        logger.info("Stop requested by user via bridge.")
        if self._controller:
            self._controller.cancel_synthesis()

    # =========================================================================
    # Model & Voice
    # =========================================================================

    @Slot(result=str)
    def getModels(self) -> str:
        """Return JSON array of available model names."""
        if self._controller:
            return json.dumps(self._controller.list_models())
        return "[]"

    @Slot(result=str)
    def getActiveModel(self) -> str:
        """Return the currently active model name."""
        if self._controller:
            return self._controller.get_active_model()
        return ""

    @Slot(str)
    def setModel(self, model: str):
        """Set the active TTS model."""
        if self._controller:
            self._controller.set_model(model)

    @Slot(result=str)
    def getVoices(self) -> str:
        """Return JSON array of available voice IDs."""
        if self._controller:
            voices = self._controller.list_voices()
            return json.dumps(voices)
        return "[]"

    @Slot(result=str)
    def getActiveVoice(self) -> str:
        """Return the currently active voice ID."""
        if self._controller:
            return self._controller.get_active_voice()
        return ""

    @Slot(str)
    def setVoice(self, voice: str):
        """Set the active voice."""
        if self._controller:
            self._controller.set_voice(voice)

    # =========================================================================
    # App Config
    # =========================================================================

    @Slot(result=str)
    def getAppConfig(self):
        """Invoked by UI to get application configuration."""
        if self._controller:
            return json.dumps(self._controller.get_app_config())
        return "{}"

    @Slot(result=str)
    def getSystemInfo(self):
        """Invoked by UI to get OS information."""
        import sys
        return json.dumps({"platform": sys.platform})

    @Slot(str)
    @background_task
    def updateAppConfig(self, config_json: str):
        """Update app config with a partial JSON object."""
        if self._controller:
            try:
                config = json.loads(config_json)
                self._controller.update_app_config(config)
                if "appShortcut" in config:
                    self.app_shortcut_changed.emit(config["appShortcut"])
                if "defaultMonitor" in config:
                    self.default_monitor_changed.emit(int(config["defaultMonitor"]))
            except json.JSONDecodeError as e:
                logger.error(f"updateAppConfig: invalid JSON: {e}")

    @Slot(str)
    @background_task
    def updateEngineConfig(self, config_json: str):
        """Update engine config with a partial JSON object."""
        if self._controller:
            try:
                config = json.loads(config_json)
                self._controller.update_engine_config("kokoro", config)
            except json.JSONDecodeError as e:
                logger.error(f"updateEngineConfig: invalid JSON: {e}")

    @Slot(result=bool)
    def isReady(self) -> bool:
        """Return True if background initialization has completed."""
        return self.is_ready

    @Slot(result=str)
    def browseDirectory(self) -> str:
        """Open a native folder selection dialog and return the chosen path."""
        from PySide6.QtWidgets import QFileDialog
        self.is_dialog_open = True
        try:
            path = QFileDialog.getExistingDirectory(
                None,
                "Select Models Directory",
                "",
                QFileDialog.Option.ShowDirsOnly
            )
            return path
        finally:
            self.is_dialog_open = False

    @Slot(result=str)
    def getScreens(self) -> str:
        """Return JSON list of available screens/monitors."""
        from PySide6.QtWidgets import QApplication
        screens = QApplication.screens()
        result = []
        for i, s in enumerate(screens):
            name = s.name()
            if not name:
                name = f"Monitor {i + 1}"
            else:
                name = f"Monitor {i + 1} ({name})"
            result.append({"index": i, "name": name})
        return json.dumps(result)

    # =========================================================================
    # Audio Devices
    # =========================================================================

    @Slot(result=str)
    def getDevices(self) -> str:
        """Return JSON array of audio output devices."""
        if self._controller:
            return json.dumps(self._controller.get_devices())
        return "[]"

    # =========================================================================
    # Window Management
    # =========================================================================

    @Slot()
    def closeApp(self):
        """Request the main window to close/hide."""
        self.close_app_requested.emit()

    @Slot()
    def quitApp(self):
        """Fully quit the application."""
        logger.info("Quit requested via bridge.")
        self.quit_app_requested.emit()

    @Slot(str)
    def openSettings(self, bounds_json: str):
        """Request the settings window to open, positioned relative to the button."""
        self.open_settings_requested.emit(bounds_json)

    @Slot()
    def closeSettings(self):
        """Request the settings window to close."""
        self.close_settings_requested.emit()

    @Slot(bool)
    def expandSettings(self, expanded: bool):
        """Request the settings window to expand or collapse."""
        self.expand_settings_requested.emit(expanded)

    @Slot(str)
    def openUrl(self, url: str):
        """Open the given URL in the system's default browser."""
        from PySide6.QtGui import QDesktopServices
        from PySide6.QtCore import QUrl
        QDesktopServices.openUrl(QUrl(url))

    # =========================================================================
    # History Slots
    # =========================================================================

    @Slot(result=str)
    def getHistory(self) -> str:
        """Return JSON list of history text entries."""
        if self._controller:
            return json.dumps(self._controller.get_history())
        return "[]"

    @Slot(int)
    @background_task
    def playHistory(self, history_id: int):
        """Play historical audio by ID."""
        if self._controller:
            self._controller.play_history(history_id)

    @Slot(int)
    def deleteHistory(self, history_id: int):
        """Delete historical entry by ID."""
        if self._controller:
            self._controller.delete_history(history_id)

    @Slot()
    @background_task
    def clearHistory(self):
        """Clear all historical recordings."""
        if self._controller:
            self._controller.clear_history()

    # =========================================================================
    # Dictionary Slots
    # =========================================================================

    @Slot(result=str)
    def getDictionary(self) -> str:
        """Return JSON list of dictionary entries."""
        if self._controller:
            return json.dumps(self._controller.get_dictionary())
        return "[]"

    @Slot(str, str, bool, result=bool)
    def addDictionaryEntry(self, original: str, spelling: str, case_sensitive: bool) -> bool:
        """Add a new dictionary replacement entry."""
        if self._controller:
            return self._controller.add_dictionary_entry(original, spelling, case_sensitive)
        return False

    @Slot(int, str, str, bool, result=bool)
    def updateDictionaryEntry(self, index: int, original: str, spelling: str, case_sensitive: bool) -> bool:
        """Update an existing dictionary replacement entry."""
        if self._controller:
            return self._controller.update_dictionary_entry(index, original, spelling, case_sensitive)
        return False

    @Slot(int, result=bool)
    def deleteDictionaryEntry(self, index: int) -> bool:
        """Delete a dictionary replacement entry."""
        if self._controller:
            return self._controller.delete_dictionary_entry(index)
        return False

    @Slot(str)
    @background_task
    def testDictionarySpelling(self, spelling: str):
        """Preview a dictionary spelling through the monitoring device."""
        if self._controller:
            self._controller.preview_dictionary_spelling(spelling)

    # =========================================================================
    # Synthesis Speed
    # =========================================================================

    @Slot(result=float)
    def getSpeed(self) -> float:
        """Return the current Kokoro synthesis speed."""
        if self._controller:
            return self._controller.get_speed()
        return 1.0

    @Slot(float)
    def setSpeed(self, speed: float):
        """Set the Kokoro synthesis speed."""
        if self._controller:
            self._controller.set_speed(speed)

    # =========================================================================
    # Hotkey Slots
    # =========================================================================

    @Slot(result=str)
    def getHotkeys(self) -> str:
        """Return JSON list of hotkeys."""
        if self._controller:
            return json.dumps(self._controller.list_hotkeys())
        return "[]"

    @Slot(str, str)
    def assignHotkey(self, hotkey: str, text: str):
        """Assign a hotkey to a text phrase."""
        if self._controller:
            self._controller.assign_hotkey(hotkey, text)

    @Slot(str)
    def playHotkey(self, hotkey_id: str) -> None:
        """Invoked by UI to play a saved hotkey phrase."""
        if self._controller:
            self._controller.play_hotkey(hotkey_id)

    @Slot(str)
    def deleteHotkey(self, hotkey_id: str) -> None:
        """Invoked by UI to delete a saved hotkey phrase."""
        if self._controller:
            self._controller.delete_hotkey(hotkey_id)

    @Slot()
    @background_task
    def clearHotkeys(self):
        """Clear all hotkeys."""
        if self._controller:
            self._controller.clear_hotkeys()

    # =========================================================================
    # Drag Support
    # =========================================================================

    @Slot(int, int)
    def startDrag(self, screen_x: int, screen_y: int):
        """Begin window drag from the given screen coordinates."""
        self.drag_start_requested.emit(screen_x, screen_y)

    @Slot(int, int)
    def doDrag(self, screen_x: int, screen_y: int):
        """Continue window drag to the given screen coordinates."""
        self.drag_move_requested.emit(screen_x, screen_y)

    @Slot()
    def escapePressed(self):
        """Handle escape key press from the frontend to hide all windows."""
        self.escape_pressed.emit()


    # =========================================================================
    # Model Management
    # =========================================================================

    @Slot(str)
    def downloadModel(self, precision: str):
        logger.info(f"downloadModel called with precision={precision}")
        if self._model_manager:
            self._model_manager.download_model("kokoro", precision)
        else:
            logger.error("downloadModel: _model_manager is None!")

    @Slot(result=bool)
    def deleteModel(self) -> bool:
        if self._model_manager:
            res = self._model_manager.delete_model("kokoro", "")
            if self._controller:
                _executor.submit(self._controller.reload_engine)
            return res
        return False

    @Slot(str, result=bool)
    def deleteModelWithPrecision(self, precision: str) -> bool:
        if self._model_manager:
            res = self._model_manager.delete_model("kokoro", precision)
            if self._controller:
                _executor.submit(self._controller.reload_engine)
            return res
        return False

    @Slot(result=bool)
    def isModelInstalled(self) -> bool:
        if self._model_manager:
            return self._model_manager.is_model_installed("kokoro", "")
        return False

    @Slot(result=str)
    def getEngineName(self) -> str:
        if self._controller:
            active_model = self._controller.get_active_model()
            if active_model:
                engine_id = active_model.split('_')[0]
                if self._model_manager:
                    return self._model_manager.get_engine_name(engine_id)
        if self._model_manager and self._model_manager._installers:
            first_engine_id = list(self._model_manager._installers.keys())[0]
            return self._model_manager.get_engine_name(first_engine_id)
        return "Kokoro"

    @Slot(str, result=bool)
    def isModelInstalledWithPrecision(self, precision: str) -> bool:
        if self._model_manager:
            return self._model_manager.is_model_installed("kokoro", precision)
        return False

    @Slot(result=str)
    def getInstalledPrecisions(self) -> str:
        if self._model_manager:
            return json.dumps(self._model_manager.get_installed_precisions("kokoro"))
        return "[]"

    @Slot(result=bool)
    def isDownloadRunning(self) -> bool:
        if self._model_manager:
            return self._model_manager.is_download_running()
        return False
        
    @Slot(result=bool)
    def isEngineAvailable(self) -> bool:
        """Check if the TTS engine has models and is ready."""
        if self._controller:
            return self._controller.check_tts_engine_status()
        return False

    @Slot()
    def finishSetup(self):
        self.setup_finished.emit()

    @Slot()
    def skipSetup(self):
        if self._controller:
            self._controller.update_app_config({"initialSetupComplete": True})
        self.setup_finished.emit()
