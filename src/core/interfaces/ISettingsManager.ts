/**
 * Configuration schema for the MTTS-JS application.
 * Governs audio routing, playback states, hotkeys, and model locations.
 */
export interface AppConfig {
    /** Whether audio output should be synthesized and played back to the user */
    playback: boolean;
    
    /** Primary playback volume level (0.0 to 1.0) */
    volume: number;
    
    /** Selected primary playback audio device identifier. Null defaults to system default output. */
    playbackDevice: string | null;
    
    /** Whether dual monitoring mode is enabled (playing audio concurrently to a secondary output) */
    monitoring: boolean;
    
    /** Selected secondary monitoring audio device identifier. Null defaults to system default output. */
    monitoringDevice: string | null;
    
    /** Secondary monitoring volume level (0.0 to 1.0) */
    monitoringVolume: number;
    
    /** Absolute path to directory where AI models are stored */
    modelsPath: string;
    
    /** User-configured keyboard shortcut to show/hide the main Electron UI */
    appShortcut: string;
    
    /** Fallback default shortcut to show/hide the main Electron UI */
    defaultAppShortcut: string;
}

/**
 * Interface defining settings storage and retrieval contracts.
 * Decouples the storage mechanism (JSON files, local storage, DB) from managers and UI.
 */
export interface ISettingsManager {
    /**
     * Retrieves the root user data directory for application file storage.
     * Varies depending on operating system conventions.
     */
    getAppDirectory(): string;

    /**
     * Retrieves the current application configuration.
     * If configuration doesn't exist, initializes it with defaults.
     */
    getAppConfig(): Promise<AppConfig>;

    /**
     * Updates specific keys of the application configuration.
     * Merges current config with modified settings and persists changes.
     */
    updateAppConfig(settings: Partial<AppConfig>): Promise<void>;
    
    /**
     * Retrieves configuration for a specific TTS synthesis engine.
     * @template T Type of configuration shape
     * @param engineName Name of the target engine (e.g. 'kokoro')
     * @param defaultSettings Fallback configurations if file doesn't exist
     */
    getEngineConfig<T>(engineName: string, defaultSettings: T): Promise<T>;

    /**
     * Updates settings for a specific TTS synthesis engine.
     * @template T Type of configuration shape
     * @param engineName Name of the target engine (e.g. 'kokoro')
     * @param settings Configuration subset to update and persist
     */
    updateEngineConfig<T>(engineName: string, settings: Partial<T>): Promise<void>;
}

