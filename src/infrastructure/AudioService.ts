import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';

const execPromise = promisify(exec);

export interface AudioDevice {
    id: string;
    name: string;
}

export class AudioService {
    public async getDevices(): Promise<AudioDevice[]> {
        const platform = os.platform();
        const devices: AudioDevice[] = [{ id: 'default', name: 'System Default' }];

        if (platform === 'linux') {
            try {
                const { stdout } = await execPromise('wpctl status');
                const sinksPart = stdout.split(/Sinks:/)[1]?.split(/├─|└─|Sources:/)[0];
                
                if (sinksPart) {
                    const lines = sinksPart.split('\n');
                    for (const line of lines) {
                        const match = line.match(/(?:[*\s]*?)(\d+)\.\s+(.*?)(?:\s+\[vol|$)/);
                        if (match) {
                            devices.push({ id: match[1], name: match[2].trim() });
                        }
                    }
                    if (devices.length > 1) return devices;
                }
            } catch (e) {}
            
            try {
                 const { stdout } = await execPromise('aplay -l');
                 const lines = stdout.split('\n');
                 for (const line of lines) {
                     const match = line.match(/^card (\d+):.*?, device (\d+): (.*?) \[/);
                     if (match) {
                         devices.push({ id: `hw:${match[1]},${match[2]}`, name: match[3].trim() });
                     }
                 }
            } catch (e) {}
        } else if (platform === 'win32') {
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
            } catch (e) {}
        } else if (platform === 'darwin') {
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
            } catch (e) {}
        }
        
        return devices;
    }

    private getPlayCommand(filePath: string, deviceId: string | null, volume: number): string {
        const platform = os.platform();
        if (platform === 'darwin') {
            if (deviceId && deviceId !== 'default') {
                // Using ffplay for targeted device playback via SDL AUDIODEV environment variable
                return `AUDIODEV="${deviceId}" ffplay -nodisp -autoexit -volume ${Math.round(volume * 100)} "${filePath}"`;
            }
            return `afplay -v ${volume} "${filePath}"`;
        } else if (platform === 'win32') {
            if (deviceId && deviceId !== 'default') {
                // Using ffplay on Windows for targeted device playback
                return `cmd /c "set AUDIODEV=${deviceId} && ffplay -nodisp -autoexit -volume ${Math.round(volume * 100)} \\"${filePath}\\""`;
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
        } else if (platform === 'android') {
            // Android via Termux or similar CLI environments
            return `termux-media-player play "${filePath}" || play-audio "${filePath}"`;
        }
        throw new Error(`Unsupported platform: ${platform}`);
    }

    public async play(filePath: string, playback: boolean, deviceId: string | null, volume: number, monitoring: boolean = false, monitoringDeviceId: string | null = null, monitoringVolume: number = 1.0): Promise<void> {
        const tasks: Promise<any>[] = [];

        if (playback) {
            const mainCommand = this.getPlayCommand(filePath, deviceId, volume);
            console.log(`Playing audio (Main): ${mainCommand}`);
            
            tasks.push(
                execPromise(mainCommand).catch(err => {
                    console.error(`Failed to play audio on device ${deviceId}:`, err.message);
                })
            );
        }

        if (monitoring && monitoringDeviceId) {
            const monCommand = this.getPlayCommand(filePath, monitoringDeviceId, monitoringVolume);
            console.log(`Playing audio (Monitor): ${monCommand}`);
            tasks.push(
                execPromise(monCommand).catch(err => {
                    console.error(`Failed to play audio on monitoring device ${monitoringDeviceId}:`, err.message);
                })
            );
        }

        await Promise.all(tasks);
    }
}
