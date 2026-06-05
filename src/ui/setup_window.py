import os
import logging
from pathlib import Path
from PySide6.QtCore import Qt, QUrl
from PySide6.QtWidgets import QWidget, QVBoxLayout

from .base_window import BaseWebWindow

logger = logging.getLogger(__name__)

class SetupWindow(BaseWebWindow):
    def __init__(self, bridge):
        html_path = Path(__file__).parent / "web" / "setup.html"
        super().__init__(
            bridge=bridge, 
            html_path=html_path, 
            frameless=True, 
            transparent=False, 
            parent=None, 
            console_prefix="Setup JS"
        )
        self.setWindowTitle("Moon-TTS Initial Setup")
        self.resize(800, 500)
        self.setStyleSheet("background-color: #0f0f13; border-radius: 12px; border: 1px solid #2a2a35;")
        
        # Enable dragging the window
        self._web_view.page().loadFinished.connect(self._inject_drag_script)
        
        self._bridge.drag_start_requested.connect(self._handle_drag_start)
        self._bridge.drag_move_requested.connect(self._handle_drag_move)
        
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
        js = """
        if (!window.dragInjected) {
            window.dragInjected = true;
            document.addEventListener('mousedown', (e) => {
                if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
                    bridge.dragStart(e.screenX, e.screenY);
                }
            });
            document.addEventListener('mousemove', (e) => {
                if (e.buttons === 1) {
                    bridge.dragMove(e.screenX, e.screenY);
                }
            });
        }
        """
        self._web_view.page().runJavaScript(js)
