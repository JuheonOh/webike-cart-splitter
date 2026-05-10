const assert = require("assert");
const fs = require("fs");
const path = require("path");

const htmlPath = path.join(__dirname, "..", "cart_group_calculator.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);

assert(scriptMatch, "inline script not found");

const runtimeScript = scriptMatch[1].replace(/\s*clearManualRows\(\);[\s\S]*$/, "");
const api = new Function(`${runtimeScript}
return {
  buildXlsxBytes,
  groupTotals,
  normalizeManualProducts,
  recommendGroups,
  renderGroups,
  renderProducts,
};
`)();

function makeProduct(index, code, name, quantity, unitJpy) {
  return {
    index,
    code,
    name,
    quantity,
    unitJpy,
    totalJpy: quantity * unitJpy,
  };
}

function makeSettings(overrides = {}) {
  const settings = {
    limitUsd: 150,
    usdKrw: 1476.92,
    jpyKrw: 9.272,
    maxGroups: 8,
    splitQuantity: true,
    ...overrides,
  };
  settings.limitJpy = (settings.limitUsd * settings.usdKrw) / settings.jpyKrw;
  return settings;
}

const sampleProducts = [
  makeProduct(0, "13225MY9003", "HONDA OEM BearingB, connecting", 4, 1061),
  makeProduct(1, "13225ML0405", "HONDA OEM BearingB, connecting", 4, 1522),
  makeProduct(2, "99103-MT2-0350", "HONDA OEM Jet, Slow #35", 4, 831),
  makeProduct(3, "91331PC9003", "HONDA OEM O-Ring 21.2X2.4", 1, 209),
  makeProduct(4, "91311MCE900", "HONDA OEM O-ring 47.5X2", 1, 287),
  makeProduct(5, "13011MV4305", "HONDA OEM Ring Set, Piston Std", 4, 5599),
  makeProduct(6, "91310KT8003", "HONDA OEM O-Ring 74.5X2", 1, 615),
  makeProduct(7, "91301147023", "HONDA OEM O-Ring 18.3X2.3", 2, 401),
  makeProduct(8, "91302MB0013", "HONDA OEM O-Ring 32.95X2.62", 1, 293),
  makeProduct(9, "11632MY7000", "HONDA OEM Gasket, Shift Cover", 1, 1508),
  makeProduct(10, "12391MR8000", "HONDA OEM Gasket, Cylinder head", 1, 2933),
];

const settings = makeSettings();
const recommendation = api.recommendGroups(sampleProducts, settings);
const totals = recommendation.groups.map((group) => api.groupTotals(group, settings).totalJpy);

assert.strictEqual(recommendation.totalJpy, 42699);
assert.strictEqual(Math.floor(settings.limitJpy), 23893);
assert.strictEqual(recommendation.groups.length, 2);
assert.deepStrictEqual(totals, [21350, 21349]);

const xlsxBytes = api.buildXlsxBytes(sampleProducts, recommendation, settings);
assert(xlsxBytes instanceof Uint8Array, "xlsx output must be bytes");
assert(xlsxBytes.length > 1000, "xlsx output is unexpectedly small");
assert.deepStrictEqual([...xlsxBytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

const unsafeProducts = [
  makeProduct(0, "<img src=x onerror=alert(1)>", "<script>alert(1)</script>", 1, 100),
];
const productHtml = api.renderProducts(unsafeProducts);
assert(!productHtml.includes("<script>"), "product name must not render as raw HTML");
assert(productHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));

const oversizeRecommendation = api.recommendGroups(unsafeProducts, makeSettings({ limitUsd: 1 }));
const oversizeHtml = api.renderGroups(oversizeRecommendation, makeSettings({ limitUsd: 1 }));
assert(!oversizeHtml.includes("<img"), "oversize product code must not render as raw HTML");
assert(oversizeHtml.includes("&lt;img src=x onerror=alert(1)&gt;"));

const manualResult = api.normalizeManualProducts([
  { code: "A-001", name: "Manual Item", quantity: "2", unitJpy: "1500" },
  { code: "", name: "", quantity: "", unitJpy: "" },
  { code: "B-002", name: "", quantity: "1", unitJpy: "250" },
]);
assert.strictEqual(manualResult.errors.length, 0);
assert.deepStrictEqual(manualResult.products.map((item) => item.totalJpy), [3000, 250]);
assert.strictEqual(manualResult.products[1].name, "B-002");

const invalidManualResult = api.normalizeManualProducts([
  { code: "", name: "Missing code", quantity: "1", unitJpy: "100" },
  { code: "BAD-QTY", name: "", quantity: "0", unitJpy: "100" },
  { code: "BAD-PRICE", name: "", quantity: "1", unitJpy: "0" },
]);
assert.deepStrictEqual(invalidManualResult.products, []);
assert.deepStrictEqual(invalidManualResult.errors, [
  "1행 상품번호를 입력해 주세요.",
  "2행 수량은 1 이상이어야 합니다.",
  "3행 단가 JPY는 1 이상이어야 합니다.",
]);

console.log("cart_group_calculator tests passed");
