import { ITTSService } from './interfaces/ITTSService.js';
import { ISettingsManager } from './interfaces/ISettingsManager.js';
import { AudioService } from '../infrastructure/AudioService.js';
import { HotkeyManager } from './HotkeyManager.js';
import { HistoryManager } from './HistoryManager.js';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export class AppController {
    // We keep track of available models locally for now
    private availableModels = ['kokoro'];
    private activeModel = 'kokoro';

    constructor(
        private ttsService: ITTSService,
        private settingsManager: ISettingsManager,
        private audioService: AudioService,
        private hotkeyManager: HotkeyManager,
        private historyManager: HistoryManager
    ) {}

    public async processInput(text: string): Promise<void> {
        try {
            await this.ttsService.speak(text);
        } catch (error) {
            console.error('Error processing TTS input:', error);
        }
    }

    public async handleCommand(commandLine: string): Promise<boolean> {
        const parts = commandLine.trim().split(' ');
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (command) {
            case '/help':
                this.showHelp();
                break;
            case '/model':
                this.handleModelCommand(args);
                break;
            case '/voice':
                await this.handleVoiceCommand(args);
                break;
            case '/output':
                await this.handleOutputCommand(args);
                break;
            case '/volume':
                await this.handleVolumeCommand(args);
                break;
            case '/monitoring':
                await this.handleMonitoringCommand(args);
                break;
            case '/monitoring_output':
                await this.handleMonitoringOutputCommand(args);
                break;
            case '/volume_monitoring':
                await this.handleVolumeMonitoringCommand(args);
                break;
            case '/history':
                await this.handleHistoryCommand(args);
                break;
            case '/hotkey':
                await this.handleHotkeyCommand(args);
                break;
            case '/exit':
            case '/quit':
                console.log('Exiting.');
                return false; // Signals to close the app
            default:
                console.log('Command not found. Type "/help" for a list of commands.');
                break;
        }
        return true; // Signals to continue running
    }

    public showHelp(): void {
        console.log(`
Available commands:
  /help                   - Show this help message

  /model --list           - List available TTS models
         <model_name>     - Set the active TTS model
  
  /voice --list           - List available voices for the current model
         <voice_name>     - Set the active voice
  
  /output --list          - List available output devices
          <device_id>     - Set the active output device
  /volume <0.0-1.0>       - Set playback volume (e.g., 0.5 for 50%)
  
  /monitoring <on/off>    - Enable or disable dual output monitoring
  /monitoring_output <id> - Set the monitoring output device
  /volume_monitoring <v>  - Set monitoring output volume (0.0-1.0)
  
  /history                - List the last 20 generated audios
           play <ID>      - Play the specific history file
           delete <ID>    - Delete the specific history file
           clear          - Delete all generated history

  /hotkey list            - List available hotkey combiantions
          play <ID>       - Play a specific hotkeyed phrase
          assign <hotkey> - Assign a hotkey combination to a phrase to generate
          delete <ID>     - Delete a hotkey combination and its phrase
          clear           - Delete all hotkeyed phrases
  
  /exit                   - Quit the application
        `.trim());
    }

    public listModels(): string[] {
        return this.availableModels;
    }

    public setModel(modelName: string): boolean {
        if (this.availableModels.includes(modelName)) {
            this.activeModel = modelName;
            return true;
        }
        return false;
    }

    public getActiveModel(): string {
        return this.activeModel;
    }

    private handleModelCommand(args: string[]): void {
        if (args.length === 0) {
            console.log('Usage: /model --list OR /model <model_name>');
            return;
        }

        if (args[0] === '--list') {
            console.log(`Available models:\n${this.listModels().join(', ')}`);
        } else {
            const success = this.setModel(args[0]);
            if (success) {
                console.log(`Model set to ${args[0]}.`);
            } else {
                console.log(`Model '${args[0]}' not found.`);
            }
        }
    }

    public async listVoices(): Promise<string[]> {
        return await this.ttsService.getVoices();
    }

    public async getActiveVoice(): Promise<string> {
        // Hardcoded to kokoro for now since it's the only engine
        const config = await this.settingsManager.getEngineConfig<{voiceId: string}>('kokoro', { voiceId: 'af_heart' });
        return config.voiceId;
    }

    public async setVoice(voiceName: string): Promise<void> {
        await this.ttsService.setVoice(voiceName);
    }

    public async getAppConfig() {
        return await this.settingsManager.getAppConfig();
    }

    public async updateAppConfig(config: any) {
        return await this.settingsManager.updateAppConfig(config);
    }

    public async getDevices() {
        return await this.audioService.getDevices();
    }

    private async handleVoiceCommand(args: string[]): Promise<void> {
        if (args.length === 0) {
            console.log('Usage: /voice --list OR /voice <voice_name>');
            return;
        }

        try {
            if (args[0] === '--list') {
                const voices = await this.listVoices();
                console.log(`Available voices:\n${voices.join(', ')}`);
            } else {
                await this.setVoice(args[0]);
            }
        } catch (error: any) {
            console.error(error.message);
        }
    }

    private async handleOutputCommand(args: string[]): Promise<void> {
        if (args.length === 0) {
            console.log('Usage: /output --list OR /output <device_ID>');
            return;
        }

        const devices = await this.audioService.getDevices();

        if (args[0] === '--list') {
            console.log('Available output devices:');
            devices.forEach((device, index) => {
                console.log(`[${index}] ${device.name}`);
            });
        } else {
            const index = parseInt(args[0], 10);
            let selectedId: string | null = null;

            if (!isNaN(index) && index >= 0 && index < devices.length) {
                selectedId = devices[index].id;
                console.log(`Output device set to: ${devices[index].name}`);
            } else {
                // If they passed ID string directly
                const device = devices.find(d => d.id === args[0]);
                if (device) {
                    selectedId = device.id;
                    console.log(`Output device set to: ${device.name}`);
                } else {
                    console.log('Device not found. Use "/output --list" to see valid indices or IDs.');
                    return;
                }
            }

            await this.settingsManager.updateAppConfig({ playbackDevice: selectedId });
        }
    }

    private async handleVolumeCommand(args: string[]): Promise<void> {
        if (args.length === 0) {
            console.log('Usage: /volume <0.0-1.0>');
            return;
        }

        const volume = parseFloat(args[0]);
        if (!isNaN(volume) && volume >= 0 && volume <= 2.0) {
            await this.settingsManager.updateAppConfig({ volume });
            console.log(`Volume set to ${Math.round(volume * 100)}%`);
        } else {
            console.log('Invalid volume level. Please use a number between 0.0 and 1.0.');
        }
    }

    private async handleMonitoringCommand(args: string[]): Promise<void> {
        if (args.length === 0) {
            console.log('Usage: /monitoring <on|off>');
            return;
        }

        const state = args[0].toLowerCase();
        if (state === 'on' || state === 'true' || state === '1') {
            await this.settingsManager.updateAppConfig({ monitoring: true });
            console.log('Monitoring enabled.');
        } else if (state === 'off' || state === 'false' || state === '0') {
            await this.settingsManager.updateAppConfig({ monitoring: false });
            console.log('Monitoring disabled.');
        } else {
            console.log('Usage: /monitoring <on|off>');
        }
    }

    private async handleMonitoringOutputCommand(args: string[]): Promise<void> {
        if (args.length === 0) {
            console.log('Usage: /monitoring_output <device_ID> or /monitoring_output --list');
            return;
        }

        const devices = await this.audioService.getDevices();

        if (args[0] === '--list') {
            console.log('Available output devices:');
            devices.forEach((device, index) => {
                console.log(`[${index}] ${device.name} (ID: ${device.id})`);
            });
            return;
        }

        const index = parseInt(args[0], 10);
        let selectedId: string | null = null;

        if (!isNaN(index) && index >= 0 && index < devices.length) {
            selectedId = devices[index].id;
            console.log(`Monitoring output device set to: ${devices[index].name}`);
        } else {
            const device = devices.find(d => d.id === args[0]);
            if (device) {
                selectedId = device.id;
                console.log(`Monitoring output device set to: ${device.name}`);
            } else {
                console.log('Device not found. Use "/monitoring_output --list" to see valid indices or IDs.');
                return;
            }
        }

        await this.settingsManager.updateAppConfig({ monitoringDevice: selectedId });
    }

    private async handleVolumeMonitoringCommand(args: string[]): Promise<void> {
        if (args.length === 0) {
            console.log('Usage: /volume_monitoring <0.0-1.0>');
            return;
        }

        const volume = parseFloat(args[0]);
        if (!isNaN(volume) && volume >= 0 && volume <= 2.0) {
            await this.settingsManager.updateAppConfig({ monitoringVolume: volume });
            console.log(`Monitoring volume set to ${Math.round(volume * 100)}%`);
        } else {
            console.log('Invalid volume level. Please use a number between 0.0 and 1.0.');
        }
    }

    private async handleHistoryCommand(args: string[]): Promise<void> {
        if (args.length > 0) {
            const subCommand = args[0].toLowerCase();
            
            if (subCommand === 'clear') {
                await this.historyManager.clearHistory();
                return;
            } else if (subCommand === 'play' && args.length > 1) {
                const id = parseInt(args[1], 10);
                if (isNaN(id) || id < 0 || id > 19) {
                    console.log('Invalid history ID.');
                    return;
                }
                await this.historyManager.playHistory(id);
                return;
            } else if (subCommand === 'delete' && args.length > 1) {
                const id = parseInt(args[1], 10);
                if (isNaN(id) || id < 0 || id > 19) {
                    console.log('Invalid history ID.');
                    return;
                }
                await this.historyManager.deleteHistory(id);
                return;
            } else {
                console.log('Usage: /history OR /history clear OR /history play <ID> OR /history delete <ID>');
                return;
            }
        }

        // Default: List history
        await this.historyManager.printHistory();
    }

    private async handleHotkeyCommand(args: string[]): Promise<void> {
        if (args.length === 0) {
            console.log('Usage: /hotkey list OR /hotkey play <ID> OR /hotkey assign <hotkey> <text...>');
            return;
        }

        const subCommand = args[0].toLowerCase();

        if (subCommand === 'list') {
            this.hotkeyManager.printHotkeys();
        } else if (subCommand === 'play' && args.length > 1) {
            const id = parseInt(args[1], 10);
            if (isNaN(id)) {
                console.log('Invalid hotkey ID.');
            } else {
                await this.hotkeyManager.playHotkey(id);
            }
        } else if (subCommand === 'delete' && args.length > 1) {
            const id = parseInt(args[1], 10);
            if (isNaN(id)) {
                console.log('Invalid hotkey ID.');
            } else {
                await this.hotkeyManager.deleteHotkey(id);
            }
        } else if (subCommand === 'clear') {
            await this.hotkeyManager.clearHotkeys();
        } else if (subCommand === 'assign' && args.length > 2) {
            const hotkey = args[1];
            const text = args.slice(2).join(' ');
            await this.hotkeyManager.assignHotkey(hotkey, text);
        } else {
            console.log('Usage: /hotkey list OR /hotkey clear OR /hotkey play <ID> OR /hotkey delete <ID> OR /hotkey assign <hotkey> <text...>');
        }
    }
}

