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
