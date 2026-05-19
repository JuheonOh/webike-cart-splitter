const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const panelSource = fs.readFileSync(path.join(projectRoot, "src", "extension", "content", "panel.js"), "utf8");

const sandbox = {
  module: { exports: {} },
  Date,
};

vm.runInNewContext(`
  const REQUIRED_HOST = "www.japan-webike.kr";
  const ROOT_ID = "webike-cart-splitter-extension-root";
  const STYLE_PATH = "extension/content-style.css";
  const STORAGE_KEY = "webike-cart-splitter-extension-state-v1";
  const STORAGE_TTL_MS = 24 * 60 * 60 * 1000;
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

  function cleanText(value) {
    return String(value == null ? "" : value).replace(/\\s+/g, " ").trim();
  }
  function cleanMessageText(value) {
    return cleanText(value);
  }
  function restoreCartSummary(value) {
    return value;
  }
  const localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
  const location = { hostname: REQUIRED_HOST };
  const chrome = { runtime: { getURL(value) { return value; } } };

  function render() {}
  function renderActions() {}
  function renderConfirmDialog() {}
  function setMessage() {}
  function findPartsFromInput() {}
  function addResolvedItemsToCart() {}
  function copyFailedRows() {}
  function openCartPage() {}
  function clearCartPage() {}
  function retryRow() {}
  function ignoreRow() {}
  function chooseCandidate() {}
  function restoreSavedStateOverride() {}

  ${panelSource}

  module.exports = {
    savedStateExpired,
    normalizeSavedResult,
  };
`, sandbox);

const { savedStateExpired, normalizeSavedResult } = sandbox.module.exports;

assert.strictEqual(savedStateExpired({ savedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }), true);
assert.strictEqual(savedStateExpired({ savedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }), false);
assert.strictEqual(savedStateExpired({}), false);

const normalized = normalizeSavedResult({
  partNumber: "13225ML0405",
  productUrl: "https://www.japan-webike.kr/products/25681390.html",
});

assert.strictEqual(normalized.resolvedProductUrl, "https://www.japan-webike.kr/products/25681390.html");
assert.strictEqual(Object.hasOwn(normalized, "productUrl"), false);

console.log("extension state tests passed");
