import { contextBridge, ipcRenderer } from 'electron';

// ============================================================================
// ELECTRON SECURITY CONTEXT BRIDGE
// ============================================================================
// Electron recommends running renderer processes in isolated contexts with nodeIntegration 
// disabled to prevent remote code execution vulnerabilities. The contextBridge securely 
// exposes a limited subset of IPC messaging methods to the window.api property.
contextBridge.exposeInMainWorld('api', {
    /** Sends text input to the main process for model synthesis */
    submitText: (text: string) => ipcRenderer.invoke('submit-text', text),
    
    /** Request main process to exit the application */
    closeApp: () => ipcRenderer.send('close-app'),
    
    /** Open settings modal, aligned to target bounds coordinates */
    openSettings: (bounds: { x: number, y: number, width: number, height: number }) => ipcRenderer.send('open-settings', bounds),
    
    /** Closes settings popup window */
    closeSettings: () => ipcRenderer.send('close-settings'),
    
    /** Queries registered model engines list */
    getModels: () => ipcRenderer.invoke('get-models'),
    
    /** Queries active model engine */
    getActiveModel: () => ipcRenderer.invoke('get-active-model'),
    
    /** Updates active model engine */
    setModel: (model: string) => ipcRenderer.invoke('set-model', model),
    
    /** Retrieves list of voices matching current engine */
    getVoices: () => ipcRenderer.invoke('get-voices'),
    
    /** Queries currently selected active voice ID */
    getActiveVoice: () => ipcRenderer.invoke('get-active-voice'),
    
    /** Updates the selected voice */
    setVoice: (voice: string) => ipcRenderer.invoke('set-voice', voice),
    
    /** Queries current global settings state */
    getAppConfig: () => ipcRenderer.invoke('get-app-config'),
    
    /** Updates subsets of the global settings configuration */
    updateAppConfig: (config: any) => ipcRenderer.invoke('update-app-config', config),
    
    /** Queries output devices enumerated on system */
    getDevices: () => ipcRenderer.invoke('get-audio-devices'),
    
    /**
     * Registers listener callback that is triggered when Main process pushes 
     * binary audio stream payloads (`play-audio`) to Renderer.
     */
    onPlayAudio: (callback: (data: any) => void) => {
        ipcRenderer.on('play-audio', (_event, data) => callback(data));
    }
});