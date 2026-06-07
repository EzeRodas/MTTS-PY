"""History manager for Moon-TTS application.

Maintains a rolling list of the most recent TTS outputs as numbered WAV
files and a parallel ``history.json`` metadata file.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from src.core.settings_manager import SettingsManager


class HistoryManager:
    """Manages a capped history of TTS audio outputs.

    Audio files are stored as ``tts_output_{uuid}.wav``.
    Adding a new entry writes the file and records it in ``history.json``
    with a unique ID and text. Oldest entries are deleted on overflow.
    """

    MAX_HISTORY: int = 20

    def __init__(self, audio_service: Any, settings_manager: "SettingsManager") -> None:
        """Initialize the history manager.

        Args:
            audio_service: Service used to play back audio files.
            settings_manager: Application settings manager instance.
        """
        self._audio_service = audio_service
        self._settings_manager = settings_manager

        app_dir = settings_manager.get_app_directory()
        self._audio_dir: Path = Path(app_dir) / "audio"
        self._history_path: Path = self._audio_dir / "history.json"
        self._lock = threading.RLock()

        os.makedirs(self._audio_dir, exist_ok=True)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_entry(self, text: str, temp_wav_path: str) -> None:
        """Add a new TTS output to the history.

        Saves the WAV file using a unique ID, prepends it to the history metadata,
        and deletes any oldest files exceeding MAX_HISTORY.

        Args:
            text: The text that was synthesised.
            temp_wav_path: Path to the temporary WAV file to archive.
        """
        import uuid
        with self._lock:
            history = self._load_history()

            # Generate unique ID and target path
            entry_id = str(uuid.uuid4())
            dst_path = self._wav_path(entry_id)

            # Copy temp file to target
            shutil.copy2(temp_wav_path, str(dst_path))

            # Prepend new entry
            history.insert(0, {"id": entry_id, "text": text})

            # Check for overflow and delete files
            if len(history) > self.MAX_HISTORY:
                to_delete = history[self.MAX_HISTORY:]
                history = history[: self.MAX_HISTORY]
                for item in to_delete:
                    old_path = self._wav_path(item["id"])
                    if os.path.exists(old_path):
                        try:
                            os.remove(old_path)
                        except Exception:
                            pass

            self._save_history(history)

    def get_history(self) -> list[dict[str, Any]]:
        """Return the list of history text entries.

        Returns:
            List of dicts containing 'id' and 'text', newest first.
        """
        with self._lock:
            return list(self._load_history())

    def play_history(self, entry_id: str) -> None:
        """Play a historical TTS output by its unique ID.

        Args:
            entry_id: Unique string ID of the history entry.
        """
        with self._lock:
            if self._audio_service.is_playing():
                return
            wav = self._wav_path(entry_id)
            if not os.path.exists(wav):
                return

            config = self._settings_manager.get_app_config()
            self._audio_service.play_with_config(str(wav), config)

    def delete_history(self, entry_id: str) -> None:
        """Delete a single history entry by its unique ID.

        Args:
            entry_id: Unique string ID of the entry to remove.
        """
        with self._lock:
            history = self._load_history()

            # Remove the WAV file
            target = self._wav_path(entry_id)
            if os.path.exists(target):
                try:
                    os.remove(target)
                except Exception:
                    pass

            # Filter history list
            new_history = [item for item in history if item["id"] != entry_id]
            self._save_history(new_history)

    def clear_history(self) -> None:
        """Delete all history audio files and reset the metadata."""
        with self._lock:
            history = self._load_history()
            for item in history:
                wav = self._wav_path(item["id"])
                if os.path.exists(wav):
                    try:
                        os.remove(wav)
                    except Exception:
                        pass

            self._save_history([])

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _wav_path(self, entry_id: str) -> Path:
        """Return the path for the WAV file with the given entry_id.

        Args:
            entry_id: Unique ID of the entry.

        Returns:
            Full path to ``tts_output_{entry_id}.wav``.
        """
        return self._audio_dir / f"tts_output_{entry_id}.wav"

    def _load_history(self) -> list[dict[str, Any]]:
        """Read history.json and return its contents.

        Returns:
            List of dictionary entries, or empty list on error / missing file.
        """
        with self._lock:
            if not self._history_path.exists():
                return []
            try:
                with open(self._history_path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                    if not isinstance(data, list):
                        return []
                    cleaned = []
                    for item in data:
                        if isinstance(item, dict) and "id" in item and "text" in item:
                            cleaned.append(item)
                    return cleaned
            except (json.JSONDecodeError, ValueError):
                return []

    def _save_history(self, history: list[dict[str, Any]]) -> None:
        """Write *history* to history.json.

        Args:
            history: List of dictionary entries to persist.
        """
        with self._lock:
            os.makedirs(self._audio_dir, exist_ok=True)
            with open(self._history_path, "w", encoding="utf-8") as fh:
                json.dump(history, fh, indent=2, ensure_ascii=False)
