import { app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut } from 'electron';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// SYSTEM GRAPHICS & DISPLAY WORKAROUNDS
// ============================================================================
// Disabling hardware acceleration on macOS/Windows prevents background rendering issues.
// On Linux, appending ozone-platform wayland/transparent flags resolves transparency bugs
// on modern compositors (e.g. Hyprland, Sway, GNOME Wayland).
if (process.platform !== 'linux') {
    app.disableHardwareAcceleration();
}

if (process.platform === 'linux') {
    app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
    app.commandLine.appendSwitch('enable-transparent-visuals');
}

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let appController: any;
let tray: Tray | null = null;
let isQuitting = false;

/** Path to electron-specific persistent settings JSON file */
const electronSettingsPath = path.join(app.getPath('userData'), 'electron-settings.json');

/**
 * Loads Electron UI specific preferences (like the last used screen monitor ID).
 */
async function loadElectronSettings() {
    if (existsSync(electronSettingsPath)) {
        try {
            const data = await fs.readFile(electronSettingsPath, 'utf-8');
            if (!data.trim()) return {}; 
            return JSON.parse(data);
        } catch (e) {
            console.error('Failed to load electron settings:', e);
        }
    }
    return {};
}

/**
 * Persists Electron UI configurations to disk.
 * @param settings Partial settings object to merge.
 */
async function saveElectronSettings(settings: any) {
    try {
        const current = await loadElectronSettings();
        const updated = { ...current, ...settings };
        await fs.writeFile(electronSettingsPath, JSON.stringify(updated, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save electron settings:', e);
    }
}

/**
 * Dynamically boots up backend services and sets up IPC-renderer callbacks.
 * Dynamic imports are used to defer loading heavy models and core frameworks
 * until Electron is fully prepared, preventing startup locks.
 */
async function bootstrapBackend() {
    // Dynamic imports to prevent early initialization crashes
    const { SettingsManager } = await import('../settings/SettingsManager.js');
    const { AudioService } = await import('../infrastructure/AudioService.js');
    const { HistoryManager } = await import('../core/HistoryManager.js');
    const { KokoroTTSProvider } = await import('../infrastructure/KokoroTTSProvider.js');
    const { HotkeyManager } = await import('../core/HotkeyManager.js');
    const { AppController } = await import('../core/AppController.js');

    const settingsManager = new SettingsManager();
    const audioService = new AudioService();
    
    // Reroute audio playback to Renderer via Buffer to avoid protocol/security issues.
    // Reading wav files directly in Renderer over standard protocol (file:// or asar://)
    // is blocked by Electron CSP and filesystem sandbox limitations.
    audioService.setPlaybackHandler(async (data) => {
        console.log('Main: Audio playback handler triggered for:', data.filePath);
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                if (!existsSync(data.filePath)) {
                    console.error('Main: Audio file does not exist:', data.filePath);
                    return;
                }
                const buffer = await fs.readFile(data.filePath);
                // Convert Node Buffer to standard Uint8Array for structured clone safety across IPC boundary
                const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                console.log(`Main: Sending play-audio IPC to renderer. Buffer size: ${uint8Array.length} bytes`);
                mainWindow.webContents.send('play-audio', {
                    ...data,
                    audioBuffer: uint8Array
                });
            } catch (err) {
                console.error('Main: Failed to read audio file for IPC:', err);
            }
        } else {
            console.warn('Main: Cannot send play-audio IPC. mainWindow is null or destroyed.');
        }
    });

    const historyManager = new HistoryManager(audioService, settingsManager);
    const ttsProvider = new KokoroTTSProvider(settingsManager, audioService, historyManager);
    const hotkeyManager = new HotkeyManager(ttsProvider, audioService, settingsManager);
    
    await hotkeyManager.init();
    await settingsManager.getAppConfig();
    
    appController = new AppController(ttsProvider, settingsManager, audioService, hotkeyManager, historyManager);
}

/**
 * Creates the main input bar application window.
 * Positions it at the bottom-center of the screen.
 */
async function createWindow() {
    const settings = await loadElectronSettings();
    let targetDisplay = screen.getPrimaryDisplay();

    // Re-focus on the screen the user last dragged or used the window on.
    if (settings.lastDisplayId) {
        const displays = screen.getAllDisplays();
        const foundDisplay = displays.find(d => d.id === settings.lastDisplayId);
        if (foundDisplay) targetDisplay = foundDisplay;
    }

    const { x: workX, y: workY, width, height } = targetDisplay.workArea;
    const windowWidth = 1056;
    const windowHeight = 80;
    const x = workX + Math.floor((width - windowWidth) / 2);
    const y = workY + height - windowHeight;

    mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: x,
        y: y,
        frame: false,
        transparent: true,
        autoHideMenuBar: true,
        resizable: false,
        maximizable: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false,
            autoplayPolicy: 'no-user-gesture-required'
        },
        icon: path.join(__dirname, '../../src/ui/assets/icon.png')
    });
    
    mainWindow.setMenu(null);
    if (process.env['ELECTRON_RENDERER_URL']) {
        await mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/index.html`);
    } else {
        await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
    
    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            mainWindow.setPosition(x, y);
            mainWindow.show();
            // Staggered repositioning to reliably override window manager initial placement
            setTimeout(() => mainWindow?.setPosition(x, y), 50);
            setTimeout(() => mainWindow?.setPosition(x, y), 150);
            setTimeout(() => mainWindow?.setPosition(x, y), 400);
        }
    });

    mainWindow.on('hide', () => {
        // If main bar is hidden (via hotkey), auto-hide open settings window
        if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
    });

    mainWindow.on('close', (event) => {
        // Prevent close unless system tray explicitly sends quit commands,
        // allowing the window to minimize/hide to the system tray.
        if (!isQuitting) {
            event.preventDefault();
            if (mainWindow) {
                mainWindow.hide();
                if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
                const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
                saveElectronSettings({ lastDisplayId: currentDisplay.id });
            }
            return;
        }
        if (mainWindow) {
            const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
            saveElectronSettings({ lastDisplayId: currentDisplay.id });
        }
    });
}

/**
 * Configures the OS system tray icon and context menus.
 */
function createTray() {
    const iconPath = path.join(__dirname, '../../src/ui/assets/icon.png');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show', click: () => { mainWindow?.show(); } },
        { label: 'Exit Moon-TTS', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('Moon-TTS');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { mainWindow?.show(); });
}

/**
 * Creates the secondary window displaying settings parameters.
 */
async function createSettingsWindow() {
    settingsWindow = new BrowserWindow({
        width: 400,
        height: 500,
        frame: false,
        transparent: true,
        resizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            autoplayPolicy: 'no-user-gesture-required'
        }
    });

    settingsWindow.setMenu(null);
    if (process.env['ELECTRON_RENDERER_URL']) {
        await settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`);
    } else {
        await settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
    }

    settingsWindow.on('close', (event) => {
        // Intercept close to hide the window instead of destroying resources
        if (!isQuitting) {
            event.preventDefault();
            if (settingsWindow) settingsWindow.hide();
        }
    });
}

/**
 * Binds global keyboard hotkeys to show/hide the main app bar on the screen.
 * @param shortcut Keyboard combination accelerator.
 */
function registerAppShortcut(shortcut: string) {
    globalShortcut.unregisterAll();
    if (shortcut) {
        try {
            globalShortcut.register(shortcut, () => {
                if (mainWindow) {
                    if (mainWindow.isVisible()) mainWindow.hide();
                    else mainWindow.show();
                }
            });
        } catch (e) {
            console.error('Failed to register shortcut', e);
        }
    }
}

// ============================================================================
// MAIN LIFE CYCLE TRIGGERS
// ============================================================================

app.whenReady().then(async () => {
    await bootstrapBackend();
    
    const initialConfig = await appController.getAppConfig();
    if (initialConfig && initialConfig.appShortcut) {
        registerAppShortcut(initialConfig.appShortcut);
    }
    
    // Register IPC channels handlers
    ipcMain.handle('submit-text', async (event, text: string) => {
        if (appController) await appController.processInput(text);
    });

    ipcMain.handle('get-models', () => appController ? appController.listModels() : []);
    ipcMain.handle('get-active-model', () => appController ? appController.getActiveModel() : null);
    ipcMain.handle('set-model', (event, model: string) => {
        if (appController) appController.setModel(model);
    });

    ipcMain.handle('get-voices', async () => appController ? await appController.listVoices() : []);
    ipcMain.handle('get-active-voice', async () => appController ? await appController.getActiveVoice() : null);
    ipcMain.handle('set-voice', async (event, voice: string) => {
        if (appController) await appController.setVoice(voice);
    });

    ipcMain.handle('get-app-config', async () => appController ? await appController.getAppConfig() : null);
    ipcMain.handle('update-app-config', async (event, config: any) => {
        if (appController) {
            await appController.updateAppConfig(config);
            if (config.appShortcut !== undefined) registerAppShortcut(config.appShortcut);
        }
    });

    // Support both ipc handlers for robustness
    ipcMain.handle('get-audio-devices', async () => appController ? await appController.getDevices() : []);
    ipcMain.handle('get-devices', async () => appController ? await appController.getDevices() : []);
    
    ipcMain.on('close-app', () => { if (mainWindow) mainWindow.close(); });

    ipcMain.on('open-settings', (event, buttonBounds: { x: number, y: number, width: number, height: number }) => {
        if (!settingsWindow || !mainWindow) return;
        
        // Toggle settings if it is clicked again
        if (settingsWindow.isVisible()) {
            settingsWindow.hide();
            return;
        }
        
        // Position settings window directly on top of the settings gear button
        const mainBounds = mainWindow.getBounds();
        const settingsHeight = 500;
        const x = mainBounds.x + Math.floor(buttonBounds.x);
        const y = mainBounds.y + Math.floor(buttonBounds.y) - settingsHeight - 16;
        settingsWindow.setPosition(x, y);
        settingsWindow.show();
    });

    ipcMain.on('close-settings', () => { if (settingsWindow) settingsWindow.hide(); });

    await createWindow();
    await createSettingsWindow();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            createSettingsWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
