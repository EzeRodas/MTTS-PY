// Tab selection and sidebar actions for Advanced Settings
const api = parent.api;

function switchTab(tabId, button) {
    // Deactivate all panels
    document.querySelectorAll('.category-panel').forEach(p => p.classList.remove('active'));
    // Deactivate all nav buttons
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    
    // Activate selected
    document.getElementById(tabId).classList.add('active');
    if (button) button.classList.add('active');

    // Tab-specific loads
    if (tabId === 'general') loadGeneralTab();
    if (tabId === 'audio') loadAudioTab();
    if (tabId === 'engine') loadEngineTab();
    if (tabId === 'hotkeys') loadHotkeysTab();
    if (tabId === 'history') loadHistoryTab();
}

// Wire Close and Back buttons
document.getElementById('backToQuickBtn').addEventListener('click', () => {
    if (parent && typeof parent.triggerCollapse === 'function') {
        parent.triggerCollapse();
    }
});

document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    if (api) api.closeSettings();
});

// Toast Notification helper
function showToast(message, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    // Force reflow
    toast.offsetHeight;
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
            if (container.children.length === 0) {
                container.remove();
            }
        }, 200);
    }, 2500);
}

// Confirmation modal helper
function showConfirm(title, message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    const content = document.createElement('div');
    content.className = 'modal-content';
    
    const titleEl = document.createElement('div');
    titleEl.className = 'modal-title';
    titleEl.textContent = title;
    
    const bodyEl = document.createElement('div');
    bodyEl.className = 'modal-body';
    bodyEl.textContent = message;
    
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancel';
    // Match height/padding/radius styles for uniform look in modal
    cancelBtn.style.padding = '10px 20px';
    cancelBtn.style.borderRadius = '12px';
    cancelBtn.style.fontSize = '0.95rem';
    
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn-danger';
    confirmBtn.textContent = 'Confirm';
    
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    
    content.appendChild(titleEl);
    content.appendChild(bodyEl);
    content.appendChild(actions);
    overlay.appendChild(content);
    
    document.body.appendChild(overlay);
    
    // Force reflow and show
    overlay.offsetHeight;
    overlay.classList.add('show');
    
    const closeConfirm = () => {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 200);
    };
    
    cancelBtn.addEventListener('click', closeConfirm);
    confirmBtn.addEventListener('click', () => {
        closeConfirm();
        if (typeof onConfirm === 'function') onConfirm();
    });
}

// Load general tab on startup
document.addEventListener('DOMContentLoaded', () => {
    loadGeneralTab();
});

