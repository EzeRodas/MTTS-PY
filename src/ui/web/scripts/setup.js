let bridge_obj = null;
let isDownloading = false;

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

    if (typeof qt !== 'undefined' && qt.webChannelTransport) {
        new QWebChannel(qt.webChannelTransport, function(channel) {
            bridge_obj = channel.objects.bridge_obj;
            initBridgeConnections();
        });
    }
});

function initBridgeConnections() {
    // Check if already installed or downloading
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
                bridge_obj.isModelInstalled(function(installed) {
                    if (installed) {
                        document.getElementById('engineSelectionContainer').style.display = 'none';
                        document.getElementById('qualitySelectionContainer').style.display = 'flex';
                        updateModelOptionsList();
                    }
                });
            }
        });
    } else {
        bridge_obj.isModelInstalled(function(installed) {
            if (installed) {
                document.getElementById('engineSelectionContainer').style.display = 'none';
                document.getElementById('qualitySelectionContainer').style.display = 'flex';
                updateModelOptionsList();
            }
        });
    }

    // Listen for progress
    bridge_obj.download_progress.connect(function(bytesRead, totalBytes, filename) {
        document.getElementById('progressFile').innerText = `Downloading: ${filename}`;
        
        let percent = 0;
        if (totalBytes > 0) {
            percent = (bytesRead / totalBytes) * 100;
        }
        
        document.getElementById('progressBar').style.width = `${percent}%`;
        
        const mbRead = (bytesRead / (1024 * 1024)).toFixed(1);
        const mbTotal = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : "?";
        document.getElementById('progressText').innerText = `${mbRead} MB / ${mbTotal} MB (${percent.toFixed(0)}%)`;
    });

    // Listen for completion
    bridge_obj.download_complete.connect(function(success, errorMsg) {
        isDownloading = false;
        if (success) {
            bridge_obj.finishSetup();
        } else {
            document.getElementById('statusMessage').innerText = "Error: " + errorMsg;
            document.getElementById('btnDownload').disabled = false;
            document.getElementById('btnSkip').disabled = false;
            document.getElementById('modelOptions').style.opacity = "1";
            document.getElementById('progressContainer').style.display = "none";
        }
    });
}

function startDownload() {
    if (isDownloading) return;
    
    // If we're in the "Finish Setup" state (already installed)
    if (document.getElementById('btnDownload').innerText === "Finish Setup") {
        bridge_obj.finishSetup();
        return;
    }

    const selected = document.querySelector('input[name="modelQuality"]:checked').value;
    console.log("startDownload: selected precision =", selected);
    console.log("startDownload: bridge_obj =", bridge_obj);
    console.log("startDownload: bridge_obj.downloadModel =", bridge_obj.downloadModel);
    
    isDownloading = true;
    document.getElementById('btnDownload').disabled = true;
    document.getElementById('btnSkip').disabled = true;
    document.getElementById('statusMessage').innerText = "";
    document.getElementById('modelOptions').style.opacity = "0.5";
    document.getElementById('progressContainer').style.display = "flex";
    
    document.getElementById('progressBar').style.width = "0%";
    document.getElementById('progressText').innerText = "Starting download...";
    
    console.log("startDownload: calling bridge_obj.downloadModel(" + selected + ")");
    bridge_obj.downloadModel(selected);
    console.log("startDownload: downloadModel call returned");
}

function deleteModel() {
    if (isDownloading) return;
    
    const selectedRadio = document.querySelector('input[name="modelQuality"]:checked');
    if (!selectedRadio) return;
    
    const val = selectedRadio.value;
    
    if (bridge_obj.deleteModelWithPrecision) {
        bridge_obj.deleteModelWithPrecision(val, function(success) {
            if (success) {
                updateModelOptionsList();
            } else {
                document.getElementById('statusMessage').innerText = `Failed to delete model (${val.toUpperCase()}).`;
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
