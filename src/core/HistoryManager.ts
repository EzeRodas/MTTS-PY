import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { AudioService } from '../infrastructure/AudioService.js';
import { ISettingsManager } from './interfaces/ISettingsManager.js';

/**
 * Manages the synthesized audio history.
 * Handles the persistence of metadata inside a JSON file and rotates/renames
 * corresponding WAV files on the local filesystem to enforce storage caps.
 */
export class HistoryManager {
    /** Target directory where history files are saved */
    private audioDir: string;
    
    /** Absolute path to the JSON file tracking history items */
    private historyPath: string;
    
    /** Maximum history items kept on disk before rotation overrides old records */
    private readonly MAX_HISTORY = 20;

    constructor(
        private audioService: AudioService,
        private settingsManager: ISettingsManager
    ) {
        this.audioDir = path.join(settingsManager.getAppDirectory(), 'audio');
        this.historyPath = path.join(this.audioDir, 'history.json');
    }

    /**
     * Adds a newly synthesized speech entry into history.
     * Enforces size limits by shifting existing files (`tts_output_i.wav` to `tts_output_i+1.wav`)
     * and writing the text metadata to `history.json`.
     * @param text Original synthesized sentence.
     * @param tempWavPath Path to temporary generated raw WAV file.
     */
    public async addEntry(text: string, tempWavPath: string): Promise<void> {
        await fs.mkdir(this.audioDir, { recursive: true });

        // Rotate history files starting from the second to last index down to zero.
        // E.g., shifts tts_output_18.wav -> tts_output_19.wav, ..., tts_output_0.wav -> tts_output_1.wav
        for (let i = this.MAX_HISTORY - 2; i >= 0; i--) {
            const oldFile = path.join(this.audioDir, `tts_output_${i}.wav`);
            const newFile = path.join(this.audioDir, `tts_output_${i + 1}.wav`);
            try {
                await fs.rename(oldFile, newFile);
            } catch (err: any) {
                // Ignore missing file errors (ENOENT) during initial runs or if history is sparse
                if (err.code !== 'ENOENT') {
                    console.error(`Failed to rotate history file ${oldFile}:`, err.message);
                }
            }
        }

        // Copy the new audio to index 0
        const newFilePath = path.join(this.audioDir, `tts_output_0.wav`);
        await fs.copyFile(tempWavPath, newFilePath);

        // Update history.json list
        let historyTexts: string[] = [];
        try {
            if (existsSync(this.historyPath)) {
                const historyData = await fs.readFile(this.historyPath, 'utf-8');
                historyTexts = JSON.parse(historyData);
            }
        } catch (e) {
            // Suppress errors and fallback to empty history if parsing fails
        }
        
        historyTexts.unshift(text);
        if (historyTexts.length > this.MAX_HISTORY) {
            historyTexts = historyTexts.slice(0, this.MAX_HISTORY);
        }
        await fs.writeFile(this.historyPath, JSON.stringify(historyTexts, null, 2), 'utf-8');
    }

    /**
     * Retrieves the history metadata from disk.
     * @returns List of synthesized sentences in order of newest to oldest.
     */
    public async getHistory(): Promise<string[]> {
        if (!existsSync(this.historyPath)) {
            return [];
        }
        try {
            const data = await fs.readFile(this.historyPath, 'utf-8');
            return JSON.parse(data);
        } catch (e) {
            return [];
        }
    }

    /**
     * Plays a historical recording by its unique index ID.
     * Routes the call to AudioService with current playback configurations.
     * @param id The index of the item (0 is newest).
     */
    public async playHistory(id: number): Promise<void> {
        const filePath = path.join(this.audioDir, `tts_output_${id}.wav`);
        if (!existsSync(filePath)) {
            console.log(`Audio file for ID [${id}] not found.`);
            return;
        }

        try {
            const appConfig = await this.settingsManager.getAppConfig();
            console.log(`Playing history [${id}]...`);
            await this.audioService.play(
                filePath, 
                appConfig.playback,
                appConfig.playbackDevice, 
                appConfig.volume, 
                appConfig.monitoring, 
                appConfig.monitoringDevice, 
                appConfig.monitoringVolume
            );
        } catch (error: any) {
            console.error('Failed to play history audio:', error.message);
        }
    }

    /**
     * Deletes a history entry, shifts subsequent files down to close the file index gap,
     * and updates the metadata manifest.
     * @param id Index of the history entry to delete.
     */
    public async deleteHistory(id: number): Promise<void> {
        let historyTexts = await this.getHistory();
        
        if (id >= historyTexts.length || id < 0) {
            console.log(`History ID [${id}] not found.`);
            return;
        }

        // Remove the target entry from metadata
        historyTexts.splice(id, 1);
        await fs.writeFile(this.historyPath, JSON.stringify(historyTexts, null, 2), 'utf-8');

        // Delete the WAV file
        const fileToDelete = path.join(this.audioDir, `tts_output_${id}.wav`);
        if (existsSync(fileToDelete)) {
            await fs.unlink(fileToDelete);
        }

        // Shift all subsequent files down (e.g. tts_output_3.wav renames to tts_output_2.wav)
        for (let i = id + 1; i < this.MAX_HISTORY; i++) {
            const oldFile = path.join(this.audioDir, `tts_output_${i}.wav`);
            const newFile = path.join(this.audioDir, `tts_output_${i - 1}.wav`);
            if (existsSync(oldFile)) {
                await fs.rename(oldFile, newFile);
            }
        }
        console.log(`Deleted history [${id}] and shifted remaining IDs.`);
    }

    /**
     * Deletes all synthesized history files and removes the metadata manifest.
     */
    public async clearHistory(): Promise<void> {
        if (!existsSync(this.audioDir)) {
            console.log('No history to clear.');
            return;
        }
        try {
            const files = await fs.readdir(this.audioDir);
            for (const file of files) {
                if ((file.startsWith('tts_output_') && file.endsWith('.wav')) || file === 'history.json') {
                    await fs.unlink(path.join(this.audioDir, file));
                }
            }
            console.log('History cleared.');
        } catch (error: any) {
            console.error('Failed to clear history:', error.message);
        }
    }

    /**
     * Prints history logs to stdout.
     */
    public async printHistory(): Promise<void> {
        const historyTexts = await this.getHistory();

        if (historyTexts.length === 0) {
            console.log('No history available yet.');
            return;
        }

        console.log('Recent TTS Audio History (Newest to Oldest):');
        historyTexts.forEach((text, index) => {
            let displayText = text.replace(/\\n/g, ' ').trim();
            if (displayText.length > 50) {
                displayText = displayText.substring(0, 50) + '...';
            }
            console.log(`[${index}] ${displayText}`);
        });
    }
}