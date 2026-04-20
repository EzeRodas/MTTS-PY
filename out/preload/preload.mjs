import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("api", {
  submitText: (text) => ipcRenderer.invoke("submit-text", text),
  closeApp: () => ipcRenderer.send("close-app"),
  openSettings: (bounds) => ipcRenderer.send("open-settings", bounds),
  closeSettings: () => ipcRenderer.send("close-settings"),
  getModels: () => ipcRenderer.invoke("get-models"),
  getActiveModel: () => ipcRenderer.invoke("get-active-model"),
  setModel: (model) => ipcRenderer.invoke("set-model", model),
  getVoices: () => ipcRenderer.invoke("get-voices"),
  getActiveVoice: () => ipcRenderer.invoke("get-active-voice"),
  setVoice: (voice) => ipcRenderer.invoke("set-voice", voice)
});
