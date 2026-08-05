const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright가 설치되어 있지 않습니다. npm install 후 다시 실행하세요.");
  process.exit(1);
}

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const styleguideSections = [
  "layout",
  "panel",
  "form",
  "buttons",
  "table",
  "badge",
  "metric",
  "status",
  "empty",
  "dirty",
  "next-action",
  "calculator-initial",
  "calculator-manual",
  "calculator-analyzed",
  "calculator-dirty-disabled",
  "wizard-steps-1-5",
  "wizard-status",
  "wizard-script",
  "wizard-preview",
  "wizard-comparison",
  "wizard-cart-group-states",
];

function contentType(filePath) {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(distDir, relativePath);
    const containedPath = path.relative(distDir, filePath);

    if (!containedPath || containedPath.startsWith("..") || path.isAbsolute(containedPath)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, contents) => {
      if (error) {
        response.writeHead(404).end("Not found");
        return;
      }

      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(contents);
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function assertPublicUrl(page, baseUrl, pathname) {
  const response = await page.goto(`${baseUrl}${pathname}`);
  assert.ok(response && response.ok(), `${pathname} should load from dist`);
}

async function assertPublicNav(page, currentPath) {
  await page.waitForSelector("[data-public-nav]");
  assert.strictEqual(
    await page.$$eval("[data-public-nav] a", (links) => links.some((link) => {
      const href = new URL(link.getAttribute("href"), window.location.href).pathname;
      return href.endsWith("/styleguide.html") || href.endsWith("styleguide.html");
    })),
    false,
    "public nav should not expose styleguide",
  );
  assert.ok(
    await page.$eval(
      "[data-public-nav] [data-nav-link][aria-current='page']",
      (link, expectedPath) => {
        const pathname = new URL(link.getAttribute("href"), window.location.href).pathname;
        if (expectedPath === "/") return pathname === "/" || pathname.endsWith("/index.html");
        return pathname.endsWith(`/${expectedPath}`) || pathname.endsWith(expectedPath);
      },
      currentPath,
    ),
    `${currentPath} nav link should be current`,
  );
}

async function testPublicUrlsAndNav(page, baseUrl) {
  await assertPublicUrl(page, baseUrl, "/");
  await assertPublicNav(page, "/");

  await assertPublicUrl(page, baseUrl, "/cart_group_calculator.html");
  await assertPublicNav(page, "cart_group_calculator.html");

  await assertPublicUrl(page, baseUrl, "/webike_quote_wizard.html");
  await assertPublicNav(page, "webike_quote_wizard.html");
}

async function testCalculatorManualFlow(page, baseUrl) {
  await page.goto(`${baseUrl}/cart_group_calculator.html`);
  await page.waitForSelector('[data-production-component="calculator-bridge"] [data-production-component="calculator-state"][data-state="initial"]');
  const fallbackTextareaCleaned = await page.evaluate(async () => {
    const originalClipboard = navigator.clipboard;
    const originalExecCommand = document.execCommand;
    const countFallbackTextareas = () => document.querySelectorAll('textarea[readonly][style*="-9999px"]').length;
    const before = countFallbackTextareas();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = () => { throw new Error("copy failed"); };
    try {
      await copyTextToClipboard("copy should clean up");
    } catch {
      // Expected: the fallback must still remove its temporary textarea.
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
      document.execCommand = originalExecCommand;
    }
    return countFallbackTextareas() === before;
  });
  assert.strictEqual(fallbackTextareaCleaned, true);
  await page.click("input[name='inputMode'][value='manual']");
  await page.waitForSelector('[data-production-component="calculator-state"][data-state="manual"]');
  await page.fill(
    "#bulkPasteInput",
    [
      "상품번호\t상품명\t수량\t단가JPY",
      "E2E-001\tE2E URL Item\t2\t1500",
      "E2E-002\tE2E Plain Item\t1\t2500",
    ].join("\n"),
  );
  await page.click("#applyBulkPasteButton");
  await page.waitForFunction(() => document.querySelectorAll("#manualRows tr").length === 2);

  assert.strictEqual(await page.$eval(".manual-code", (element) => element.value), "E2E-001");
  assert.strictEqual(await page.$eval("input[name='inputMode'][value='manual']", (element) => element.checked), true);

  await page.click("#analyzeButton");
  await page.waitForSelector('[data-action="copy-group-cart-script"]');
  await page.waitForSelector('[data-production-component="calculator-state"][data-state="analyzed"]');
  assert.strictEqual(await page.$eval('[data-production-component="calculator-state"][data-state="analyzed"]', (element) => element.textContent.includes("USD 123.40")), false);
  assert.ok(await page.$eval('[data-production-component="calculator-state"][data-state="analyzed"]', (element) => element.textContent.includes("분석 완료")));

  assert.strictEqual(await page.$$eval(".group-checks", (elements) => elements.length), 1);
  assert.strictEqual(await page.$eval("#productEditDirtyNotice", (element) => element.hidden), true);

  await page.click('[data-action="copy-group-cart-script"]');
  await page.waitForFunction(() => window.__webikeCopiedText?.includes('"partNumber": "E2E-001"'));
  assert.strictEqual(await page.$eval(".group-script-copied", (element) => element.checked), true);

  await page.fill(".result-product-quantity", "3");
  assert.strictEqual(await page.$eval("#productEditDirtyNotice", (element) => element.hidden), false);
  assert.strictEqual(await page.$eval('[data-action="copy-group-cart-script"]', (element) => element.disabled), true);
  await page.waitForSelector('[data-production-component="calculator-state"][data-state="dirty-disabled"]');

  await page.fill(".manual-quantity", "1001");
  await page.click("#analyzeButton");
  assert.ok(await page.$eval("#errorBox", (element) => element.textContent.includes("1000 이하여야")));
  assert.strictEqual(await page.$eval("#exportXlsxButton", (button) => button.disabled), true);
}

async function testCalculatorDraftRestoreAndCorruption(page, baseUrl) {
  await page.goto(`${baseUrl}/cart_group_calculator.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click("input[name='inputMode'][value='manual']");
  await page.fill(
    "#bulkPasteInput",
    [
      "상품번호\t상품명\t수량\t단가JPY",
      "DRAFT-001\tDraft item\t2\t1800",
    ].join("\n"),
  );
  await page.click("#applyBulkPasteButton");
  await page.click("#analyzeButton");
  await page.waitForSelector('[data-production-component="calculator-state"][data-state="analyzed"]');
  await page.fill(".result-product-quantity", "3");
  await page.waitForFunction(() => {
    const draft = JSON.parse(localStorage.getItem("webike-cart-splitter-draft-v1") || "null");
    return draft?.analysis?.dirtyProductRows?.some((row) => row.quantity === "3");
  });

  await page.reload();
  await page.waitForSelector('[data-production-component="calculator-state"][data-state="dirty-disabled"]');
  assert.strictEqual(await page.$eval(".result-product-quantity", (input) => input.value), "3");
  assert.strictEqual(await page.$eval("#productEditDirtyNotice", (element) => element.hidden), false);
  assert.strictEqual(await page.$eval('[data-action="copy-group-cart-script"]', (element) => element.disabled), true);

  await page.evaluate(() => localStorage.setItem("webike-cart-splitter-draft-v1", "{broken-json"));
  await page.reload();
  await page.waitForSelector('[data-production-component="calculator-state"][data-state="initial"]');
  assert.strictEqual(await page.$eval("#errorBox", (element) => getComputedStyle(element).display), "none");
  assert.strictEqual(await page.$eval("#errorBox", (element) => element.textContent), "");
  assert.strictEqual(await page.$$eval("#manualRows tr", (rows) => rows.length), 1);
  assert.strictEqual(await page.$eval(".manual-code", (input) => input.value), "");
}

async function testTaxableGroupsFirst(page, baseUrl) {
  await page.goto(`${baseUrl}/cart_group_calculator.html`);
  await page.click("input[name='inputMode'][value='manual']");
  await page.fill(
    "#bulkPasteInput",
    [
      "상품번호\t상품명\t수량\t단가JPY",
      "TAX-001\tTaxable item\t1\t30000",
      "DUTYFREE-001\tDuty-free item\t1\t1000",
    ].join("\n"),
  );
  await page.click("#applyBulkPasteButton");
  await page.click("#analyzeButton");
  await page.waitForFunction(() => document.querySelectorAll(".group-card").length === 2);

  const groupTexts = await page.$$eval(".group-card", (cards) => cards.map((card) => card.textContent));
  assert.ok(groupTexts[0].includes("TAX-001"));
  assert.ok(groupTexts[0].includes("과세 예상"));
  assert.ok(groupTexts[1].includes("DUTYFREE-001"));
  assert.strictEqual(await page.$eval("#exportCsvZipButton", (button) => button.disabled), false);

  await page.click('[data-action="copy-group-cart-script"]');
  await page.waitForFunction(() => window.__webikeCopiedText?.includes('"partNumber": "TAX-001"'));
}

async function testWizardCartHtmlInput(page, baseUrl) {
  const cartHtml = fs.readFileSync(
    path.join(rootDir, "tests", "fixtures", "webike-cart", "table-cart-current.html"),
    "utf8",
  );

  await page.goto(`${baseUrl}/webike_quote_wizard.html#step-1`);
  await page.waitForFunction(() => !document.querySelector("#wizardExchangeRateSource").textContent.includes("확인하는 중"));
  assert.strictEqual(await page.$eval("#delimitedTab", (tab) => tab.getAttribute("aria-selected")), "true");
  await page.click("#cartHtmlTab");
  assert.strictEqual(await page.$eval("#cartHtmlTab", (tab) => tab.getAttribute("aria-selected")), "true");
  assert.strictEqual(await page.$eval("#cartHtmlInputPanel", (panel) => panel.hidden), false);
  assert.strictEqual(await page.$eval("#delimitedInputPanel", (panel) => panel.hidden), true);

  await page.fill("#cartHtmlInput", cartHtml);
  await page.click("#parseInputButton");
  await page.waitForSelector('[data-step-panel="2"].active');
  assert.ok(await page.$eval("#inputStatus", (element) => element.textContent.includes("2개 상품")));
  const previewText = await page.$eval("#inputPreview", (element) => element.textContent);
  assert.ok(previewText.includes("13225MY9003"));
  assert.ok(previewText.includes("HONDA OEM Jet, Slow #35"));
  const generatedQuoteScript = await page.evaluate(() => buildQuoteScript());
  assert.ok(generatedQuoteScript.includes('"partNumber": "13225MY9003"'));
  assert.ok(generatedQuoteScript.includes('"quantity": 4'));
  await page.goto(`${baseUrl}/`);
}

async function testWizardStepGating(page, baseUrl) {
  await page.goto(`${baseUrl}/webike_quote_wizard.html#step-1`);
  await page.waitForSelector('[data-production-component="wizard-bridge"] [data-production-component="wizard-state"][data-state="steps"]');
  await page.waitForFunction(() => !document.querySelector("#wizardExchangeRateSource").textContent.includes("확인하는 중"));
  assert.ok(await page.$eval("#wizardExchangeRateSource", (element) => element.textContent.includes("적용기간")));
  await page.waitForSelector('[data-step-panel="1"].active');
  assert.strictEqual(await page.$eval('[data-step-target="2"]', (button) => button.disabled), true);
  assert.strictEqual(await page.$eval('[data-step-target="3"]', (button) => button.disabled), true);
  const fallbackCopyFailsClosed = await page.evaluate(async () => {
    const originalClipboard = navigator.clipboard;
    const originalExecCommand = document.execCommand;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = () => false;
    try {
      await copyText("copy should fail");
      return false;
    } catch {
      return true;
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
      document.execCommand = originalExecCommand;
    }
  });
  assert.strictEqual(fallbackCopyFailsClosed, true);

  await page.fill(
    "#pasteInput",
    "E2E-001,2,E2E Wizard Item,1500,https://www.japan-webike.kr/products/900001.html",
  );
  await page.click("#parseInputButton");
  await page.waitForFunction(() => !document.querySelector('[data-step-target="2"]').disabled);
  assert.ok(await page.$eval("#inputPreview", (box) => box.textContent.includes("E2E Wizard Item")));
  assert.ok(await page.$eval("#inputPreview", (box) => box.textContent.includes("https://www.japan-webike.kr/products/900001.html")));
  await page.waitForSelector('[data-production-component="wizard-state"][data-state="script"]');
  assert.strictEqual(await page.$eval('[data-step-target="3"]', (button) => button.disabled), false);
  const generatedQuoteScript = await page.evaluate(() => buildQuoteScript());
  assert.doesNotThrow(() => new Function(generatedQuoteScript));
  assert.ok(generatedQuoteScript.includes("recommendationOrderGroups"));
  assert.ok(generatedQuoteScript.includes("orderGroupCount"));
  await page.fill("#maxGroups", "21");
  await page.dispatchEvent("#maxGroups", "change");
  assert.strictEqual(await page.$eval("#copyQuoteScriptButton", (button) => button.disabled), true);
  assert.ok(await page.$eval("#quoteScriptStatus", (element) => element.textContent.includes("1~20")));
  await page.fill("#maxGroups", "8");
  await page.dispatchEvent("#maxGroups", "change");
  assert.strictEqual(await page.$eval("#copyQuoteScriptButton", (button) => button.disabled), false);
  const validJpyRate = await page.inputValue("#jpyKrw");
  await page.fill("#jpyKrw", "-1");
  await page.dispatchEvent("#jpyKrw", "change");
  assert.strictEqual(await page.$eval("#copyQuoteScriptButton", (button) => button.disabled), true);
  assert.ok(await page.$eval("#quoteScriptStatus", (element) => element.textContent.includes("환율 값을 확인")));
  await page.fill("#jpyKrw", validJpyRate);
  await page.dispatchEvent("#jpyKrw", "change");
  assert.strictEqual(await page.$eval("#copyQuoteScriptButton", (button) => button.disabled), false);

  await page.click('[data-step-target="2"]');
  await page.waitForSelector('[data-step-panel="2"].active');
  assert.strictEqual(await page.$eval("#copyQuoteScriptButton", (button) => button.disabled), false);
  const currentWizardSettings = await page.evaluate(() => getSettings());
  const validQuoteResult = {
    source: "webike-cart-splitter-wizard",
    schemaVersion: 1,
    status: "measured",
    settings: currentWizardSettings,
    products: [{
      index: 0,
      code: "E2E-001",
      productId: "900001",
      productUrl: "https://www.japan-webike.kr/products/900001.html",
      name: "E2E Wizard Item",
      quantity: 2,
      unitJpy: 1500,
      totalJpy: 3000,
    }],
    measurement: {
      singleShipment: {
        label: "한 번에 주문",
        productJpy: 3000,
        shippingJpy: 1200,
        products: [{ index: 0, code: "E2E-001", productId: "900001", name: "E2E Wizard Item", quantity: 2, unitJpy: 1500, totalJpy: 3000 }],
      },
      strategies: {
        split_quantity: {
          recommendationSummary: { totalJpy: 3000, groupCount: 1, oversizeCount: 0, taxableGroupCount: 0, orderGroupCount: 1 },
          splitShipments: [],
          splitUnavailableReason: "전체 상품가가 면세 기준 안이라 분할 주문이 필요하지 않습니다.",
        },
        row_unit: {
          recommendationSummary: { totalJpy: 3000, groupCount: 1, oversizeCount: 0, taxableGroupCount: 0, orderGroupCount: 1 },
          splitShipments: [],
          splitUnavailableReason: "전체 상품가가 면세 기준 안이라 분할 주문이 필요하지 않습니다.",
        },
      },
    },
    automationResults: [],
  };
  await page.click('[data-step-target="3"]');
  await page.fill("#quoteResultInput", JSON.stringify(validQuoteResult));
  await page.click("#applyQuoteResultButton");
  await page.waitForSelector("#quoteResultNextAction:not(.hidden)");
  assert.strictEqual(await page.$eval('[data-step-target="4"]', (button) => button.disabled), false);
  await page.waitForSelector('[data-production-component="wizard-state"][data-state="preview"]');
  await page.click("#goComparisonButton");
  await page.waitForSelector('[data-production-component="wizard-state"][data-state="comparison"]');
  await page.click("#goCartScriptsButton");
  await page.waitForSelector('[data-production-component="wizard-state"][data-state="cart-group"]');
  assert.strictEqual(await page.$eval('[data-production-component="wizard-state"][data-state="cart-group"]', (element) => element.textContent.includes("231,000원")), false);
  assert.strictEqual(await page.$eval('[data-production-component="wizard-state"][data-state="cart-group"]', (element) => element.textContent.includes("분할 추천")), false);
  await page.click("[data-copy-cart-script]");
  await page.waitForFunction(() => window.__webikeCopiedText?.includes('"productsId": "900001"'));
  assert.strictEqual(await page.evaluate(() => window.__webikeCopiedText.includes("const items = [];")), false);

  await page.selectOption("#shippingService", "SEA");
  assert.strictEqual(await page.$eval('[data-step-target="4"]', (button) => button.disabled), true);
  assert.strictEqual(await page.$eval('[data-step-target="5"]', (button) => button.disabled), true);
  assert.ok(await page.$eval("#comparisonArea", (element) => element.textContent.includes("먼저 견적 결과")));
  assert.ok(await page.$eval("#cartScriptArea", (element) => element.textContent.includes("추천 그룹이 없습니다")));
  await page.selectOption("#shippingService", "STD");

  await page.click('[data-step-target="3"]');
  await page.waitForSelector('[data-step-panel="3"].active');
  await page.fill("#quoteResultInput", JSON.stringify(validQuoteResult));
  await page.click("#applyQuoteResultButton");
  assert.strictEqual(await page.$eval('[data-step-target="4"]', (button) => button.disabled), false);
  await page.fill("#quoteResultInput", JSON.stringify({
    source: "webike-cart-splitter-wizard",
    schemaVersion: 1,
    status: "failed",
    products: [],
    automationResults: [{
      rowIndex: 1,
      partNumber: "E2E-001",
      productUrl: "https://example.com/item/E2E-001",
      status: "failed",
      errors: ["상품 상세 확인 실패"],
    }],
  }));
  await page.click("#applyQuoteResultButton");
  assert.ok(await page.$eval("#quoteResultStatus", (element) => element.textContent.includes("견적이 완료되지 않았습니다")));
  assert.ok(await page.$eval("#quoteResultPreview", (element) => element.textContent.includes("상품 상세 확인 실패")));
  assert.strictEqual(await page.$eval('[data-step-target="4"]', (button) => button.disabled), true);

  await page.fill("#quoteResultInput", JSON.stringify(validQuoteResult));
  await page.click("#applyQuoteResultButton");
  assert.strictEqual(await page.$eval('[data-step-target="4"]', (button) => button.disabled), false);
  await page.fill("#quoteResultInput", JSON.stringify({
    source: "webike-cart-splitter-wizard",
    schemaVersion: 1,
    status: "failed",
    products: [],
    automationResults: {},
  }));
  await page.click("#applyQuoteResultButton");
  assert.ok(await page.$eval("#quoteResultStatus", (element) => element.textContent.includes("자동화 결과")));
  assert.strictEqual(await page.$eval('[data-step-target="4"]', (button) => button.disabled), true);
  assert.strictEqual(await page.$eval('[data-step-target="5"]', (button) => button.disabled), true);
  assert.ok(await page.$eval("#comparisonArea", (element) => element.textContent.includes("먼저 견적 결과")));

  const missingProductIdResult = structuredClone(validQuoteResult);
  missingProductIdResult.products[0].productId = "";
  await page.fill("#quoteResultInput", JSON.stringify(missingProductIdResult));
  await page.click("#applyQuoteResultButton");
  assert.ok(await page.$eval("#quoteResultStatus", (element) => element.textContent.includes("상품 ID")));
  assert.strictEqual(await page.$eval('[data-step-target="4"]', (button) => button.disabled), true);
  assert.strictEqual(await page.$eval('[data-step-target="5"]', (button) => button.disabled), true);

  await page.fill("#quoteResultInput", "{ invalid json");
  await page.click("#applyQuoteResultButton");
  assert.ok(await page.$eval("#quoteResultStatus", (element) => element.textContent.includes("JSON 형식")));
  assert.strictEqual(await page.$eval('[data-step-target="4"]', (button) => button.disabled), true);
  assert.ok(await page.$eval("#comparisonArea", (element) => element.textContent.includes("먼저 견적 결과")));
  await page.click('[data-step-target="1"]');
  await page.fill("#pasteInput", "E2E-002,0,Invalid Quantity,1500,https://example.com/item/E2E-002");
  await page.click("#parseInputButton");
  await page.waitForSelector('[data-step-panel="1"].active');
  assert.ok(await page.$eval("#inputStatus", (element) => element.textContent.includes("수량은 1 이상")));
  assert.strictEqual(await page.$eval('[data-step-target="2"]', (button) => button.disabled), true);
  assert.strictEqual(await page.$eval("#copyQuoteScriptButton", (button) => button.disabled), true);
  assert.strictEqual(await page.$eval("#quoteScriptNextAction", (element) => element.classList.contains("hidden")), true);

  await page.fill("#pasteInput", "E2E-003,1001,Excessive Quantity,1500,https://example.com/item/E2E-003");
  await page.click("#parseInputButton");
  assert.ok(await page.$eval("#inputStatus", (element) => element.textContent.includes("1000 이하여야")));
  assert.strictEqual(await page.$eval('[data-step-target="2"]', (button) => button.disabled), true);
}

async function testWizardHashHistoryAndLockedStep(page, baseUrl) {
  await page.goto(`${baseUrl}/webike_quote_wizard.html#step-5`);
  await page.waitForSelector('[data-production-component="wizard-bridge"] [data-production-component="wizard-state"][data-state="steps"]');
  await page.waitForSelector('[data-step-panel="1"].active');
  assert.strictEqual(await page.evaluate(() => window.location.hash), "#step-1");
  assert.strictEqual(await page.$eval('[data-step-target="5"]', (button) => button.disabled), true);

  await page.fill("#pasteInput", "HASH-001,1,Hash item,1200,https://www.japan-webike.kr/products/920001.html");
  await page.click("#parseInputButton");
  await page.waitForFunction(() => !document.querySelector('[data-step-target="2"]').disabled);
  await page.click('[data-step-target="2"]');
  await page.waitForSelector('[data-step-panel="2"].active');
  assert.strictEqual(await page.evaluate(() => window.location.hash), "#step-2");

  await page.goBack();
  await page.waitForSelector('[data-step-panel="1"].active');
  assert.strictEqual(await page.evaluate(() => window.location.hash), "#step-1");
  await page.goForward();
  await page.waitForSelector('[data-step-panel="2"].active');
  assert.strictEqual(await page.evaluate(() => window.location.hash), "#step-2");
}

async function testWizardPreviewDoesNotLinkifyUntrustedUrls(page, baseUrl) {
  await page.goto(`${baseUrl}/webike_quote_wizard.html#step-1`);
  await page.fill("#pasteInput", "URL-001,1,URL item,1200,javascript:alert(1)");
  await page.click("#parseInputButton");
  await page.waitForSelector('[data-step-panel="2"].active');
  assert.strictEqual(await page.$$eval("#inputPreview a", (links) => links.length), 0);
}

async function testWizardTaxableFirstPlan(page, baseUrl) {
  await page.goto(`${baseUrl}/webike_quote_wizard.html#step-1`);
  await page.waitForFunction(() => !document.querySelector("#wizardExchangeRateSource").textContent.includes("확인하는 중"));
  await page.fill(
    "#pasteInput",
    [
      "BIG-001,1,Taxable wizard item,30000,https://www.japan-webike.kr/products/910001.html",
      "SMALL-001,1,Duty-free wizard item,1000,https://www.japan-webike.kr/products/910002.html",
    ].join("\n"),
  );
  await page.click("#parseInputButton");
  await page.click('[data-step-target="2"]');
  const settings = await page.evaluate(() => getSettings());
  const quoteProducts = [
    {
      index: 0,
      code: "BIG-001",
      productId: "910001",
      productUrl: "https://www.japan-webike.kr/products/910001.html",
      name: "Taxable wizard item",
      quantity: 1,
      unitJpy: 30000,
      totalJpy: 30000,
    },
    {
      index: 1,
      code: "SMALL-001",
      productId: "910002",
      productUrl: "https://www.japan-webike.kr/products/910002.html",
      name: "Duty-free wizard item",
      quantity: 1,
      unitJpy: 1000,
      totalJpy: 1000,
    },
  ];
  const recommendationSummary = {
    totalJpy: 31000,
    groupCount: 1,
    oversizeCount: 1,
    taxableGroupCount: 1,
    orderGroupCount: 2,
  };
  const quoteResult = {
    source: "webike-cart-splitter-wizard",
    schemaVersion: 1,
    status: "measured",
    settings,
    products: quoteProducts,
    measurement: {
      singleShipment: {
        label: "한 번에 주문",
        productJpy: 31000,
        shippingJpy: 1200,
        products: quoteProducts,
      },
      strategies: {
        split_quantity: {
          recommendationSummary,
          splitShipments: [
            {
              label: "과세 예상 주문 1",
              productJpy: 30000,
              shippingJpy: 1800,
              products: [quoteProducts[0]],
            },
            {
              label: "수량 분할 주문 2",
              productJpy: 1000,
              shippingJpy: 800,
              products: [quoteProducts[1]],
            },
          ],
          splitUnavailableReason: "",
        },
        row_unit: {
          recommendationSummary,
          splitShipments: [
            {
              label: "과세 예상 주문 1",
              productJpy: 30000,
              shippingJpy: 1800,
              products: [quoteProducts[0]],
            },
            {
              label: "행 단위 주문 2",
              productJpy: 1000,
              shippingJpy: 800,
              products: [quoteProducts[1]],
            },
          ],
          splitUnavailableReason: "",
        },
      },
    },
    automationResults: [],
  };
  await page.click('[data-step-target="3"]');
  await page.fill("#quoteResultInput", JSON.stringify(quoteResult));
  await page.click("#applyQuoteResultButton");
  await page.waitForSelector("#quoteResultNextAction:not(.hidden)");
  await page.click("#goComparisonButton");
  await page.waitForSelector("#goCartScriptsButton");
  assert.ok(await page.$eval("#comparisonArea", (element) => element.textContent.includes("과세 예상 우선 주문")));
  assert.ok(await page.$eval("#comparisonArea", (element) => element.textContent.includes("과세 예상 포함")));
  assert.ok(await page.$eval("#comparisonArea", (element) => element.textContent.includes("과세 예상 주문 1")));
  assert.ok(await page.$eval("#comparisonArea", (element) => element.textContent.includes("1,800 JPY")));
  await page.click("#goCartScriptsButton");
  await page.waitForSelector('[data-production-component="wizard-state"][data-state="cart-group"]');
  const cartGroupTexts = await page.$$eval(".group-box", (boxes) => boxes.map((box) => box.textContent));
  assert.strictEqual(cartGroupTexts.length, 2);
  assert.ok(cartGroupTexts[0].includes("BIG-001"));
  assert.ok(cartGroupTexts[1].includes("SMALL-001"));
}

async function testStyleguide(page, baseUrl) {
  await page.goto(`${baseUrl}/styleguide.html`);
  for (const section of styleguideSections) {
    await page.waitForSelector(`[data-styleguide-section="${section}"]`);
  }
  assert.strictEqual(await page.$$eval('[data-production-component="calculator-state"]', (elements) => elements.length >= 4), true);
  assert.strictEqual(await page.$$eval('[data-production-component="wizard-state"]', (elements) => elements.length >= 6), true);
}

async function main() {
  assert.ok(fs.existsSync(distDir), "dist must exist; run npm run build before npm run test:e2e");

  const server = createServer();
  const baseUrl = await listen(server);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__webikeCopiedText = text;
        },
      },
    });
  });

  try {
    await testPublicUrlsAndNav(page, baseUrl);
    await testCalculatorManualFlow(page, baseUrl);
    await testCalculatorDraftRestoreAndCorruption(page, baseUrl);
    await testTaxableGroupsFirst(page, baseUrl);
    await testWizardCartHtmlInput(page, baseUrl);
    await testWizardStepGating(page, baseUrl);
    await testWizardHashHistoryAndLockedStep(page, baseUrl);
    await testWizardPreviewDoesNotLinkifyUntrustedUrls(page, baseUrl);
    await testWizardTaxableFirstPlan(page, baseUrl);
    await testStyleguide(page, baseUrl);
  } finally {
    await browser.close();
    await close(server);
  }
}

main().then(() => {
  console.log("dist e2e tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
