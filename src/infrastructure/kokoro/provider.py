"""Kokoro TTS provider for Moon-TTS.

Wraps the ``kokoro-onnx`` Python package to provide text-to-speech
synthesis with automatic language resolution from voice prefixes.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import soundfile as sf
from pathlib import Path
from typing import Any

from .language_map import get_language_for_voice
from src.core.dictionary_manager import DictionaryManager

logger = logging.getLogger(__name__)

# Silence the phonemizer logger to prevent warnings about uppercase acronyms
logging.getLogger("phonemizer").setLevel(logging.ERROR)

# Voices known to ship with Kokoro-82M-v1.0.
_FALLBACK_VOICES: list[str] = [
    "af_heart",
    "af_sarah",
    "af_nova",
    "af_sky",
    "af_nicole",
    "am_adam",
    "am_michael",
    "bf_emma",
    "bf_isabella",
    "bm_george",
    "bm_lewis",
    "ef_dora",
    "ff_siwis",
    "jf_alpha",
    "zf_xiaoxiao",
    "if_sara",
    "pf_dora",
    "hf_alpha",
]


class KokoroTTSProvider:
    """Text-to-speech provider backed by Kokoro-82M via ONNX.

    Supports multilingual text-to-speech synthesis by mapping the selected
    voice's prefix to the corresponding language code (e.g. 'ef_dora' -> 'es').
    """

    MODEL_REPO_ID: str = "fastrtc/kokoro-onnx"
    MODEL_FILENAME: str = "kokoro-v1.0.onnx"
    VOICES_FILENAME: str = "voices-v1.0.bin"

    def __init__(
        self,
        settings_manager: Any,
        audio_service: Any,
        history_manager: Any,
    ) -> None:
        """Initialise the provider.

        Parameters
        ----------
        settings_manager:
            Application settings accessor (used to read app-level paths
            and user preferences).
        audio_service:
            :class:`~infrastructure.audio_service.AudioService` instance
            used for WAV playback.
        history_manager:
            History tracker for logging generated utterances.
        """
        self.settings_manager = settings_manager
        self.audio_service = audio_service
        self.history_manager = history_manager
        self.dictionary_manager = DictionaryManager(settings_manager)

        self.tts_instance: Any = None
        self._cached_voices: list[str] = []
        self._cancelled: bool = False

        self.kokoro_config: dict[str, Any] = self.settings_manager.get_engine_config(
            "kokoro",
            {
                "voiceId": "af_heart",
                "speed": 1.0,
            }
        )

    def preload_model(self) -> None:
        """Synchronously load the TTS model (designed to be run in a background thread)."""
        if not self.is_available():
            logger.info("TTS engine models not found, skipping preload.")
            return
        try:
            self._get_tts_instance()
        except Exception as e:
            logger.error(f"Error preloading TTS model: {e}")

    # ------------------------------------------------------------------
    # Lazy model loading
    # ------------------------------------------------------------------

    def _resolve_model_paths(self) -> tuple[Path | None, Path | None]:
        """Resolve the model and voices files from configured or default paths."""
        # 1. Check path from settings
        config = self.settings_manager.get_app_config()
        settings_models_path = config.get("modelsPath", "")
        
        # Determine the precision we want to load.
        # It should match the active model, e.g. "kokoro_fp16" -> "fp16".
        # Let's get the active model name from settings if possible.
        active_model = config.get("activeModel", "")
        precision = ""
        if active_model.startswith("kokoro_"):
            precision = active_model.split("_")[1] # e.g. "fp16"
        elif active_model == "kokoro":
            precision = config.get("kokoroPrecision", "")
            
        logger.debug(f"Resolving model paths for precision: {precision}")
        
        search_paths = []
        if settings_models_path:
            p = Path(settings_models_path)
            search_paths.append(p / "kokoro")
            search_paths.append(p)
            
        # 2. Check app data models folder
        app_dir = Path(self.settings_manager.get_app_directory())
        search_paths.append(app_dir / "models" / "kokoro")
        search_paths.append(app_dir / "models")
        
        # 3. Check project models folder (relative to this file)
        src_dir = Path(__file__).resolve().parent.parent.parent
        search_paths.append(src_dir / "models" / "kokoro")
        search_paths.append(src_dir.parent / "models")
        
        # Remove duplicates while preserving order
        unique_paths = []
        for path in search_paths:
            if path not in unique_paths:
                unique_paths.append(path)

        for path in unique_paths:
            # Check for precision-specific model file first
            if precision:
                m_path = path / f"kokoro-v1.0-{precision}.onnx"
                v_path = path / self.VOICES_FILENAME
                if m_path.exists() and v_path.exists():
                    return m_path, v_path
            
            # Check for default name
            m_path = path / self.MODEL_FILENAME
            v_path = path / self.VOICES_FILENAME
            if m_path.exists() and v_path.exists():
                return m_path, v_path

        # If we couldn't find the active precision but another precision is installed,
        # fallback to any available kokoro model file
        for path in unique_paths:
            v_path = path / self.VOICES_FILENAME
            if v_path.exists():
                for p in ["fp32", "fp16", "int8"]:
                    m_path = path / f"kokoro-v1.0-{p}.onnx"
                    if m_path.exists():
                        return m_path, v_path

        return None, None

    def is_available(self) -> bool:
        """Return True if any model and voices files are present."""
        m, v = self._resolve_model_paths()
        return m is not None and v is not None

    def _get_tts_instance(self) -> Any:
        """Return the lazily-loaded :class:`Kokoro` instance from local files.

        Looks for the ONNX model and voice pack in search paths.
        Raises FileNotFoundError if not found.
        """
        if self.tts_instance is not None:
            return self.tts_instance

        model_path, voices_path = self._resolve_model_paths()
        if not model_path or not voices_path:
            raise FileNotFoundError(
                f"Could not find '{self.MODEL_FILENAME}' and '{self.VOICES_FILENAME}' "
                "in configured or default directories."
            )

        import onnxruntime as rt
        from kokoro_onnx import Kokoro

        # Temporarily patch InferenceSession.__init__ to inject optimized session options
        original_init = rt.InferenceSession.__init__

        def _patched_init(sess_self, *args, **kwargs):
            if "sess_options" not in kwargs or kwargs["sess_options"] is None:
                opts = rt.SessionOptions()
                # Disable memory arena (releases memory back to OS immediately)
                opts.enable_cpu_mem_arena = False
                # Run ops sequentially to avoid parallel memory overhead
                opts.execution_mode = rt.ExecutionMode.ORT_SEQUENTIAL
                # Limit thread count to reduce stack overhead
                opts.intra_op_num_threads = 2
                kwargs["sess_options"] = opts
            original_init(sess_self, *args, **kwargs)

        rt.InferenceSession.__init__ = _patched_init
        try:
            instance = Kokoro(str(model_path), str(voices_path))
        finally:
            rt.InferenceSession.__init__ = original_init

        self._patch_dtype_bug(instance)
        self.tts_instance = instance
        return self.tts_instance

    def reload_model(self) -> None:
        """Clear cached instance and reload/preload the model."""
        self.tts_instance = None
        import gc
        gc.collect()
        self.preload_model()

    def unload_model(self) -> None:
        """Unload the model instance and run garbage collection to release locks."""
        self.tts_instance = None
        import gc
        gc.collect()
        logger.info("Kokoro model unloaded and garbage collected.")

    @staticmethod
    def _patch_dtype_bug(instance: Any) -> None:
        """Fix kokoro_onnx bug: speed is passed as int32 but models expect float32.

        The library's _create_audio builds the ONNX input dict with
        ``np.array([speed], dtype=np.int32)`` for newer model exports.
        fp32 models tolerate this but fp16/int8 models raise
        INVALID_ARGUMENT.  We inspect the model's declared input dtypes
        and cast accordingly.
        """
        import numpy as np

        sess = instance.sess
        # Build a map of input_name -> numpy dtype from the model's metadata
        _onnx_to_np = {
            "tensor(float)": np.float32,
            "tensor(float16)": np.float16,
            "tensor(int32)": np.int32,
            "tensor(int64)": np.int64,
        }
        expected_dtypes: dict[str, np.dtype] = {}
        for inp in sess.get_inputs():
            if inp.type in _onnx_to_np:
                expected_dtypes[inp.name] = _onnx_to_np[inp.type]

        original_create_audio = instance._create_audio

        def _patched_create_audio(phonemes, voice, speed):
            # Temporarily override sess.run to cast inputs
            original_run = sess.run

            def _casting_run(output_names, inputs, *args, **kwargs):
                fixed = {}
                for k, v in inputs.items():
                    if k in expected_dtypes:
                        if k == "speed":
                            # Use original float speed value to bypass int32 truncation
                            arr = np.array([speed], dtype=expected_dtypes[k])
                        else:
                            arr = np.asarray(v)
                            if arr.dtype != expected_dtypes[k]:
                                arr = arr.astype(expected_dtypes[k])
                        fixed[k] = arr
                    else:
                        fixed[k] = v
                return original_run(output_names, fixed, *args, **kwargs)

            sess.run = _casting_run
            try:
                audio, sr = original_create_audio(phonemes, voice, speed)
                if hasattr(audio, "flatten"):
                    audio = audio.flatten()
                return audio, sr
            finally:
                sess.run = original_run

        instance._create_audio = _patched_create_audio

    # ------------------------------------------------------------------
    # Voice management
    # ------------------------------------------------------------------

    def get_voices(self) -> list[str]:
        """Return the list of available voice identifiers.

        Falls back to a hardcoded list if the runtime query fails.
        """
        if self._cached_voices:
            return self._cached_voices

        if self.tts_instance is not None:
            try:
                self._cached_voices = list(self.tts_instance.get_voices())
                return self._cached_voices
            except Exception:
                pass

        if not self.is_available():
            return list(_FALLBACK_VOICES)

        _, voices_path = self._resolve_model_paths()
        if voices_path and voices_path.exists():
            try:
                import numpy as np
                # Load voices file directly to retrieve keys without loading ONNX model session
                voices_data = np.load(str(voices_path))
                self._cached_voices = list(sorted(voices_data.keys()))
                return self._cached_voices
            except Exception as e:
                logger.error(f"Failed to read voices file directly: {e}")

        try:
            tts = self._get_tts_instance()
            self._cached_voices = list(tts.get_voices())
            return self._cached_voices
        except Exception as e:
            logger.exception("Failed to load/initialize TTS engine:")
            return list(_FALLBACK_VOICES)

    def set_voice(self, voice_id: str) -> None:
        """Set the active voice for subsequent synthesis calls.

        Parameters
        ----------
        voice_id:
            A voice identifier such as ``'af_heart'`` or ``'am_adam'``.
        """
        self.kokoro_config["voiceId"] = voice_id
        self.settings_manager.update_engine_config("kokoro", {"voiceId": voice_id})

    def cancel(self) -> None:
        """Cancel the ongoing synthesis loop."""
        self._cancelled = True

    # ------------------------------------------------------------------
    # Synthesis
    # ------------------------------------------------------------------

    def split_text_safely(self, text: str) -> list[str]:
        import re
        # 1. Collect protected patterns
        patterns = [
            r'\d+\.\d+',  # Decimals (e.g. 3.14)
            r'\b(?:mr|mrs|ms|dr|vs|eg|ie|etc|am|pm|gen|col|st|jr|sr)\.', # Abbreviations (case-insensitive)
        ]
        
        # 2. Add custom dictionary entry patterns
        if self.dictionary_manager:
            dict_entries = self.dictionary_manager.get_dictionary()
            for entry in sorted(dict_entries, key=lambda x: len(x.get("original", "")), reverse=True):
                orig = entry.get("original", "")
                spelling = entry.get("spelling", "")
                # Protect both the original string and the replacement spelling
                for term in [orig, spelling]:
                    if not term:
                        continue
                    escaped = re.escape(term)
                    if entry.get("case_sensitive", False):
                        patterns.append(rf'\b{escaped}\b')
                    else:
                        patterns.append(rf'(?i:\b{escaped}\b)')
                    
        combined_pattern = re.compile("|".join(patterns))
        
        # 3. Substitute punctuation with unique placeholders
        def replace_fn(match):
            matched_str = match.group(0)
            return (matched_str
                    .replace('.', '__DOT__')
                    .replace(',', '__COMMA__')
                    .replace(';', '__SEMICOLON__')
                    .replace(':', '__COLON__'))

        protected_text = combined_pattern.sub(replace_fn, text)
        
        # 4. Perform split on clause boundary punctuation followed by spaces
        raw_chunks = re.split(r'(?<=[.!?,\;:—])\s+', protected_text)
        
        # 5. Restore placeholders and yield cleaned chunks
        final_chunks = []
        for chunk in raw_chunks:
            chunk = chunk.strip()
            if not chunk:
                continue
            restored = (chunk
                        .replace('__DOT__', '.')
                        .replace('__COMMA__', ',')
                        .replace('__SEMICOLON__', ';')
                        .replace('__COLON__', ':'))
            final_chunks.append(restored)
            
        return final_chunks

    def speak(self, text: str) -> None:
        """Synthesise *text* and play it through the audio service.

        The generated audio is written to a temporary WAV file, added to
        the history manager, played via the configured audio service, and
        then cleaned up.

        Parameters
        ----------
        text:
            The text to synthesise.
        """
        if not self.is_available():
            logger.warning("Synthesis requested but TTS engine is not available.")
            return
            
        tts = self._get_tts_instance()
        config = self.settings_manager.get_engine_config(
            "kokoro",
            {
                "voiceId": "af_heart",
                "speed": 1.0,
            }
        )
        self.kokoro_config = config

        voice_id = config.get("voiceId", "af_heart")
        speed = config.get("speed", 1.0)
        # Determine language automatically from voice prefix
        lang = get_language_for_voice(voice_id)

        logger.info(f"Synthesizing text with voice='{voice_id}' (resolved lang='{lang}')")
        self._cancelled = False
        
        app_config = self.settings_manager.get_app_config()
        
        # Split text safely without breaking decimals, abbreviations, or dictionary entries
        if app_config.get("splitSentences", True):
            sentences = self.split_text_safely(text)
        else:
            sentences = [text.strip()] if text.strip() else []

        if not sentences:
            return

        playback = app_config.get("playback", True)
        device_id = app_config.get("playbackDevice", "default")
        volume = app_config.get("volume", 0.8)
        monitoring = app_config.get("monitoring", False)
        monitoring_device_id = app_config.get("monitoringDevice", "default")
        monitoring_volume = app_config.get("monitoringVolume", 0.8)

        master_samples = []
        sample_rate_used = 24000

        try:
            import numpy as np
            for sentence in sentences:
                if self._cancelled:
                    logger.info("Synthesis loop aborted by user.")
                    break
                samples, sample_rate = tts.create(
                    sentence,
                    voice=voice_id,
                    speed=speed,
                    lang=lang,
                )
                if self._cancelled:
                    logger.info("Synthesis loop aborted by user after creation.")
                    break
                sample_rate_used = sample_rate
                master_samples.append(samples)
                
                if playback:
                    self.audio_service.enqueue_chunk(samples, sample_rate, device_id, volume)
                    
                if monitoring and monitoring_device_id is not None:
                    # Enqueue for monitoring device as well
                    self.audio_service.enqueue_chunk(samples, sample_rate, monitoring_device_id, monitoring_volume)
                
        except Exception as e:
            logger.error(f"Synthesis failed during streaming: {e}")
        finally:
            if not self._cancelled:
                if playback or (monitoring and monitoring_device_id is not None):
                    self.audio_service.enqueue_sentinel()

        # Write the full synthesized text to a single file for history
        if master_samples and not self._cancelled:
            try:
                import soundfile as sf
                import numpy as np
                all_samples = np.concatenate(master_samples)
                hist_fd, hist_path = tempfile.mkstemp(suffix=".wav")
                os.close(hist_fd)
                sf.write(hist_path, all_samples, sample_rate_used)
                self.history_manager.add_entry(text, hist_path)
            except Exception as e:
                logger.error(f"Failed to record history: {e}")

    def preview_spelling(self, spelling: str) -> None:
        """Synthesize *spelling* and play it ONLY through the monitoring device.
        Does not record history.
        """
        tts = self._get_tts_instance()
        config = self.kokoro_config

        voice_id = config.get("voiceId", "af_heart")
        speed = config.get("speed", 1.0)
        lang = get_language_for_voice(voice_id)

        samples, sample_rate = tts.create(
            spelling,
            voice=voice_id,
            speed=speed,
            lang=lang,
        )

        app_config = self.settings_manager.get_app_config()
        monitoring = app_config.get("monitoring", False)
        if not monitoring:
            logger.warning("Monitoring is disabled, preview will not play.")
            return

        monitoring_device_id = app_config.get("monitoringDevice", "default")
        monitoring_volume = app_config.get("monitoringVolume", 0.8)

        self.audio_service.resume()
        self.audio_service.enqueue_chunk(
            samples, 
            sample_rate, 
            monitoring_device_id, 
            monitoring_volume
        )
        self.audio_service.enqueue_sentinel()

    def generate_to_file(self, text: str, file_path: str) -> None:
        """Synthesise *text* and write the result directly to *file_path*.

        Parameters
        ----------
        text:
            The text to synthesise.
        file_path:
            Destination path for the output WAV file.
        """
        tts = self._get_tts_instance()
        config = self.settings_manager.get_engine_config(
            "kokoro",
            {
                "voiceId": "af_heart",
                "speed": 1.0,
            }
        )
        self.kokoro_config = config

        voice_id = config.get("voiceId", "af_heart")
        speed = config.get("speed", 1.0)
        # Determine language automatically from voice prefix
        lang = get_language_for_voice(voice_id)

        samples, sample_rate = tts.create(
            text,
            voice=voice_id,
            speed=speed,
            lang=lang,
        )

        # Ensure parent directory exists.
        Path(file_path).parent.mkdir(parents=True, exist_ok=True)
        sf.write(file_path, samples, sample_rate)
