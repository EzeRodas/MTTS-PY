// Handles submitting text to be synthesized
let isProcessing = false;
const submitBtn = document.getElementById('submitBtn');
const textArea = document.getElementById('textArea');

async function submitAction() {
    if (isProcessing || !api) return;
    const text = textArea.value.trim();
    if (!text) return;

    api.getActiveModel(function(activeModel) {
        if (!activeModel) {
            textArea.value = "No TTS engine selected";
            textArea.disabled = true;
            setTimeout(() => {
                textArea.value = "";
                textArea.disabled = false;
                textArea.focus();
            }, 2000);
            return;
        }

        isProcessing = true;
        submitBtn.disabled = true;
        textArea.value = '';

        api.getAppConfig(function(configJson) {
            let hide = false;
            try {
                const config = JSON.parse(configJson);
                hide = (config.hideOnEnter === true);
            } catch (err) {
                console.error('Config parsing error:', err);
            }

            if (hide) {
                api.closeApp();
            }

            // Delay blocking synthesis slightly to let Qt hide window instantly
            setTimeout(() => {
                try {
                    api.submitText(text);
                } catch(e) {
                    console.error('Submit failed:', e);
                } finally {
                    isProcessing = false;
                    submitBtn.disabled = false;
                    textArea.focus();
                }
            }, hide ? 50 : 0);
        });
    });
}

submitBtn.addEventListener('click', submitAction);
textArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitAction();
    }
});
