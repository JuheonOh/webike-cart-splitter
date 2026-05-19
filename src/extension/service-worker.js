const WEBIKE_HOST = "www.japan-webike.kr";
const WEBIKE_HOME = "https://www.japan-webike.kr/";
const TOGGLE_MESSAGE = { type: "WEBIKE_CART_SPLITTER_TOGGLE" };
const OPEN_MESSAGE = { type: "WEBIKE_CART_SPLITTER_OPEN" };

function isWebikeTab(tab) {
  try {
    return new URL(tab?.url || "").hostname === WEBIKE_HOST;
  } catch {
    return false;
  }
}

async function togglePanel(tab) {
  if (!tab?.id) return;
  if (!isWebikeTab(tab)) {
    await chrome.tabs.create({ url: WEBIKE_HOME });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, TOGGLE_MESSAGE);
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["extension/content-script.js"],
    });
  }

  await chrome.tabs.sendMessage(tab.id, OPEN_MESSAGE);
}

chrome.action.onClicked.addListener((tab) => {
  void togglePanel(tab);
});
