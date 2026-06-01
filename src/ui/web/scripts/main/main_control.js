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
    if (submitBtn) submitBtn.removeAttribute('disabled');
    if (textArea) {
        textArea.removeAttribute('disabled');
        textArea.setAttribute('placeholder', 'Enter text to synthesize...');
    }
    if (dragArea) dragArea.classList.remove('disabled');
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

window.addEventListener('bridgeReady', () => {
    if (api) {
        api.isReady(function(ready) {
            if (ready) {
                enableUI();
            } else {
                api.app_ready.connect(enableUI);
            }
        });
    }
});
