import * as readline from 'node:readline';
import { SettingsManager } from './settings/SettingsManager.js';
import { KokoroTTSProvider } from './infrastructure/KokoroTTSProvider.js';
import { AppController } from './core/AppController.js';
import { AudioService } from './infrastructure/AudioService.js';
import { HotkeyManager } from './core/HotkeyManager.js';
import { HistoryManager } from './core/HistoryManager.js';

/**
 * Bootstraps the application services and starts the command-line interface.
 * Wire up the Dependency Injection graph:
 * - SettingsManager reads/writes JSON configs.
 * - AudioService triggers CLI playback programs or delegates to Electron.
 * - HistoryManager indexes spoken phrases.
 * - KokoroTTSProvider loads model and synthesizes speech.
 * - HotkeyManager enables keyboard macro plays.
 * - AppController coordinates domain requests.
 */
async function bootstrap() {
    console.log('Initializing MTTS-JS CLI...');
    
    // 1. Instantiate core infrastructure and services
    const settingsManager = new SettingsManager();
    const audioService = new AudioService();
    const historyManager = new HistoryManager(audioService, settingsManager);
    const ttsProvider = new KokoroTTSProvider(settingsManager, audioService, historyManager);
    const hotkeyManager = new HotkeyManager(ttsProvider, audioService, settingsManager);
    
    // Initialize directory structure and hotkey index
    await hotkeyManager.init();
    
    // 2. Instantiate facade coordinator controller
    const appController = new AppController(ttsProvider, settingsManager, audioService, hotkeyManager, historyManager);
    
    // Read config to guarantee that paths and default files are setup on disk
    await settingsManager.getAppConfig();
    
    // 3. Setup console readline command loop
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('Ready. Type sentence to synthesize. Type "/help" for commands, or "/exit" to stop.');

    const promptLoop = () => {
        rl.question('> ', async (input) => {
            const text = input.trim();
            
            if (!text) return promptLoop();

            if (text.startsWith('/')) {
                // Execute slash command
                const shouldContinue = await appController.handleCommand(text);
                if (!shouldContinue) {
                    rl.close();
                    process.exit(0);
                }
            } else {
                // Generate and speak text input
                await appController.processInput(text);
            }
            
            promptLoop();
        });
    };

    // Begin looping
    promptLoop();
}

bootstrap().catch(error => {
    console.error('Fatal error start:', error);
    process.exit(1);
});
