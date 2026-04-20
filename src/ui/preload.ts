import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    submitText: (text: string) => ipcRenderer.invoke('submit-text', text),
    closeApp: () => ipcRenderer.send('close-app'),
    openSettings: (bounds: { x: number, y: number, width: number, height: number }) => ipcRenderer.send('open-settings', bounds),
    closeSettings: () => ipcRenderer.send('close-settings')
});