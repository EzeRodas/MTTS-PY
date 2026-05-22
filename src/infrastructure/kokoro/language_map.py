"""Voice-to-language mapping helper for Kokoro.

Matches the first character of the voice ID to its respective standard language code
needed by the kokoro-onnx engine and phonemizer/espeak-ng.
"""

def get_language_for_voice(voice_id: str) -> str:
    """Determine the language code based on the voice ID prefix.

    Kokoro v1.0 voices use prefixes:
    - a (e.g. af_heart, am_adam) -> en-us (American English)
    - b (e.g. bf_emma, bm_george) -> en-gb (British English)
    - e (e.g. ef_dora) -> es (Spanish)
    - f (e.g. ff_siwis) -> fr-fr (French)
    - j (e.g. jf_alpha) -> ja (Japanese)
    - z (e.g. zf_xiaoxiao) -> cmn (Mandarin Chinese)
    - i (e.g. if_sara) -> it (Italian)
    - p (e.g. pf_dora) -> pt-br (Portuguese)
    - h (e.g. hf_alpha) -> hi (Hindi)
    """
    if not voice_id or len(voice_id) < 2:
        return "en-us"

    prefix = voice_id[0].lower()
    mapping = {
        "a": "en-us",
        "b": "en-gb",
        "e": "es",
        "f": "fr-fr",
        "j": "ja",
        "z": "cmn",
        "i": "it",
        "p": "pt-br",
        "h": "hi",
    }
    return mapping.get(prefix, "en-us")
