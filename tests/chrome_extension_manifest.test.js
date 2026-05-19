const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(projectRoot, "src", "extension");
const manifestPath = path.join(sourceDir, "manifest.json");
const buildScriptPath = path.join(projectRoot, "scripts", "build-extension.js");
const serviceWorkerPath = path.join(sourceDir, "service-worker.js");
const contentSourceDir = path.join(sourceDir, "content");
const styleSourceDir = path.join(sourceDir, "styles", "content");
const fontPath = path.join(sourceDir, "fonts", "D2Coding.woff2");
const iconPaths = [16, 32, 48, 128].map((size) => path.join(sourceDir, "icons", `icon${size}.png`));

const contentScriptFiles = [
  "00-bootstrap.js",
  "panel.js",
  "find-parts.js",
  "cart-actions.js",
  "renderer.js",
  "progress-state.js",
  "cart-page.js",
  "input-parser.js",
  "webike-product.js",
  "errors-utils.js",
];

const contentStyleFiles = [
  "00-base.css",
  "10-layout.css",
  "20-buttons.css",
  "30-feedback.css",
  "40-cards.css",
  "90-responsive.css",
];

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const buildScript = fs.readFileSync(buildScriptPath, "utf8");
const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
const contentScript = contentScriptFiles
  .map((fileName) => fs.readFileSync(path.join(contentSourceDir, fileName), "utf8"))
  .join("\n\n");
const contentStyle = contentStyleFiles
  .map((fileName) => fs.readFileSync(path.join(styleSourceDir, fileName), "utf8"))
  .join("\n\n");

assert.strictEqual(manifest.manifest_version, 3);
assert.strictEqual(manifest.name, "위바이크 장바구니 자동화");
assert.strictEqual(manifest.action.default_title, "위바이크 장바구니 자동화");
assert.strictEqual(manifest.background.service_worker, "extension/service-worker.js");
assert.deepStrictEqual(manifest.permissions, ["activeTab", "scripting"]);
assert.deepStrictEqual(manifest.host_permissions, ["https://www.japan-webike.kr/*"]);
assert.deepStrictEqual(manifest.content_scripts[0].matches, ["https://www.japan-webike.kr/*"]);
assert.deepStrictEqual(manifest.content_scripts[0].js, ["extension/content-script.js"]);
assert.strictEqual(manifest.content_scripts[0].run_at, "document_idle");
assert.strictEqual(manifest.icons["16"], "extension/icons/icon16.png");
assert.strictEqual(manifest.icons["32"], "extension/icons/icon32.png");
assert.strictEqual(manifest.icons["48"], "extension/icons/icon48.png");
assert.strictEqual(manifest.icons["128"], "extension/icons/icon128.png");
assert.strictEqual(manifest.action.default_icon["16"], "extension/icons/icon16.png");
assert.strictEqual(manifest.action.default_icon["32"], "extension/icons/icon32.png");
assert.strictEqual(manifest.action.default_icon["48"], "extension/icons/icon48.png");
assert.strictEqual(manifest.action.default_icon["128"], "extension/icons/icon128.png");
assert(manifest.web_accessible_resources[0].resources.includes("extension/content-style.css"));
assert(manifest.web_accessible_resources[0].resources.includes("extension/fonts/D2Coding.woff2"));

assert(fs.existsSync(serviceWorkerPath), "extension service worker must exist");
assert(fs.existsSync(fontPath), "D2Coding font must exist");
iconPaths.forEach((iconPath) => {
  assert(fs.existsSync(iconPath), `${path.basename(iconPath)} must exist`);
  assert.strictEqual(fs.readFileSync(iconPath).subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path.basename(iconPath)} must be a PNG`);
});
[16, 32, 48, 128].forEach((size) => {
  assert(buildScript.includes(`icon${size}.png`), `build script must copy icon${size}.png`);
});
assert(!buildScript.includes("icon.svg"), "build script must not copy SVG manifest icons");
contentScriptFiles.forEach((fileName) => {
  assert(fs.existsSync(path.join(contentSourceDir, fileName)), `${fileName} must exist`);
});
contentStyleFiles.forEach((fileName) => {
  assert(fs.existsSync(path.join(styleSourceDir, fileName)), `${fileName} must exist`);
});

[
  "chrome.action.onClicked.addListener",
  "chrome.scripting.executeScript",
  "chrome.tabs.sendMessage",
  "WEBIKE_CART_SPLITTER_OPEN",
].forEach((needle) => assert(serviceWorker.includes(needle), `service worker must include ${needle}`));

[
  "attachShadow",
  "requestPanelConfirm",
  "STORAGE_TTL_MS",
  "savedStateExpired",
  "resolvedProductUrl",
  "FIND_PARTS_CONCURRENCY = 4",
  "resolveRowsInChunks(state.results)",
  "copyFailedRows",
  "detectCartItems",
  "removeUrlFromControl",
  "productCandidatesFromText",
  "isUsedProductScope",
  "function displayPartLabel",
  "[부품번호],[수량],부품명",
  "16016MAS670,1,파일럿스크류",
  "중복 부품은 수량을 합산했습니다.",
  '"부품번호", "수량", "부품명", "상품URL", "사유", "검색URL"',
].forEach((needle) => assert(contentScript.includes(needle), `content script must include ${needle}`));

[
  "window.confirm",
  'data-action="scan-cart"',
  "장바구니 확인",
  'data-role="direct-url"',
  '"apply-url"',
  "상품 URL 직접 입력",
  "part_number,quantity,name,product_url",
  "부품번호 또는 상품 URL",
].forEach((needle) => assert(!contentScript.includes(needle), `content script must not include ${needle}`));

assert(
  contentScript.indexOf('<h2 class="wcs-section-title">못 찾은 부품</h2>') <
    contentScript.indexOf('<h2 class="wcs-section-title">찾은 부품</h2>'),
);

[
  "@font-face",
  "D2Coding.woff2",
  ".wcs-button.cart-ready",
  "@keyframes wcs-cart-nudge",
  ".wcs-confirm",
  ".wcs-failure-list",
  ".wcs-spinner",
  ".wcs-restore",
  ".wcs-summary-badges",
].forEach((needle) => assert(contentStyle.includes(needle), `content style must include ${needle}`));

[
  ".wcs-url-input",
  ".wcs-url-row",
].forEach((needle) => assert(!contentStyle.includes(needle), `content style must not include ${needle}`));
