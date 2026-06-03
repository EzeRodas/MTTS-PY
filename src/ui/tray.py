"""
System tray icon with context menu for Moon-TTS.
Replaces Electron's Tray module.
"""
import logging
from pathlib import Path

from PySide6.QtWidgets import QSystemTrayIcon, QMenu, QApplication
from PySide6.QtGui import QIcon

logger = logging.getLogger(__name__)

ICON_PATH = Path(__file__).parent / "web" / "assets" / "icon.png"


class TrayIcon(QSystemTrayIcon):
    """
    System tray icon with Show/Exit context menu.
    Clicking the tray icon toggles main window visibility.
    """

    def __init__(self, main_window, parent=None):
        super().__init__(parent)
        self._main_window = main_window

        # Set icon
        icon = QIcon(str(ICON_PATH))
        self.setIcon(icon)
        self.setToolTip("Moon-TTS")

        # Context menu
        menu = QMenu()
        show_action = menu.addAction("Show")
        show_action.triggered.connect(self._show_window)
        exit_action = menu.addAction("Exit Moon-TTS")
        exit_action.triggered.connect(self._quit_app)
        self.setContextMenu(menu)

        # Click toggles visibility
        self.activated.connect(self._on_activated)

    def _on_activated(self, reason):
        """Toggle main window on tray icon click."""
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            if self._main_window.isVisible():
                self._main_window.hide()
            else:
                self._show_window()

    def _show_window(self):
        """Show and raise the main window."""
        self._main_window.show()
        self._main_window.raise_()
        self._main_window.activateWindow()

    def _quit_app(self):
        """Quit the application."""
        app = QApplication.instance()
        if app:
            app.setProperty("is_quitting", True)
            
        for widget in QApplication.topLevelWidgets():
            widget.close()
            
        QApplication.quit()
        import sys
        sys.exit(0)
