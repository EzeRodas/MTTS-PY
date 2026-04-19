import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    submitText: (text: string) => ipcRenderer.invoke('submit-text', text),
    closeApp: () => ipcRenderer.send('close-app')
});