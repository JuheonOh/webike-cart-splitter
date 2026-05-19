const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const fixtureDir = path.join(projectRoot, "tests", "fixtures", "extension");

function runSource(relativePath, prefix, exportsSource) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const sandbox = {
    __copied: "",
    module: { exports: {} },
    URL,
    URLSearchParams,
    location: { origin: "https://www.japan-webike.kr", pathname: "/shopping_cart.html" },
    HTMLElement: class HTMLElement {},
  };
  sandbox.navigator = {
    clipboard: {
      writeText(text) {
        sandbox.__copied = text;
        return Promise.resolve();
      },
    },
  };
  vm.runInNewContext(`${prefix}\n${source}\n${exportsSource}`, sandbox);
  return sandbox.module.exports;
}

const commonPrefix = `
  const SEARCH_ENDPOINT = "/api-search-es.html";
  const CART_PAGE_PATH = "/shopping_cart.html";
  const CART_ENDPOINT = "/api_shopping_cart.html?action=add_product&ajax_action=1";
  const ROOT_ID = "webike-cart-splitter-extension-root";
  function cleanText(value) {
    return String(value == null ? "" : value).replace(/\\s+/g, " ").trim();
  }
  function toNumber(value) {
    return Number(String(value == null ? "" : value).replace(/,/g, "").trim()) || 0;
  }
  function normalizePartNumber(value) {
    return cleanText(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }
  function csvCell(value) {
    const text = String(value == null ? "" : value);
    return /[",\\n]/.test(text) ? \`"\${text.replace(/"/g, '""')}"\` : text;
  }
`;

{
  const helpers = runSource(
    "src/extension/content/webike-product.js",
    commonPrefix,
    `module.exports = { buildSearchApiUrl, buildSearchPageUrl, productCandidatesFromText, isUsedProductUrl, candidateDisplayName };`,
  );

  assert.strictEqual(
    helpers.buildSearchPageUrl("13225ML0405"),
    "https://www.japan-webike.kr/ps/13225ML0405/#!search&p.k=13225ML0405",
  );
  assert.strictEqual(
    helpers.buildSearchApiUrl("13225ML0405"),
    "/api-search-es.html?search=&p.k=13225ML0405&p.ref=product-search-es&smp=sp",
  );

  const searchText = fs.readFileSync(path.join(fixtureDir, "search-text.txt"), "utf8");
  const candidates = helpers.productCandidatesFromText(searchText);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].url, "https://www.japan-webike.kr/products/25681390.html");
  assert(candidates[0].displayName.includes("13225ML0405"));
  assert.strictEqual(helpers.isUsedProductUrl("https://www.japan-webike.kr/products/2032376822.html"), true);
  assert.strictEqual(helpers.isUsedProductUrl("https://www.japan-webike.kr/products/25681390.html"), false);
}

async function testCopyFailedRows() {
  const helpers = runSource(
    "src/extension/content/cart-actions.js",
    `${commonPrefix}
      const state = {
        busy: false,
        results: [
          {
            status: "need_review",
            partNumber: "13225ML0405",
            quantity: 2,
            name: "앞바퀴베어링",
            resolvedProductUrl: "https://www.japan-webike.kr/products/25681390.html",
            reason: "후보가 여러 개라 직접 선택이 필요합니다.",
            searchUrl: "https://www.japan-webike.kr/ps/13225ML0405/#!search&p.k=13225ML0405"
          }
        ]
      };
      function reviewItems() {
        return state.results.filter((item) => ["need_review", "cart_failed"].includes(item.status));
      }
      function setMessage(type, text) {
        state.message = { type, text };
      }
      function render() {}
      function persistState() {}
      function setBusy() {}
      function beginCartAddProgress() {}
      function advanceCartAddProgress() {}
      function finishCartAddProgress() {}
      function isAddableCartItem() { return false; }
      function addToCart() {}
      function classifyCartError() { return ""; }
      function openCartPage() {}
      function isCartClearActionLocked() { return false; }
      function setCartClearActionLocked() {}
      function releaseCartClearActionLockSoon() {}
      function isLikelyCartPage() { return true; }
      function detectCartItems() { return []; }
      function requestPanelConfirm() { return Promise.resolve(false); }
      function beginCartProgress() {}
      function removeCartItemsByUrl() { return { removed: 0, failures: [] }; }
      function advanceCartProgress() {}
      function finishCartProgress() {}
      function delay() { return Promise.resolve(); }
      const location = { origin: "https://www.japan-webike.kr", assign() {}, reload() {} };
    `,
    `module.exports = { copyFailedRows, getCopied: () => __copied };`,
  );

  await helpers.copyFailedRows();
  const copiedCsv = helpers.getCopied();
  assert(copiedCsv.startsWith("부품번호,수량,부품명,상품URL,사유,검색URL"));
  assert(copiedCsv.includes("13225ML0405,2"));
  assert(copiedCsv.includes("https://www.japan-webike.kr/products/25681390.html"));
}

{
  const cartHelpers = runSource(
    "src/extension/content/cart-page.js",
    `${commonPrefix}
      function advanceCartProgress() {}
      function delay() { return Promise.resolve(); }
    `,
    `module.exports = { removeUrlFromControl, cartItemLabel, HTMLElement };`,
  );

  class FakeElement extends cartHelpers.HTMLElement {
    constructor({ textContent = "", dataset = {}, attributes = {}, className = "", id = "" } = {}) {
      super();
      this.textContent = textContent;
      this.dataset = dataset;
      this.attributes = attributes;
      this.className = className;
      this.id = id;
      this.disabled = false;
      this.offsetParent = {};
    }
    getAttribute(name) {
      return this.attributes[name] || "";
    }
    querySelector(selector) {
      if (selector.includes(".product-code")) return new FakeElement({ textContent: "상품 번호: 11632MY7000" });
      return null;
    }
  }

  const cartFixture = fs.readFileSync(path.join(fixtureDir, "cart-row.html"), "utf8");
  const removeUrl = (cartFixture.match(/data-href="([^"]+)"/) || [])[1].replace(/&amp;/g, "&");
  const control = new FakeElement({ dataset: { href: removeUrl } });
  assert.strictEqual(
    cartHelpers.removeUrlFromControl(control),
    "https://www.japan-webike.kr/shopping_cart.html?product_id=24439713&action=remove_product",
  );
  assert.strictEqual(cartHelpers.cartItemLabel(new FakeElement({ dataset: { sku: "24439713" } }), 0), "24439713");
}

testCopyFailedRows()
  .then(() => {
    console.log("extension webike helper tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
