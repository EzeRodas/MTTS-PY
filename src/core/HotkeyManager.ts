import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ITTSService } from './interfaces/ITTSService.js';
import { AudioService } from '../infrastructure/AudioService.js';
import { ISettingsManager } from './interfaces/ISettingsManager.js';

/**
 * Data shape representing a hotkeyed predefined speech phrase.
 */
export interface HotkeyEntry {
    /** Unique numeric identifier for the hotkey entry. Maps directly to `hotkey_${id}.wav`. */
    id: number;
    
    /** Text sentence associated with this hotkey. Synthesized on demand or pre-rendered. */
    text: string;
    
    /** Accelerator/hotkey key combination configuration string (e.g. 'CommandOrControl+Alt+1') */
    hotkey: string;
}

/**
 * Manages shortcut hotkeys and pre-generated audio clips for instant phrase playback.
 * Minimizes real-time speech generation latencies by pre-rendering audio files.
 */
export class HotkeyManager {
    /** Directory where pre-rendered hotkeyed WAV audios are cached */
    private hotkeyedDir: string;
    
    /** Absolute path to the JSON file indexing assigned hotkeys */
    private jsonPath: string;
    
    /** Internal cache of hotkey entries */
    private entries: HotkeyEntry[] = [];
    
    /** Limit on max hotkeys active simultaneously */
    private readonly MAX_ENTRIES = 20;

    constructor(
        private ttsService: ITTSService,
        private audioService: AudioService,
        private settingsManager: ISettingsManager
    ) {
        this.hotkeyedDir = path.join(settingsManager.getAppDirectory(), 'audio', 'hotkeyed');
        this.jsonPath = path.join(this.hotkeyedDir, 'hotkeys.json');
    }

    /**
     * Initializes hotkey directories and loads metadata from disk.
     */
    public async init(): Promise<void> {
        if (!existsSync(this.hotkeyedDir)) {
            await fs.mkdir(this.hotkeyedDir, { recursive: true });
        }
        if (existsSync(this.jsonPath)) {
            try {
                const data = await fs.readFile(this.jsonPath, 'utf-8');
                this.entries = JSON.parse(data);
            } catch (e) {
                this.entries = [];
            }
        }
    }

    /**
     * Writes hotkeys cache metadata back to disk.
     */
    private async save(): Promise<void> {
        await fs.writeFile(this.jsonPath, JSON.stringify(this.entries, null, 2), 'utf-8');
    }

    /**
     * Associates a keyboard hotkey combination with a specific phrase.
     * Pre-renders and saves the voice phrase immediately to disk to guarantee instant playback when triggered.
     * @param hotkey Key combination accelerator.
     * @param text Sentence to synthesize.
     */
    public async assignHotkey(hotkey: string, text: string): Promise<void> {
        let entryIndex = this.entries.findIndex(e => e.hotkey === hotkey);
        let id: number;

        // If hotkey already exists, reuse its ID and overwrite its text/file
        if (entryIndex >= 0) {
            id = this.entries[entryIndex].id;
            this.entries[entryIndex].text = text;
        } else {
            // Find first available integer ID hole (0 to MAX_ENTRIES - 1)
            const usedIds = new Set(this.entries.map(e => e.id));
            id = -1;
            for (let i = 0; i < this.MAX_ENTRIES; i++) {
                if (!usedIds.has(i)) {
                    id = i;
                    break;
                }
            }

            // Fallback: If no holes found, eject the oldest hotkey entry
            if (id === -1) {
                const oldest = this.entries.shift();
                if (oldest) id = oldest.id;
                else id = 0;
            }

            this.entries.push({ id, text, hotkey });
        }

        const filePath = path.join(this.hotkeyedDir, `hotkey_${id}.wav`);
        console.log(`Assigning hotkey '${hotkey}' to ID [${id}]...`);
        
        // Trigger immediate background synthesis to destination path
        await this.ttsService.generateToFile(text, filePath);
        
        await this.save();
        console.log(`Hotkey '${hotkey}' assigned successfully.`);
    }

    /**
     * Plays a hotkeyed phrase audio file by ID using current audio configuration.
     * @param id Identifier of the hotkey recording.
     */
    public async playHotkey(id: number): Promise<void> {
        const entry = this.entries.find(e => e.id === id);
        if (!entry) {
            console.log(`No audio assigned to hotkey ID: ${id}`);
            return;
        }

        const filePath = path.join(this.hotkeyedDir, `hotkey_${entry.id}.wav`);
        if (!existsSync(filePath)) {
            console.log(`Audio file missing for hotkey ID: ${id}`);
            return;
        }

        const appConfig = await this.settingsManager.getAppConfig();
        console.log(`Playing hotkey [${entry.hotkey}]: "${entry.text}"`);
        await this.audioService.play(
            filePath,
            appConfig.playback,
            appConfig.playbackDevice,
            appConfig.volume,
            appConfig.monitoring,
            appConfig.monitoringDevice,
            appConfig.monitoringVolume
        );
    }
    
    /**
     * Deletes a hotkey, shifts IDs of subsequent hotkeys to fill gaps,
     * renames files, and persists metadata.
     * @param id Identifier of the hotkey to delete.
     */
    public async deleteHotkey(id: number): Promise<void> {
        const index = this.entries.findIndex(e => e.id === id);
        if (index === -1) {
            console.log(`Hotkey ID [${id}] not found.`);
            return;
        }

        // Remove the entry
        this.entries.splice(index, 1);

        // Delete the associated file
        const fileToDelete = path.join(this.hotkeyedDir, `hotkey_${id}.wav`);
        if (existsSync(fileToDelete)) {
            try {
                await fs.unlink(fileToDelete);
            } catch (err: any) {
                console.error(`Failed to delete file ${fileToDelete}:`, err.message);
            }
        }

        // Shift remaining IDs down and rename files to maintain contiguous mapping.
        // Prevents internal fragmented gaps.
        for (const entry of this.entries) {
            if (entry.id > id) {
                const oldId = entry.id;
                const newId = oldId - 1;
                entry.id = newId;

                const oldFile = path.join(this.hotkeyedDir, `hotkey_${oldId}.wav`);
                const newFile = path.join(this.hotkeyedDir, `hotkey_${newId}.wav`);
                if (existsSync(oldFile)) {
                    try {
                        await fs.rename(oldFile, newFile);
                    } catch (err: any) {
                        console.error(`Failed to rename ${oldFile} to ${newFile}:`, err.message);
                    }
                }
            }
        }

        await this.save();
        console.log(`Deleted hotkey ID [${id}] and shifted remaining IDs.`);
    }

    /**
     * Clears all hotkey entries and deletes their respective cached `.wav` files.
     */
    public async clearHotkeys(): Promise<void> {
        this.entries = [];
        await this.save();
        
        try {
            if (existsSync(this.hotkeyedDir)) {
                const files = await fs.readdir(this.hotkeyedDir);
                for (const file of files) {
                    if (file.startsWith('hotkey_') && file.endsWith('.wav')) {
                        await fs.unlink(path.join(this.hotkeyedDir, file));
                    }
                }
            }
            console.log('All hotkeys cleared.');
        } catch (error: any) {
            console.error('Failed to clear hotkey files:', error.message);
        }
    }

    /**
     * Gets the list of loaded hotkey entries.
     */
    public listHotkeys(): HotkeyEntry[] {
        return this.entries;
    }

    /**
     * Prints active hotkey combinations to stdout.
     */
    public printHotkeys(): void {
        if (this.entries.length === 0) {
            console.log('No hotkeys assigned yet.');
        } else {
            console.log('Assigned Hotkeys:');
            this.entries.forEach(h => {
                console.log(`  [${h.id}] ${h.hotkey} -> "${h.text}"`);
            });
        }
    }
}

