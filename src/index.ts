import * as readline from 'node:readline';
import { SettingsManager } from './settings/SettingsManager.js';
import { KokoroTTSProvider } from './infrastructure/KokoroTTSProvider.js';
import { AppController } from './core/AppController.js';
import { AudioService } from './infrastructure/AudioService.js';
import { HotkeyManager } from './core/HotkeyManager.js';
import { HistoryManager } from './core/HistoryManager.js';

async function bootstrap() {
    console.log('Initializing MTTS-JS CLI...');
    
    const settingsManager = new SettingsManager();
    const audioService = new AudioService();
    const historyManager = new HistoryManager(audioService, settingsManager);
    const ttsProvider = new KokoroTTSProvider(settingsManager, audioService, historyManager);
    const hotkeyManager = new HotkeyManager(ttsProvider, audioService, settingsManager);
    await hotkeyManager.init();
    const appController = new AppController(ttsProvider, settingsManager, audioService, hotkeyManager, historyManager);
    
    await settingsManager.getAppConfig();
    
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
                const shouldContinue = await appController.handleCommand(text);
                if (!shouldContinue) {
                    rl.close();
                    process.exit(0);
                }
            } else {
                await appController.processInput(text);
            }
            
            promptLoop();
        });
    };

    promptLoop();
}

bootstrap().catch(error => {
    console.error('Fatal error start:', error);
    process.exit(1);
});
