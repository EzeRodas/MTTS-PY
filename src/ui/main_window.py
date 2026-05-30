"""
Main application window containing the TTS input bar.
Uses QWebEngineView to render the HTML/CSS/JS frontend.
"""
import json
import logging
from pathlib import Path

from PySide6.QtCore import Qt, QUrl, QEvent
from PySide6.QtWidgets import QMainWindow, QApplication
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel

from .bridge import Bridge
from .settings_window import ConsoleWebEnginePage

logger = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"


class MainWindow(QMainWindow):
    """
    Frameless, transparent window hosting the TTS input bar via QWebEngineView.
    Positioned at the bottom-center of the primary screen.
    """

    WINDOW_WIDTH = 1056
    WINDOW_HEIGHT = 80

    def __init__(self, bridge: Bridge, parent=None):
        super().__init__(parent)
        self._bridge = bridge
        self._drag_start_pos = None
        self._window_start_pos = None

        # Window flags: frameless, always on top, transparent
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool  # Prevents taskbar entry
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFixedSize(self.WINDOW_WIDTH, self.WINDOW_HEIGHT)

        # Web engine view
        self._web_view = QWebEngineView(self)
        self._web_view.setPage(ConsoleWebEnginePage(self._web_view))
        self._web_view.setStyleSheet("background: transparent;")
        self._web_view.page().setBackgroundColor(Qt.GlobalColor.transparent)
        self.setCentralWidget(self._web_view)

        # Web channel (bridge between Python and JS)
        self._channel = QWebChannel(self._web_view.page())
        self._channel.registerObject("bridge", self._bridge)
        self._web_view.page().setWebChannel(self._channel)

        # Connect bridge signals
        self._bridge.close_app_requested.connect(self._on_close_requested)
        self._bridge.drag_start_requested.connect(self._on_drag_start)
        self._bridge.drag_move_requested.connect(self._on_drag_move)
        self._bridge.default_monitor_changed.connect(self._on_default_monitor_changed)

        # Load HTML
        html_path = WEB_DIR / "index.html"
        self._web_view.setUrl(QUrl.fromLocalFile(str(html_path)))

        # Position at bottom center
        self._position_at_bottom_center()

    def _position_at_bottom_center(self):
        """Place the window at the bottom-center of the configured screen."""
        screens = QApplication.screens()
        monitor_idx = 0
        try:
            config = json.loads(self._bridge.getAppConfig())
            monitor_idx = int(config.get("defaultMonitor", 0))
        except Exception:
            pass

        screen = None
        if 0 <= monitor_idx < len(screens):
            screen = screens[monitor_idx]
        else:
            screen = QApplication.primaryScreen()

        if screen:
            geo = screen.availableGeometry()
            x = geo.x() + (geo.width() - self.WINDOW_WIDTH) // 2
            y = geo.y() + geo.height() - self.WINDOW_HEIGHT
            self.move(x, y)

    def _on_default_monitor_changed(self, monitor_idx: int):
        self._position_at_bottom_center()

    def _on_close_requested(self):
        """Hide instead of close (tray app behavior)."""
        self.hide()

    def _on_drag_start(self, screen_x: int, screen_y: int):
        """Begin window drag from the given screen coordinates."""
        self._drag_start_pos = (screen_x, screen_y)
        self._window_start_pos = (self.x(), self.y())

    def _on_drag_move(self, screen_x: int, screen_y: int):
        """Move window by the delta from drag start."""
        if self._drag_start_pos and self._window_start_pos:
            dx = screen_x - self._drag_start_pos[0]
            dy = screen_y - self._drag_start_pos[1]
            self.move(
                self._window_start_pos[0] + dx,
                self._window_start_pos[1] + dy,
            )

    def closeEvent(self, event):
        """Override close to hide instead, unless app is quitting."""
        if QApplication.instance().property("is_quitting"):
            event.accept()
        else:
            event.ignore()
            self.hide()

    def showEvent(self, event):
        super().showEvent(event)
        self._web_view.setFocus()

    def changeEvent(self, event):
        if event.type() == QEvent.Type.ActivationChange:
            if self.isActiveWindow():
                self._web_view.setFocus()
        super().changeEvent(event)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape:
            self._bridge.escape_pressed.emit()
            event.accept()
        else:
            super().keyPressEvent(event)
