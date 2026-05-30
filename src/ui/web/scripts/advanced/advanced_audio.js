// Audio Tab Configuration
function loadAudioTab() {
    if (!api) return;
    api.getAppConfig(function(configJson) {
        const config = JSON.parse(configJson);

        // Playback Checkbox
        const outCb = document.getElementById('advOutputCheckbox');
        const newOutCb = outCb.cloneNode(true);
        outCb.parentNode.replaceChild(newOutCb, outCb);
        newOutCb.checked = config.playback;
        newOutCb.addEventListener('change', () => {
            api.updateAppConfig(JSON.stringify({playback: newOutCb.checked}));
        });

        function updateSliderBackground(slider) {
            const val = slider.value;
            const min = slider.min || 0;
            const max = slider.max || 100;
            const percent = ((val - min) / (max - min)) * 100;
            slider.style.background = `linear-gradient(to right, #6366f1 0%, #6366f1 ${percent}%, #d4d4d4 ${percent}%, #d4d4d4 100%)`;
        }

        // Volume slider
        const outSlider = document.getElementById('advOutputSlider');
        const newOutSlider = outSlider.cloneNode(true);
        outSlider.parentNode.replaceChild(newOutSlider, outSlider);
        newOutSlider.value = String(config.volume * 100);
        updateSliderBackground(newOutSlider);
        newOutSlider.addEventListener('input', () => {
            updateSliderBackground(newOutSlider);
            api.updateAppConfig(JSON.stringify({volume: parseInt(newOutSlider.value) / 100}));
        });

        // Monitoring checkbox
        const monCb = document.getElementById('advMonitoringCheckbox');
        const newMonCb = monCb.cloneNode(true);
        monCb.parentNode.replaceChild(newMonCb, monCb);
        newMonCb.checked = config.monitoring;
        newMonCb.addEventListener('change', () => {
            api.updateAppConfig(JSON.stringify({monitoring: newMonCb.checked}));
        });

        // Monitoring volume
        const monSlider = document.getElementById('advMonitoringSlider');
        const newMonSlider = monSlider.cloneNode(true);
        monSlider.parentNode.replaceChild(newMonSlider, monSlider);
        newMonSlider.value = String(config.monitoringVolume * 100);
        updateSliderBackground(newMonSlider);
        newMonSlider.addEventListener('input', () => {
            updateSliderBackground(newMonSlider);
            api.updateAppConfig(JSON.stringify({monitoringVolume: parseInt(newMonSlider.value) / 100}));
        });

        // Devices List
        api.getDevices(function(devicesJson) {
            const devices = JSON.parse(devicesJson);
            const outSel = document.getElementById('advOutputSelector');
            const monSel = document.getElementById('advMonitoringSelector');
            
            const newOutSel = outSel.cloneNode(true);
            outSel.parentNode.replaceChild(newOutSel, outSel);
            
            const newMonSel = monSel.cloneNode(true);
            monSel.parentNode.replaceChild(newMonSel, monSel);
            
            newOutSel.innerHTML = '';
            newMonSel.innerHTML = '';

            devices.forEach(d => {
                const opt1 = document.createElement('option');
                opt1.value = String(d.id); opt1.textContent = d.name;
                if (String(config.playbackDevice) === String(d.id)) opt1.selected = true;
                newOutSel.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = String(d.id); opt2.textContent = d.name;
                if (String(config.monitoringDevice) === String(d.id)) opt2.selected = true;
                newMonSel.appendChild(opt2);
            });

            newOutSel.addEventListener('change', () => {
                api.updateAppConfig(JSON.stringify({playbackDevice: newOutSel.value}));
            });

            newMonSel.addEventListener('change', () => {
                api.updateAppConfig(JSON.stringify({monitoringDevice: newMonSel.value}));
            });
        });
    });
}
