"""History manager for Moon-TTS application.

Maintains a rolling list of the most recent TTS outputs as numbered WAV
files and a parallel ``history.json`` metadata file.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from src.core.settings_manager import SettingsManager


class HistoryManager:
    """Manages a capped history of TTS audio outputs.

    Audio files are stored as ``tts_output_0.wav`` through
    ``tts_output_{MAX_HISTORY-1}.wav`` where index 0 is the newest.
    Adding a new entry rotates all existing files up by one index and
    drops the oldest if the cap is exceeded.
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

        os.makedirs(self._audio_dir, exist_ok=True)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_entry(self, text: str, temp_wav_path: str) -> None:
        """Add a new TTS output to the history.

        Rotates existing files upward (0 → 1, 1 → 2, …) then copies
        *temp_wav_path* into slot 0. The oldest file beyond
        ``MAX_HISTORY`` is discarded.

        Args:
            text: The text that was synthesised.
            temp_wav_path: Path to the temporary WAV file to archive.
        """
        history = self._load_history()

        # Rotate files from highest to lowest to avoid overwrites
        for i in range(self.MAX_HISTORY - 1, 0, -1):
            src = self._wav_path(i - 1)
            dst = self._wav_path(i)
            if os.path.exists(src):
                os.rename(src, dst)

        # Discard overflow (file at MAX_HISTORY would be orphaned)
        overflow = self._wav_path(self.MAX_HISTORY)
        if os.path.exists(overflow):
            os.remove(overflow)

        # Copy the new file into slot 0
        shutil.copy2(temp_wav_path, str(self._wav_path(0)))

        # Update text history
        history.insert(0, text)
        history = history[: self.MAX_HISTORY]
        self._save_history(history)

    def get_history(self) -> list[str]:
        """Return the list of history text entries.

        Returns:
            List of strings, newest first.
        """
        return self._load_history()

    def play_history(self, entry_id: int) -> None:
        """Play a historical TTS output by its index.

        Args:
            entry_id: Zero-based index into the history.
        """
        wav = self._wav_path(entry_id)
        if not os.path.exists(wav):
            return

        config = self._settings_manager.get_app_config()
        self._audio_service.play(str(wav), config)

    def delete_history(self, entry_id: int) -> None:
        """Delete a single history entry and shift subsequent files down.

        Args:
            entry_id: Zero-based index of the entry to remove.
        """
        history = self._load_history()

        # Remove the WAV file
        target = self._wav_path(entry_id)
        if os.path.exists(target):
            os.remove(target)

        # Shift subsequent files down to fill the gap
        for i in range(entry_id, self.MAX_HISTORY - 1):
            src = self._wav_path(i + 1)
            dst = self._wav_path(i)
            if os.path.exists(src):
                os.rename(src, dst)
            else:
                break

        # Update text history
        if 0 <= entry_id < len(history):
            history.pop(entry_id)
        self._save_history(history)

    def clear_history(self) -> None:
        """Delete all history audio files and reset the metadata."""
        for i in range(self.MAX_HISTORY):
            wav = self._wav_path(i)
            if os.path.exists(wav):
                os.remove(wav)

        self._save_history([])

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _wav_path(self, index: int) -> Path:
        """Return the path for the WAV file at *index*.

        Args:
            index: File slot number.

        Returns:
            Full path to ``tts_output_{index}.wav``.
        """
        return self._audio_dir / f"tts_output_{index}.wav"

    def _load_history(self) -> list[str]:
        """Read history.json and return its contents.

        Returns:
            List of text strings, or empty list on error / missing file.
        """
        if not self._history_path.exists():
            return []
        try:
            with open(self._history_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
                return data if isinstance(data, list) else []
        except (json.JSONDecodeError, ValueError):
            return []

    def _save_history(self, history: list[str]) -> None:
        """Write *history* to history.json.

        Args:
            history: List of text strings to persist.
        """
        os.makedirs(self._audio_dir, exist_ok=True)
        with open(self._history_path, "w", encoding="utf-8") as fh:
            json.dump(history, fh, indent=2, ensure_ascii=False)
