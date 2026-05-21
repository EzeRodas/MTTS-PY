"""
QWebChannel bridge exposing Python backend methods to the JS frontend.
Replaces Electron's preload.ts + ipcMain handler pattern.
"""
import json
import logging
from typing import Optional

from PySide6.QtCore import QObject, Slot, Signal

logger = logging.getLogger(__name__)


class Bridge(QObject):
    """
    QObject exposed to QWebEngineView via QWebChannel.
    JS code calls methods on `window.api` which map to @Slot methods here.
    
    All complex data is serialized as JSON strings across the bridge boundary,
    since QWebChannel only supports primitive types natively.
    """

    # Signals emitted to the UI layer (Qt side)
    close_app_requested = Signal()
    open_settings_requested = Signal(str)  # JSON string of button bounds
    close_settings_requested = Signal()
    drag_start_requested = Signal(int, int)  # screenX, screenY
    drag_move_requested = Signal(int, int)   # screenX, screenY
    app_shortcut_changed = Signal(str)       # New shortcut string

    def __init__(self, app_controller=None, parent=None):
        super().__init__(parent)
        self._controller = app_controller

    def set_controller(self, controller):
        """Set the app controller after construction (for deferred init)."""
        self._controller = controller

    # =========================================================================
    # TTS Actions
    # =========================================================================

    @Slot(str)
    def submitText(self, text: str):
        """Synthesize and play the given text."""
        if self._controller:
            try:
                self._controller.process_input(text)
            except Exception as e:
                logger.error(f"submitText failed: {e}")

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
    def getAppConfig(self) -> str:
        """Return the full app config as a JSON string."""
        if self._controller:
            return json.dumps(self._controller.get_app_config())
        return "{}"

    @Slot(str)
    def updateAppConfig(self, config_json: str):
        """Update app config with a partial JSON object."""
        if self._controller:
            try:
                config = json.loads(config_json)
                self._controller.update_app_config(config)
                if "appShortcut" in config:
                    self.app_shortcut_changed.emit(config["appShortcut"])
            except json.JSONDecodeError as e:
                logger.error(f"updateAppConfig: invalid JSON: {e}")

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

    @Slot(str)
    def openSettings(self, bounds_json: str):
        """Request the settings window to open, positioned relative to the button."""
        self.open_settings_requested.emit(bounds_json)

    @Slot()
    def closeSettings(self):
        """Request the settings window to close."""
        self.close_settings_requested.emit()

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
