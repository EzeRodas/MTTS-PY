// Global Hotkeys Configuration Tab
let recordingTargetInput = null;
let recordingButton = null;
let pressedKeys = new Set();
let currentShortcut = '';
let onRecordCompleteCallback = null;

function getStandardKeyName(event) {
    const key = event.key;
    if (key === 'Control') return 'Ctrl';
    if (key === 'Alt') return 'Alt';
    if (key === 'Shift') return 'Shift';
    if (key === 'Meta') return 'Meta';
    if (key === 'Escape') return 'Esc';
    if (key === ' ') return 'Space';
    if (key === 'ArrowUp') return 'Up';
    if (key === 'ArrowDown') return 'Down';
    if (key === 'ArrowLeft') return 'Left';
    if (key === 'ArrowRight') return 'Right';
    if (key.length === 1) return key.toUpperCase();
    return key;
}

function startRecording(inputElement, buttonElement, callback) {
    if (recordingTargetInput) {
        stopRecording();
    }
    
    recordingTargetInput = inputElement;
    recordingButton = buttonElement;
    onRecordCompleteCallback = callback;
    pressedKeys.clear();
    currentShortcut = '';
    
    recordingButton.textContent = 'Recording...';
    recordingButton.classList.add('btn-primary');
    recordingButton.classList.remove('btn-secondary');
    recordingTargetInput.placeholder = 'Press keys...';
    recordingTargetInput.value = '';
    
    window.addEventListener('keydown', handleRecordKeyDown, true);
    window.addEventListener('keyup', handleRecordKeyUp, true);
}

function stopRecording() {
    if (!recordingTargetInput) return;
    
    window.removeEventListener('keydown', handleRecordKeyDown, true);
    window.removeEventListener('keyup', handleRecordKeyUp, true);
    
    const targetInput = recordingTargetInput;
    const button = recordingButton;
    const callback = onRecordCompleteCallback;
    const shortcut = currentShortcut;
    
    button.textContent = 'Change';
    button.classList.remove('btn-primary');
    button.classList.add('btn-secondary');
    targetInput.placeholder = targetInput.id === 'advToggleShortcutInput' 
        ? 'e.g. Ctrl+Alt+M' 
        : 'Press Change to record...';
        
    recordingTargetInput = null;
    recordingButton = null;
    onRecordCompleteCallback = null;
    
    if (shortcut) {
        const isGlobalToggle = (targetInput.id === 'advToggleShortcutInput');
        checkShortcutConflict(shortcut, isGlobalToggle, () => {
            targetInput.value = shortcut;
            if (callback) {
                callback(shortcut);
            }
        }, () => {
            restoreOriginalValue(targetInput);
        });
    } else {
        restoreOriginalValue(targetInput);
    }
}

function restoreOriginalValue(targetInput) {
    if (targetInput.id === 'advToggleShortcutInput') {
        api.getAppConfig(function(configJson) {
            const config = JSON.parse(configJson);
            targetInput.value = config.appShortcut || 'Ctrl+Alt+M';
        });
    } else {
        targetInput.value = '';
    }
}

function checkShortcutConflict(shortcut, isGlobalToggle, onSuccess, onFailure) {
    api.getAppConfig(function(configJson) {
        const config = JSON.parse(configJson);
        const globalShortcut = config.appShortcut || 'Ctrl+Alt+M';
        
        if (!isGlobalToggle && shortcut.toLowerCase() === globalShortcut.toLowerCase()) {
            showToast('Key combination already in use', 'error');
            onFailure();
            return;
        }
        
        api.getHotkeys(function(hotkeysJson) {
            const hotkeys = JSON.parse(hotkeysJson);
            const conflict = hotkeys.some(hk => hk.hotkey.toLowerCase() === shortcut.toLowerCase());
            
            if (conflict) {
                showToast('Key combination already in use', 'error');
                onFailure();
                return;
            }
            
            onSuccess();
        });
    });
}

function handleRecordKeyDown(event) {
    event.preventDefault();
    event.stopPropagation();
    
    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        currentShortcut = '';
        stopRecording();
        return;
    }
    
    pressedKeys.add(event.code);
    
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    
    const key = event.key;
    if (key && key !== 'Control' && key !== 'Alt' && key !== 'Shift' && key !== 'Meta') {
        parts.push(getStandardKeyName(event));
    }
    
    const combo = parts.slice(0, 3).join('+');
    if (combo) {
        currentShortcut = combo;
        recordingTargetInput.value = combo;
    }
}

function handleRecordKeyUp(event) {
    event.preventDefault();
    event.stopPropagation();
    
    pressedKeys.delete(event.code);
    
    if (pressedKeys.size === 0) {
        stopRecording();
    }
}

function loadHotkeysTab() {
    if (!api) return;

    // Global toggle shortcut
    api.getAppConfig(function(configJson) {
        const config = JSON.parse(configJson);
        const shortcutInput = document.getElementById('advToggleShortcutInput');
        shortcutInput.value = config.appShortcut || 'Ctrl+Alt+M';

        const saveBtn = document.getElementById('saveToggleShortcutBtn');
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.addEventListener('click', () => {
            startRecording(shortcutInput, newSaveBtn, (newShortcut) => {
                api.updateAppConfig(JSON.stringify({appShortcut: newShortcut}));
            });
        });
    });

    // Listen for OS-bound shortcut updates
    api.shortcut_updated_by_os.connect(function(actualShortcut) {
        const shortcutInput = document.getElementById('advToggleShortcutInput');
        if (shortcutInput) {
            shortcutInput.value = actualShortcut;
        }
    });

    // Phrase hotkey change button
    const hkInput = document.getElementById('newHotkeyShortcut');
    const changeHkBtn = document.getElementById('changeHotkeyBtn');
    const newChangeHkBtn = changeHkBtn.cloneNode(true);
    changeHkBtn.parentNode.replaceChild(newChangeHkBtn, changeHkBtn);
    newChangeHkBtn.addEventListener('click', () => {
        startRecording(hkInput, newChangeHkBtn, null);
    });

    // Hotkey-to-speech list
    refreshHotkeysList();

    const addBtn = document.getElementById('addHotkeyBtn');
    const newAddBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newAddBtn, addBtn);
    newAddBtn.addEventListener('click', () => {
        const phInput = document.getElementById('newHotkeyPhrase');
        const hk = hkInput.value.trim();
        const ph = phInput.value.trim();

        if (!hk || !ph || hk === 'Press Change to record...') {
            showToast('Please enter both a key shortcut and a speech phrase!', 'error');
            return;
        }

        api.assignHotkey(hk, ph);
        setTimeout(() => {
            hkInput.value = '';
            phInput.value = '';
            refreshHotkeysList();
        }, 100);
    });
}

function refreshHotkeysList() {
    api.getHotkeys(function(hotkeysJson) {
        const hotkeys = JSON.parse(hotkeysJson);
        const container = document.getElementById('hotkeysList');
        container.innerHTML = '';

        if (hotkeys.length === 0) {
            container.innerHTML = '<div class="empty-state">No phrase hotkeys mapped yet.</div>';
            return;
        }

        hotkeys.forEach((hk, index) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            
            const label = document.createElement('div');
            label.className = 'list-item-text';
            label.innerHTML = `<strong>${hk.hotkey}</strong> &rarr; "${hk.text}"`;
            
            const actions = document.createElement('div');
            actions.className = 'list-item-actions';
            
            const playBtn = document.createElement('button');
            playBtn.className = 'btn-secondary';
            playBtn.textContent = 'Play';
            playBtn.addEventListener('click', () => api.playHotkey(index));

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-secondary';
            delBtn.style.color = '#ef4444';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', () => {
                api.deleteHotkey(index);
                setTimeout(refreshHotkeysList, 100);
            });

            actions.appendChild(playBtn);
            actions.appendChild(delBtn);
            item.appendChild(label);
            item.appendChild(actions);
            container.appendChild(item);
        });
    });
}
