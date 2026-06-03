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
sys.dont_write_bytecode = True
import os

# Add project root to sys.path to allow absolute imports when run directly
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

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
from PySide6.QtCore import QSharedMemory, QByteArray, Qt, QObject, Slot
from PySide6.QtNetwork import QLocalServer, QLocalSocket

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("Moon-TTS")

APP_NAME = "Moon-TTS"
SOCKET_NAME = "moon-tts-single-instance"


hotkey_mgr = None


class BootstrapReceiver(QObject):
    def __init__(self, bridge, main_window, settings_window):
        super().__init__()
        self.bridge = bridge
        self.main_window = main_window
        self.settings_window = settings_window

    @Slot(object)
    def on_backend_initialized(self, app_controller):
        try:
            if app_controller is None:
                return

            self.bridge.set_controller(app_controller)

            # Position window on the configured monitor
            try:
                self.main_window._position_at_bottom_center()
            except Exception as e:
                logger.error(f"Error positioning window: {e}")

            # Setup the global hotkey listener on the main thread
            try:
                from src.infrastructure.global_shortcut import GlobalHotkeyManager
                global hotkey_mgr
                hotkey_mgr = GlobalHotkeyManager()

                def toggle_app_visibility():
                    if self.main_window.isVisible():
                        self.main_window.hide()
                        self.settings_window.hide()
                    else:
                        self.main_window.show()
                        self.main_window.raise_()
                        self.main_window.activateWindow()

                hotkey_mgr.activated.connect(toggle_app_visibility, Qt.QueuedConnection)

                def update_all_shortcuts(new_app_shortcut: str = None):
                    app_config = app_controller.get_app_config()
                    toggle_shortcut = new_app_shortcut if new_app_shortcut is not None else app_config.get("appShortcut", "Ctrl+Alt+M")
                    
                    phrases = app_controller.list_hotkeys()
                    hotkey_mgr.register_all_shortcuts(toggle_shortcut, phrases)

                # Connect phrase activation
                hotkey_mgr.phrase_activated.connect(app_controller.play_hotkey, Qt.QueuedConnection)

                # Wire up hotkeys_changed callback from AppController
                app_controller.set_hotkeys_changed_callback(update_all_shortcuts)

                # Load and register initial shortcuts
                update_all_shortcuts()

                # Listen for shortcut changes from settings UI
                def on_app_shortcut_changed(shortcut):
                    update_all_shortcuts(new_app_shortcut=shortcut)
                    
                self.bridge.app_shortcut_changed.connect(on_app_shortcut_changed)
                
                def handle_shortcut_bound(actual_shortcut: str):
                    logger.info(f"Main thread: shortcut bound by OS: {actual_shortcut}")
                    app_controller.update_app_config({"appShortcut": actual_shortcut})
                    self.bridge.shortcut_updated_by_os.emit(actual_shortcut)
                    self.bridge.app_shortcut_changed.emit(actual_shortcut)
                
                hotkey_mgr.shortcut_bound.connect(handle_shortcut_bound, Qt.QueuedConnection)
            except Exception as e:
                logger.error(f"Error setting up hotkey manager: {e}")
        finally:
            # Mark ready and notify the UI under all circumstances
            self.bridge.is_ready = True
            self.bridge.app_ready.emit()
            logger.info("Main thread: Backend linked and app_ready signal emitted.")


def install_desktop_file():
    """Generates and writes a .desktop file to ~/.local/share/applications/moon-tts.desktop"""
    if sys.platform != "linux":
        return
    try:
        desktop_dir = Path.home() / ".local" / "share" / "applications"
        desktop_dir.mkdir(parents=True, exist_ok=True)
        desktop_file_path = desktop_dir / "moon-tts.desktop"
        
        main_py_path = Path(__file__).resolve()
        icon_path = Path(__file__).parent.resolve() / "ui" / "web" / "assets" / "icon.png"
        project_root_path = Path(__file__).resolve().parent.parent
        
        exec_line = f"{sys.executable} {main_py_path}"
        
        content = f"""[Desktop Entry]
Type=Application
Name=Moon-TTS
Comment=Moon-TTS system-wide Text-to-Speech
Exec={exec_line}
Icon={icon_path}
Path={project_root_path}
Terminal=false
Categories=Utility;Audio;
StartupWMClass=moon-tts
"""
        desktop_file_path.write_text(content, encoding="utf-8")
        try:
            import subprocess
            subprocess.run(["update-desktop-database", str(desktop_dir)], check=False)
        except Exception as db_e:
            logger.debug(f"Failed to update desktop database: {db_e}")
        logger.info(f"Installed/updated desktop file at: {desktop_file_path}")
    except Exception as e:
        logger.error(f"Failed to install desktop file: {e}")


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
            cmd = "show"  # Default: show window

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

    if sys.platform == "linux":
        install_desktop_file()

    app = QApplication(sys.argv)
    if sys.platform == "linux":
        app.setDesktopFileName("moon-tts")
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
    # Build UI First (Renders UI instantly)
    # -----------------------------------------------------------------
    from src.ui.bridge import Bridge
    from src.ui.main_window import MainWindow
    from src.ui.settings_window import SettingsWindow
    from src.ui.tray import TrayIcon

    bridge = Bridge(None)
    main_window = MainWindow(bridge)
    settings_window = SettingsWindow(bridge)

    # Wire settings open/close signals
    bridge.open_settings_requested.connect(
        lambda bounds_json: settings_window.show_at(main_window, bounds_json)
    )
    bridge.expand_settings_requested.connect(settings_window.set_expanded)

    # Wire escape key press to hide all windows
    def hide_all_windows():
        main_window.hide()
        settings_window.hide()

    bridge.escape_pressed.connect(hide_all_windows)

    # System tray
    tray = TrayIcon(main_window)
    tray.show()

    # Quick parse to check startMinimized and setup status
    from src.core.settings_manager import SettingsManager
    sm = SettingsManager()
    config = sm.get_app_config()
    start_minimized = config.get("startMinimized", False)
    initial_setup_complete = config.get("initialSetupComplete", False)

    from src.core.model_manager import ModelManager
    model_manager = ModelManager(sm)
    bridge.set_model_manager(model_manager)

    from src.ui.setup_window import SetupWindow
    setup_window = SetupWindow(bridge)

    def on_setup_finished():
        setup_window.hide()
        if "--hide" not in args and not start_minimized:
            main_window.show()

    bridge.setup_finished.connect(on_setup_finished)

    if not initial_setup_complete:
        setup_window.show()
    else:
        # Show main window immediately (unless --hide was passed or start_minimized is true)
        if "--hide" not in args and not start_minimized:
            main_window.show()

    # -----------------------------------------------------------------
    # Background bootstrap of backend services
    # -----------------------------------------------------------------
    import threading

    receiver = BootstrapReceiver(bridge, main_window, settings_window)
    bridge.backend_initialized.connect(receiver.on_backend_initialized)

    def _bg_bootstrap():
        try:
            logger.info("Background thread: Initializing backend services...")
            from src.infrastructure.audio_service import AudioService
            from src.core.history_manager import HistoryManager
            from src.infrastructure.kokoro import KokoroTTSProvider
            from src.core.hotkey_manager import HotkeyManager
            from src.core.app_controller import AppController

            audio_service = AudioService()
            history_manager = HistoryManager(audio_service, sm)
            tts_provider = KokoroTTSProvider(sm, audio_service, history_manager)
            hotkey_manager = HotkeyManager(tts_provider, audio_service, sm)
            hotkey_manager.init()

            # Initialize app config on disk
            sm.get_app_config()

            app_controller = AppController(
                tts_provider, sm, audio_service, hotkey_manager, history_manager, model_manager
            )

            # 1. Preload TTS model (imports ONNX and parses model)
            logger.info("Background thread: Preloading TTS model...")
            tts_provider.preload_model()

            # 2. Pre-initialize sounddevice
            logger.info("Background thread: Pre-initializing audio service...")
            try:
                import sounddevice as sd
                sd.query_devices()
            except Exception as e:
                logger.warning(f"Failed to query sound devices in background: {e}")

            logger.info("Background thread: Backend initialization complete. Signaling main thread.")
            bridge.backend_initialized.emit(app_controller)
        except Exception as e:
            logger.error(f"Error in background initialization: {e}", exc_info=True)
            bridge.backend_initialized.emit(None)

    # Launch background thread
    threading.Thread(target=_bg_bootstrap, daemon=True).start()

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
    if hotkey_mgr:
        hotkey_mgr.unregister()
    local_server.close()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
