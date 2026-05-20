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

// Elements Cache
const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement;
const modelSelector = document.getElementById('modelSelector') as HTMLSelectElement;
const voiceSelector = document.getElementById('voiceSelector') as HTMLSelectElement;

const outputCheckbox = document.getElementById('outputCheckbox') as HTMLInputElement;
const outputSelector = document.getElementById('outputSelector') as HTMLSelectElement;
const outputSlider = document.getElementById('outputSlider') as HTMLInputElement;

const monitoringCheckbox = document.getElementById('monitoringCheckbox') as HTMLInputElement;
const monitoringSelector = document.getElementById('monitoringSelector') as HTMLSelectElement;
const monitoringSlider = document.getElementById('monitoringSlider') as HTMLInputElement;

if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        window.api.closeSettings();
    });
}

/**
 * Loads models, voices, audio devices, and active configurations from IPC channels,
 * and configures UI elements with current settings.
 */
async function loadSettings() {
    // ============================================================================
    // 1. MODELS AND VOICES POPULATION
    // ============================================================================
    if (modelSelector) {
        const models = await window.api.getModels();
        const activeModel = await window.api.getActiveModel();
        
        modelSelector.innerHTML = '';
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === activeModel) option.selected = true;
            modelSelector.appendChild(option);
        });

        modelSelector.addEventListener('change', async () => {
            await window.api.setModel(modelSelector.value);
        });
    }

    if (voiceSelector) {
        const voices = await window.api.getVoices();
        const activeVoice = await window.api.getActiveVoice();
        
        voiceSelector.innerHTML = '';
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice;
            option.textContent = voice;
            if (voice === activeVoice) option.selected = true;
            voiceSelector.appendChild(option);
        });

        voiceSelector.addEventListener('change', async () => {
            await window.api.setVoice(voiceSelector.value);
        });
    }

    // ============================================================================
    // 2. AUDIO DEVICELIST & SETTINGS POPULATION
    // ============================================================================
    const config = await window.api.getAppConfig();
    
    let devices: any[] = [];
    try {
        // HACK: WebRTC APIs require initial permissions trigger to return full device labels 
        // instead of empty arrays or anonymous placeholders. Calling getUserMedia temporarily
        // grants browser-level permissions to inspect hardware labels.
        try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {}
        
        const mediaDevices = await navigator.mediaDevices.enumerateDevices();
        devices = mediaDevices
            .filter(d => d.kind === 'audiooutput')
            .map(d => ({ id: d.deviceId || 'default', name: d.label || 'System Default' }));
            
        if (devices.length === 0) devices = [{ id: 'default', name: 'System Default' }];
    } catch (e) {
        devices = [{ id: 'default', name: 'System Default' }];
    }

    // Configure main speaker selector dropdown
    if (outputSelector) {
        outputSelector.innerHTML = '';
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = device.name;
            if (config.playbackDevice === device.id) option.selected = true;
            outputSelector.appendChild(option);
        });

        outputSelector.addEventListener('change', async () => {
            await window.api.updateAppConfig({ playbackDevice: outputSelector.value });
        });
    }

    // Configure main output checkbox toggle
    if (outputCheckbox) {
        outputCheckbox.checked = config.playback;
        outputCheckbox.addEventListener('change', async () => {
            await window.api.updateAppConfig({ playback: outputCheckbox.checked });
        });
    }

    // Configure main volume slider
    if (outputSlider) {
        outputSlider.value = String(config.volume * 100);
        outputSlider.addEventListener('input', async () => {
            const vol = parseInt(outputSlider.value, 10) / 100;
            await window.api.updateAppConfig({ volume: vol });
        });
    }

    // Configure secondary monitor selector dropdown
    if (monitoringSelector) {
        monitoringSelector.innerHTML = '';
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = device.name;
            if (config.monitoringDevice === device.id) option.selected = true;
            monitoringSelector.appendChild(option);
        });

        monitoringSelector.addEventListener('change', async () => {
            await window.api.updateAppConfig({ monitoringDevice: monitoringSelector.value });
        });
    }

    // Configure secondary monitor checkbox toggle
    if (monitoringCheckbox) {
        monitoringCheckbox.checked = config.monitoring;
        monitoringCheckbox.addEventListener('change', async () => {
            await window.api.updateAppConfig({ monitoring: monitoringCheckbox.checked });
        });
    }

    // Configure secondary monitor volume slider
    if (monitoringSlider) {
        monitoringSlider.value = String(config.monitoringVolume * 100);
        monitoringSlider.addEventListener('input', async () => {
            const vol = parseInt(monitoringSlider.value, 10) / 100;
            await window.api.updateAppConfig({ monitoringVolume: vol });
        });
    }
}

// Trigger load sequence
loadSettings();