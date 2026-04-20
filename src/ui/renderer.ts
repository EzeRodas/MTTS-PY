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

const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const textArea = document.getElementById('textArea') as HTMLInputElement;
const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;

let isProcessing = false;

const submitAction = async () => {
    if (isProcessing) return;

    const text = textArea.value.trim();
    if (text) {
        isProcessing = true;
        submitBtn.disabled = true;
        textArea.value = ''; // Delete text immediately
        
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

if (submitBtn) {
    submitBtn.addEventListener('click', submitAction);
}

if (textArea) {
    textArea.addEventListener('keydown', (event) => {
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
        const rect = settingsBtn.getBoundingClientRect();
        window.api.openSettings({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
        });
    });
}