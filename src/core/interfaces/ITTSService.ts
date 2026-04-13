export interface ITTSService {
    speak(text: string): Promise<void>;
    generateToFile(text: string, filePath: string): Promise<void>;
    getVoices(): Promise<string[]>;
    setVoice(voiceId: string): Promise<void>;
}
