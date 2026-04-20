import { app, ipcMain, BrowserWindow, screen, Tray, Menu } from "electron";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import { KokoroTTS } from "kokoro-js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
class SettingsManager {
  appConfigDir;
  appConfigPath;
  engineConfigDir;
  getModelsDirectory() {
    const homeDir = os.homedir();
    const appName = "Moon-TTS";
    switch (process.platform) {
      case "win32":
        return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
      case "darwin":
        return path.join(homeDir, "Library", "Application Support", appName);
      case "linux":
      case "android":
      default:
        return path.join(process.env.XDG_DATA_HOME || path.join(homeDir, ".local", "share"), appName);
    }
  }
  defaultAppConfig = {
    playback: true,
    volume: 1,
    playbackDevice: null,
    monitoring: false,
    monitoringDevice: null,
    monitoringVolume: 1,
    modelsPath: this.getModelsDirectory()
  };
  constructor() {
    this.appConfigDir = path.join(process.cwd(), "src", "settings");
    this.engineConfigDir = path.join(process.cwd(), "src", "infrastructure");
    this.appConfigPath = path.join(this.appConfigDir, "app_config.json");
  }
  async ensureFileExists(filePath, defaultData, dir) {
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    if (!existsSync(filePath)) {
      await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), "utf-8");
    }
  }
  async getAppConfig() {
    await this.ensureFileExists(this.appConfigPath, this.defaultAppConfig, this.appConfigDir);
    try {
      const data = await fs.readFile(this.appConfigPath, "utf-8");
      const parsed = JSON.parse(data);
      return { ...this.defaultAppConfig, ...parsed };
    } catch (error) {
      console.error("Failed to read app config, returning defaults.", error);
      return { ...this.defaultAppConfig };
    }
  }
  async updateAppConfig(newSettings) {
    const currentSettings = await this.getAppConfig();
    const updatedSettings = { ...currentSettings, ...newSettings };
    await fs.writeFile(this.appConfigPath, JSON.stringify(updatedSettings, null, 2), "utf-8");
  }
  async getEngineConfig(engineName, defaultSettings) {
    const filePath = path.join(this.engineConfigDir, `${engineName}_config.json`);
    await this.ensureFileExists(filePath, defaultSettings, this.engineConfigDir);
    try {
      const data = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);
      return { ...defaultSettings, ...parsed };
    } catch (error) {
      console.error(`Failed to read ${engineName} config, returning defaults.`, error);
      return { ...defaultSettings };
    }
  }
  async updateEngineConfig(engineName, newSettings) {
    const filePath = path.join(this.engineConfigDir, `${engineName}_config.json`);
    let currentSettings = {};
    if (existsSync(filePath)) {
      try {
        const data = await fs.readFile(filePath, "utf-8");
        currentSettings = JSON.parse(data);
      } catch (e) {
      }
    }
    const updatedSettings = { ...currentSettings, ...newSettings };
    await fs.writeFile(filePath, JSON.stringify(updatedSettings, null, 2), "utf-8");
  }
}
class KokoroTTSProvider {
  ttsInstance = null;
  settingsManager;
  audioService;
  historyManager;
  modelId = "onnx-community/Kokoro-82M-v1.0-ONNX";
  defaultKokoroConfig = {
    voiceId: "af_heart",
    speed: 1,
    dtype: "fp32"
  };
  constructor(settingsManager, audioService, historyManager) {
    this.settingsManager = settingsManager;
    this.audioService = audioService;
    this.historyManager = historyManager;
  }
  async getTTSInstance() {
    if (!this.ttsInstance) {
      console.log(`Loading Kokoro TTS model: ${this.modelId}`);
      const config = await this.settingsManager.getEngineConfig("kokoro", this.defaultKokoroConfig);
      this.ttsInstance = await KokoroTTS.from_pretrained(this.modelId, {
        dtype: config.dtype,
        device: "cpu"
        // Explicitly run on CPU
      });
      console.log("Kokoro TTS model loaded into memory and cached.");
    }
    return this.ttsInstance;
  }
  async getVoices() {
    const tts = await this.getTTSInstance();
    return Object.keys(tts.voices);
  }
  async setVoice(voiceId) {
    const tts = await this.getTTSInstance();
    if (!tts.voices[voiceId]) {
      throw new Error(`Voice '${voiceId}' not found.`);
    }
    await this.settingsManager.updateEngineConfig("kokoro", { voiceId });
    console.log(`Voice set to: ${voiceId}`);
  }
  async generateToFile(text, filePath) {
    const tts = await this.getTTSInstance();
    const config = await this.settingsManager.getEngineConfig("kokoro", this.defaultKokoroConfig);
    console.log(`Generating audio for file: "${text}"`);
    const voice = config.voiceId;
    const audio = await tts.generate(text, {
      voice,
      speed: config.speed
    });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await audio.save(filePath);
    console.log(`Saved audio file to: ${filePath}`);
  }
  async speak(text) {
    const tts = await this.getTTSInstance();
    const config = await this.settingsManager.getEngineConfig("kokoro", this.defaultKokoroConfig);
    const appConfig = await this.settingsManager.getAppConfig();
    console.log(`Generating audio for text: "${text}"`);
    const voice = config.voiceId;
    const audio = await tts.generate(text, {
      voice,
      speed: config.speed
    });
    const tempFilePath = path.join(os.tmpdir(), `tts_temp_${Date.now()}.wav`);
    await audio.save(tempFilePath);
    await this.historyManager.addEntry(text, tempFilePath);
    try {
      await fs.unlink(tempFilePath);
    } catch (e) {
    }
    const finalFilePath = path.join(process.cwd(), "src", "audio", "tts_output_0.wav");
    await this.audioService.play(finalFilePath, appConfig.playback, appConfig.playbackDevice, appConfig.volume, appConfig.monitoring, appConfig.monitoringDevice, appConfig.monitoringVolume);
  }
}
class AppController {
  constructor(ttsService, settingsManager, audioService, hotkeyManager, historyManager) {
    this.ttsService = ttsService;
    this.settingsManager = settingsManager;
    this.audioService = audioService;
    this.hotkeyManager = hotkeyManager;
    this.historyManager = historyManager;
  }
  ttsService;
  settingsManager;
  audioService;
  hotkeyManager;
  historyManager;
  // We keep track of available models locally for now
  availableModels = ["kokoro"];
  activeModel = "kokoro";
  async processInput(text) {
    try {
      await this.ttsService.speak(text);
    } catch (error) {
      console.error("Error processing TTS input:", error);
    }
  }
  async handleCommand(commandLine) {
    const parts = commandLine.trim().split(" ");
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    switch (command) {
      case "/help":
        this.showHelp();
        break;
      case "/model":
        this.handleModelCommand(args);
        break;
      case "/voice":
        await this.handleVoiceCommand(args);
        break;
      case "/output":
        await this.handleOutputCommand(args);
        break;
      case "/volume":
        await this.handleVolumeCommand(args);
        break;
      case "/monitoring":
        await this.handleMonitoringCommand(args);
        break;
      case "/monitoring_output":
        await this.handleMonitoringOutputCommand(args);
        break;
      case "/volume_monitoring":
        await this.handleVolumeMonitoringCommand(args);
        break;
      case "/history":
        await this.handleHistoryCommand(args);
        break;
      case "/hotkey":
        await this.handleHotkeyCommand(args);
        break;
      case "/exit":
      case "/quit":
        console.log("Exiting.");
        return false;
      // Signals to close the app
      default:
        console.log('Command not found. Type "/help" for a list of commands.');
        break;
    }
    return true;
  }
  showHelp() {
    console.log(`
Available commands:
  /help                   - Show this help message

  /model --list           - List available TTS models
         <model_name>     - Set the active TTS model
  
  /voice --list           - List available voices for the current model
         <voice_name>     - Set the active voice
  
  /output --list          - List available output devices
          <device_id>     - Set the active output device
  /volume <0.0-1.0>       - Set playback volume (e.g., 0.5 for 50%)
  
  /monitoring <on/off>    - Enable or disable dual output monitoring
  /monitoring_output <id> - Set the monitoring output device
  /volume_monitoring <v>  - Set monitoring output volume (0.0-1.0)
  
  /history                - List the last 20 generated audios
           play <ID>      - Play the specific history file
           delete <ID>    - Delete the specific history file
           clear          - Delete all generated history

  /hotkey list            - List available hotkey combiantions
          play <ID>       - Play a specific hotkeyed phrase
          assign <hotkey> - Assign a hotkey combination to a phrase to generate
          delete <ID>     - Delete a hotkey combination and its phrase
          clear           - Delete all hotkeyed phrases
  
  /exit                   - Quit the application
        `.trim());
  }
  listModels() {
    return this.availableModels;
  }
  setModel(modelName) {
    if (this.availableModels.includes(modelName)) {
      this.activeModel = modelName;
      return true;
    }
    return false;
  }
  getActiveModel() {
    return this.activeModel;
  }
  handleModelCommand(args) {
    if (args.length === 0) {
      console.log("Usage: /model --list OR /model <model_name>");
      return;
    }
    if (args[0] === "--list") {
      console.log(`Available models:
${this.listModels().join(", ")}`);
    } else {
      const success = this.setModel(args[0]);
      if (success) {
        console.log(`Model set to ${args[0]}.`);
      } else {
        console.log(`Model '${args[0]}' not found.`);
      }
    }
  }
  async listVoices() {
    return await this.ttsService.getVoices();
  }
  async getActiveVoice() {
    const config = await this.settingsManager.getEngineConfig("kokoro", { voiceId: "af_heart" });
    return config.voiceId;
  }
  async setVoice(voiceName) {
    await this.ttsService.setVoice(voiceName);
  }
  async getAppConfig() {
    return await this.settingsManager.getAppConfig();
  }
  async updateAppConfig(config) {
    return await this.settingsManager.updateAppConfig(config);
  }
  async getDevices() {
    return await this.audioService.getDevices();
  }
  async handleVoiceCommand(args) {
    if (args.length === 0) {
      console.log("Usage: /voice --list OR /voice <voice_name>");
      return;
    }
    try {
      if (args[0] === "--list") {
        const voices = await this.listVoices();
        console.log(`Available voices:
${voices.join(", ")}`);
      } else {
        await this.setVoice(args[0]);
      }
    } catch (error) {
      console.error(error.message);
    }
  }
  async handleOutputCommand(args) {
    if (args.length === 0) {
      console.log("Usage: /output --list OR /output <device_ID>");
      return;
    }
    const devices = await this.audioService.getDevices();
    if (args[0] === "--list") {
      console.log("Available output devices:");
      devices.forEach((device, index) => {
        console.log(`[${index}] ${device.name}`);
      });
    } else {
      const index = parseInt(args[0], 10);
      let selectedId = null;
      if (!isNaN(index) && index >= 0 && index < devices.length) {
        selectedId = devices[index].id;
        console.log(`Output device set to: ${devices[index].name}`);
      } else {
        const device = devices.find((d) => d.id === args[0]);
        if (device) {
          selectedId = device.id;
          console.log(`Output device set to: ${device.name}`);
        } else {
          console.log('Device not found. Use "/output --list" to see valid indices or IDs.');
          return;
        }
      }
      await this.settingsManager.updateAppConfig({ playbackDevice: selectedId });
    }
  }
  async handleVolumeCommand(args) {
    if (args.length === 0) {
      console.log("Usage: /volume <0.0-1.0>");
      return;
    }
    const volume = parseFloat(args[0]);
    if (!isNaN(volume) && volume >= 0 && volume <= 2) {
      await this.settingsManager.updateAppConfig({ volume });
      console.log(`Volume set to ${Math.round(volume * 100)}%`);
    } else {
      console.log("Invalid volume level. Please use a number between 0.0 and 1.0.");
    }
  }
  async handleMonitoringCommand(args) {
    if (args.length === 0) {
      console.log("Usage: /monitoring <on|off>");
      return;
    }
    const state = args[0].toLowerCase();
    if (state === "on" || state === "true" || state === "1") {
      await this.settingsManager.updateAppConfig({ monitoring: true });
      console.log("Monitoring enabled.");
    } else if (state === "off" || state === "false" || state === "0") {
      await this.settingsManager.updateAppConfig({ monitoring: false });
      console.log("Monitoring disabled.");
    } else {
      console.log("Usage: /monitoring <on|off>");
    }
  }
  async handleMonitoringOutputCommand(args) {
    if (args.length === 0) {
      console.log("Usage: /monitoring_output <device_ID> or /monitoring_output --list");
      return;
    }
    const devices = await this.audioService.getDevices();
    if (args[0] === "--list") {
      console.log("Available output devices:");
      devices.forEach((device, index2) => {
        console.log(`[${index2}] ${device.name} (ID: ${device.id})`);
      });
      return;
    }
    const index = parseInt(args[0], 10);
    let selectedId = null;
    if (!isNaN(index) && index >= 0 && index < devices.length) {
      selectedId = devices[index].id;
      console.log(`Monitoring output device set to: ${devices[index].name}`);
    } else {
      const device = devices.find((d) => d.id === args[0]);
      if (device) {
        selectedId = device.id;
        console.log(`Monitoring output device set to: ${device.name}`);
      } else {
        console.log('Device not found. Use "/monitoring_output --list" to see valid indices or IDs.');
        return;
      }
    }
    await this.settingsManager.updateAppConfig({ monitoringDevice: selectedId });
  }
  async handleVolumeMonitoringCommand(args) {
    if (args.length === 0) {
      console.log("Usage: /volume_monitoring <0.0-1.0>");
      return;
    }
    const volume = parseFloat(args[0]);
    if (!isNaN(volume) && volume >= 0 && volume <= 2) {
      await this.settingsManager.updateAppConfig({ monitoringVolume: volume });
      console.log(`Monitoring volume set to ${Math.round(volume * 100)}%`);
    } else {
      console.log("Invalid volume level. Please use a number between 0.0 and 1.0.");
    }
  }
  async handleHistoryCommand(args) {
    if (args.length > 0) {
      const subCommand = args[0].toLowerCase();
      if (subCommand === "clear") {
        await this.historyManager.clearHistory();
        return;
      } else if (subCommand === "play" && args.length > 1) {
        const id = parseInt(args[1], 10);
        if (isNaN(id) || id < 0 || id > 19) {
          console.log("Invalid history ID.");
          return;
        }
        await this.historyManager.playHistory(id);
        return;
      } else if (subCommand === "delete" && args.length > 1) {
        const id = parseInt(args[1], 10);
        if (isNaN(id) || id < 0 || id > 19) {
          console.log("Invalid history ID.");
          return;
        }
        await this.historyManager.deleteHistory(id);
        return;
      } else {
        console.log("Usage: /history OR /history clear OR /history play <ID> OR /history delete <ID>");
        return;
      }
    }
    await this.historyManager.printHistory();
  }
  async handleHotkeyCommand(args) {
    if (args.length === 0) {
      console.log("Usage: /hotkey list OR /hotkey play <ID> OR /hotkey assign <hotkey> <text...>");
      return;
    }
    const subCommand = args[0].toLowerCase();
    if (subCommand === "list") {
      this.hotkeyManager.printHotkeys();
    } else if (subCommand === "play" && args.length > 1) {
      const id = parseInt(args[1], 10);
      if (isNaN(id)) {
        console.log("Invalid hotkey ID.");
      } else {
        await this.hotkeyManager.playHotkey(id);
      }
    } else if (subCommand === "delete" && args.length > 1) {
      const id = parseInt(args[1], 10);
      if (isNaN(id)) {
        console.log("Invalid hotkey ID.");
      } else {
        await this.hotkeyManager.deleteHotkey(id);
      }
    } else if (subCommand === "clear") {
      await this.hotkeyManager.clearHotkeys();
    } else if (subCommand === "assign" && args.length > 2) {
      const hotkey = args[1];
      const text = args.slice(2).join(" ");
      await this.hotkeyManager.assignHotkey(hotkey, text);
    } else {
      console.log("Usage: /hotkey list OR /hotkey clear OR /hotkey play <ID> OR /hotkey delete <ID> OR /hotkey assign <hotkey> <text...>");
    }
  }
}
const execPromise = promisify(exec);
class AudioService {
  async getDevices() {
    const platform = os.platform();
    const devices = [{ id: "default", name: "System Default" }];
    if (platform === "linux") {
      try {
        const { stdout } = await execPromise("wpctl status");
        const sinksPart = stdout.split(/Sinks:/)[1]?.split(/├─|└─|Sources:/)[0];
        if (sinksPart) {
          const lines = sinksPart.split("\n");
          for (const line of lines) {
            const match = line.match(/(?:[*\s]*?)(\d+)\.\s+(.*?)(?:\s+\[vol|$)/);
            if (match) {
              devices.push({ id: match[1], name: match[2].trim() });
            }
          }
          if (devices.length > 1) return devices;
        }
      } catch (e) {
      }
      try {
        const { stdout } = await execPromise("aplay -l");
        const lines = stdout.split("\n");
        for (const line of lines) {
          const match = line.match(/^card (\d+):.*?, device (\d+): (.*?) \[/);
          if (match) {
            devices.push({ id: `hw:${match[1]},${match[2]}`, name: match[3].trim() });
          }
        }
      } catch (e) {
      }
    } else if (platform === "win32") {
      try {
        const { stdout } = await execPromise('powershell -NoProfile -Command "Get-PnpDevice -Class Media | Where-Object {$_.Present -eq $true} | Select-Object -Property FriendlyName, InstanceId | ConvertTo-Json"');
        if (stdout) {
          const parsed = JSON.parse(stdout);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of items) {
            if (item && item.FriendlyName && item.InstanceId) {
              devices.push({ id: item.InstanceId, name: item.FriendlyName });
            }
          }
        }
      } catch (e) {
      }
    } else if (platform === "darwin") {
      try {
        const { stdout } = await execPromise("system_profiler SPAudioDataType -json");
        if (stdout) {
          const parsed = JSON.parse(stdout);
          const audioData = parsed.SPAudioDataType || [];
          for (const item of audioData) {
            if (item._items) {
              for (const device of item._items) {
                if (device.coreaudio_device_output) {
                  devices.push({ id: device._name, name: device._name });
                }
              }
            }
          }
        }
      } catch (e) {
      }
    }
    return devices;
  }
  getPlayCommand(filePath, deviceId, volume) {
    const platform = os.platform();
    if (platform === "darwin") {
      if (deviceId && deviceId !== "default") {
        return `AUDIODEV="${deviceId}" ffplay -nodisp -autoexit -volume ${Math.round(volume * 100)} "${filePath}"`;
      }
      return `afplay -v ${volume} "${filePath}"`;
    } else if (platform === "win32") {
      if (deviceId && deviceId !== "default") {
        return `cmd /c "set AUDIODEV=${deviceId} && ffplay -nodisp -autoexit -volume ${Math.round(volume * 100)} \\"${filePath}\\""`;
      }
      return `powershell -c (New-Object Media.SoundPlayer '${filePath}').PlaySync()`;
    } else if (platform === "linux") {
      const volArg = `--volume ${Math.round(volume * 65536)}`;
      if (deviceId && deviceId !== "default") {
        if (deviceId.startsWith("hw:")) {
          return `aplay -D ${deviceId} "${filePath}"`;
        } else {
          return `pw-play --target ${deviceId} --volume ${volume} "${filePath}" || paplay ${volArg} "${filePath}"`;
        }
      } else {
        return `paplay ${volArg} "${filePath}" || aplay "${filePath}"`;
      }
    } else if (platform === "android") {
      return `termux-media-player play "${filePath}" || play-audio "${filePath}"`;
    }
    throw new Error(`Unsupported platform: ${platform}`);
  }
  async play(filePath, playback, deviceId, volume, monitoring = false, monitoringDeviceId = null, monitoringVolume = 1) {
    const tasks = [];
    if (playback) {
      const mainCommand = this.getPlayCommand(filePath, deviceId, volume);
      console.log(`Playing audio (Main): ${mainCommand}`);
      tasks.push(
        execPromise(mainCommand).catch((err) => {
          console.error(`Failed to play audio on device ${deviceId}:`, err.message);
        })
      );
    }
    if (monitoring && monitoringDeviceId) {
      const monCommand = this.getPlayCommand(filePath, monitoringDeviceId, monitoringVolume);
      console.log(`Playing audio (Monitor): ${monCommand}`);
      tasks.push(
        execPromise(monCommand).catch((err) => {
          console.error(`Failed to play audio on monitoring device ${monitoringDeviceId}:`, err.message);
        })
      );
    }
    await Promise.all(tasks);
  }
}
class HotkeyManager {
  constructor(ttsService, audioService, settingsManager) {
    this.ttsService = ttsService;
    this.audioService = audioService;
    this.settingsManager = settingsManager;
    this.hotkeyedDir = path.join(process.cwd(), "src", "audio", "hotkeyed");
    this.jsonPath = path.join(this.hotkeyedDir, "hotkeys.json");
  }
  ttsService;
  audioService;
  settingsManager;
  hotkeyedDir;
  jsonPath;
  entries = [];
  MAX_ENTRIES = 20;
  async init() {
    if (!existsSync(this.hotkeyedDir)) {
      await fs.mkdir(this.hotkeyedDir, { recursive: true });
    }
    if (existsSync(this.jsonPath)) {
      try {
        const data = await fs.readFile(this.jsonPath, "utf-8");
        this.entries = JSON.parse(data);
      } catch (e) {
        this.entries = [];
      }
    }
  }
  async save() {
    await fs.writeFile(this.jsonPath, JSON.stringify(this.entries, null, 2), "utf-8");
  }
  async assignHotkey(hotkey, text) {
    let entryIndex = this.entries.findIndex((e) => e.hotkey === hotkey);
    let id;
    if (entryIndex >= 0) {
      id = this.entries[entryIndex].id;
      this.entries[entryIndex].text = text;
    } else {
      const usedIds = new Set(this.entries.map((e) => e.id));
      id = -1;
      for (let i = 0; i < this.MAX_ENTRIES; i++) {
        if (!usedIds.has(i)) {
          id = i;
          break;
        }
      }
      if (id === -1) {
        const oldest = this.entries.shift();
        if (oldest) id = oldest.id;
        else id = 0;
      }
      this.entries.push({ id, text, hotkey });
    }
    const filePath = path.join(this.hotkeyedDir, `hotkey_${id}.wav`);
    console.log(`Assigning hotkey '${hotkey}' to ID [${id}]...`);
    await this.ttsService.generateToFile(text, filePath);
    await this.save();
    console.log(`Hotkey '${hotkey}' assigned successfully.`);
  }
  async playHotkey(id) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) {
      console.log(`No audio assigned to hotkey ID: ${id}`);
      return;
    }
    const filePath = path.join(this.hotkeyedDir, `hotkey_${entry.id}.wav`);
    if (!existsSync(filePath)) {
      console.log(`Audio file missing for hotkey ID: ${id}`);
      return;
    }
    const appConfig = await this.settingsManager.getAppConfig();
    console.log(`Playing hotkey [${entry.hotkey}]: "${entry.text}"`);
    await this.audioService.play(
      filePath,
      appConfig.playback,
      appConfig.playbackDevice,
      appConfig.volume,
      appConfig.monitoring,
      appConfig.monitoringDevice,
      appConfig.monitoringVolume
    );
  }
  async deleteHotkey(id) {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) {
      console.log(`Hotkey ID [${id}] not found.`);
      return;
    }
    this.entries.splice(index, 1);
    const fileToDelete = path.join(this.hotkeyedDir, `hotkey_${id}.wav`);
    if (existsSync(fileToDelete)) {
      try {
        await fs.unlink(fileToDelete);
      } catch (err) {
        console.error(`Failed to delete file ${fileToDelete}:`, err.message);
      }
    }
    for (const entry of this.entries) {
      if (entry.id > id) {
        const oldId = entry.id;
        const newId = oldId - 1;
        entry.id = newId;
        const oldFile = path.join(this.hotkeyedDir, `hotkey_${oldId}.wav`);
        const newFile = path.join(this.hotkeyedDir, `hotkey_${newId}.wav`);
        if (existsSync(oldFile)) {
          try {
            await fs.rename(oldFile, newFile);
          } catch (err) {
            console.error(`Failed to rename ${oldFile} to ${newFile}:`, err.message);
          }
        }
      }
    }
    await this.save();
    console.log(`Deleted hotkey ID [${id}] and shifted remaining IDs.`);
  }
  async clearHotkeys() {
    this.entries = [];
    await this.save();
    try {
      if (existsSync(this.hotkeyedDir)) {
        const files = await fs.readdir(this.hotkeyedDir);
        for (const file of files) {
          if (file.startsWith("hotkey_") && file.endsWith(".wav")) {
            await fs.unlink(path.join(this.hotkeyedDir, file));
          }
        }
      }
      console.log("All hotkeys cleared.");
    } catch (error) {
      console.error("Failed to clear hotkey files:", error.message);
    }
  }
  listHotkeys() {
    return this.entries;
  }
  printHotkeys() {
    if (this.entries.length === 0) {
      console.log("No hotkeys assigned yet.");
    } else {
      console.log("Assigned Hotkeys:");
      this.entries.forEach((h) => {
        console.log(`  [${h.id}] ${h.hotkey} -> "${h.text}"`);
      });
    }
  }
}
class HistoryManager {
  constructor(audioService, settingsManager) {
    this.audioService = audioService;
    this.settingsManager = settingsManager;
    this.audioDir = path.join(process.cwd(), "src", "audio");
    this.historyPath = path.join(this.audioDir, "history.json");
  }
  audioService;
  settingsManager;
  audioDir;
  historyPath;
  MAX_HISTORY = 20;
  async addEntry(text, tempWavPath) {
    await fs.mkdir(this.audioDir, { recursive: true });
    for (let i = this.MAX_HISTORY - 2; i >= 0; i--) {
      const oldFile = path.join(this.audioDir, `tts_output_${i}.wav`);
      const newFile = path.join(this.audioDir, `tts_output_${i + 1}.wav`);
      try {
        await fs.rename(oldFile, newFile);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error(`Failed to rotate history file ${oldFile}:`, err.message);
        }
      }
    }
    const newFilePath = path.join(this.audioDir, `tts_output_0.wav`);
    await fs.copyFile(tempWavPath, newFilePath);
    let historyTexts = [];
    try {
      if (existsSync(this.historyPath)) {
        const historyData = await fs.readFile(this.historyPath, "utf-8");
        historyTexts = JSON.parse(historyData);
      }
    } catch (e) {
    }
    historyTexts.unshift(text);
    if (historyTexts.length > this.MAX_HISTORY) {
      historyTexts = historyTexts.slice(0, this.MAX_HISTORY);
    }
    await fs.writeFile(this.historyPath, JSON.stringify(historyTexts, null, 2), "utf-8");
  }
  async getHistory() {
    if (!existsSync(this.historyPath)) {
      return [];
    }
    try {
      const data = await fs.readFile(this.historyPath, "utf-8");
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }
  async playHistory(id) {
    const filePath = path.join(this.audioDir, `tts_output_${id}.wav`);
    if (!existsSync(filePath)) {
      console.log(`Audio file for ID [${id}] not found.`);
      return;
    }
    try {
      const appConfig = await this.settingsManager.getAppConfig();
      console.log(`Playing history [${id}]...`);
      await this.audioService.play(
        filePath,
        appConfig.playback,
        appConfig.playbackDevice,
        appConfig.volume,
        appConfig.monitoring,
        appConfig.monitoringDevice,
        appConfig.monitoringVolume
      );
    } catch (error) {
      console.error("Failed to play history audio:", error.message);
    }
  }
  async deleteHistory(id) {
    let historyTexts = await this.getHistory();
    if (id >= historyTexts.length || id < 0) {
      console.log(`History ID [${id}] not found.`);
      return;
    }
    historyTexts.splice(id, 1);
    await fs.writeFile(this.historyPath, JSON.stringify(historyTexts, null, 2), "utf-8");
    const fileToDelete = path.join(this.audioDir, `tts_output_${id}.wav`);
    if (existsSync(fileToDelete)) {
      await fs.unlink(fileToDelete);
    }
    for (let i = id + 1; i < this.MAX_HISTORY; i++) {
      const oldFile = path.join(this.audioDir, `tts_output_${i}.wav`);
      const newFile = path.join(this.audioDir, `tts_output_${i - 1}.wav`);
      if (existsSync(oldFile)) {
        await fs.rename(oldFile, newFile);
      }
    }
    console.log(`Deleted history [${id}] and shifted remaining IDs.`);
  }
  async clearHistory() {
    if (!existsSync(this.audioDir)) {
      console.log("No history to clear.");
      return;
    }
    try {
      const files = await fs.readdir(this.audioDir);
      for (const file of files) {
        if (file.startsWith("tts_output_") && file.endsWith(".wav") || file === "history.json") {
          await fs.unlink(path.join(this.audioDir, file));
        }
      }
      console.log("History cleared.");
    } catch (error) {
      console.error("Failed to clear history:", error.message);
    }
  }
  async printHistory() {
    const historyTexts = await this.getHistory();
    if (historyTexts.length === 0) {
      console.log("No history available yet.");
      return;
    }
    console.log("Recent TTS Audio History (Newest to Oldest):");
    historyTexts.forEach((text, index) => {
      let displayText = text.replace(/\\n/g, " ").trim();
      if (displayText.length > 50) {
        displayText = displayText.substring(0, 50) + "...";
      }
      console.log(`[${index}] ${displayText}`);
    });
  }
}
app.disableHardwareAcceleration();
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
let mainWindow = null;
let settingsWindow = null;
let appController;
let tray = null;
let isQuitting = false;
const electronSettingsPath = path.join(app.getPath("userData"), "electron-settings.json");
async function loadElectronSettings() {
  if (existsSync(electronSettingsPath)) {
    try {
      const data = await fs.readFile(electronSettingsPath, "utf-8");
      return JSON.parse(data);
    } catch (e) {
      console.error("Failed to load electron settings:", e);
    }
  }
  return {};
}
async function saveElectronSettings(settings) {
  try {
    const current = await loadElectronSettings();
    const updated = { ...current, ...settings };
    await fs.writeFile(electronSettingsPath, JSON.stringify(updated, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save electron settings:", e);
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
    const foundDisplay = displays.find((d) => d.id === settings.lastDisplayId);
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
    x,
    y,
    frame: false,
    transparent: true,
    autoHideMenuBar: true,
    resizable: false,
    maximizable: false,
    show: false,
    // Create hidden
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname$1, "assets/icon.jpg")
  });
  mainWindow.setMenu(null);
  if (process.env["ELECTRON_RENDERER_URL"]) {
    await mainWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/index.html`);
  } else {
    await mainWindow.loadFile(path.join(__dirname$1, "../renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.setPosition(x, y);
      mainWindow.show();
    }
  });
  mainWindow.on("hide", () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.hide();
    }
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      if (mainWindow) {
        mainWindow.hide();
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          settingsWindow.hide();
        }
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
  mainWindow.webContents.openDevTools({ mode: "detach" });
}
function createTray() {
  const iconPath = path.join(__dirname$1, "../../src/ui/assets/icon.png");
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: "Show", click: () => {
      mainWindow?.show();
    } },
    { label: "Exit Moon-TTS", click: () => {
      isQuitting = true;
      app.quit();
    } }
  ]);
  tray.setToolTip("Moon-TTS");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    mainWindow?.show();
  });
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
    show: false,
    // Hidden by default
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWindow.setMenu(null);
  if (process.env["ELECTRON_RENDERER_URL"]) {
    await settingsWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/settings.html`);
  } else {
    await settingsWindow.loadFile(path.join(__dirname$1, "../renderer/settings.html"));
  }
  settingsWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      if (settingsWindow) {
        settingsWindow.hide();
      }
    }
  });
}
app.whenReady().then(async () => {
  await bootstrapBackend();
  ipcMain.handle("submit-text", async (event, text) => {
    if (appController) {
      await appController.processInput(text);
    }
  });
  ipcMain.handle("get-models", () => {
    return appController ? appController.listModels() : [];
  });
  ipcMain.handle("get-active-model", () => {
    return appController ? appController.getActiveModel() : null;
  });
  ipcMain.handle("set-model", (event, model) => {
    if (appController) {
      appController.setModel(model);
    }
  });
  ipcMain.handle("get-voices", async () => {
    return appController ? await appController.listVoices() : [];
  });
  ipcMain.handle("get-active-voice", async () => {
    return appController ? await appController.getActiveVoice() : null;
  });
  ipcMain.handle("set-voice", async (event, voice) => {
    if (appController) {
      await appController.setVoice(voice);
    }
  });
  ipcMain.handle("get-app-config", async () => {
    return appController ? await appController.getAppConfig() : null;
  });
  ipcMain.handle("update-app-config", async (event, config) => {
    if (appController) {
      await appController.updateAppConfig(config);
    }
  });
  ipcMain.handle("get-devices", async () => {
    return appController ? await appController.getDevices() : [];
  });
  ipcMain.on("close-app", () => {
    if (mainWindow) {
      mainWindow.close();
    }
  });
  ipcMain.on("open-settings", (event, buttonBounds) => {
    if (!settingsWindow || !mainWindow) return;
    if (settingsWindow.isVisible()) {
      settingsWindow.hide();
      return;
    }
    const mainBounds = mainWindow.getBounds();
    const settingsHeight = 500;
    const x = mainBounds.x + Math.floor(buttonBounds.x);
    const y = mainBounds.y + Math.floor(buttonBounds.y) - settingsHeight - 16;
    settingsWindow.setPosition(x, y);
    settingsWindow.show();
  });
  ipcMain.on("close-settings", () => {
    if (settingsWindow) {
      settingsWindow.hide();
    }
  });
  await createWindow();
  await createSettingsWindow();
  createTray();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createSettingsWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
