// Handles submitting text to be synthesized
let isProcessing = false;
const submitBtn = document.getElementById('submitBtn');
if (submitBtn) {
    submitBtn.dataset.state = 'send';
}
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
        submitBtn.dataset.state = 'send';
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

if (submitBtn) {
    submitBtn.addEventListener('click', () => {
        if (submitBtn.dataset.state === 'pause') {
            if (api) api.pause();
        } else if (submitBtn.dataset.state === 'play') {
            if (api) api.resume();
        } else {
            submitAction();
        }
    });
}

textArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (submitBtn.dataset.state !== 'pause' && submitBtn.dataset.state !== 'play') {
            submitAction();
        }
    }
});

const stopBtn = document.getElementById('stopBtn');
if (stopBtn) {
    stopBtn.addEventListener('click', () => {
        if (api) {
            api.stop();
        }
    });
}

function updatePlaybackUI(busy, paused) {
    const stopBtn = document.getElementById('stopBtn');
    const submitBtn = document.getElementById('submitBtn');
    if (!stopBtn || !submitBtn) return;

    if (busy) {
        stopBtn.removeAttribute('disabled');
        stopBtn.classList.add('active');

        if (paused) {
            if (submitBtn.dataset.state !== 'play') {
                submitBtn.dataset.state = 'play';
                submitBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="32" height="32" style="pointer-events: none;">
                        <path d="M8 5v14l11-7z" fill="currentColor"></path>
                    </svg>
                `;
                submitBtn.removeAttribute('disabled');
            }
        } else {
            if (submitBtn.dataset.state !== 'pause') {
                submitBtn.dataset.state = 'pause';
                submitBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="32" height="32" style="pointer-events: none;">
                        <rect x="6" y="5" width="4" height="14" fill="currentColor"></rect>
                        <rect x="14" y="5" width="4" height="14" fill="currentColor"></rect>
                    </svg>
                `;
                submitBtn.removeAttribute('disabled');
            }
        }
    } else {
        stopBtn.setAttribute('disabled', 'true');
        stopBtn.classList.remove('active');

        if (submitBtn.dataset.state !== 'send') {
            submitBtn.dataset.state = 'send';
            submitBtn.innerHTML = `<img src="assets/rocket.svg" draggable="false" alt="send">`;
            if (api && api.isEngineAvailable) {
                api.isEngineAvailable(function(available) {
                    if (available) {
                        submitBtn.removeAttribute('disabled');
                    } else {
                        submitBtn.setAttribute('disabled', 'true');
                    }
                });
            } else {
                submitBtn.removeAttribute('disabled');
            }
        }
    }
}

window.addEventListener('bridgeReady', () => {
    if (api) {
        if (api.playback_state_changed) {
            api.playback_state_changed.connect((busy, paused) => {
                updatePlaybackUI(busy, paused);
            });
        }
        api.isBusy(function(busy) {
            if (api.isPaused) {
                api.isPaused(function(paused) {
                    updatePlaybackUI(busy, paused);
                });
            } else {
                updatePlaybackUI(busy, false);
            }
        });
    }
});



