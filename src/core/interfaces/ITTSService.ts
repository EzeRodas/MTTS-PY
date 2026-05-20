/**
 * Interface defining the contract for Text-To-Speech engine providers.
 * Decouples the application's domain logic from the underlying synthesis model (e.g. Kokoro, PyTorch, ONNX).
 */
export interface ITTSService {
    /**
     * Synthesizes text to speech, saves it to a temporary file, adds it to the
     * audio history, and plays it back.
     * @param text The sentence or paragraph to synthesize.
     */
    speak(text: string): Promise<void>;

    /**
     * Synthesizes text to speech and saves it directly to a specific target file path.
     * Mostly used for hotkeyed predefined phrases.
     * @param text The text to synthesize.
     * @param filePath Destination path for the output `.wav` file.
     */
    generateToFile(text: string, filePath: string): Promise<void>;

    /**
     * Retrieves list of available voice identifiers supported by the TTS model.
     * @returns Promise resolving to an array of voice names.
     */
    getVoices(): Promise<string[]>;

    /**
     * Changes the active voice model.
     * @param voiceId The identifier of the voice to activate.
     */
    setVoice(voiceId: string): Promise<void>;
}

