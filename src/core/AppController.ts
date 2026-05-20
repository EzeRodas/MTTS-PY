import { ITTSService } from './interfaces/ITTSService.js';
import { ISettingsManager } from './interfaces/ISettingsManager.js';
import { AudioService } from '../infrastructure/AudioService.js';
import { HotkeyManager } from './HotkeyManager.js';
import { HistoryManager } from './HistoryManager.js';

/**
 * Controller coordinating the core domain services of the TTS application.
 * Acts as the entrypoint coordinator for inputs, command execution, settings adjustments,
 * history lookups, and hotkey actions.
 * Decouples the user interfaces (both CLI and Electron frontend) from underlying logic.
 */
export class AppController {
    /** List of supported synthesis engines. Extensible for future local/cloud providers. */
    private availableModels = ['kokoro'];
    
    /** The active TTS engine. */
    private activeModel = 'kokoro';

    constructor(
        private ttsService: ITTSService,
        private settingsManager: ISettingsManager,
        private audioService: AudioService,
        private hotkeyManager: HotkeyManager,
        private historyManager: HistoryManager
    ) {}

    /**
     * Synthesizes and plays a text input stream.
     * Delegates text synthesis directly to the active TTS provider.
     * @param text The sentence/paragraph text.
     */
    public async processInput(text: string): Promise<void> {
        try {
            await this.ttsService.speak(text);
        } catch (error) {
            console.error('Error processing TTS input:', error);
        }
    }

    /**
     * Parses and routes console/IPC commands starting with a slash (`/`).
     * Supports commands such as /help, /voice, /model, /output, /volume, etc.
     * @param commandLine Raw input command string containing parameters.
     * @returns Promise resolving to true if the program loop should continue, or false to exit.
     */
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

    /**
     * Outputs help instructions and command usage guidelines to stdout.
     */
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

    /**
     * Lists registered model identifiers.
     */
    public listModels(): string[] {
        return this.availableModels;
    }

    /**
     * Sets the active voice model.
     * @param modelName Identifier of the model to select.
     */
    public setModel(modelName: string): boolean {
        if (this.availableModels.includes(modelName)) {
            this.activeModel = modelName;
            return true;
        }
        return false;
    }

    /**
     * Gets the currently active model identifier.
     */
    public getActiveModel(): string {
        return this.activeModel;
    }

    /**
     * Handles /model subcommands.
     */
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

    /**
     * Lists all voice options matching the current synthesis engine.
     */
    public async listVoices(): Promise<string[]> {
        return await this.ttsService.getVoices();
    }

    /**
     * Retrieves the current voice identifier from engine configuration files.
     */
    public async getActiveVoice(): Promise<string> {
        // Hardcoded to kokoro for now since it's the only engine
        const config = await this.settingsManager.getEngineConfig<{voiceId: string}>('kokoro', { voiceId: 'af_heart' });
        return config.voiceId;
    }

    /**
     * Sets a new active voice and persists changes.
     * @param voiceName The identifier of the voice.
     */
    public async setVoice(voiceName: string): Promise<void> {
        await this.ttsService.setVoice(voiceName);
    }

    /**
     * Returns the global application configuration object.
     */
    public async getAppConfig() {
        return await this.settingsManager.getAppConfig();
    }

    /**
     * Patches the current global application configuration and triggers updates.
     * @param config Partial configurations object.
     */
    public async updateAppConfig(config: any) {
        return await this.settingsManager.updateAppConfig(config);
    }

    /**
     * Enumerates output audio devices available on the system.
     */
    public async getDevices() {
        return await this.audioService.getDevices();
    }

    /**
     * Process Voice selection CLI command.
     */
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

    /**
     * Process Output device selection CLI command.
     * Translates index number or device ID string to app settings.
     */
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

    /**
     * Process Volume scaling CLI command.
     */
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

    /**
     * Process Monitoring toggle CLI command.
     */
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

    /**
     * Process Monitoring target device selection CLI command.
     */
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

    /**
     * Process Monitoring volume CLI command.
     */
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

    /**
     * Process History command and subcommands (list, clear, play, delete).
     */
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

    /**
     * Process Hotkey commands (list, assign, delete, play, clear).
     */
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


