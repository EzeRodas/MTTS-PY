let bridge_obj = null;
let isDownloading = false;
let setupStatusTimeout = null;
let lastSetupDownloadedModel = "";

function showSetupToast(msg, color) {
    const el = document.getElementById('statusMessage');
    el.innerText = msg;
    if (color) el.style.color = color;
    if (setupStatusTimeout) {
        clearTimeout(setupStatusTimeout);
    }
    setupStatusTimeout = setTimeout(() => {
        el.innerText = "";
    }, 5000);
}

document.addEventListener("DOMContentLoaded", () => {
    // Handle radio button selection styling
    const options = document.querySelectorAll('.model-option');
    options.forEach(opt => {
        opt.addEventListener('click', () => {
            if (isDownloading) return;
            
            options.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            const radio = opt.querySelector('input[type="radio"]');
            radio.checked = true;
            updateDownloadButtonState();
        });
    });

    window.addEventListener('bridgeReady', (e) => {
        bridge_obj = e.detail;
        initBridgeConnections();
    });
});

function initBridgeConnections() {
    // Check if download is running to resume progress view
    if (bridge_obj.isDownloadRunning) {
        bridge_obj.isDownloadRunning(function(running) {
            if (running) {
                isDownloading = true;
                document.getElementById('engineSelectionContainer').style.display = 'none';
                document.getElementById('qualitySelectionContainer').style.display = 'flex';
                document.getElementById('btnDownload').disabled = true;
                document.getElementById('btnSkip').disabled = true;
                document.getElementById('modelOptions').style.opacity = "0.5";
                document.getElementById('progressContainer').style.display = "flex";
                document.getElementById('progressText').innerText = "Resuming download progress...";
            } else {
                document.getElementById('engineSelectionContainer').style.display = 'flex';
                document.getElementById('qualitySelectionContainer').style.display = 'none';
            }
        });
    } else {
        document.getElementById('engineSelectionContainer').style.display = 'flex';
        document.getElementById('qualitySelectionContainer').style.display = 'none';
    }

    // Listen for progress updates
    if (bridge_obj.download_progress) {
        if (bridge_obj._setup_download_progress_cb) {
            try { bridge_obj.download_progress.disconnect(bridge_obj._setup_download_progress_cb); } catch(e) {}
        }
        bridge_obj._setup_download_progress_cb = function(bytesRead, totalBytes, filename) {
            const fileEl = document.getElementById('progressFile');
            if (fileEl) fileEl.innerText = `Downloading: ${filename}`;
            
            let percent = 0;
            if (totalBytes > 0) {
                percent = (bytesRead / totalBytes) * 100;
            }
            const barEl = document.getElementById('progressBar');
            if (barEl) barEl.style.width = `${percent}%`;
            
            const textEl = document.getElementById('progressText');
            if (textEl) {
                const mbRead = (bytesRead / (1024 * 1024)).toFixed(1);
                const mbTotal = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : "?";
                textEl.innerText = `${mbRead} MB / ${mbTotal} MB (${percent.toFixed(0)}%)`;
            }
        };
        bridge_obj.download_progress.connect(bridge_obj._setup_download_progress_cb);
    }
    
    // Listen for completion
    if (bridge_obj.download_complete) {
        if (bridge_obj._setup_download_complete_cb) {
            try { bridge_obj.download_complete.disconnect(bridge_obj._setup_download_complete_cb); } catch(e) {}
        }
        bridge_obj._setup_download_complete_cb = function(success, errorMsg) {
            isDownloading = false;
            
            if (success) {
                bridge_obj.finishSetup();
            } else {
                showSetupToast("Error: " + errorMsg, "#ff4a4a");
                const btnEl = document.getElementById('btnDownload');
                if (btnEl) btnEl.disabled = false;
                const skipBtn = document.getElementById('btnSkip');
                if (skipBtn) skipBtn.disabled = false;
                
                const optsEl = document.getElementById('modelOptions');
                if (optsEl) optsEl.style.opacity = "1";
                
                const progEl = document.getElementById('progressContainer');
                if (progEl) progEl.style.display = "none";
            }
        };
        bridge_obj.download_complete.connect(bridge_obj._setup_download_complete_cb);
    }
}

function startDownload() {
    if (isDownloading) return;
    
    // If we're in the "Finish Setup" state (already installed)
    if (document.getElementById('btnDownload').innerText === "Finish Setup") {
        bridge_obj.finishSetup();
        return;
    }

    const selected = document.querySelector('input[name="modelQuality"]:checked').value;
    lastSetupDownloadedModel = selected;
    
    isDownloading = true;
    document.getElementById('btnDownload').disabled = true;
    document.getElementById('btnSkip').disabled = true;
    if (setupStatusTimeout) clearTimeout(setupStatusTimeout);
    document.getElementById('statusMessage').innerText = "";
    document.getElementById('modelOptions').style.opacity = "0.5";
    document.getElementById('progressContainer').style.display = "flex";
    
    document.getElementById('progressBar').style.width = "0%";
    document.getElementById('progressText').innerText = "Starting download...";
    
    bridge_obj.downloadModel(selected);
}

function deleteModel() {
    if (isDownloading) return;
    
    const selectedRadio = document.querySelector('input[name="modelQuality"]:checked');
    if (!selectedRadio) return;
    
    const val = selectedRadio.value;
    
    if (bridge_obj.deleteModelWithPrecision) {
        bridge_obj.deleteModelWithPrecision(val, function(success) {
            if (success) {
                showSetupToast(`Kokoro model (${val.toUpperCase()}) deleted successfully.`, "#4aff4a");
                updateModelOptionsList();
            } else {
                showSetupToast(`Failed to delete Kokoro model (${val.toUpperCase()}).`, "#ff4a4a");
            }
        });
    }
}

function skipSetup() {
    if (isDownloading) return;
    bridge_obj.skipSetup();
}

function selectEngine() {
    document.getElementById('engineSelectionContainer').style.display = 'none';
    document.getElementById('qualitySelectionContainer').style.display = 'flex';
    updateModelOptionsList();
}

function backToEngine() {
    document.getElementById('qualitySelectionContainer').style.display = 'none';
    document.getElementById('engineSelectionContainer').style.display = 'flex';
}

function updateModelOptionsList() {
    if (!bridge_obj || !bridge_obj.getInstalledPrecisions) return;
    
    bridge_obj.getInstalledPrecisions(function(precJson) {
        const precs = JSON.parse(precJson);
        const options = document.querySelectorAll('#modelOptions .model-option');
        
        options.forEach(opt => {
            const radio = opt.querySelector('input[type="radio"]');
            const val = radio.value;
            const titleSpan = opt.querySelector('.model-title');
            
            let baseTitle = titleSpan.innerText.replace(" (Installed)", "");
            
            if (precs.includes(val)) {
                titleSpan.innerText = baseTitle + " (Installed)";
                opt.classList.add('installed');
            } else {
                titleSpan.innerText = baseTitle;
                opt.classList.remove('installed');
            }
        });
        
        updateDownloadButtonState();
    });
}

function updateDownloadButtonState() {
    if (isDownloading) return;
    
    const selectedRadio = document.querySelector('input[name="modelQuality"]:checked');
    if (!selectedRadio) return;
    
    const val = selectedRadio.value;
    
    if (bridge_obj.isModelInstalledWithPrecision) {
        bridge_obj.isModelInstalledWithPrecision(val, function(installed) {
            const btn = document.getElementById('btnDownload');
            const deleteBtn = document.getElementById('btnDelete');
            if (installed) {
                btn.disabled = false;
                btn.innerText = "Finish Setup";
                deleteBtn.style.display = "block";
            } else {
                btn.disabled = false;
                btn.innerText = "Download & Install";
                deleteBtn.style.display = "none";
            }
        });
    }
}
