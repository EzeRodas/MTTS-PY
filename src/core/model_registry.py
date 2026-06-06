from abc import ABC, abstractmethod
from pathlib import Path

class ModelInstaller(ABC):
    """
    Abstract interface for TTS engine model installers.
    Defines methods for checking status, deleting, and defining download URLs.
    """

    @abstractmethod
    def get_download_queue(self, precision: str, app_dir: Path) -> list[dict]:
        """
        Return a list of download tasks required to install the specified precision.
        Each task is a dict: {"url": str, "dest": str, "name": str}.
        """
        pass

    @abstractmethod
    def is_installed(self, precision: str, app_dir: Path) -> bool:
        """Return True if the specified precision is fully installed."""
        pass

    @abstractmethod
    def get_installed_precisions(self, app_dir: Path, saved_precision: str) -> list[str]:
        """Return a list of all currently installed precisions/versions."""
        pass

    @abstractmethod
    def delete_model(self, precision: str, app_dir: Path) -> bool:
        """
        Delete the specified precision. If precision is empty, delete all installed files.
        Return True if successful.
        """
        pass
