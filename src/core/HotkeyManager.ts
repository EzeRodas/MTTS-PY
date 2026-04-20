import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ITTSService } from './interfaces/ITTSService.js';
import { AudioService } from '../infrastructure/AudioService.js';
import { ISettingsManager } from './interfaces/ISettingsManager.js';

export interface HotkeyEntry {
    id: number;
    text: string;
    hotkey: string;
}

export class HotkeyManager {
    private hotkeyedDir: string;
    private jsonPath: string;
    private entries: HotkeyEntry[] = [];
    private readonly MAX_ENTRIES = 20;

    constructor(
        private ttsService: ITTSService,
        private audioService: AudioService,
        private settingsManager: ISettingsManager
    ) {
        this.hotkeyedDir = path.join(process.cwd(), 'src', 'audio', 'hotkeyed');
        this.jsonPath = path.join(this.hotkeyedDir, 'hotkeys.json');
    }

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

    private async save(): Promise<void> {
        await fs.writeFile(this.jsonPath, JSON.stringify(this.entries, null, 2), 'utf-8');
    }

    public async assignHotkey(hotkey: string, text: string): Promise<void> {
        let entryIndex = this.entries.findIndex(e => e.hotkey === hotkey);
        let id: number;

        if (entryIndex >= 0) {
            id = this.entries[entryIndex].id;
            this.entries[entryIndex].text = text;
        } else {
            const usedIds = new Set(this.entries.map(e => e.id));
            id = -1;
            for (let i = 0; i < this.MAX_ENTRIES; i++) {
                if (!usedIds.has(i)) {
                    id = i;
                    break;
                }
            }

            if (id === -1) {
                const oldest = this.entries.shift();
                if (oldest) id = oldest.id;
                else id = 0;
            }

            this.entries.push({ id, text, hotkey });
        }

        const filePath = path.join(this.hotkeyedDir, `hotkey_${id}.wav`);
        console.log(`Assigning hotkey '${hotkey}' to ID [${id}]...`);
        await this.ttsService.generateToFile(text, filePath);
        
        await this.save();
        console.log(`Hotkey '${hotkey}' assigned successfully.`);
    }

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

        // Shift remaining IDs and rename files to keep consistent
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

    public listHotkeys(): HotkeyEntry[] {
        return this.entries;
    }

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
