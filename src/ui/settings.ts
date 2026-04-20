declare global {
    interface Window {
        api: {
            submitText: (text: string) => Promise<void>;
            closeApp: () => void;
            openSettings: (bounds: { x: number, y: number, width: number, height: number }) => void;
            closeSettings: () => void;
        };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement;

    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            window.api.closeSettings();
        });
    }
});