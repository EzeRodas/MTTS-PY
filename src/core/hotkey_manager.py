"""Hotkey manager for Moon-TTS application.

Allows users to bind keyboard shortcuts to pre-generated TTS audio
clips for instant playback.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from src.core.settings_manager import SettingsManager


# Type alias for hotkey entry dicts
HotkeyEntry = dict[str, Any]  # keys: id (int), text (str), hotkey (str)


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

        self.entries: list[HotkeyEntry] = []

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def init(self) -> None:
        """Create the hotkeyed directory if needed and load entries."""
        os.makedirs(self._hotkeyed_dir, exist_ok=True)
        self.entries = self._load_entries()

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
        # Check for existing entry with same hotkey
        existing = next((e for e in self.entries if e["hotkey"] == hotkey), None)

        if existing is not None:
            entry_id = existing["id"]
            existing["text"] = text
        else:
            if len(self.entries) >= self.MAX_ENTRIES:
                return  # cap reached
            entry_id = len(self.entries)
            self.entries.append({"id": entry_id, "text": text, "hotkey": hotkey})

        # Generate audio file
        wav_path = str(self._wav_path(entry_id))
        self._tts_service.generate_to_file(text, wav_path)

        self._save_entries()

    def play_hotkey(self, entry_id: int) -> None:
        """Play the audio bound to a hotkey entry.

        Args:
            entry_id: Zero-based index of the hotkey entry.
        """
        wav = self._wav_path(entry_id)
        if not os.path.exists(wav):
            return

        config = self._settings_manager.get_app_config()
        self._audio_service.play(str(wav), config)

    def delete_hotkey(self, entry_id: int) -> None:
        """Delete a hotkey entry, shift subsequent IDs down, and rename files.

        Args:
            entry_id: Zero-based index of the entry to remove.
        """
        if entry_id < 0 or entry_id >= len(self.entries):
            return

        # Remove the WAV file for the deleted entry
        target = self._wav_path(entry_id)
        if os.path.exists(target):
            os.remove(target)

        # Remove entry from list
        self.entries.pop(entry_id)

        # Shift subsequent files and reassign IDs
        for i in range(entry_id, len(self.entries)):
            old_path = self._wav_path(i + 1)
            new_path = self._wav_path(i)
            if os.path.exists(old_path):
                os.rename(old_path, new_path)
            self.entries[i]["id"] = i

        self._save_entries()

    def clear_hotkeys(self) -> None:
        """Remove all hotkey entries and their audio files."""
        for i in range(len(self.entries)):
            wav = self._wav_path(i)
            if os.path.exists(wav):
                os.remove(wav)

        self.entries.clear()
        self._save_entries()

    def list_hotkeys(self) -> list[HotkeyEntry]:
        """Return a copy of all current hotkey entries.

        Returns:
            List of dicts with keys ``id``, ``text``, ``hotkey``.
        """
        return list(self.entries)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _wav_path(self, entry_id: int) -> Path:
        """Return the WAV file path for an entry.

        Args:
            entry_id: Entry slot number.

        Returns:
            Full path to ``hotkey_{entry_id}.wav``.
        """
        return self._hotkeyed_dir / f"hotkey_{entry_id}.wav"

    def _load_entries(self) -> list[HotkeyEntry]:
        """Read hotkeys.json and return the entry list.

        Returns:
            List of hotkey entry dicts, or empty list on error.
        """
        if not self._json_path.exists():
            return []
        try:
            with open(self._json_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
                return data if isinstance(data, list) else []
        except (json.JSONDecodeError, ValueError):
            return []

    def _save_entries(self) -> None:
        """Persist the current entries list to hotkeys.json."""
        os.makedirs(self._hotkeyed_dir, exist_ok=True)
        with open(self._json_path, "w", encoding="utf-8") as fh:
            json.dump(self.entries, fh, indent=2, ensure_ascii=False)
