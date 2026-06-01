"""Dictionary manager for Moon-TTS.
Handles loading, saving, and applying string replacements for TTS text.
"""
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

class DictionaryManager:
    def __init__(self, settings_manager):
        self._settings_manager = settings_manager
        self._config_dir = self._settings_manager.get_config_directory()
        self._dictionary_path = Path(self._config_dir) / "dictionary.json"
        self._entries = self._load_dictionary()

    def _load_dictionary(self) -> list[dict[str, Any]]:
        if not self._dictionary_path.exists():
            return []
        try:
            with open(self._dictionary_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception as e:
            logger.error(f"Error loading dictionary: {e}")
        return []

    def _save_dictionary(self) -> None:
        os.makedirs(self._dictionary_path.parent, exist_ok=True)
        try:
            with open(self._dictionary_path, "w", encoding="utf-8") as f:
                json.dump(self._entries, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error saving dictionary: {e}")

    def get_dictionary(self) -> list[dict[str, Any]]:
        return self._entries

    def add_entry(self, original: str, spelling: str, case_sensitive: bool) -> bool:
        if len(self._entries) >= 500:
            return False
        original = original[:30]
        spelling = spelling[:30]
        self._entries.append({
            "original": original,
            "spelling": spelling,
            "case_sensitive": case_sensitive
        })
        self._save_dictionary()
        return True

    def update_entry(self, index: int, original: str, spelling: str, case_sensitive: bool) -> bool:
        if 0 <= index < len(self._entries):
            self._entries[index] = {
                "original": original[:30],
                "spelling": spelling[:30],
                "case_sensitive": case_sensitive
            }
            self._save_dictionary()
            return True
        return False

    def delete_entry(self, index: int) -> bool:
        if 0 <= index < len(self._entries):
            self._entries.pop(index)
            self._save_dictionary()
            return True
        return False

    def replace_text(self, text: str) -> str:
        for entry in self._entries:
            original = entry.get("original", "")
            spelling = entry.get("spelling", "")
            if not original:
                continue
                
            escaped = re.escape(original)
            # Use regex with word boundaries
            pattern_str = r'\b' + escaped + r'\b'
            
            flags = 0 if entry.get("case_sensitive", False) else re.IGNORECASE
            try:
                text = re.sub(pattern_str, spelling, text, flags=flags)
            except Exception as e:
                logger.error(f"Regex error for {original}: {e}")
                
        return text
