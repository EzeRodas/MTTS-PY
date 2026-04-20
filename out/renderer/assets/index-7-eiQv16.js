/* empty css               */
const submitBtn = document.getElementById("submitBtn");
const textArea = document.getElementById("textArea");
const closeBtn = document.getElementById("closeBtn");
const settingsBtn = document.getElementById("settingsBtn");
let isProcessing = false;
const submitAction = async () => {
  if (isProcessing) return;
  const text = textArea.value.trim();
  if (text) {
    isProcessing = true;
    submitBtn.disabled = true;
    textArea.value = "";
    try {
      await window.api.submitText(text);
    } catch (error) {
      console.error("Failed to submit text:", error);
    } finally {
      isProcessing = false;
      submitBtn.disabled = false;
      textArea.focus();
    }
  }
};
if (submitBtn) {
  submitBtn.addEventListener("click", submitAction);
}
if (textArea) {
  textArea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitAction();
    }
  });
}
if (closeBtn) {
  closeBtn.addEventListener("click", () => {
    window.api.closeApp();
  });
}
if (settingsBtn) {
  settingsBtn.addEventListener("click", () => {
    const rect = settingsBtn.getBoundingClientRect();
    window.api.openSettings({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    });
  });
}
