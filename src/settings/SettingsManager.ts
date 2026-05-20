import { ISettingsManager, AppConfig } from '../core/interfaces/ISettingsManager.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';

/**
 * Service managing global application and modular speech engine configurations.
 * Handles automatic, OS-compliant folder routing, lazy creation of configuration structures,
 * and JSON file reading/writing safely.
 */
export class SettingsManager implements ISettingsManager {
    /** Root directory where user configs are stored */
    private appDirectory: string;
    
    /** Target file storing general application parameters */
    private settingsFilePath: string;

    /** Default values for fresh application bootstraps */
    private defaultSettings: AppConfig = {
        playback: true,
        volume: 0.8,
        playbackDevice: 'default',
        monitoring: false,
        monitoringDevice: 'default',
        monitoringVolume: 0.8,
        modelsPath: '',
        appShortcut: 'CommandOrControl+Alt+S',
        defaultAppShortcut: 'CommandOrControl+Alt+S'
    };

    constructor() {
        const homeDir = os.homedir();
        const appName = 'Moon-TTS';

        // Resolve platform-standard paths for persistence data
        if (os.platform() === 'win32') {
            this.appDirectory = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), appName);
        } else if (os.platform() === 'darwin') {
            this.appDirectory = path.join(homeDir, 'Library', 'Application Support', appName);
        } else {
            // Linux and other Unix-like systems adhering to XDG specs
            this.appDirectory = path.join(process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), appName);
        }

        this.settingsFilePath = path.join(this.appDirectory, 'settings.json');
        
        // Initialize the default models path to a models subfolder inside the app directory
        this.defaultSettings.modelsPath = path.join(this.appDirectory, 'models');
    }

    /**
     * Resolves the system app directory.
     */
    public getAppDirectory(): string {
        return this.appDirectory;
    }

    /**
     * Loads the current application settings.
     * Merges existing on disk with defaults to cover newly added settings keys.
     */
    public async getAppConfig(): Promise<AppConfig> {
        await fs.mkdir(this.appDirectory, { recursive: true });

        if (!existsSync(this.settingsFilePath)) {
            // Write defaults if config file does not exist
            await fs.writeFile(this.settingsFilePath, JSON.stringify(this.defaultSettings, null, 2), 'utf-8');
            return this.defaultSettings;
        }

        try {
            const data = await fs.readFile(this.settingsFilePath, 'utf-8');
            const parsed = JSON.parse(data);
            
            // Merge defaults in case new configuration parameters were introduced in later versions
            return { ...this.defaultSettings, ...parsed };
        } catch (error) {
            console.error('Failed to parse settings.json. Reverting to default settings.');
            return this.defaultSettings;
        }
    }

    /**
     * Updates and saves the application settings.
     * @param settings Subset of properties to change.
     */
    public async updateAppConfig(settings: Partial<AppConfig>): Promise<void> {
        const currentConfig = await this.getAppConfig();
        const updatedConfig = { ...currentConfig, ...settings };
        await fs.writeFile(this.settingsFilePath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
    }

    /**
     * Loads settings specific to a given TTS engine provider.
     * Saves defaults if configuration doesn't exist.
     * @template T The configuration type.
     * @param engineName Name of the engine.
     * @param defaultSettings Values to save/return if config does not exist.
     */
    public async getEngineConfig<T>(engineName: string, defaultSettings: T): Promise<T> {
        const filePath = path.join(this.appDirectory, `${engineName}.json`);

        if (!existsSync(filePath)) {
            await fs.writeFile(filePath, JSON.stringify(defaultSettings, null, 2), 'utf-8');
            return defaultSettings;
        }

        try {
            const data = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(data);
            return { ...defaultSettings, ...parsed };
        } catch (error) {
            return defaultSettings;
        }
    }

    /**
     * Overwrites settings specific to a given TTS engine provider.
     * @template T The configuration type.
     * @param engineName Name of the engine.
     * @param settings Properties to write.
     */
    public async updateEngineConfig<T>(engineName: string, settings: Partial<T>): Promise<void> {
        const current = await this.getEngineConfig(engineName, {} as T);
        const merged = { ...current, ...settings };
        const filePath = path.join(this.appDirectory, `${engineName}.json`);
        await fs.writeFile(filePath, JSON.stringify(merged, null, 2), 'utf-8');
    }
}
