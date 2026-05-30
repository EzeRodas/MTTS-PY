// Handles global shortcut detection and Escape key bindings
let appShortcut = "Ctrl+Alt+M"; // default fallback

function isShortcutPressed(e, shortcutStr) {
    if (!shortcutStr) return false;
    const parts = shortcutStr.split('+').map(p => p.trim().toLowerCase());
    const hasCtrl = parts.includes('ctrl');
    const hasAlt = parts.includes('alt');
    const hasShift = parts.includes('shift');
    const hasMeta = parts.includes('meta') || parts.includes('win') || parts.includes('cmd');
    
    const keyPart = parts.find(p => !['ctrl', 'alt', 'shift', 'meta', 'win', 'cmd'].includes(p));
    if (!keyPart) return false;
    
    const matchCtrl = e.ctrlKey === hasCtrl;
    const matchAlt = e.altKey === hasAlt;
    const matchShift = e.shiftKey === hasShift;
    const matchMeta = e.metaKey === hasMeta;
    
    const matchKey = e.key.toLowerCase() === keyPart;
    
    return matchCtrl && matchAlt && matchShift && matchMeta && matchKey;
}

// Get initial shortcut config and listen for changes on bridgeReady
window.addEventListener('bridgeReady', (e) => {
    const bridgeApi = e.detail;
    bridgeApi.getAppConfig(function(configJson) {
        try {
            const config = JSON.parse(configJson);
            if (config.appShortcut) {
                appShortcut = config.appShortcut;
            }
        } catch(err) {
            console.error('Failed to parse app config:', err);
        }
    });

    bridgeApi.app_shortcut_changed.connect(function(newShortcut) {
        appShortcut = newShortcut;
    });
});

document.addEventListener('keydown', (e) => {
    // Escape key hides all windows
    if (e.key === 'Escape') {
        if (api) api.escapePressed();
        e.preventDefault();
        return;
    }

    // Prevent default behavior for the registered global toggle shortcut so it doesn't type into text fields
    if (isShortcutPressed(e, appShortcut)) {
        e.preventDefault();
    }
});
