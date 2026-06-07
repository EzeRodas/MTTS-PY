"""Dictionary manager for Moon-TTS.
Handles loading, saving, and applying string replacements for TTS text.
"""
import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

class DictionaryManager:
    def __init__(self, settings_manager):
        self._settings_manager = settings_manager
        self._config_dir = self._settings_manager.get_config_directory()
        self._dictionary_path = Path(self._config_dir) / "dictionary.json"
        self._lock = threading.RLock()
        self._entries = self._load_dictionary()

    def _load_dictionary(self) -> list[dict[str, Any]]:
        with self._lock:
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
        with self._lock:
            os.makedirs(self._dictionary_path.parent, exist_ok=True)
            try:
                with open(self._dictionary_path, "w", encoding="utf-8") as f:
                    json.dump(self._entries, f, indent=2, ensure_ascii=False)
            except Exception as e:
                logger.error(f"Error saving dictionary: {e}")

    def get_dictionary(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._entries)

    def add_entry(self, original: str, spelling: str, case_sensitive: bool) -> bool:
        with self._lock:
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
        with self._lock:
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
        with self._lock:
            if 0 <= index < len(self._entries):
                self._entries.pop(index)
                self._save_dictionary()
                return True
            return False

    def replace_text(self, text: str) -> str:
        with self._lock:
            if not self._entries or not text:
                return text
    
            parts = []
            # Map index to entry to preserve correct substitution retrieval
            indexed_entries = list(enumerate(self._entries))
            # Sort by length of original text descending
            indexed_entries.sort(key=lambda x: len(x[1].get("original", "")), reverse=True)
            
            for idx, entry in indexed_entries:
                original = entry.get("original", "")
                if not original:
                    continue
                    
                escaped = re.escape(original)
                if entry.get("case_sensitive", False):
                    parts.append(f"(?P<r{idx}>\\b{escaped}\\b)")
                else:
                    parts.append(f"(?P<r{idx}>(?i:\\b{escaped}\\b))")
                
            if not parts:
                return text
                
            pattern_str = "|".join(parts)
            try:
                pattern = re.compile(pattern_str)
            except Exception as e:
                logger.error(f"Error compiling dictionary regex: {e}")
                return text
    
            def replacer(match):
                group_name = match.lastgroup
                if group_name and group_name.startswith("r"):
                    try:
                        idx = int(group_name[1:])
                        return self._entries[idx].get("spelling", "")
                    except (ValueError, IndexError):
                        pass
                return match.group(0)
    
            try:
                text = pattern.sub(replacer, text)
            except Exception as e:
                logger.error(f"Error applying dictionary replacements: {e}")
                
            return text
