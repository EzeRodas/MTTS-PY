// Loads configuration parameters for Quick Settings
async function loadSettings() {
    if (!api) return;

    api.getModels(function(modelsJson) {
        const models = JSON.parse(modelsJson);
        const sel = document.getElementById('modelSelector');
        sel.innerHTML = '';
        if (models.length === 0) {
            const opt = document.createElement('option');
            opt.value = ''; opt.textContent = 'No TTS engine detected';
            opt.disabled = true; opt.selected = true;
            sel.appendChild(opt);
            return;
        }
        api.getActiveModel(function(active) {
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                if (m === active) opt.selected = true;
                sel.appendChild(opt);
            });
        });
        sel.onchange = () => { api.setModel(sel.value); };
    });

    // Voices
    api.getVoices(function(voicesJson) {
        const voices = JSON.parse(voicesJson);
        const sel = document.getElementById('voiceSelector');
        sel.innerHTML = '';
        if (voices.length === 0) {
            const opt = document.createElement('option');
            opt.value = ''; opt.textContent = 'No voices available';
            opt.disabled = true; opt.selected = true;
            sel.appendChild(opt);
            return;
        }

        const langNames = {
            'a': 'American English',
            'b': 'British English',
            'e': 'Spanish',
            'f': 'French',
            'j': 'Japanese',
            'z': 'Mandarin Chinese',
            'i': 'Italian',
            'p': 'Portuguese',
            'h': 'Hindi'
        };
        const langOrder = ['a', 'b', 'e', 'f', 'j', 'z', 'i', 'p', 'h'];

        api.getActiveVoice(function(active) {
            const parsed = voices.map(v => {
                if (v.length < 3 || v[2] !== '_') {
                    return { id: v, name: v, gender: 'Other', lang: 'Other', genderKey: 'other', langKey: 'other' };
                }
                const gKey = v[1].toLowerCase();
                const lKey = v[0].toLowerCase();
                const gender = gKey === 'f' ? 'Female' : (gKey === 'm' ? 'Male' : 'Other');
                const lang = langNames[lKey] || 'Other';
                const namePart = v.slice(3);
                const name = namePart.charAt(0).toUpperCase() + namePart.slice(1);
                return {
                    id: v,
                    name: name,
                    gender: gender,
                    lang: lang,
                    genderKey: gKey,
                    langKey: lKey
                };
            });

            parsed.sort((x, y) => {
                const gOrder = { 'f': 0, 'm': 1, 'other': 2 };
                const gx = gOrder[x.genderKey] !== undefined ? gOrder[x.genderKey] : 2;
                const gy = gOrder[y.genderKey] !== undefined ? gOrder[y.genderKey] : 2;
                if (gx !== gy) return gx - gy;

                const lx = langOrder.indexOf(x.langKey);
                const ly = langOrder.indexOf(y.langKey);
                const lxIndex = lx !== -1 ? lx : 999;
                const lyIndex = ly !== -1 ? ly : 999;
                if (lxIndex !== lyIndex) return lxIndex - lyIndex;

                return x.name.localeCompare(y.name);
            });

            let currentGender = null;
            let currentGenderEl = null;
            let currentLang = null;

            parsed.forEach(v => {
                if (v.gender !== currentGender) {
                    currentGender = v.gender;
                    currentGenderEl = document.createElement('optgroup');
                    currentGenderEl.label = currentGender;
                    sel.appendChild(currentGenderEl);
                    currentLang = null;
                }

                if (v.lang !== currentLang) {
                    currentLang = v.lang;
                    const divOpt = document.createElement('option');
                    divOpt.disabled = true;
                    divOpt.textContent = `── ${currentLang} ──`;
                    currentGenderEl.appendChild(divOpt);
                }

                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = v.name;
                if (v.id === active) opt.selected = true;
                currentGenderEl.appendChild(opt);
            });
        });
        sel.onchange = () => { api.setVoice(sel.value); };
    });

    // App config + devices
    api.getAppConfig(function(configJson) {
        const config = JSON.parse(configJson);

        const outCb = document.getElementById('outputCheckbox');
        outCb.checked = config.playback;
        outCb.onchange = () => { api.updateAppConfig(JSON.stringify({playback: outCb.checked})); };

        function updateSliderBackground(slider) {
            const val = slider.value;
            const min = slider.min || 0;
            const max = slider.max || 100;
            const percent = ((val - min) / (max - min)) * 100;
            slider.style.background = `linear-gradient(to right, #6366f1 0%, #6366f1 ${percent}%, #d4d4d4 ${percent}%, #d4d4d4 100%)`;
        }

        const outSlider = document.getElementById('outputSlider');
        outSlider.value = String(config.volume * 100);
        updateSliderBackground(outSlider);
        outSlider.oninput = () => {
            updateSliderBackground(outSlider);
            api.updateAppConfig(JSON.stringify({volume: parseInt(outSlider.value) / 100}));
        };

        // Monitoring checkbox
        const monCb = document.getElementById('monitoringCheckbox');
        monCb.checked = config.monitoring;
        monCb.onchange = () => { api.updateAppConfig(JSON.stringify({monitoring: monCb.checked})); };

        // Monitoring volume
        const monSlider = document.getElementById('monitoringSlider');
        monSlider.value = String(config.monitoringVolume * 100);
        updateSliderBackground(monSlider);
        monSlider.oninput = () => {
            updateSliderBackground(monSlider);
            api.updateAppConfig(JSON.stringify({monitoringVolume: parseInt(monSlider.value) / 100}));
        };

        // Devices
        api.getDevices(function(devicesJson) {
            const devices = JSON.parse(devicesJson);
            const outSel = document.getElementById('outputSelector');
            const monSel = document.getElementById('monitoringSelector');
            
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
            
            newOutSel.addEventListener('change', () => { api.updateAppConfig(JSON.stringify({playbackDevice: newOutSel.value})); });
            newMonSel.addEventListener('change', () => { api.updateAppConfig(JSON.stringify({monitoringDevice: newMonSel.value})); });
        });
    });
}

// Listen for connection
window.addEventListener('bridgeReady', () => {
    if (api) {
        api.isReady(function(ready) {
            if (ready) {
                loadSettings();
            } else {
                api.app_ready.connect(loadSettings);
            }
        });
    }
});
