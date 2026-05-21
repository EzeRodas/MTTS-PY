"""Infrastructure layer — audio playback and TTS providers."""

from .audio_service import AudioService
from .kokoro_provider import KokoroTTSProvider

__all__ = ["AudioService", "KokoroTTSProvider"]
