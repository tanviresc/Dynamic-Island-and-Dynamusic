import { DEFAULT_SETTINGS, ExtensionSettings } from "../types";

const portInput = document.getElementById("portInput") as HTMLInputElement;
const tokenInput = document.getElementById("tokenInput") as HTMLInputElement;
const siteClaude = document.getElementById("siteClaude") as HTMLInputElement;
const siteChatgpt = document.getElementById("siteChatgpt") as HTMLInputElement;
const siteGemini = document.getElementById("siteGemini") as HTMLInputElement;
const showChatTitles = document.getElementById("showChatTitles") as HTMLInputElement;
const probeMode = document.getElementById("probeMode") as HTMLInputElement;

const statusBadge = document.getElementById("statusBadge") as HTMLElement;
const statusText = document.getElementById("statusText") as HTMLElement;
const btnSave = document.getElementById("btnSave") as HTMLButtonElement;
const btnTest = document.getElementById("btnTest") as HTMLButtonElement;
const toast = document.getElementById("toast") as HTMLElement;

function updateStatusDisplay(status: string) {
  statusBadge.className = `badge status-${status}`;
  switch (status) {
    case "connected":
      statusText.textContent = "Connected";
      break;
    case "connecting":
      statusText.textContent = "Connecting...";
      break;
    case "auth_failed":
      statusText.textContent = "Auth Failed";
      break;
    default:
      statusText.textContent = "Disconnected";
      break;
  }
}

function loadSettings() {
  chrome.storage.local.get(
    { ...DEFAULT_SETTINGS, connectionStatus: "disconnected" },
    (items: any) => {
      portInput.value = items.port?.toString() || "47821";
      tokenInput.value = items.token || "";
      siteClaude.checked = items.sites?.claude ?? true;
      siteChatgpt.checked = items.sites?.chatgpt ?? true;
      siteGemini.checked = items.sites?.gemini ?? true;
      showChatTitles.checked = items.showChatTitles ?? true;
      probeMode.checked = items.probeMode ?? false;

      updateStatusDisplay(items.connectionStatus || "disconnected");
    }
  );
}

function saveSettings() {
  const settings: ExtensionSettings = {
    port: parseInt(portInput.value, 10) || 47821,
    token: tokenInput.value.trim(),
    showChatTitles: showChatTitles.checked,
    probeMode: probeMode.checked,
    sites: {
      claude: siteClaude.checked,
      chatgpt: siteChatgpt.checked,
      gemini: siteGemini.checked,
    },
  };

  chrome.storage.local.set(settings, () => {
    showToast("Settings saved successfully");
    // Trigger reconnection
    chrome.runtime.sendMessage({ type: "testConnection" });
  });
}

function showToast(msg: string) {
  toast.textContent = msg;
  toast.style.display = "block";
  setTimeout(() => {
    toast.style.display = "none";
  }, 2500);
}

// Watch status changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.connectionStatus) {
    updateStatusDisplay(changes.connectionStatus.newValue);
  }
});

btnSave.addEventListener("click", saveSettings);
btnTest.addEventListener("click", () => {
  saveSettings();
});

document.addEventListener("DOMContentLoaded", loadSettings);
