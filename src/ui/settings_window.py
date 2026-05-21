"""
Settings popup window rendered via QWebEngineView.
Appears above the settings button when clicked.
"""
import json
import logging
from pathlib import Path

from PySide6.QtCore import Qt, QUrl
from PySide6.QtWidgets import QMainWindow, QApplication
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel

from .bridge import Bridge

logger = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"


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

        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFixedSize(self.SETTINGS_WIDTH, self.SETTINGS_HEIGHT)

        # Web engine view
        self._web_view = QWebEngineView(self)
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

        try:
            bounds = json.loads(button_bounds_json)
        except (json.JSONDecodeError, TypeError):
            bounds = {"x": 0, "y": 0, "width": 48, "height": 48}

        main_pos = main_window.pos()
        x = main_pos.x() + int(bounds.get("x", 0))
        y = main_pos.y() + int(bounds.get("y", 0)) - self.SETTINGS_HEIGHT - 16

        self.move(x, y)
        self.show()

        # Reload settings page to refresh data
        html_path = WEB_DIR / "settings.html"
        self._web_view.setUrl(QUrl.fromLocalFile(str(html_path)))

    def closeEvent(self, event):
        """Hide instead of destroy."""
        event.ignore()
        self.hide()
