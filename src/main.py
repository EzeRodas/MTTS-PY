"""
Moon-TTS — PySide6 Application Entry Point

Single-instance desktop TTS application with:
- QWebEngineView UI (HTML/CSS/JS frontend)
- Kokoro 82M ONNX TTS engine
- sounddevice audio playback with device selection
- System tray integration
- CLI toggle support (--show, --hide, --toggle)
"""
import sys
import os
import json
import logging
import signal
from pathlib import Path

# ---------------------------------------------------------------------------
# Platform-specific display setup (must happen before QApplication)
# ---------------------------------------------------------------------------
if sys.platform == "linux":
    # Force X11/XWayland mode on Linux to allow absolute window positioning and transparency.
    os.environ["QT_QPA_PLATFORM"] = "xcb"

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import QSharedMemory, QByteArray, Qt
from PySide6.QtNetwork import QLocalServer, QLocalSocket

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("Moon-TTS")

APP_NAME = "Moon-TTS"
SOCKET_NAME = "moon-tts-single-instance"


def send_command_to_running_instance(args: list[str]) -> bool:
    """
    Attempt to connect to an already-running instance and send CLI arguments.
    Returns True if a running instance was found and the command was sent.
    """
    socket = QLocalSocket()
    socket.connectToServer(SOCKET_NAME)
    if socket.waitForConnected(500):
        # Determine command from args
        if "--toggle" in args:
            cmd = "toggle"
        elif "--show" in args:
            cmd = "show"
        elif "--hide" in args:
            cmd = "hide"
        else:
            cmd = "toggle"  # Default: toggle visibility

        socket.write(cmd.encode("utf-8"))
        socket.flush()
        socket.waitForBytesWritten(500)
        socket.disconnectFromServer()
        return True
    return False


def main():
    """Application entry point."""
    # Handle graceful SIGINT (Ctrl+C)
    signal.signal(signal.SIGINT, signal.SIG_DFL)

    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setQuitOnLastWindowClosed(False)  # Tray keeps app alive
    app.setProperty("is_quitting", False)

    # -----------------------------------------------------------------
    # Single-instance check
    # -----------------------------------------------------------------
    args = sys.argv[1:]
    if send_command_to_running_instance(args):
        logger.info("Sent command to running instance. Exiting.")
        sys.exit(0)

    # We are the first instance — set up the local server
    # Clean up stale socket file on Linux
    QLocalServer.removeServer(SOCKET_NAME)
    local_server = QLocalServer()
    if not local_server.listen(SOCKET_NAME):
        logger.error(f"Failed to start local server: {local_server.errorString()}")

    # -----------------------------------------------------------------
    # Bootstrap backend services
    # -----------------------------------------------------------------
    from src.core.settings_manager import SettingsManager
    from src.infrastructure.audio_service import AudioService
    from src.core.history_manager import HistoryManager
    from src.infrastructure.kokoro import KokoroTTSProvider
    from src.core.hotkey_manager import HotkeyManager
    from src.core.app_controller import AppController

    settings_manager = SettingsManager()
    audio_service = AudioService()
    history_manager = HistoryManager(audio_service, settings_manager)
    tts_provider = KokoroTTSProvider(settings_manager, audio_service, history_manager)
    hotkey_manager = HotkeyManager(tts_provider, audio_service, settings_manager)
    hotkey_manager.init()

    # Initialize app config on disk
    settings_manager.get_app_config()

    app_controller = AppController(
        tts_provider, settings_manager, audio_service, hotkey_manager, history_manager
    )

    # -----------------------------------------------------------------
    # Build UI
    # -----------------------------------------------------------------
    from src.ui.bridge import Bridge
    from src.ui.main_window import MainWindow
    from src.ui.settings_window import SettingsWindow
    from src.ui.tray import TrayIcon

    bridge = Bridge(app_controller)
    main_window = MainWindow(bridge)
    settings_window = SettingsWindow(bridge)

    # Wire settings open/close signals
    bridge.open_settings_requested.connect(
        lambda bounds_json: settings_window.show_at(main_window, bounds_json)
    )

    # -----------------------------------------------------------------
    # Global hotkey listener (Ctrl+Alt+M toggle)
    # -----------------------------------------------------------------
    from src.infrastructure.global_shortcut import GlobalHotkeyManager

    hotkey_mgr = GlobalHotkeyManager()

    def toggle_app_visibility():
        if main_window.isVisible():
            main_window.hide()
            settings_window.hide()
        else:
            main_window.show()
            main_window.raise_()
            main_window.activateWindow()

    hotkey_mgr.activated.connect(toggle_app_visibility, Qt.QueuedConnection)

    # Load and register initial app shortcut
    app_config = settings_manager.get_app_config()
    initial_shortcut = app_config.get("appShortcut", "Ctrl+Alt+M")
    if initial_shortcut:
        hotkey_mgr.register_shortcut(initial_shortcut)

    # Listen for shortcut changes from settings UI
    bridge.app_shortcut_changed.connect(hotkey_mgr.register_shortcut)

    # System tray
    tray = TrayIcon(main_window)
    tray.show()

    # Show main window (unless --hide was passed)
    if "--hide" not in args:
        main_window.show()

    # -----------------------------------------------------------------
    # Handle commands from second instances
    # -----------------------------------------------------------------
    def handle_new_connection():
        client = local_server.nextPendingConnection()
        if client:
            client.waitForReadyRead(500)
            data = client.readAll().data().decode("utf-8").strip()
            logger.info(f"Received command from second instance: {data}")
            client.disconnectFromServer()

            if data == "toggle":
                if main_window.isVisible():
                    main_window.hide()
                else:
                    main_window.show()
                    main_window.raise_()
                    main_window.activateWindow()
            elif data == "show":
                main_window.show()
                main_window.raise_()
                main_window.activateWindow()
            elif data == "hide":
                main_window.hide()

    local_server.newConnection.connect(handle_new_connection)

    # -----------------------------------------------------------------
    # Run event loop
    # -----------------------------------------------------------------
    exit_code = app.exec()
    hotkey_mgr.unregister()
    local_server.close()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
