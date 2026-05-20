import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';

const execPromise = promisify(exec);

/**
 * Platform-independent descriptor for a system audio hardware device.
 */
export interface AudioDevice {
    /** OS-specific identifier of the device (device ID or hardware address name) */
    id: string;
    
    /** Human-readable friendly name of the hardware output (e.g. Speakers) */
    name: string;
}

/**
 * Data payload for playback actions, containing volume level and dual target device IDs.
 */
export interface PlaybackData {
    /** Absolute path to the WAV file to be played */
    filePath: string;
    
    /** Whether primary audio output is enabled */
    playback: boolean;
    
    /** Target ID for primary audio playback. Null targets system default. */
    deviceId: string | null;
    
    /** Primary volume scalar (0.0 to 1.0) */
    volume: number;
    
    /** Whether dual monitoring mode is enabled */
    monitoring: boolean;
    
    /** Target ID for secondary monitoring output. Null targets system default. */
    monitoringDeviceId: string | null;
    
    /** Monitoring volume scalar (0.0 to 1.0) */
    monitoringVolume: number;
}

/**
 * Service managing cross-platform audio device listing and speech file playback.
 * 
 * DESIGN PATTERN: Hybrid Output Delegation
 * When running in CLI mode, plays audio directly using system binaries (aplay/pw-play/afplay/powershell).
 * When running in Electron UI mode, the UI layer overrides this by calling `setPlaybackHandler`.
 * This reroutes playback to the Electron renderer (passing audio buffers via IPC), allowing
 * precise HTML Audio + `setSinkId` device targeting, which is more reliable than CLI subprocessing.
 */
export class AudioService {
    /** Rerouted playback interceptor, typically registered by the Electron Main Process */
    private playbackHandler: ((data: PlaybackData) => Promise<void>) | null = null;

    /**
     * Registers a callback to override CLI playback.
     * Used by Electron Main to forward raw audio buffers to the Renderer.
     * @param handler Playback delegation handler.
     */
    public setPlaybackHandler(handler: (data: PlaybackData) => Promise<void>): void {
        this.playbackHandler = handler;
    }

    /**
     * Enumerates available output audio devices on the host operating system.
     * Parses platform specific CLI tools outputs (Pipewire wpctl status / ALSA aplay on Linux,
     * PowerShell PnpDevices on Windows, system_profiler on macOS).
     * @returns List of AudioDevice structures.
     */
    public async getDevices(): Promise<AudioDevice[]> {
        const platform = os.platform();
        const devices: AudioDevice[] = [{ id: 'default', name: 'System Default' }];

        if (platform === 'linux') {
            // Priority 1: Query PipeWire status using WirePlumber controller
            try {
                const { stdout } = await execPromise('wpctl status');
                const sinksPart = stdout.split(/Sinks:/)[1]?.split(/├─|└─|Sources:/)[0];
                
                if (sinksPart) {
                    const lines = sinksPart.split('\n');
                    for (const line of lines) {
                        // Regex matches index numbers followed by names: e.g. "  53. Built-in Audio Analog Stereo [vol: 0.50]"
                        const match = line.match(/(?:[*\s]*?)(\d+)\.\s+(.*?)(?:\s+\[vol|$)/);
                        if (match) {
                            devices.push({ id: match[1], name: match[2].trim() });
                        }
                    }
                    if (devices.length > 1) return devices;
                }
            } catch (e) {
                // PipeWire check failed, fallback to ALSA
            }
            
            // Priority 2: Fallback to listing raw ALSA playback cards
            try {
                 const { stdout } = await execPromise('aplay -l');
                 const lines = stdout.split('\n');
                 for (const line of lines) {
                     const match = line.match(/^card (\d+):.*?, device (\d+): (.*?) \[/);
                     if (match) {
                         devices.push({ id: `hw:${match[1]},${match[2]}`, name: match[3].trim() });
                     }
                 }
            } catch (e) {
                // ALSA query failed, return standard fallback
            }
        } else if (platform === 'win32') {
            // Windows: Retrieve plug-and-play audio output endpoints using PowerShell
            try {
                const { stdout } = await execPromise('powershell -NoProfile -Command "Get-PnpDevice -Class AudioEndpoint | Where-Object { $_.DeviceID -like \'*0.0.0.00000000*\' } | Select-Object -Property FriendlyName | ConvertTo-Json"');
                if (stdout) {
                    const parsed = JSON.parse(stdout);
                    const items = Array.isArray(parsed) ? parsed : [parsed];
                    const nameCounts = new Map<string, number>();
                    for (const item of items) {
                        if (item && item.FriendlyName) {
                            let name = item.FriendlyName;
                            const count = nameCounts.get(name) || 0;
                            nameCounts.set(name, count + 1);
                            if (count > 0) name = `${name} (${count + 1})`;
                            devices.push({ id: name, name: name });
                        }
                    }
                }
            } catch (e) {
                // PnpDevice call failed
            }
        } else if (platform === 'darwin') {
            // macOS: Query CoreAudio outputs using system_profiler
            try {
                const { stdout } = await execPromise('system_profiler SPAudioDataType -json');
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
                // system_profiler call failed
            }
        }
        
        return devices;
    }

    /**
     * Generates a platform-specific command line utility string to execute audio file playback.
     * Used exclusively in pure CLI mode when no renderer handler is registered.
     */
    private getPlayCommand(filePath: string, deviceId: string | null, volume: number): string {
        const platform = os.platform();
        if (platform === 'darwin') {
            if (deviceId && deviceId !== 'default') {
                return `SDL_AUDIO_DEVICE_NAME="${deviceId}" ffplay -nodisp -autoexit -volume ${Math.round(volume * 100)} "${filePath}"`;
            }
            return `afplay -v ${volume} "${filePath}"`;
        } else if (platform === 'win32') {
            if (deviceId && deviceId !== 'default') {
                return `set "SDL_AUDIO_DEVICE_NAME=${deviceId}" && ffplay -nodisp -autoexit -volume ${Math.round(volume * 100)} "${filePath}"`;
            }
            return `powershell -c (New-Object Media.SoundPlayer '${filePath}').PlaySync()`;
        } else if (platform === 'linux') {
            const volArg = `--volume ${Math.round(volume * 65536)}`;
            if (deviceId && deviceId !== 'default') {
                if (deviceId.startsWith('hw:')) {
                    return `aplay -D ${deviceId} "${filePath}"`;
                } else {
                    return `pw-play --target ${deviceId} --volume ${volume} "${filePath}" || paplay ${volArg} "${filePath}"`;
                }
            } else {
                return `paplay ${volArg} "${filePath}" || aplay "${filePath}"`;
            }
        }
        throw new Error(`Unsupported platform: ${platform}`);
    }

    /**
     * Plays a voice WAV file. Reroutes to Electron Renderer if the handler is active,
     * or invokes native OS shell utilities if running in headless CLI mode.
     * Supports simultaneous monitoring output routing.
     */
    public async play(
        filePath: string,
        playback: boolean,
        deviceId: string | null,
        volume: number,
        monitoring: boolean = false,
        monitoringDeviceId: string | null = null,
        monitoringVolume: number = 1.0
    ): Promise<void> {
        console.log(`AudioService: play requested for ${filePath}. Playback: ${playback}, Monitor: ${monitoring}, Handler set: ${!!this.playbackHandler}`);
        
        // If Electron Main has registered an audio playback handler, route through UI renderer
        if (this.playbackHandler) {
            await this.playbackHandler({
                filePath,
                playback,
                deviceId,
                volume,
                monitoring,
                monitoringDeviceId,
                monitoringVolume
            });
            return;
        }

        // Headless CLI execution mode: Spawn system audio binary processes
        const tasks: Promise<any>[] = [];
        if (playback) {
            const cmd = this.getPlayCommand(filePath, deviceId, volume);
            tasks.push(execPromise(cmd).catch(err => console.error(`Playback failed: ${err.message}`)));
        }
        if (monitoring && monitoringDeviceId) {
            const cmd = this.getPlayCommand(filePath, monitoringDeviceId, monitoringVolume);
            tasks.push(execPromise(cmd).catch(err => console.error(`Monitoring failed: ${err.message}`)));
        }
        await Promise.all(tasks);
    }
}

