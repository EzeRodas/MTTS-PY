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
        };
    }
}

const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement;
const modelSelector = document.getElementById('modelSelector') as HTMLSelectElement;
const voiceSelector = document.getElementById('voiceSelector') as HTMLSelectElement;

if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        window.api.closeSettings();
    });
}

async function loadSettings() {
    if (modelSelector) {
        const models = await window.api.getModels();
        const activeModel = await window.api.getActiveModel();
        
        modelSelector.innerHTML = '';
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === activeModel) {
                option.selected = true;
            }
            modelSelector.appendChild(option);
        });

        modelSelector.addEventListener('change', async () => {
            await window.api.setModel(modelSelector.value);
            // In the future, changing model might change available voices
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
            if (voice === activeVoice) {
                option.selected = true;
            }
            voiceSelector.appendChild(option);
        });

        voiceSelector.addEventListener('change', async () => {
            await window.api.setVoice(voiceSelector.value);
        });
    }
}

loadSettings();