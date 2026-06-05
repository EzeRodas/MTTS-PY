import os
import logging
from pathlib import Path
from PySide6.QtCore import Qt, QUrl
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWidgets import QWidget, QVBoxLayout

try:
    from PySide6.QtWebEngineCore import QWebEnginePage
except ImportError:
    from PySide6.QtWebEngineWidgets import QWebEnginePage

logger = logging.getLogger(__name__)

class SetupConsolePage(QWebEnginePage):
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
        logger.log(lvl, f"[Setup JS] {message} ({source_id}:{line})")

class SetupWindow(QWidget):
    def __init__(self, bridge):
        super().__init__()
        self.bridge = bridge
        self.setWindowTitle("Moon-TTS Initial Setup")
        self.resize(800, 500)
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground, False)
        
        self.setStyleSheet("background-color: #0f0f13; border-radius: 12px; border: 1px solid #2a2a35;")
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        self.view = QWebEngineView(self)
        self.view.setPage(SetupConsolePage(self.view))
        self.view.page().setBackgroundColor(Qt.transparent)
        
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.view.page().setWebChannel(self.channel)
        
        layout.addWidget(self.view)
        
        html_path = Path(__file__).parent / "web" / "setup.html"
        self.view.setUrl(QUrl.fromLocalFile(str(html_path.resolve())))
        
        # Enable dragging the window
        self.view.page().loadFinished.connect(self._inject_drag_script)
        
        self.bridge.drag_start_requested.connect(self._handle_drag_start)
        self.bridge.drag_move_requested.connect(self._handle_drag_move)
        
        self._drag_start_pos = None
        self._window_start_pos = None

    def _handle_drag_start(self, screen_x, screen_y):
        self._drag_start_pos = (screen_x, screen_y)
        self._window_start_pos = self.pos()

    def _handle_drag_move(self, screen_x, screen_y):
        if self._drag_start_pos is not None and self._window_start_pos is not None:
            dx = screen_x - self._drag_start_pos[0]
            dy = screen_y - self._drag_start_pos[1]
            self.move(self._window_start_pos.x() + dx, self._window_start_pos.y() + dy)

    def _inject_drag_script(self):
        script = """
        let isDragging = false;
        
        document.addEventListener('mousedown', (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'A') {
                isDragging = true;
                bridge_obj.startDrag(e.screenX, e.screenY);
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                bridge_obj.doDrag(e.screenX, e.screenY);
            }
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
        """
        self.view.page().runJavaScript(script)
