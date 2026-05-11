const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright가 설치되어 있지 않습니다. npm install 후 다시 실행하세요.");
  process.exit(1);
}

async function main() {
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
    await page.goto(pathToFileURL(path.join(__dirname, "..", "cart_group_calculator.html")).href);
    await page.click("input[name='inputMode'][value='manual']");
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
    assert.strictEqual(
      await page.$eval("input[name='inputMode'][value='manual']", (element) => element.checked),
      true,
    );

    await page.click("#analyzeButton");
    await page.waitForSelector('[data-action="copy-group-cart-script"]');

    assert.strictEqual(await page.$$eval(".group-checks", (elements) => elements.length), 1);
    assert.strictEqual(await page.$eval("#productEditDirtyNotice", (element) => element.hidden), true);

    await page.click('[data-action="copy-group-cart-script"]');
    await page.waitForFunction(() => window.__webikeCopiedText?.includes('"partNumber": "E2E-001"'));
    assert.strictEqual(await page.$eval(".group-script-copied", (element) => element.checked), true);

    await page.fill(".result-product-quantity", "3");
    assert.strictEqual(await page.$eval("#productEditDirtyNotice", (element) => element.hidden), false);
    assert.strictEqual(await page.$eval('[data-action="copy-group-cart-script"]', (element) => element.disabled), true);
  } finally {
    await browser.close();
  }
}

main().then(() => {
  console.log("cart_group_calculator e2e tests passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
