"""Global hotkey listener for Moon-TTS.

Provides a thread-safe bridge to register keyboard shortcuts system-wide.
On Linux, uses the Freedesktop GlobalShortcuts portal via dbus-next.
Falls back to pynput on other platforms or if the portal is unavailable.
"""

import logging
import sys
import threading
import asyncio
from typing import Optional
from PySide6.QtCore import QObject, Signal

try:
    import dbus_next
    from dbus_next.aio import MessageBus
    from dbus_next import Variant
    from dbus_next.introspection import Node
    HAS_DBUS = True
except ImportError:
    HAS_DBUS = False

logger = logging.getLogger("Moon-TTS.GlobalHotkey")


# Minimal D-Bus Introspection XMLs to bypass invalid property names in portal desktop XML
GLOBAL_SHORTCUTS_XML = """
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/introspect.dtd">
<node>
  <interface name="org.freedesktop.portal.GlobalShortcuts">
    <method name="CreateSession">
      <arg type="a{sv}" name="options" direction="in"/>
      <arg type="o" name="request" direction="out"/>
    </method>
    <method name="BindShortcuts">
      <arg type="o" name="session" direction="in"/>
      <arg type="a(sa{sv})" name="shortcuts" direction="in"/>
      <arg type="s" name="parent_window" direction="in"/>
      <arg type="a{sv}" name="options" direction="in"/>
      <arg type="o" name="request" direction="out"/>
    </method>
    <signal name="Activated">
      <arg type="o" name="session"/>
      <arg type="s" name="shortcut_id"/>
      <arg type="t" name="timestamp"/>
      <arg type="a{sv}" name="options"/>
    </signal>
  </interface>
</node>
"""

REQUEST_XML = """
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/introspect.dtd">
<node>
  <interface name="org.freedesktop.portal.Request">
    <method name="Close">
    </method>
    <signal name="Response">
      <arg type="u" name="response"/>
      <arg type="a{sv}" name="results"/>
    </signal>
  </interface>
</node>
"""

SESSION_XML = """
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/introspect.dtd">
<node>
  <interface name="org.freedesktop.portal.Session">
    <method name="Close">
    </method>
  </interface>
</node>
"""


def to_pynput_shortcut(qt_shortcut: str) -> str:
    """Translate a Qt-style shortcut string to pynput format.

    Example: "Ctrl+Alt+M" -> "<ctrl>+<alt>+m"
    """
    normalized = qt_shortcut.lower()
    normalized = normalized.replace("commandorcontrol", "ctrl")
    normalized = normalized.replace("cmdorctrl", "ctrl")
    normalized = normalized.replace("control", "ctrl")
    normalized = normalized.replace("command", "cmd")

    parts = normalized.split("+")
    translated = []
    for p in parts:
        p = p.strip()
        if p == "ctrl":
            translated.append("<ctrl>")
        elif p == "alt":
            translated.append("<alt>")
        elif p == "shift":
            translated.append("<shift>")
        elif p in ("meta", "win", "cmd"):
            translated.append("<cmd>")
        else:
            if len(p) > 1 and not (p.startswith("<") and p.endswith(">")):
                translated.append(f"<{p}>")
            else:
                translated.append(p)
    return "+".join(translated)


def to_portal_shortcut(qt_shortcut: str) -> str:
    """Translate a Qt-style shortcut string to XDG Shortcuts Specification format.

    Example: "Ctrl+Alt+M" -> "CTRL+ALT+m"
    """
    normalized = qt_shortcut.upper()
    normalized = normalized.replace("COMMANDORCONTROL", "CTRL")
    normalized = normalized.replace("CMDORCTRL", "CTRL")
    normalized = normalized.replace("CONTROL", "CTRL")
    normalized = normalized.replace("COMMAND", "LOGO")
    normalized = normalized.replace("WIN", "LOGO")
    normalized = normalized.replace("META", "LOGO")
    normalized = normalized.replace("SUPER", "LOGO")

    parts = normalized.split("+")
    translated = []
    for p in parts:
        p = p.strip()
        if p in ("CTRL", "ALT", "SHIFT", "NUM", "LOGO"):
            translated.append(p)
        else:
            if len(p) == 1:
                translated.append(p.lower())
            else:
                p_lower = p.lower()
                if p_lower == "space":
                    translated.append("space")
                elif p_lower in ("enter", "return"):
                    translated.append("Return")
                elif p_lower == "escape":
                    translated.append("Escape")
                elif p_lower == "tab":
                    translated.append("Tab")
                elif p_lower == "backspace":
                    translated.append("BackSpace")
                else:
                    translated.append(p.capitalize())
    return "+".join(translated)


class DBusLoopRunner:
    """Manages an asyncio loop in a separate thread for dbus-next portal interaction."""

    def __init__(self, activated_callback, fallback_callback) -> None:
        self.activated_callback = activated_callback
        self.fallback_callback = fallback_callback
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self.bus: Optional[MessageBus] = None
        self.session_proxy = None
        self.shortcuts_interface = None
        self.session_handle: Optional[str] = None
        self._is_running = False

    def start(self) -> None:
        if self._is_running:
            return
        self._is_running = True
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def stop(self) -> None:
        self._is_running = False
        if self.loop:
            future = asyncio.run_coroutine_threadsafe(self._cleanup(), self.loop)
            try:
                future.result(timeout=2.0)
            except Exception as e:
                logger.debug(f"Error during runner cleanup: {e}")
            self.loop.call_soon_threadsafe(self.loop.stop)
            if self.thread:
                self.thread.join(timeout=1.0)
            self.loop = None
            self.thread = None


    async def _cleanup(self) -> None:
        if self.session_proxy:
            try:
                await self.session_proxy.call_close()
                logger.info("Closed D-Bus portal shortcuts session cleanly.")
            except Exception as e:
                logger.debug(f"Error closing D-Bus portal session: {e}")
            self.session_proxy = None
        if self.bus:
            try:
                self.bus.disconnect()
            except Exception:
                pass
            self.bus = None
        self.session_handle = None

    def register_shortcut(self, trigger_str: str) -> None:
        if self.loop:
            asyncio.run_coroutine_threadsafe(self._register(trigger_str), self.loop)

    async def _register(self, trigger_str: str) -> None:
        try:
            await self._cleanup()

            self.bus = await MessageBus().connect()

            intro = Node.parse(GLOBAL_SHORTCUTS_XML)
            obj = self.bus.get_proxy_object(
                "org.freedesktop.portal.Desktop",
                "/org/freedesktop/portal/desktop",
                intro
            )
            self.shortcuts_interface = obj.get_interface("org.freedesktop.portal.GlobalShortcuts")

            # 1. CreateSession
            session_token = "moontts_session_token"
            request_token = "moontts_session_request_token"
            options = {
                "session_handle_token": Variant("s", session_token),
                "handle_token": Variant("s", request_token)
            }

            request_path = await self.shortcuts_interface.call_create_session(options)

            req_intro = Node.parse(REQUEST_XML)
            req_obj = self.bus.get_proxy_object("org.freedesktop.portal.Desktop", request_path, req_intro)
            req_interface = req_obj.get_interface("org.freedesktop.portal.Request")

            session_resp_future = asyncio.Future()

            def on_session_response(res_code, results):
                if res_code == 0:
                    session_resp_future.set_result(results)
                else:
                    session_resp_future.set_exception(RuntimeError(f"CreateSession error: {res_code}"))

            req_interface.on_response(on_session_response)

            results = await asyncio.wait_for(session_resp_future, timeout=5.0)
            self.session_handle = results["session_handle"].value

            # 2. BindShortcuts
            shortcuts = [
                [
                    "toggle_app_visibility",
                    {
                        "description": Variant("s", "Show/Hide Moon-TTS"),
                        "preferred_trigger": Variant("s", trigger_str)
                    }
                ]
            ]
            bind_options = {
                "handle_token": Variant("s", "moontts_bind_request_token")
            }

            bind_req_path = await self.shortcuts_interface.call_bind_shortcuts(
                self.session_handle,
                shortcuts,
                "",
                bind_options
            )

            bind_obj = self.bus.get_proxy_object("org.freedesktop.portal.Desktop", bind_req_path, req_intro)
            bind_req_interface = bind_obj.get_interface("org.freedesktop.portal.Request")

            bind_resp_future = asyncio.Future()

            def on_bind_response(res_code, results):
                if res_code == 0:
                    bind_resp_future.set_result(results)
                else:
                    bind_resp_future.set_exception(RuntimeError(f"BindShortcuts error: {res_code}"))

            bind_req_interface.on_response(on_bind_response)

            await asyncio.wait_for(bind_resp_future, timeout=10.0)

            # Get session object for closing cleanly on unregister
            sess_intro = Node.parse(SESSION_XML)
            sess_obj = self.bus.get_proxy_object("org.freedesktop.portal.Desktop", self.session_handle, sess_intro)
            self.session_proxy = sess_obj.get_interface("org.freedesktop.portal.Session")

            # 3. Listen for Activated signal
            def on_activated(session, shortcut_id, timestamp, options):
                if shortcut_id == "toggle_app_visibility":
                    self.activated_callback()

            self.shortcuts_interface.on_activated(on_activated)
            logger.info(f"Registered portal global shortcut: '{trigger_str}'")

        except Exception as e:
            logger.warning(f"Freedesktop portal shortcut registration failed: {e}. Falling back to pynput.")
            self.fallback_callback()


class GlobalHotkeyManager(QObject):
    """Manages system-wide global shortcut hook registration.

    On Linux, uses Freedesktop GlobalShortcuts portal.
    Falls back to keyboard hook (pynput) if portals are unavailable.
    """

    activated = Signal()
    fallback_needed = Signal(str)

    def __init__(self, parent: Optional[QObject] = None) -> None:
        super().__init__(parent)
        self._listener = None
        self._dbus_runner: Optional[DBusLoopRunner] = None
        self._current_shortcut = ""
        self.fallback_needed.connect(self._register_pynput)

    def register_shortcut(self, qt_shortcut: str) -> None:
        """Register a new global shortcut, unregistering any prior binding."""
        self.unregister()

        if not qt_shortcut:
            return

        self._current_shortcut = qt_shortcut

        if HAS_DBUS and sys.platform.startswith("linux"):
            trigger_str = to_portal_shortcut(qt_shortcut)
            logger.info(f"Attempting to register portal shortcut: '{trigger_str}'")

            if not self._dbus_runner:
                self._dbus_runner = DBusLoopRunner(
                    activated_callback=self.activated.emit,
                    fallback_callback=self._on_dbus_fallback
                )
                self._dbus_runner.start()

            self._dbus_runner.register_shortcut(trigger_str)
        else:
            self._register_pynput(qt_shortcut)

    def _on_dbus_fallback(self) -> None:
        """Called asynchronously when portal binding fails."""
        self.fallback_needed.emit(self._current_shortcut)

    def _register_pynput(self, qt_shortcut: str) -> None:
        """Register shortcut using the standard pynput listener hook."""
        if not qt_shortcut:
            return
        
        # Avoid registering if pynput is already listening to the correct key
        if self._listener:
            return

        pynput_format = to_pynput_shortcut(qt_shortcut)
        from pynput import keyboard

        def on_activate():
            self.activated.emit()

        try:
            self._listener = keyboard.GlobalHotKeys({
                pynput_format: on_activate
            })
            self._listener.daemon = True
            self._listener.start()
            logger.info(f"Registered fallback global shortcut: '{qt_shortcut}' (pynput: '{pynput_format}')")
        except Exception as e:
            logger.error(f"Failed to register fallback global shortcut '{qt_shortcut}': {e}")

    def unregister(self) -> None:
        """Unregister and stop the active keyboard listener hook/D-Bus session."""
        if self._listener:
            try:
                self._listener.stop()
            except Exception as e:
                logger.debug(f"Error stopping hotkey listener: {e}")
            self._listener = None

        if self._dbus_runner:
            self._dbus_runner.stop()
            self._dbus_runner = None

        self._current_shortcut = ""

