declare global {
    interface Window {
        api: {
            submitText: (text: string) => Promise<void>;
            closeApp: () => void;
        };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
    const textArea = document.getElementById('textArea') as HTMLTextAreaElement;
    const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement;

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

    submitBtn.addEventListener('click', submitAction);

    textArea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitAction();
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.api.closeApp();
        });
    }
});