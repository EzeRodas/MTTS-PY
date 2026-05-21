"""Settings manager for Moon-TTS application.

Handles persistent application and engine configuration using JSON files
stored in platform-appropriate directories.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any


class SettingsManager:
    """Manages application and engine configuration persistence.

    Reads and writes JSON configuration files from a platform-specific
    application data directory. Settings are merged with defaults so
    missing keys are always filled in automatically.
    """

    def __init__(self) -> None:
        """Initialize the settings manager.

        Determines the platform-specific app directory, sets up the
        settings file path, and defines default application settings.
        """
        self._app_dir: str = self._resolve_app_directory()
        self._settings_path: Path = Path(self._app_dir) / "settings.json"

        self.default_settings: dict[str, Any] = {
            "playback": True,
            "volume": 0.8,
            "playbackDevice": "default",
            "monitoring": False,
            "monitoringDevice": "default",
            "monitoringVolume": 0.8,
            "modelsPath": "",
            "appShortcut": "Ctrl+Alt+M",
            "defaultAppShortcut": "Ctrl+Alt+M",
        }

    def _resolve_app_directory(self) -> str:
        """Determine the platform-specific application data directory.

        Returns:
            Absolute path to the Moon-TTS data directory.
        """
        platform = sys.platform

        if platform == "win32":
            base = os.environ.get("APPDATA", os.path.expanduser("~"))
            return os.path.join(base, "Moon-TTS")
        elif platform == "darwin":
            return os.path.join(
                os.path.expanduser("~"), "Library", "Application Support", "Moon-TTS"
            )
        else:
            # Linux / other POSIX
            base = os.environ.get(
                "XDG_DATA_HOME", os.path.join(os.path.expanduser("~"), ".local", "share")
            )
            return os.path.join(base, "Moon-TTS")

    def get_app_directory(self) -> str:
        """Return the resolved application data directory path.

        Returns:
            Absolute path string to the Moon-TTS data directory.
        """
        return self._app_dir

    def get_app_config(self) -> dict[str, Any]:
        """Read the application settings, creating defaults if needed.

        If the settings file does not exist it is created with defaults.
        If it exists but is missing keys, the missing keys are filled in
        from defaults and the file is re-saved.

        Returns:
            Complete settings dictionary with all default keys guaranteed.
        """
        os.makedirs(self._app_dir, exist_ok=True)

        if not self._settings_path.exists():
            self._write_json(self._settings_path, self.default_settings)
            return dict(self.default_settings)

        stored = self._read_json(self._settings_path)
        merged = {**self.default_settings, **stored}

        # Migrate legacy Electron/Alt+S values to Ctrl+Alt+M
        migrated = False
        for key in ["appShortcut", "defaultAppShortcut"]:
            val = merged.get(key)
            if val and ("Alt+S" in val or "CommandOrControl" in val):
                merged[key] = "Ctrl+Alt+M"
                migrated = True

        # Persist if migrated or if we added default keys
        if migrated or merged != stored:
            self._write_json(self._settings_path, merged)

        return merged

    def update_app_config(self, settings: dict[str, Any]) -> None:
        """Merge *settings* into the current app config and save.

        Args:
            settings: Partial settings dict to merge in.
        """
        current = self.get_app_config()
        current.update(settings)
        self._write_json(self._settings_path, current)

    def get_engine_config(self, engine_name: str, default_settings: dict[str, Any]) -> dict[str, Any]:
        """Read an engine-specific configuration file.

        The file is stored as ``{engine_name}.json`` inside the app
        directory. Missing keys are filled from *default_settings*.

        Args:
            engine_name: Name used as the JSON filename stem.
            default_settings: Default values for this engine.

        Returns:
            Complete engine settings dictionary.
        """
        os.makedirs(self._app_dir, exist_ok=True)
        engine_path = Path(self._app_dir) / f"{engine_name}.json"

        if not engine_path.exists():
            self._write_json(engine_path, default_settings)
            return dict(default_settings)

        stored = self._read_json(engine_path)
        merged = {**default_settings, **stored}

        if merged != stored:
            self._write_json(engine_path, merged)

        return merged

    def update_engine_config(self, engine_name: str, settings: dict[str, Any]) -> None:
        """Merge *settings* into an engine config and save.

        Args:
            engine_name: Name used as the JSON filename stem.
            settings: Partial settings dict to merge in.
        """
        engine_path = Path(self._app_dir) / f"{engine_name}.json"

        current: dict[str, Any] = {}
        if engine_path.exists():
            current = self._read_json(engine_path)

        current.update(settings)
        self._write_json(engine_path, current)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        """Read and parse a JSON file.

        Args:
            path: Path to the JSON file.

        Returns:
            Parsed dictionary. Returns empty dict on decode errors.
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
                return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, ValueError):
            return {}

    @staticmethod
    def _write_json(path: Path, data: dict[str, Any]) -> None:
        """Write a dictionary to a JSON file with pretty formatting.

        Args:
            path: Destination file path.
            data: Dictionary to serialize.
        """
        os.makedirs(path.parent, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
