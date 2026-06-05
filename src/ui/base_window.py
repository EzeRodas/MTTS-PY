import logging
from pathlib import Path
from PySide6.QtCore import Qt, QUrl, QEvent
from PySide6.QtWidgets import QMainWindow
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel

try:
    from PySide6.QtWebEngineCore import QWebEnginePage
except ImportError:
    from PySide6.QtWebEngineWidgets import QWebEnginePage

logger = logging.getLogger(__name__)

class ConsoleWebEnginePage(QWebEnginePage):
    """QWebEnginePage subclass that redirects JS console messages to Python logging."""
    def __init__(self, prefix="JS Console", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._prefix = prefix

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
        logger.log(lvl, f"[{self._prefix}] {message} ({source_id}:{line})")


class BaseWebWindow(QMainWindow):
    """
    Base class for all web-based windows in Moon-TTS.
    Sets up QWebEngineView, frameless transparency (optional), and the QWebChannel bridge.
    """
    
    def __init__(self, bridge, html_path: Path, frameless=True, transparent=True, parent=None, console_prefix="JS Console"):
        super().__init__(parent)
        self._bridge = bridge
        self._drag_start_pos = None
        self._window_start_pos = None

        # Base window flags
        flags = Qt.WindowType.WindowStaysOnTopHint
        if frameless:
            flags |= Qt.WindowType.FramelessWindowHint
        # Only set Tool hint if frameless, else it might behave strangely if it's a normal window
        if frameless:
            flags |= Qt.WindowType.Tool

        self.setWindowFlags(flags)
        
        if transparent:
            self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        # Web engine view
        self._web_view = QWebEngineView(self)
        self._web_view.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        self._web_view.setPage(ConsoleWebEnginePage(prefix=console_prefix, parent=self._web_view))
        
        if transparent:
            self._web_view.setStyleSheet("background: transparent;")
            self._web_view.page().setBackgroundColor(Qt.GlobalColor.transparent)
            
        self.setCentralWidget(self._web_view)
        
        # Web channel
        self._channel = QWebChannel(self._web_view.page())
        if self._bridge:
            self._channel.registerObject("bridge", self._bridge)
        self._web_view.page().setWebChannel(self._channel)

        # Load HTML
        self._web_view.setUrl(QUrl.fromLocalFile(str(html_path.resolve())))

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
