let isEngineDownloading = false;
let engineStatusTimeout = null;
let lastDownloadedModel = "";

function showEngineToast(msg, color) {
    const el = document.getElementById('engineStatusMessage');
    el.innerText = msg;
    el.style.color = color;
    if (engineStatusTimeout) {
        clearTimeout(engineStatusTimeout);
    }
    engineStatusTimeout = setTimeout(() => {
        el.innerText = "";
    }, 5000);
}

function loadEngineManagementTab() {
    const options = document.querySelectorAll('#engineModelOptions .model-option');
    options.forEach(opt => {
        opt.addEventListener('click', () => {
            if (isEngineDownloading) return;
            
            options.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            const radio = opt.querySelector('input[type="radio"]');
            radio.checked = true;
            updateDownloadButtonState(api);
        });
    });

    checkEngineStatus(api);
    
    // Listen for download progress
    if (api.download_progress && !api._download_progress_bound) {
        api.download_progress.connect(function(bytesRead, totalBytes, filename) {
            document.getElementById('engineProgressFile').innerText = `Downloading: ${filename}`;
            
            let percent = 0;
            if (totalBytes > 0) {
                percent = (bytesRead / totalBytes) * 100;
            }
            
            document.getElementById('engineProgressBar').style.width = `${percent}%`;
            
            const mbRead = (bytesRead / (1024 * 1024)).toFixed(1);
            const mbTotal = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : "?";
            document.getElementById('engineProgressText').innerText = `${mbRead} MB / ${mbTotal} MB (${percent.toFixed(0)}%)`;
        });
        api._download_progress_bound = true;
    }
    
    // Listen for completion
    if (api.download_complete && !api._download_complete_bound) {
        api.download_complete.connect(function(success, errorMsg) {
            isEngineDownloading = false;
            if (success) {
                const modelName = lastDownloadedModel ? `Kokoro (${lastDownloadedModel.toUpperCase()})` : "Model";
                showEngineToast(`${modelName} installed successfully. Please restart the app.`, "#4aff4a");
                checkEngineStatus(api);
                
                document.getElementById('btnEngineDownload').disabled = false;
                document.getElementById('engineModelOptions').style.opacity = "1";
                document.getElementById('engineProgressContainer').style.display = "none";
            } else {
                showEngineToast("Error: " + errorMsg, "#ff4a4a");
                document.getElementById('btnEngineDownload').disabled = false;
                document.getElementById('engineModelOptions').style.opacity = "1";
                document.getElementById('engineProgressContainer').style.display = "none";
            }
        });
        api._download_complete_bound = true;
    }
}

function checkEngineStatus(api) {
    if (api.isDownloadRunning) {
        api.isDownloadRunning(function(running) {
            if (running) {
                isEngineDownloading = true;
                document.getElementById('advEngineSelectionContainer').style.display = 'none';
                document.getElementById('advQualitySelectionContainer').style.display = 'flex';
                document.getElementById('btnEngineDownload').disabled = true;
                document.getElementById('engineStatusMessage').innerText = "";
                document.getElementById('engineModelOptions').style.opacity = "0.5";
                document.getElementById('engineProgressContainer').style.display = "flex";
                document.getElementById('engineProgressText').innerText = "Resuming download progress...";
                
                document.getElementById('engineStatusTitle').innerText = "Status: Downloading";
                document.getElementById('engineStatusTitle').style.color = "#a0a0b0";
                document.getElementById('engineStatusDesc').innerText = "A model download is currently in progress...";
                document.getElementById('engineStatusCard').style.backgroundColor = "rgba(160, 160, 176, 0.1)";
                document.getElementById('engineStatusCard').style.borderColor = "#a0a0b0";
                document.getElementById('btnEngineDelete').style.display = "none";
            } else {
                _checkInstalledStatus(api);
            }
        });
    } else {
        _checkInstalledStatus(api);
    }
}

function _checkInstalledStatus(api) {
    if (api.isModelInstalled) {
        api.isModelInstalled(function(installed) {
            if (installed) {
                if (api.getInstalledPrecisions) {
                    api.getInstalledPrecisions(function(precJson) {
                        const precs = JSON.parse(precJson);
                        const formatted = precs.map(p => p.toUpperCase()).join(", ");
                        document.getElementById('engineStatusTitle').innerText = "Status: Installed";
                        document.getElementById('engineStatusTitle').style.color = "#4aff4a";
                        document.getElementById('engineStatusDesc').innerText = `Installed precision(s): ${formatted}.`;
                        document.getElementById('engineStatusCard').style.backgroundColor = "rgba(74, 255, 74, 0.1)";
                        document.getElementById('engineStatusCard').style.borderColor = "#4aff4a";
                    });
                } else {
                    document.getElementById('engineStatusTitle').innerText = "Status: Installed";
                    document.getElementById('engineStatusTitle').style.color = "#4aff4a";
                    document.getElementById('engineStatusDesc').innerText = "A compatible Kokoro ONNX model is present on your system.";
                    document.getElementById('engineStatusCard').style.backgroundColor = "rgba(74, 255, 74, 0.1)";
                    document.getElementById('engineStatusCard').style.borderColor = "#4aff4a";
                }
                
                document.getElementById('btnEngineDelete').style.display = "block";
            } else {
                document.getElementById('engineStatusTitle').innerText = "Status: Not Installed";
                document.getElementById('engineStatusTitle').style.color = "#ff4a4a";
                document.getElementById('engineStatusDesc').innerText = "No TTS engine model found. Synthesis will not work.";
                document.getElementById('engineStatusCard').style.backgroundColor = "rgba(255, 74, 74, 0.1)";
                document.getElementById('engineStatusCard').style.borderColor = "#ff4a4a";
                
                document.getElementById('btnEngineDelete').style.display = "none";
            }
            updateModelOptionsList(api);
        });
    }
}

function updateModelOptionsList(api) {
    if (!api.getInstalledPrecisions) return;
    
    api.getInstalledPrecisions(function(precJson) {
        const precs = JSON.parse(precJson);
        const options = document.querySelectorAll('#engineModelOptions .model-option');
        
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
        
        updateDownloadButtonState(api);
    });
}

function updateDownloadButtonState(api) {
    if (isEngineDownloading) return;
    
    const selectedRadio = document.querySelector('input[name="engineModelQuality"]:checked');
    if (!selectedRadio) return;
    
    const val = selectedRadio.value;
    
    if (api.isModelInstalledWithPrecision) {
        api.isModelInstalledWithPrecision(val, function(installed) {
            const btn = document.getElementById('btnEngineDownload');
            const deleteBtn = document.getElementById('btnEngineDeleteSelected');
            if (installed) {
                btn.disabled = true;
                btn.innerText = "Already Installed";
                deleteBtn.style.display = "block";
            } else {
                btn.disabled = false;
                btn.innerText = "Download & Install";
                deleteBtn.style.display = "none";
            }
        });
    }
}

window.startEngineDownload = function() {
    if (isEngineDownloading) return;
    
    const selected = document.querySelector('input[name="engineModelQuality"]:checked').value;
    lastDownloadedModel = selected;
    
    isEngineDownloading = true;
    document.getElementById('btnEngineDownload').disabled = true;
    if (engineStatusTimeout) clearTimeout(engineStatusTimeout);
    document.getElementById('engineStatusMessage').innerText = "";
    document.getElementById('engineModelOptions').style.opacity = "0.5";
    document.getElementById('engineProgressContainer').style.display = "flex";
    
    document.getElementById('engineProgressBar').style.width = "0%";
    document.getElementById('engineProgressText').innerText = "Starting download...";
    
    if (api && api.downloadModel) {
        api.downloadModel(selected);
    }
};

window.deleteEngineModel = function() {
    if (isEngineDownloading) return;
    
    if (api && api.deleteModel) {
        api.deleteModel(function(success) {
            if (success) {
                showEngineToast("All Kokoro models deleted successfully. Restart app to apply fully.", "#ff4a4a");
                checkEngineStatus(api);
            } else {
                showEngineToast("Failed to delete models.", "#ff4a4a");
            }
        });
    }
};

window.deleteSelectedEngineModel = function() {
    if (isEngineDownloading) return;
    
    const selectedRadio = document.querySelector('input[name="engineModelQuality"]:checked');
    if (!selectedRadio) return;
    
    const val = selectedRadio.value;
    
    if (api && api.deleteModelWithPrecision) {
        api.deleteModelWithPrecision(val, function(success) {
            if (success) {
                showEngineToast(`Kokoro model (${val.toUpperCase()}) deleted successfully.`, "#ff4a4a");
                checkEngineStatus(api);
            } else {
                showEngineToast(`Failed to delete Kokoro model (${val.toUpperCase()}).`, "#ff4a4a");
            }
        });
    }
};

window.advSelectEngine = function() {
    document.getElementById('advEngineSelectionContainer').style.display = 'none';
    document.getElementById('advQualitySelectionContainer').style.display = 'flex';
    updateModelOptionsList(api);
};

window.advBackToEngine = function() {
    document.getElementById('advQualitySelectionContainer').style.display = 'none';
    document.getElementById('advEngineSelectionContainer').style.display = 'flex';
};
