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
import hashlib

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

    def __init__(self, activated_callback, fallback_callback, bound_callback=None, phrase_activated_callback=None) -> None:
        self.activated_callback = activated_callback
        self.fallback_callback = fallback_callback
        self.bound_callback = bound_callback
        self.phrase_activated_callback = phrase_activated_callback
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self.bus: Optional[MessageBus] = None
        self.session_proxy = None
        self.shortcuts_interface = None
        self.session_handle: Optional[str] = None
        self.last_toggle_trigger_str = None
        self.last_phrases_hash = None
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

    def register_all_shortcuts(self, toggle_trigger: str, phrases: list[dict]) -> None:
        if self.loop:
            asyncio.run_coroutine_threadsafe(self._register_all(toggle_trigger, phrases), self.loop)

    async def _register_all(self, toggle_trigger: str, phrases: list[dict]) -> None:
        try:
            # Hash to detect if we need to log changes
            import json
            phrases_hash = hashlib.md5(json.dumps(phrases, sort_keys=True).encode('utf-8')).hexdigest()
            if self.session_handle and (self.last_toggle_trigger_str != toggle_trigger or self.last_phrases_hash != phrases_hash):
                logger.info("Shortcuts changed. Re-binding with existing DBus session.")

            # 1. Connect message bus if not already connected
            if not self.bus:
                self.bus = await MessageBus().connect()

            # 2. Get shortcuts interface if not already retrieved
            if not self.shortcuts_interface:
                # Register the connection with the host portal Registry (only for host applications)
                try:
                    reg_intro = Node.parse("""
                    <!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
                     "http://www.freedesktop.org/standards/dbus/introspect.dtd">
                    <node>
                      <interface name="org.freedesktop.host.portal.Registry">
                        <method name="Register">
                          <arg type="s" name="app_id" direction="in"/>
                          <arg type="a{sv}" name="options" direction="in"/>
                        </method>
                      </interface>
                    </node>
                    """)
                    reg_obj = self.bus.get_proxy_object(
                        "org.freedesktop.portal.Desktop",
                        "/org/freedesktop/portal/desktop",
                        reg_intro
                    )
                    reg_interface = reg_obj.get_interface("org.freedesktop.host.portal.Registry")
                    logger.info("Registering app_id 'moon-tts' with host portal Registry...")
                    await reg_interface.call_register("moon-tts", {})
                except Exception as e:
                    logger.debug(f"Host portal Registry registration skipped/failed: {e}")

                intro = Node.parse(GLOBAL_SHORTCUTS_XML)
                obj = self.bus.get_proxy_object(
                    "org.freedesktop.portal.Desktop",
                    "/org/freedesktop/portal/desktop",
                    intro
                )
                self.shortcuts_interface = obj.get_interface("org.freedesktop.portal.GlobalShortcuts")

                # Connect the Activated signal listener once
                def on_activated(session, shortcut_id, timestamp, options):
                    if shortcut_id.startswith("toggle_app_visibility"):
                        self.activated_callback()
                    elif shortcut_id.startswith("moon_tts_phrase_"):
                        parts = shortcut_id.split("_")
                        if len(parts) >= 4:
                            phrase_id = parts[3]
                            if self.phrase_activated_callback:
                                self.phrase_activated_callback(phrase_id)

                self.shortcuts_interface.on_activated(on_activated)

            # 3. Create Session if not already active
            if not self.session_handle:
                import uuid
                rand_hex = uuid.uuid4().hex[:8]
                session_token = f"moontts_session_{rand_hex}"
                request_token = f"moontts_req_{rand_hex}"
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
                    if session_resp_future.done():
                        return
                    if res_code == 0:
                        session_resp_future.set_result(results)
                    else:
                        session_resp_future.set_exception(RuntimeError(f"CreateSession error: {res_code}"))

                req_interface.on_response(on_session_response)

                results = await asyncio.wait_for(session_resp_future, timeout=5.0)
                self.session_handle = results["session_handle"].value

                # Get session object for closing cleanly on unregister
                sess_intro = Node.parse(SESSION_XML)
                sess_obj = self.bus.get_proxy_object("org.freedesktop.portal.Desktop", self.session_handle, sess_intro)
                self.session_proxy = sess_obj.get_interface("org.freedesktop.portal.Session")

            # 4. BindShortcuts (always call this to register or update the shortcut trigger)
            shortcuts = []
            
            # Add Toggle Shortcut
            if toggle_trigger:
                trigger_hash = hashlib.md5(toggle_trigger.encode('utf-8')).hexdigest()[:8]
                shortcut_id = f"toggle_app_visibility_{trigger_hash}"
                shortcuts.append([
                    shortcut_id,
                    {
                        "description": Variant("s", "Show/Hide Moon-TTS"),
                        "preferred_trigger": Variant("s", toggle_trigger)
                    }
                ])
                
            # Add Phrase Shortcuts
            for phrase in phrases:
                pid = phrase["id"]
                ptrigger = phrase["trigger"]
                ptext = phrase.get("text", "")
                if ptrigger:
                    phash = hashlib.md5(ptrigger.encode('utf-8')).hexdigest()[:8]
                    # Format description: first 15 chars + "..." if longer
                    desc_text = ptext[:15] + ("..." if len(ptext) > 15 else "")
                    if not desc_text:
                        desc_text = f"Phrase {pid[:4]}"
                    
                    shortcuts.append([
                        f"moon_tts_phrase_{pid}_{phash}",
                        {
                            "description": Variant("s", desc_text),
                            "preferred_trigger": Variant("s", ptrigger)
                        }
                    ])
            
            # Generate a fresh, unique bind handle token for this request
            import uuid
            bind_token = f"moontts_bind_{uuid.uuid4().hex[:8]}"
            bind_options = {
                "handle_token": Variant("s", bind_token)
            }

            bind_req_path = await self.shortcuts_interface.call_bind_shortcuts(
                self.session_handle,
                shortcuts,
                "",
                bind_options
            )

            req_intro = Node.parse(REQUEST_XML)
            bind_obj = self.bus.get_proxy_object("org.freedesktop.portal.Desktop", bind_req_path, req_intro)
            bind_req_interface = bind_obj.get_interface("org.freedesktop.portal.Request")

            bind_resp_future = asyncio.Future()

            def on_bind_response(res_code, results):
                if bind_resp_future.done():
                    return
                if res_code == 0:
                    bind_resp_future.set_result(results)
                else:
                    bind_resp_future.set_exception(RuntimeError(f"BindShortcuts error: {res_code}"))

            bind_req_interface.on_response(on_bind_response)

            bind_res = await asyncio.wait_for(bind_resp_future, timeout=10.0)
            self.last_toggle_trigger_str = toggle_trigger
            self.last_phrases_hash = phrases_hash
            logger.info(f"Registered portal global shortcuts: toggle='{toggle_trigger}', phrases={len(phrases)}")

            # Extract actual bound shortcut from response for the toggle trigger
            actual_shortcut = None
            if "shortcuts" in bind_res and toggle_trigger:
                shortcuts_val = bind_res["shortcuts"].value
                for shortcut_tuple in shortcuts_val:
                    if len(shortcut_tuple) >= 2 and shortcut_tuple[0].startswith("toggle_app_visibility_"):
                        props = shortcut_tuple[1]
                        if "trigger_description" in props:
                            actual_shortcut = props["trigger_description"].value
                        elif "triggers" in props and props["triggers"].value:
                            actual_shortcut = props["triggers"].value[0]
            
            if actual_shortcut and self.bound_callback:
                # XDG Portal trigger_description uses typical 'Ctrl+Shift+P' string representation
                logger.info(f"Portal returned bound shortcut: '{actual_shortcut}'")
                self.bound_callback(actual_shortcut)

        except Exception as e:
            logger.warning(f"Freedesktop portal shortcut registration failed: {e}. Falling back to pynput.")
            self.fallback_callback()


class GlobalHotkeyManager(QObject):
    """Manages system-wide global shortcut hook registration.

    On Linux, uses Freedesktop GlobalShortcuts portal.
    Falls back to keyboard hook (pynput) if portals are unavailable.
    """

    activated = Signal()
    phrase_activated = Signal(str)
    fallback_needed = Signal(str)
    shortcut_bound = Signal(str)

    def __init__(self, parent: Optional[QObject] = None) -> None:
        super().__init__(parent)
        self._listener = None
        self._dbus_runner: Optional[DBusLoopRunner] = None
        self._current_shortcut = ""
        self.fallback_needed.connect(self._register_pynput)

    def register_all_shortcuts(self, toggle_trigger: str, phrases: list[dict]) -> None:
        """Register all global shortcuts, including the main app toggle and phrases."""
        if self._listener:
            try:
                self._listener.stop()
            except Exception as e:
                logger.debug(f"Error stopping hotkey listener: {e}")
            self._listener = None

        self._current_shortcut = toggle_trigger

        if HAS_DBUS and sys.platform.startswith("linux"):
            portal_toggle = to_portal_shortcut(toggle_trigger) if toggle_trigger else ""
            portal_phrases = []
            for phrase in phrases:
                if phrase.get("hotkey"):
                    portal_phrases.append({
                        "id": phrase["id"],
                        "trigger": to_portal_shortcut(phrase["hotkey"]),
                        "text": phrase.get("text", "")
                    })

            if not self._dbus_runner:
                self._dbus_runner = DBusLoopRunner(
                    activated_callback=self.activated.emit,
                    fallback_callback=self._on_dbus_fallback,
                    bound_callback=self._on_shortcut_bound,
                    phrase_activated_callback=self.phrase_activated.emit
                )
                self._dbus_runner.start()

            self._dbus_runner.register_all_shortcuts(portal_toggle, portal_phrases)
        else:
            self._register_pynput(toggle_trigger)

    def _on_shortcut_bound(self, actual_shortcut: str) -> None:
        """Called when the portal successfully binds a shortcut, providing the actual bound string."""
        if actual_shortcut != self._current_shortcut:
            self._current_shortcut = actual_shortcut
            self.shortcut_bound.emit(actual_shortcut)

    def _on_dbus_fallback(self) -> None:
        """Called asynchronously when portal binding fails."""
        if not sys.platform.startswith("linux"):
            self.fallback_needed.emit(self._current_shortcut)
        else:
            logger.warning("Portal shortcut registration failed/timed out. Cannot fallback to pynput on Linux (Wayland compatibility).")

    def _register_pynput(self, qt_shortcut: str) -> None:
        """Register shortcut using the standard pynput listener hook."""
        if sys.platform.startswith("linux"):
            logger.warning("pynput fallback disabled on Linux.")
            return

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

