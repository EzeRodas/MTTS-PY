"""Infrastructure layer — audio playback and TTS providers."""

from .audio_service import AudioService
from .kokoro import KokoroTTSProvider

__all__ = ["AudioService", "KokoroTTSProvider"]
