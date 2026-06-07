"""
Main application window containing the TTS input bar.
Uses QWebEngineView to render the HTML/CSS/JS frontend.
"""
import json
import logging
import sys
from pathlib import Path

from PySide6.QtCore import Qt, QUrl, QEvent
from PySide6.QtWidgets import QApplication

from .bridge import Bridge
from .base_window import BaseWebWindow

logger = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"


class MainWindow(BaseWebWindow):
    """
    Frameless, transparent window hosting the TTS input bar via QWebEngineView.
    Positioned at the bottom-center of the primary screen.
    """

    WINDOW_WIDTH = 1056
    WINDOW_HEIGHT = 80

    def __init__(self, bridge: Bridge, parent=None):
        html_path = WEB_DIR / "index.html"
        super().__init__(
            bridge=bridge, 
            html_path=html_path, 
            frameless=True, 
            transparent=True, 
            parent=parent, 
            console_prefix="Main JS"
        )
        self.setFixedSize(self.WINDOW_WIDTH, self.WINDOW_HEIGHT)

        # Connect bridge signals
        self._bridge.close_app_requested.connect(self._on_close_requested)
        self._bridge.quit_app_requested.connect(self._on_quit_requested)
        self._bridge.drag_start_requested.connect(self._on_drag_start)
        self._bridge.drag_move_requested.connect(self._on_drag_move)
        self._bridge.default_monitor_changed.connect(self._on_default_monitor_changed)

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

    def _on_quit_requested(self):
        """Fully quit the application."""
        logger.info("Exiting application...")
        app = QApplication.instance()
        if app:
            app.setProperty("is_quitting", True)
        
        # Close all top-level widgets to trigger cleanups
        for widget in QApplication.topLevelWidgets():
            widget.close()
            
        QApplication.quit()
        sys.exit(0)



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
        self._web_view.page().runJavaScript(
            "if (typeof checkReadiness === 'function') checkReadiness();"
            "if (typeof focusInput === 'function') focusInput();"
        )

    def changeEvent(self, event):
        if event.type() == QEvent.Type.ActivationChange:
            if self.isActiveWindow():
                self._web_view.setFocus()
                self._web_view.page().runJavaScript("if (typeof focusInput === 'function') focusInput();")
        super().changeEvent(event)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape:
            self._bridge.escape_pressed.emit()
            event.accept()
        else:
            super().keyPressEvent(event)
