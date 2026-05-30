// TTS Engine Configuration Tab
function loadEngineTab() {
    if (!api) return;

    api.getAppConfig(function(configJson) {
        const config = JSON.parse(configJson);
        const pathInput = document.getElementById('advModelsPathInput');
        pathInput.value = config.modelsPath || '';

        const savePathBtn = document.getElementById('savePathBtn');
        const newSavePathBtn = savePathBtn.cloneNode(true);
        savePathBtn.parentNode.replaceChild(newSavePathBtn, savePathBtn);
        newSavePathBtn.addEventListener('click', () => {
            api.updateAppConfig(JSON.stringify({modelsPath: pathInput.value.trim()}));
            showToast('Models directory updated! Restart app if needed.', 'success');
        });

        const browsePathBtn = document.getElementById('browsePathBtn');
        if (browsePathBtn) {
            const newBrowsePathBtn = browsePathBtn.cloneNode(true);
            browsePathBtn.parentNode.replaceChild(newBrowsePathBtn, browsePathBtn);
            newBrowsePathBtn.addEventListener('click', () => {
                api.browseDirectory(function(chosenPath) {
                    if (chosenPath) {
                        pathInput.value = chosenPath;
                        api.updateAppConfig(JSON.stringify({modelsPath: chosenPath}));
                        showToast('Models directory updated! Restart app if needed.', 'success');
                    }
                });
            });
        }
    });

    // Models dropdown
    api.getModels(function(modelsJson) {
        const models = JSON.parse(modelsJson);
        const sel = document.getElementById('advModelSelector');
        const newSel = sel.cloneNode(true);
        sel.parentNode.replaceChild(newSel, sel);
        newSel.innerHTML = '';
        
        if (models.length === 0) {
            const opt = document.createElement('option');
            opt.disabled = true;
            opt.selected = true;
            opt.textContent = "No TTS engine detected";
            newSel.appendChild(opt);
            return;
        }
        
        api.getActiveModel(function(active) {
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                if (m === active) opt.selected = true;
                newSel.appendChild(opt);
            });
        });
        
        newSel.addEventListener('change', () => {
            api.setModel(newSel.value);
        });
    });

    // Voices dropdown
    api.getVoices(function(voicesJson) {
        const voices = JSON.parse(voicesJson);
        const sel = document.getElementById('advVoiceSelector');
        const newSel = sel.cloneNode(true);
        sel.parentNode.replaceChild(newSel, sel);
        newSel.innerHTML = '';

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
                    newSel.appendChild(currentGenderEl);
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

        newSel.addEventListener('change', () => {
            api.setVoice(newSel.value);
        });
    });

    function updateSliderBackground(slider) {
        const val = parseFloat(slider.value);
        const min = parseFloat(slider.min || 0);
        const max = parseFloat(slider.max || 100);
        const percent = ((val - min) / (max - min)) * 100;
        slider.style.background = `linear-gradient(to right, #6366f1 0%, #6366f1 ${percent}%, #d4d4d4 ${percent}%, #d4d4d4 100%)`;
    }

    // Speed slider
    api.getSpeed(function(speed) {
        const speedSlider = document.getElementById('advSpeedSlider');
        const speedValue = document.getElementById('advSpeedValue');
        const newSpeedSlider = speedSlider.cloneNode(true);
        speedSlider.parentNode.replaceChild(newSpeedSlider, speedSlider);
        newSpeedSlider.value = String(speed);
        updateSliderBackground(newSpeedSlider);
        speedValue.textContent = speed.toFixed(1) + 'x';
        
        newSpeedSlider.addEventListener('input', () => {
            const val = parseFloat(newSpeedSlider.value);
            speedValue.textContent = val.toFixed(1) + 'x';
            updateSliderBackground(newSpeedSlider);
            api.setSpeed(val);
        });
    });
}
