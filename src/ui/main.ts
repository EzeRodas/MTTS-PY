import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Disable hardware acceleration if GPU process crashes
app.disableHardwareAcceleration();

import { SettingsManager } from '../settings/SettingsManager.js';
import { KokoroTTSProvider } from '../infrastructure/KokoroTTSProvider.js';
import { AppController } from '../core/AppController.js';
import { AudioService } from '../infrastructure/AudioService.js';
import { HotkeyManager } from '../core/HotkeyManager.js';
import { HistoryManager } from '../core/HistoryManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let appController: AppController;

const electronSettingsPath = path.join(app.getPath('userData'), 'electron-settings.json');

async function loadElectronSettings() {
    if (existsSync(electronSettingsPath)) {
        try {
            const data = await fs.readFile(electronSettingsPath, 'utf-8');
            return JSON.parse(data);
        } catch (e) {
            console.error('Failed to load electron settings:', e);
        }
    }
    return {};
}

async function saveElectronSettings(settings: any) {
    try {
        const current = await loadElectronSettings();
        const updated = { ...current, ...settings };
        await fs.writeFile(electronSettingsPath, JSON.stringify(updated, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save electron settings:', e);
    }
}

async function bootstrapBackend() {
    const settingsManager = new SettingsManager();
    const audioService = new AudioService();
    const historyManager = new HistoryManager(audioService, settingsManager);
    const ttsProvider = new KokoroTTSProvider(settingsManager, audioService, historyManager);
    const hotkeyManager = new HotkeyManager(ttsProvider, audioService, settingsManager);
    
    await hotkeyManager.init();
    await settingsManager.getAppConfig();
    
    appController = new AppController(ttsProvider, settingsManager, audioService, hotkeyManager, historyManager);
}

async function createWindow() {
    const settings = await loadElectronSettings();
    let targetDisplay = screen.getPrimaryDisplay();

    if (settings.lastDisplayId) {
        const displays = screen.getAllDisplays();
        const foundDisplay = displays.find(d => d.id === settings.lastDisplayId);
        if (foundDisplay) {
            targetDisplay = foundDisplay;
        }
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
        show: false, // Create hidden
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        },
        icon: path.join(__dirname,'assets/icon.jpg')
    });
    
    mainWindow.setMenu(null);
    if (process.env['ELECTRON_RENDERER_URL']) {
        await mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/index.html`);
    } else {
        await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
    
    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            // Reposition while still invisible, then show
            mainWindow.setPosition(x, y);
            mainWindow.show();
        }
    });

    mainWindow.on('close', () => {
        if (mainWindow) {
            const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
            saveElectronSettings({ lastDisplayId: currentDisplay.id });
        }
    });

    mainWindow.webContents.openDevTools({ mode: 'detach' });
}

async function createSettingsWindow() {
    settingsWindow = new BrowserWindow({
        width: 400,
        height: 500,
        frame: false,
        transparent: true,
        resizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        show: false, // Hidden by default
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    settingsWindow.setMenu(null);
    if (process.env['ELECTRON_RENDERER_URL']) {
        await settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`);
    } else {
        await settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
    }

    settingsWindow.on('close', (event) => {
        event.preventDefault(); // Don't destroy window
        if (settingsWindow) {
            settingsWindow.hide();
        }
    });
}

app.whenReady().then(async () => {
    await bootstrapBackend();
    
    ipcMain.handle('submit-text', async (event, text: string) => {
        if (appController) {
            // Passing text to the controller
            await appController.processInput(text);
        }
    });

    ipcMain.handle('get-models', () => {
        return appController ? appController.listModels() : [];
    });

    ipcMain.handle('get-active-model', () => {
        return appController ? appController.getActiveModel() : null;
    });

    ipcMain.handle('set-model', (event, model: string) => {
        if (appController) {
            appController.setModel(model);
        }
    });

    ipcMain.handle('get-voices', async () => {
        return appController ? await appController.listVoices() : [];
    });

    ipcMain.handle('get-active-voice', async () => {
        return appController ? await appController.getActiveVoice() : null;
    });

    ipcMain.handle('set-voice', async (event, voice: string) => {
        if (appController) {
            await appController.setVoice(voice);
        }
    });

    ipcMain.handle('get-app-config', async () => {
        return appController ? await appController.getAppConfig() : null;
    });

    ipcMain.handle('update-app-config', async (event, config: any) => {
        if (appController) {
            await appController.updateAppConfig(config);
        }
    });

    ipcMain.handle('get-devices', async () => {
        return appController ? await appController.getDevices() : [];
    });

    ipcMain.on('close-app', () => {
        app.quit();
    });

    ipcMain.on('open-settings', (event, buttonBounds: { x: number, y: number, width: number, height: number }) => {
        if (!settingsWindow || !mainWindow) return;

        if (settingsWindow.isVisible()) {
            settingsWindow.hide();
            return;
        }

        const mainBounds = mainWindow.getBounds();
        const settingsHeight = 500;
        
        // Aligned with left margin, extending upwards and to the right
        const x = mainBounds.x + Math.floor(buttonBounds.x);
        const y = mainBounds.y + Math.floor(buttonBounds.y) - settingsHeight - 16;

        settingsWindow.setPosition(x, y);
        settingsWindow.show();
    });

    ipcMain.on('close-settings', () => {
        if (settingsWindow) {
            settingsWindow.hide();
        }
    });

    await createWindow();
    await createSettingsWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            createSettingsWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});