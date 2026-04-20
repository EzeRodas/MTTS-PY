import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { AppConfig, ISettingsManager } from '../core/interfaces/ISettingsManager.js';

export class SettingsManager implements ISettingsManager {
    private appConfigDir: string;
    private appConfigPath: string;
    private engineConfigDir: string;
    
    private getModelsDirectory(): string {
        const homeDir = os.homedir();
        const appName = 'Moon-TTS';

        switch (process.platform) {
            case 'win32':
                return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), appName);
            case 'darwin':
                return path.join(homeDir, 'Library', 'Application Support', appName);
            case 'linux':
            case 'android':
            default:
                return path.join(process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), appName);
        }
    }

    private defaultAppConfig: AppConfig = {
        playback: true,
        volume: 1.0,
        playbackDevice: null,
        monitoring: false,
        monitoringDevice: null,
        monitoringVolume: 1.0,
        modelsPath: this.getModelsDirectory()
    };

    constructor() {
        this.appConfigDir = path.join(process.cwd(), 'src', 'settings');
        this.engineConfigDir = path.join(process.cwd(), 'src', 'infrastructure');
        this.appConfigPath = path.join(this.appConfigDir, 'app_config.json');
    }

    private async ensureFileExists(filePath: string, defaultData: any, dir: string): Promise<void> {
        if (!existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }
        
        if (!existsSync(filePath)) {
            await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), 'utf-8');
        }
    }

    public async getAppConfig(): Promise<AppConfig> {
        await this.ensureFileExists(this.appConfigPath, this.defaultAppConfig, this.appConfigDir);
        
        try {
            const data = await fs.readFile(this.appConfigPath, 'utf-8');
            const parsed = JSON.parse(data);
            return { ...this.defaultAppConfig, ...parsed };
        } catch (error) {
            console.error('Failed to read app config, returning defaults.', error);
            return { ...this.defaultAppConfig };
        }
    }

    public async updateAppConfig(newSettings: Partial<AppConfig>): Promise<void> {
        const currentSettings = await this.getAppConfig();
        const updatedSettings = { ...currentSettings, ...newSettings };
        
        await fs.writeFile(this.appConfigPath, JSON.stringify(updatedSettings, null, 2), 'utf-8');
    }

    public async getEngineConfig<T>(engineName: string, defaultSettings: T): Promise<T> {
        const filePath = path.join(this.engineConfigDir, `${engineName}_config.json`);
        await this.ensureFileExists(filePath, defaultSettings, this.engineConfigDir);

        try {
            const data = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(data);
            return { ...defaultSettings, ...parsed };
        } catch (error) {
            console.error(`Failed to read ${engineName} config, returning defaults.`, error);
            return { ...defaultSettings };
        }
    }

    public async updateEngineConfig<T>(engineName: string, newSettings: Partial<T>): Promise<void> {
        const filePath = path.join(this.engineConfigDir, `${engineName}_config.json`);
        let currentSettings: any = {};
        
        if (existsSync(filePath)) {
            try {
                const data = await fs.readFile(filePath, 'utf-8');
                currentSettings = JSON.parse(data);
            } catch (e) {}
        }
        
        const updatedSettings = { ...currentSettings, ...newSettings };
        await fs.writeFile(filePath, JSON.stringify(updatedSettings, null, 2), 'utf-8');
    }
}
