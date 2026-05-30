// Window management (Escape key, close and expand buttons)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (api) api.escapePressed();
        e.preventDefault();
    }
});

document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    if (api) api.closeSettings();
});

const expandBtn = document.getElementById('expandSettingsBtn');
const advPanel = document.getElementById('advancedPanel');
const advFrame = document.getElementById('advancedFrame');
let isExpanded = false;

expandBtn.addEventListener('click', () => {
    isExpanded = !isExpanded;
    const layout = document.querySelector('.main-layout');
    if (isExpanded) {
        expandBtn.classList.add('expanded');
        if (api) api.expandSettings(true);
        layout.classList.add('expanded');
        advPanel.classList.add('expanded');
        advFrame.src = 'advanced.html';
    } else {
        expandBtn.classList.remove('expanded');
        if (api) api.expandSettings(false);
        layout.classList.remove('expanded');
        advPanel.classList.remove('expanded');
        advFrame.src = 'about:blank';
        if (typeof loadSettings === 'function') loadSettings();
    }
});

window.collapseSettings = function() {
    isExpanded = false;
    expandBtn.classList.remove('expanded');
    const layout = document.querySelector('.main-layout');
    if (layout) layout.classList.remove('expanded');
    advPanel.classList.remove('expanded');
    advFrame.src = 'about:blank';
    if (typeof loadSettings === 'function') loadSettings();
};

window.triggerCollapse = function() {
    expandBtn.click();
};
