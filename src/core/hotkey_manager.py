"""Hotkey manager for Moon-TTS application.

Allows users to bind keyboard shortcuts to pre-generated TTS audio
clips for instant playback.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from src.core.settings_manager import SettingsManager


# Type alias for hotkey entry dicts
HotkeyEntry = dict[str, Any]  # keys: id (str), text (str), hotkey (str)


class HotkeyManager:
    """Manages hotkey-bound TTS audio entries.

    Each entry maps a keyboard shortcut to a pre-generated WAV file so
    the user can trigger instant playback without re-synthesising.
    Entries are stored as ``hotkey_{id}.wav`` alongside a
    ``hotkeys.json`` metadata file.
    """

    MAX_ENTRIES: int = 20

    def __init__(
        self,
        tts_service: Any,
        audio_service: Any,
        settings_manager: "SettingsManager",
    ) -> None:
        """Initialize the hotkey manager.

        Args:
            tts_service: Service capable of generating TTS audio files.
            audio_service: Service used to play back audio files.
            settings_manager: Application settings manager instance.
        """
        self._tts_service = tts_service
        self._audio_service = audio_service
        self._settings_manager = settings_manager

        app_dir = settings_manager.get_app_directory()
        self._hotkeyed_dir: Path = Path(app_dir) / "audio" / "hotkeyed"
        self._json_path: Path = self._hotkeyed_dir / "hotkeys.json"

        self._lock = threading.RLock()
        self._entries: list[HotkeyEntry] = []
        self._on_hotkeys_changed_callback = None

    def set_hotkeys_changed_callback(self, callback) -> None:
        """Set a callback to be invoked when hotkeys change."""
        self._on_hotkeys_changed_callback = callback

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def init(self) -> None:
        """Create the hotkeyed directory if needed and load entries."""
        import logging
        logger = logging.getLogger(__name__)
        
        os.makedirs(self._hotkeyed_dir, exist_ok=True)
        self._entries = self._load_entries()
        
        # If entries is empty but there are files, clear legacy/orphaned WAVs
        if not self._entries:
            for file in os.listdir(self._hotkeyed_dir):
                if file.endswith(".wav"):
                    try:
                        os.remove(self._hotkeyed_dir / file)
                    except Exception as e:
                        logger.debug(f"Failed to remove orphaned hotkey wav {file}: {e}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def assign_hotkey(self, hotkey: str, text: str) -> None:
        """Assign or update a hotkey binding.

        If an entry with the same *hotkey* already exists its text and
        audio are updated in-place. Otherwise a new entry is created
        (up to ``MAX_ENTRIES``).

        Args:
            hotkey: Keyboard shortcut string (e.g. ``"Ctrl+Shift+1"``).
            text: Text to synthesise and bind to *hotkey*.
        """
        with self._lock:
            # Check for existing entry with same hotkey
            existing = next((e for e in self._entries if e["hotkey"] == hotkey), None)
    
            if existing is not None:
                entry_id = existing["id"]
                existing["text"] = text
            else:
                if len(self._entries) >= self.MAX_ENTRIES:
                    return  # cap reached
                import uuid
                entry_id = uuid.uuid4().hex[:8]
                self._entries.append({"id": entry_id, "text": text, "hotkey": hotkey})
    
            # Generate audio file
            wav_path = str(self._wav_path(entry_id))
            self._tts_service.generate_to_file(text, wav_path)
    
            self._save_entries()
            
            if self._on_hotkeys_changed_callback:
                self._on_hotkeys_changed_callback()

    def play_hotkey(self, entry_id: str) -> None:
        """Play the audio bound to a hotkey entry.

        Args:
            entry_id: String UUID of the hotkey entry.
        """
        wav = self._wav_path(entry_id)
        if not os.path.exists(wav):
            return

        config = self._settings_manager.get_app_config()
        self._audio_service.play_with_config(str(wav), config)

    def delete_hotkey(self, entry_id: str) -> None:
        """Delete a hotkey entry and its corresponding file.

        Args:
            entry_id: String UUID of the entry to remove.
        """
        with self._lock:
            # Find index of entry
            idx = next((i for i, e in enumerate(self._entries) if e["id"] == entry_id), -1)
            if idx == -1:
                return
    
            # Remove the WAV file for the deleted entry
            target = self._wav_path(entry_id)
            if os.path.exists(target):
                os.remove(target)
    
            # Remove entry from list
            self._entries.pop(idx)
    
            self._save_entries()
            
            if self._on_hotkeys_changed_callback:
                self._on_hotkeys_changed_callback()

    def clear_hotkeys(self) -> None:
        """Remove all hotkey entries and their audio files."""
        with self._lock:
            for entry in self._entries:
                wav = self._wav_path(entry["id"])
                if os.path.exists(wav):
                    os.remove(wav)
    
            self._entries.clear()
            self._save_entries()
            
            if self._on_hotkeys_changed_callback:
                self._on_hotkeys_changed_callback()

    def list_hotkeys(self) -> list[HotkeyEntry]:
        """Return a copy of all current hotkey entries.

        Returns:
            List of dicts with keys ``id``, ``text``, ``hotkey``.
        """
        with self._lock:
            return list(self._entries)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _wav_path(self, entry_id: str) -> Path:
        """Return the WAV file path for an entry.

        Args:
            entry_id: String UUID of the entry.

        Returns:
            Full path to ``phrase_{entry_id}.wav``.
        """
        return self._hotkeyed_dir / f"phrase_{entry_id}.wav"

    def _load_entries(self) -> list[HotkeyEntry]:
        """Read hotkeys.json and return the entry list.

        Returns:
            List of hotkey entry dicts, or empty list on error.
        """
        with self._lock:
            if not self._json_path.exists():
                return []
            try:
                with open(self._json_path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                    if not isinstance(data, list):
                        return []
                    
                    # Drop legacy integer-based IDs
                    if any(isinstance(e.get("id"), int) for e in data):
                        return []
                        
                    return data
            except (json.JSONDecodeError, ValueError):
                return []

    def _save_entries(self) -> None:
        """Persist the current entries list to hotkeys.json."""
        with self._lock:
            os.makedirs(self._hotkeyed_dir, exist_ok=True)
            with open(self._json_path, "w", encoding="utf-8") as fh:
                json.dump(self._entries, fh, indent=2, ensure_ascii=False)
