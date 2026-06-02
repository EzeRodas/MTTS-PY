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

        // Start Minimized toggle
        const startMinCb = document.getElementById('advStartMinimizedCheckbox');
        if (startMinCb) {
            const newStartMinCb = startMinCb.cloneNode(true);
            startMinCb.parentNode.replaceChild(newStartMinCb, startMinCb);
            newStartMinCb.checked = !!config.startMinimized; // defaults to false
            newStartMinCb.addEventListener('change', () => {
                api.updateAppConfig(JSON.stringify({startMinimized: newStartMinCb.checked}));
            });
        }

        // Open on Startup toggle (Windows only)
        // We'll need the platform from the backend to know if we should show it.
        api.getSystemInfo && api.getSystemInfo(function(sysInfoJson) {
            const sysInfo = JSON.parse(sysInfoJson);
            if (sysInfo.platform === 'win32') {
                const container = document.getElementById('advOpenOnStartupContainer');
                if (container) container.style.display = 'flex';
                
                const openStartCb = document.getElementById('advOpenOnStartupCheckbox');
                if (openStartCb) {
                    const newOpenStartCb = openStartCb.cloneNode(true);
                    openStartCb.parentNode.replaceChild(newOpenStartCb, openStartCb);
                    newOpenStartCb.checked = !!config.openOnStartup; // defaults to false
                    newOpenStartCb.addEventListener('change', () => {
                        api.updateAppConfig(JSON.stringify({openOnStartup: newOpenStartCb.checked}));
                    });
                }
            }
        });

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
