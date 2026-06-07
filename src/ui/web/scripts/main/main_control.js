// General main window controls (Close app, open settings)
const closeBtn = document.getElementById('closeBtn');
const settingsBtn = document.getElementById('settingsBtn');

closeBtn.addEventListener('click', () => {
    if (api) api.closeApp();
});

settingsBtn.addEventListener('click', () => {
    if (api) {
        const rect = settingsBtn.getBoundingClientRect();
        api.openSettings(JSON.stringify({x: rect.x, y: rect.y, width: rect.width, height: rect.height}));
    }
});

const aboutBtn = document.getElementById('About');
if (aboutBtn) {
    aboutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (api) api.openUrl(aboutBtn.href);
    });
}

function enableUI() {
    const settingsBtn = document.getElementById('settingsBtn');
    const submitBtn = document.getElementById('submitBtn');
    const textArea = document.getElementById('textArea');
    const dragArea = document.getElementById('dragArea');

    if (settingsBtn) settingsBtn.removeAttribute('disabled');
    if (dragArea) dragArea.classList.remove('disabled');
}

function initializeMainControl(api) {
    if (!api) return;

    // Check engine availability periodically
    function checkEngineStatus() {
        if (api.isEngineAvailable) {
            api.isEngineAvailable(function(available) {
                const textArea = document.getElementById('textArea');
                const submitBtn = document.getElementById('submitBtn');
                
                if (!available) {
                    if (textArea) {
                        textArea.placeholder = "No TTS engine detected (Check Settings)";
                        textArea.disabled = true;
                    }
                    if (submitBtn) submitBtn.disabled = true;
                } else {
                    if (textArea && textArea.disabled) {
                        textArea.setAttribute('placeholder', 'Enter text to synthesize...');
                        textArea.disabled = false;
                        if (submitBtn) submitBtn.disabled = false;
                    }
                }
            });
        }
    }
    
    // Initial check and subscribe to updates
    checkEngineStatus();
    if (api.settings_updated) {
        api.settings_updated.connect(checkEngineStatus);
    }

    // Initial config load
}

window.checkReadiness = function() {
    if (api) {
        api.isReady(function(ready) {
            if (ready) {
                enableUI();
            }
        });
    }
};

window.focusInput = function() {
    const textArea = document.getElementById('textArea');
    if (textArea && !textArea.disabled) {
        textArea.focus({ preventScroll: true });
        textArea.select();
    }
};

window.addEventListener('bridgeReady', () => {
    if (api) {
        api.app_ready.connect(() => {
            enableUI();
            initializeMainControl(api);
        });
        api.isReady(function(ready) {
            if (ready) {
                enableUI();
                initializeMainControl(api);
            }
        });
    }
});
