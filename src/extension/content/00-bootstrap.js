(() => {
  const GLOBAL_KEY = "__WEBIKE_CART_SPLITTER_EXTENSION__";
  if (window[GLOBAL_KEY]) return;
  window[GLOBAL_KEY] = true;

  const REQUIRED_HOST = "www.japan-webike.kr";
  const ROOT_ID = "webike-cart-splitter-extension-root";
  const SEARCH_ENDPOINT = "/api-search-es.html";
  const CART_PAGE_PATH = "/shopping_cart.html";
  const CART_ENDPOINT = "/api_shopping_cart.html?action=add_product&ajax_action=1";
  const STYLE_PATH = "extension/content-style.css";
  const STORAGE_KEY = "webike-cart-splitter-extension-state-v1";
  const STORAGE_TTL_MS = 24 * 60 * 60 * 1000;
  const FIND_PARTS_CONCURRENCY = 4;
  const FALLBACK_STYLE = ":host{all:initial;font-family:sans-serif}.wcs-panel{position:fixed;top:18px;right:18px;z-index:2147483647;width:420px;max-width:calc(100vw - 28px);max-height:calc(100vh - 36px);overflow:auto;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#101828;box-shadow:0 18px 45px rgba(15,23,42,.24);font:14px/1.45 sans-serif}.wcs-header,.wcs-body{padding:14px}.wcs-header{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;background:#f8fafc}.wcs-textarea{width:100%;min-height:112px}.wcs-button{margin:4px;padding:7px 11px}.wcs-card{border:1px solid #e5e7eb;border-radius:8px;margin:8px 0;padding:10px}";

  const state = {
    inputValue: "",
    results: [],
    busy: false,
    busyMode: "",
    message: { type: "", text: "" },
    cartSummary: "",
    findProgress: { active: false, done: 0, total: 0 },
    cartAddProgress: { active: false, done: 0, total: 0 },
    cartProgress: { active: false, done: 0, total: 0 },
    panelOpen: false,
    restoreNotice: false,
    restoreExpired: false,
    confirmDialog: null,
  };

  let host = null;
  let shadow = null;
  let elements = {};

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "WEBIKE_CART_SPLITTER_TOGGLE") {
      void togglePanel();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "WEBIKE_CART_SPLITTER_OPEN") {
      void openPanel();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  restoreSavedState();
  if (state.panelOpen) void mountPanel();
