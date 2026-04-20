export interface AppConfig {
    playback: boolean;
    volume: number;
    playbackDevice: string | null;
    monitoring: boolean;
    monitoringDevice: string | null;
    monitoringVolume: number;
    modelsPath: string;
    appShortcut: string;
    defaultAppShortcut: string;
}

export interface ISettingsManager {
    getAppConfig(): Promise<AppConfig>;
    updateAppConfig(settings: Partial<AppConfig>): Promise<void>;
    
    getEngineConfig<T>(engineName: string, defaultSettings: T): Promise<T>;
    updateEngineConfig<T>(engineName: string, settings: Partial<T>): Promise<void>;
}
