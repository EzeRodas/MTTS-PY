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
        };
    }
}

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

async function loadSettings() {
    // 1. Models and Voices
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

    // 2. App Config (Output & Monitoring)
    const config = await window.api.getAppConfig();
    const devices = await window.api.getDevices();

    // Populate output devices
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

    // Output Checkbox
    if (outputCheckbox) {
        outputCheckbox.checked = config.playback;
        outputCheckbox.addEventListener('change', async () => {
            await window.api.updateAppConfig({ playback: outputCheckbox.checked });
        });
    }

    // Output Slider
    if (outputSlider) {
        outputSlider.value = String(config.volume * 100);
        outputSlider.addEventListener('input', async () => {
            const vol = parseInt(outputSlider.value, 10) / 100;
            await window.api.updateAppConfig({ volume: vol });
        });
    }

    // Populate monitoring devices
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

    // Monitoring Checkbox
    if (monitoringCheckbox) {
        monitoringCheckbox.checked = config.monitoring;
        monitoringCheckbox.addEventListener('change', async () => {
            await window.api.updateAppConfig({ monitoring: monitoringCheckbox.checked });
        });
    }

    // Monitoring Slider
    if (monitoringSlider) {
        monitoringSlider.value = String(config.monitoringVolume * 100);
        monitoringSlider.addEventListener('input', async () => {
            const vol = parseInt(monitoringSlider.value, 10) / 100;
            await window.api.updateAppConfig({ monitoringVolume: vol });
        });
    }
}

loadSettings();