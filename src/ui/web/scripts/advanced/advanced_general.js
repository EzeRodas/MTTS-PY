// General Tab Configuration
function loadGeneralTab() {
    if (!api) return;

    api.getAppConfig(function(configJson) {
        const config = JSON.parse(configJson);

        // Hide on Enter toggle
        const hideCb = document.getElementById('advHideOnEnterCheckbox');
        if (hideCb) {
            const newHideCb = hideCb.cloneNode(true);
            hideCb.parentNode.replaceChild(newHideCb, hideCb);
            newHideCb.checked = !!config.hideOnEnter; // defaults to false
            newHideCb.addEventListener('change', () => {
                api.updateAppConfig(JSON.stringify({hideOnEnter: newHideCb.checked}));
            });
        }

        // Monitors / Screens list
        if (typeof api.getScreens === 'function') {
            api.getScreens(function(screensJson) {
                const screens = JSON.parse(screensJson);
                const monSel = document.getElementById('advMonitorSelector');
                if (monSel) {
                    const newMonSel = monSel.cloneNode(true);
                    monSel.parentNode.replaceChild(newMonSel, monSel);
                    newMonSel.innerHTML = '';

                    screens.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = String(s.index);
                        opt.textContent = s.name;
                        if (parseInt(config.defaultMonitor || 0) === s.index) {
                            opt.selected = true;
                        }
                        newMonSel.appendChild(opt);
                    });

                    newMonSel.addEventListener('change', () => {
                        api.updateAppConfig(JSON.stringify({defaultMonitor: parseInt(newMonSel.value)}));
                    });
                }
            });
        }
    });
}
