/* empty css               */
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const modelSelector = document.getElementById("modelSelector");
const voiceSelector = document.getElementById("voiceSelector");
const outputCheckbox = document.getElementById("outputCheckbox");
const outputSelector = document.getElementById("outputSelector");
const outputSlider = document.getElementById("outputSlider");
const monitoringCheckbox = document.getElementById("monitoringCheckbox");
const monitoringSelector = document.getElementById("monitoringSelector");
const monitoringSlider = document.getElementById("monitoringSlider");
if (closeSettingsBtn) {
  closeSettingsBtn.addEventListener("click", () => {
    window.api.closeSettings();
  });
}
async function loadSettings() {
  if (modelSelector) {
    const models = await window.api.getModels();
    const activeModel = await window.api.getActiveModel();
    modelSelector.innerHTML = "";
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      if (model === activeModel) option.selected = true;
      modelSelector.appendChild(option);
    });
    modelSelector.addEventListener("change", async () => {
      await window.api.setModel(modelSelector.value);
    });
  }
  if (voiceSelector) {
    const voices = await window.api.getVoices();
    const activeVoice = await window.api.getActiveVoice();
    voiceSelector.innerHTML = "";
    voices.forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice;
      option.textContent = voice;
      if (voice === activeVoice) option.selected = true;
      voiceSelector.appendChild(option);
    });
    voiceSelector.addEventListener("change", async () => {
      await window.api.setVoice(voiceSelector.value);
    });
  }
  const config = await window.api.getAppConfig();
  const devices = await window.api.getDevices();
  if (outputSelector) {
    outputSelector.innerHTML = "";
    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = device.name;
      if (config.playbackDevice === device.id) option.selected = true;
      outputSelector.appendChild(option);
    });
    outputSelector.addEventListener("change", async () => {
      await window.api.updateAppConfig({ playbackDevice: outputSelector.value });
    });
  }
  if (outputCheckbox) {
    outputCheckbox.checked = config.playback;
    outputCheckbox.addEventListener("change", async () => {
      await window.api.updateAppConfig({ playback: outputCheckbox.checked });
    });
  }
  if (outputSlider) {
    outputSlider.value = String(config.volume * 100);
    outputSlider.addEventListener("input", async () => {
      const vol = parseInt(outputSlider.value, 10) / 100;
      await window.api.updateAppConfig({ volume: vol });
    });
  }
  if (monitoringSelector) {
    monitoringSelector.innerHTML = "";
    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = device.name;
      if (config.monitoringDevice === device.id) option.selected = true;
      monitoringSelector.appendChild(option);
    });
    monitoringSelector.addEventListener("change", async () => {
      await window.api.updateAppConfig({ monitoringDevice: monitoringSelector.value });
    });
  }
  if (monitoringCheckbox) {
    monitoringCheckbox.checked = config.monitoring;
    monitoringCheckbox.addEventListener("change", async () => {
      await window.api.updateAppConfig({ monitoring: monitoringCheckbox.checked });
    });
  }
  if (monitoringSlider) {
    monitoringSlider.value = String(config.monitoringVolume * 100);
    monitoringSlider.addEventListener("input", async () => {
      const vol = parseInt(monitoringSlider.value, 10) / 100;
      await window.api.updateAppConfig({ monitoringVolume: vol });
    });
  }
}
loadSettings();
