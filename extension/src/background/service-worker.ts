console.log("[Island Extension] Background service worker initialized");

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Island Extension] Installed");
});
