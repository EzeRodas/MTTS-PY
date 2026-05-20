import { ITTSService } from '../core/interfaces/ITTSService.js';
import { ISettingsManager } from '../core/interfaces/ISettingsManager.js';
import { KokoroTTS, GenerateOptions } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import { AudioService } from './AudioService.js';
import { HistoryManager } from '../core/HistoryManager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ============================================================================
// HUGGING FACE CACHE SYSTEM WORKAROUND FOR ELECTRON
// ============================================================================
// When running in an Electron package, the root execution directory is app.asar, 
// which is a read-only virtual archive. If transformers attempts to write 
// compiled model weight cache downloads to the default location inside the module folder,
// it throws write permission exceptions.
// Reroute caching directories explicitly to write-allowed user home directories.
if (process.versions.electron) {
    const homeDir = os.homedir();
    const appName = 'Moon-TTS';
    let userDataPath = '';
    
    switch (process.platform) {
        case 'win32':
            userDataPath = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), appName);
            break;
        case 'darwin':
            userDataPath = path.join(homeDir, 'Library', 'Application Support', appName);
            break;
        case 'linux':
        case 'android':
        default:
            userDataPath = path.join(process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), appName);
            break;
    }
    
    env.cacheDir = path.join(userDataPath, '.cache');
    // Ensure cache dir exists
    fs.mkdir(env.cacheDir, { recursive: true }).catch(() => {});
}

/**
 * Settings configuration structure specific to the Kokoro model provider.
 */
export interface KokoroConfig {
    /** Active voice identifier (e.g., 'af_heart') */
    voiceId: string;
    
    /** Speech rate multiplier (e.g. 1.0) */
    speed: number;
    
    /** Model precision format */
    dtype: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
}

/**
 * Text-to-Speech service provider powered by the Kokoro 82M ONNX model.
 * Handles the lazy-loading, caching, synthesis pipeline, and temporary file lifecycle.
 */
export class KokoroTTSProvider implements ITTSService {
    /** Lazy-loaded singleton instance of the Kokoro ONNX neural network */
    private ttsInstance: KokoroTTS | null = null;
    private settingsManager: ISettingsManager;
    private audioService: AudioService;
    private historyManager: HistoryManager;
    
    /** HuggingFace Model Hub ID */
    private readonly modelId = "onnx-community/Kokoro-82M-v1.0-ONNX";
    
    private defaultKokoroConfig: KokoroConfig = {
        voiceId: 'af_heart',
        speed: 1.0,
        dtype: 'fp32' // Higher precision model selected for quality improvement over robotic outputs
    };

    constructor(settingsManager: ISettingsManager, audioService: AudioService, historyManager: HistoryManager) {
        this.settingsManager = settingsManager;
        this.audioService = audioService;
        this.historyManager = historyManager;
    }

    /**
     * Lazy-loads the neural network model on the first request to speak.
     * Prevents startup lagging in both the CLI and Electron window threads.
     * Runs on CPU.
     */
    private async getTTSInstance(): Promise<KokoroTTS> {
        if (!this.ttsInstance) {
            console.log(`Loading Kokoro TTS model: ${this.modelId}`);
            
            const config = await this.settingsManager.getEngineConfig<KokoroConfig>('kokoro', this.defaultKokoroConfig);
            
            // Load via kokoro-js implementation
            this.ttsInstance = await KokoroTTS.from_pretrained(this.modelId, {
                dtype: config.dtype,
                device: "cpu", // Explicitly run on CPU to avoid WebGPU environment initialization crashes in Node context
            });
            console.log('Kokoro TTS model loaded into memory and cached.');
        }
        return this.ttsInstance;
    }

    /**
     * Returns the array of voice models packaged inside the Kokoro model assets.
     */
    public async getVoices(): Promise<string[]> {
        const tts = await this.getTTSInstance();
        return Object.keys(tts.voices);
    }

    /**
     * Swaps the active voice and updates engine config.
     * @param voiceId The voice identifier.
     */
    public async setVoice(voiceId: string): Promise<void> {
        const tts = await this.getTTSInstance();
        if (!tts.voices[voiceId as keyof typeof tts.voices]) {
            throw new Error(`Voice '${voiceId}' not found.`);
        }
        await this.settingsManager.updateEngineConfig<KokoroConfig>('kokoro', { voiceId });
        console.log(`Voice set to: ${voiceId}`);
    }

    /**
     * Synthesizes audio and saves it straight to a file path.
     * Primarily used by Hotkey pre-render bindings.
     * @param text The sentence string.
     * @param filePath Absolute path of the output file.
     */
    public async generateToFile(text: string, filePath: string): Promise<void> {
        const tts = await this.getTTSInstance();
        const config = await this.settingsManager.getEngineConfig<KokoroConfig>('kokoro', this.defaultKokoroConfig);

        console.log(`Generating audio for file: "${text}"`);
        const voice = config.voiceId as GenerateOptions['voice'];
        const audio = await tts.generate(text, {
            voice: voice,
            speed: config.speed
        });

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await audio.save(filePath);
        console.log(`Saved audio file to: ${filePath}`);
    }

    /**
     * Synthesizes audio, registers the transaction in HistoryManager,
     * and triggers playback routing.
     * @param text The input sentence.
     */
    public async speak(text: string): Promise<void> {
        const tts = await this.getTTSInstance();
        const config = await this.settingsManager.getEngineConfig<KokoroConfig>('kokoro', this.defaultKokoroConfig);
        const appConfig = await this.settingsManager.getAppConfig();

        console.log(`Generating audio for text: "${text}"`);
        
        // Generate audio via kokoro-js
        const voice = config.voiceId as GenerateOptions['voice'];
        const audio = await tts.generate(text, {
            voice: voice,
            speed: config.speed
        });

        // Save audio to temp file first
        const tempFilePath = path.join(os.tmpdir(), `tts_temp_${Date.now()}.wav`);
        await audio.save(tempFilePath);

        // Hand over to HistoryManager for rotation and persistence in history directory
        await this.historyManager.addEntry(text, tempFilePath);
        
        // Cleanup temp file
        try {
            await fs.unlink(tempFilePath);
        } catch(e) {}
        
        // Play the saved .wav file (HistoryManager saves newest to tts_output_0.wav)
        const finalFilePath = path.join(this.settingsManager.getAppDirectory(), 'audio', 'tts_output_0.wav');
        await this.audioService.play(finalFilePath, appConfig.playback, appConfig.playbackDevice, appConfig.volume, appConfig.monitoring, appConfig.monitoringDevice, appConfig.monitoringVolume);
    }
}

