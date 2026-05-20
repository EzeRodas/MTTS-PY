declare global {
    interface Window {
        api: {
            submitText: (text: string) => Promise<void>;
            closeApp: () => void;
            openSettings: (bounds: { x: number, y: number, width: number, height: number }) => void;
            closeSettings: () => void;
            getModels: () => Promise<string[]>;
            getActiveModel: () => Promise<string>;
            setModel: (model: string) => Promise<void>;
            getVoices: () => Promise<string[]>;
            getActiveVoice: () => Promise<string>;
            setVoice: (voice: string) => Promise<void>;
            getAppConfig: () => Promise<any>;
            updateAppConfig: (config: any) => Promise<void>;
            getDevices: () => Promise<any[]>;
            onPlayAudio: (callback: (data: any) => void) => void;
        };
    }
}

// UI Elements caching
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const textArea = document.getElementById('textArea') as HTMLInputElement;
const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;

/** Lock to prevent double submission processing */
let isProcessing = false;

/**
 * Initiates the Text-To-Speech request on active inputs.
 * Locks the submit button, clears text box instantly, and waits for Main synthesis.
 */
const submitAction = async () => {
    if (isProcessing) return;

    const text = textArea.value.trim();
    if (text) {
        isProcessing = true;
        submitBtn.disabled = true;
        textArea.value = ''; // Delete text immediately for instant responsive feedback
        
        try {
            await window.api.submitText(text);
        } catch (error) {
            console.error('Failed to submit text:', error);
        } finally {
            isProcessing = false;
            submitBtn.disabled = false;
            textArea.focus();
        }
    }
};

// ============================================================================
// UI EVENT LISTENERS
// ============================================================================

if (submitBtn) {
    submitBtn.addEventListener('click', submitAction);
}

if (textArea) {
    textArea.addEventListener('keydown', (event) => {
        // Submit on Enter key without shift modifier (for multiline inputs)
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitAction();
        }
    });
}

if (closeBtn) {
    closeBtn.addEventListener('click', () => {
        window.api.closeApp();
    });
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        // Measure element boundaries to position the popup window exactly on top
        const rect = settingsBtn.getBoundingClientRect();
        window.api.openSettings({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
        });
    });
}

// ============================================================================
// WEBAUDIO / PLAYBACK RECEIVER
// ============================================================================

if (window.api.onPlayAudio) {
    // Receive raw binary buffer generated in the backend, package it as blob
    // and play via HTML5 Audio with precise target speaker routing.
    window.api.onPlayAudio((data) => {
        console.log('Renderer: Received play-audio IPC event');
        
        if (!data.audioBuffer) {
            console.error('Renderer: No audio buffer received in data');
            return;
        }

        console.log(`Renderer: Received audio buffer of ${data.audioBuffer.length} bytes`);

        // Create a blob from the received buffer (Uint8Array)
        const blob = new Blob([data.audioBuffer], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        console.log('Renderer: Created ObjectURL:', audioUrl);

        /**
         * Local function to execute audio playback using HTML5 Audio element
         * and routes output to selected device ID using setSinkId.
         */
        const playAudio = async (url: string, deviceId: string | null, volume: number, label: string) => {
            console.log(`Renderer: Attempting to play ${label} audio. Device: ${deviceId}, Vol: ${volume}`);
            const audio = new Audio(url);
            audio.volume = volume;
            
            // Route to specific sound card hardware if supported by browser/Electron
            if (deviceId && deviceId !== 'default' && (audio as any).setSinkId) {
                try {
                    console.log(`Renderer: Setting sink ID to ${deviceId} for ${label}`);
                    await (audio as any).setSinkId(deviceId);
                } catch (err) {
                    console.error(`Renderer: Failed to set sink ID for ${label}:`, err);
                }
            }
            
            try {
                await audio.play();
                console.log(`Renderer: ${label} audio playback started successfully`);
                audio.onended = () => {
                    console.log(`Renderer: ${label} audio playback ended`);
                    URL.revokeObjectURL(url); // Prevent memory leak by destroying references
                };
            } catch (err) {
                console.error(`Renderer: ${label} playback error:`, err);
                URL.revokeObjectURL(url);
            }
        };

        // 1. Play main output stream
        if (data.playback) {
            playAudio(audioUrl, data.deviceId, data.volume, 'Main');
        }
        
        // 2. Play secondary monitoring stream concurrently if configured
        if (data.monitoring) {
            // Re-create object URL for monitoring to avoid issues with simultaneous playback on the same URL
            const monUrl = URL.createObjectURL(blob);
            playAudio(monUrl, data.monitoringDeviceId, data.monitoringVolume, 'Monitor');
        }
    });
}
