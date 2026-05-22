import json
import logging
import time
from pathlib import Path

from PySide6.QtCore import Qt, QUrl, QEvent, QTimer
from PySide6.QtWidgets import QMainWindow, QApplication
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel

try:
    from PySide6.QtWebEngineCore import QWebEnginePage
except ImportError:
    from PySide6.QtWebEngineWidgets import QWebEnginePage

from .bridge import Bridge

logger = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"


class ConsoleWebEnginePage(QWebEnginePage):
    """QWebEnginePage subclass that redirects JS console messages to Python logging."""
    def javaScriptConsoleMessage(self, level, message, line, source_id):
        try:
            lvl_map = {
                QWebEnginePage.JavaScriptConsoleMessageLevel.InfoMessageLevel: logging.INFO,
                QWebEnginePage.JavaScriptConsoleMessageLevel.WarningMessageLevel: logging.WARNING,
                QWebEnginePage.JavaScriptConsoleMessageLevel.ErrorMessageLevel: logging.ERROR,
            }
            lvl = lvl_map.get(level, logging.INFO)
        except AttributeError:
            lvl = logging.INFO
        logger.log(lvl, f"[JS Console] {message} ({source_id}:{line})")


class SettingsWindow(QMainWindow):
    """
    Frameless, transparent popup window for application settings.
    Shares the same Bridge object as the main window for IPC.
    """

    SETTINGS_WIDTH = 340
    SETTINGS_HEIGHT = 520

    def __init__(self, bridge: Bridge, parent=None):
        super().__init__(parent)
        self._bridge = bridge
        self._show_time = 0.0

        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFixedSize(self.SETTINGS_WIDTH, self.SETTINGS_HEIGHT)

        # Web engine view
        self._web_view = QWebEngineView(self)
        self._web_view.setPage(ConsoleWebEnginePage(self._web_view))
        self._web_view.setStyleSheet("background: transparent;")
        self._web_view.page().setBackgroundColor(Qt.GlobalColor.transparent)
        self.setCentralWidget(self._web_view)

        # Web channel — separate channel instance but same bridge object
        self._channel = QWebChannel(self._web_view.page())
        self._channel.registerObject("bridge", self._bridge)
        self._web_view.page().setWebChannel(self._channel)

        # Connect close signal
        self._bridge.close_settings_requested.connect(self.hide)

        # Load HTML
        html_path = WEB_DIR / "settings.html"
        self._web_view.setUrl(QUrl.fromLocalFile(str(html_path)))

    def show_at(self, main_window, button_bounds_json: str):
        """
        Position the settings window directly above the settings button
        and show it. Toggles visibility if already shown.
        """
        if self.isVisible():
            self.hide()
            return

        hide_time = getattr(self, "_hide_time", 0.0)
        if time.time() - hide_time < 0.2:
            return

        try:
            bounds = json.loads(button_bounds_json)
        except (json.JSONDecodeError, TypeError):
            bounds = {"x": 0, "y": 0, "width": 48, "height": 48}

        main_pos = main_window.pos()
        x = main_pos.x() + int(bounds.get("x", 0))
        y = main_pos.y() + int(bounds.get("y", 0)) - self.SETTINGS_HEIGHT - 16

        self.move(x, y)
        self._show_time = time.time()
        self.show()

        # Refresh settings data without page reload
        self._web_view.page().runJavaScript("if (typeof loadSettings !== 'undefined') loadSettings();")

        # Delay activation/focus slightly to ensure it happens after OS click propagation
        QTimer.singleShot(150, self._force_focus_and_activation)

    def _force_focus_and_activation(self):
        if self.isVisible():
            self.raise_()
            self.activateWindow()
            self._web_view.setFocus()

    def changeEvent(self, event):
        if event.type() == QEvent.Type.ActivationChange:
            # Only hide if the window has been visible for a bit to avoid race conditions during show
            if time.time() - getattr(self, "_show_time", 0.0) > 0.3:
                if not self.isActiveWindow() and self.isVisible():
                    self.hide()
                    self._hide_time = time.time()
        super().changeEvent(event)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape:
            self._bridge.escape_pressed.emit()
            event.accept()
        else:
            super().keyPressEvent(event)

    def closeEvent(self, event):
        """Hide instead of destroy."""
        event.ignore()
        self.hide()
