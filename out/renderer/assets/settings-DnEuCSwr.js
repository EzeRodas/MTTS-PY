/* empty css               */
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const modelSelector = document.getElementById("modelSelector");
const voiceSelector = document.getElementById("voiceSelector");
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
      if (model === activeModel) {
        option.selected = true;
      }
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
      if (voice === activeVoice) {
        option.selected = true;
      }
      voiceSelector.appendChild(option);
    });
    voiceSelector.addEventListener("change", async () => {
      await window.api.setVoice(voiceSelector.value);
    });
  }
}
loadSettings();
