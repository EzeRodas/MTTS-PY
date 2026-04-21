import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { AudioService } from '../infrastructure/AudioService.js';
import { ISettingsManager } from './interfaces/ISettingsManager.js';

export class HistoryManager {
    private audioDir: string;
    private historyPath: string;
    private readonly MAX_HISTORY = 20;

    constructor(
        private audioService: AudioService,
        private settingsManager: ISettingsManager
    ) {
        this.audioDir = path.join(settingsManager.getAppDirectory(), 'audio');
        this.historyPath = path.join(this.audioDir, 'history.json');
    }

    public async addEntry(text: string, tempWavPath: string): Promise<void> {
        await fs.mkdir(this.audioDir, { recursive: true });

        // Rotate history files
        for (let i = this.MAX_HISTORY - 2; i >= 0; i--) {
            const oldFile = path.join(this.audioDir, `tts_output_${i}.wav`);
            const newFile = path.join(this.audioDir, `tts_output_${i + 1}.wav`);
            try {
                await fs.rename(oldFile, newFile);
            } catch (err: any) {
                if (err.code !== 'ENOENT') {
                    console.error(`Failed to rotate history file ${oldFile}:`, err.message);
                }
            }
        }

        const newFilePath = path.join(this.audioDir, `tts_output_0.wav`);
        await fs.copyFile(tempWavPath, newFilePath);

        // Update history.json
        let historyTexts: string[] = [];
        try {
            if (existsSync(this.historyPath)) {
                const historyData = await fs.readFile(this.historyPath, 'utf-8');
                historyTexts = JSON.parse(historyData);
            }
        } catch (e) {
            // Ignore
        }
        
        historyTexts.unshift(text);
        if (historyTexts.length > this.MAX_HISTORY) {
            historyTexts = historyTexts.slice(0, this.MAX_HISTORY);
        }
        await fs.writeFile(this.historyPath, JSON.stringify(historyTexts, null, 2), 'utf-8');
    }

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

    public async deleteHistory(id: number): Promise<void> {
        let historyTexts = await this.getHistory();
        
        if (id >= historyTexts.length || id < 0) {
            console.log(`History ID [${id}] not found.`);
            return;
        }

        historyTexts.splice(id, 1);
        await fs.writeFile(this.historyPath, JSON.stringify(historyTexts, null, 2), 'utf-8');

        const fileToDelete = path.join(this.audioDir, `tts_output_${id}.wav`);
        if (existsSync(fileToDelete)) {
            await fs.unlink(fileToDelete);
        }

        for (let i = id + 1; i < this.MAX_HISTORY; i++) {
            const oldFile = path.join(this.audioDir, `tts_output_${i}.wav`);
            const newFile = path.join(this.audioDir, `tts_output_${i - 1}.wav`);
            if (existsSync(oldFile)) {
                await fs.rename(oldFile, newFile);
            }
        }
        console.log(`Deleted history [${id}] and shifted remaining IDs.`);
    }

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