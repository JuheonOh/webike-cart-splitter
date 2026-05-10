const assert = require("assert");
const fs = require("fs");
const path = require("path");

const htmlPath = path.join(__dirname, "..", "cart_group_calculator.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);

assert(scriptMatch, "inline script not found");

const runtimeScript = scriptMatch[1].replace(/\s*applyStoredSettingsToForm\(\);[\s\S]*$/, "");
const api = new Function(`${runtimeScript}
return {
  buildXlsxBytes,
  cartProductFromRow,
  groupTotals,
  manualRowsFromProducts,
  manualRowsFromPastedText,
  normalizeManualProducts,
  normalizeStoredSettings,
  parseJpy,
  recommendGroups,
  renderGroups,
  renderProducts,
  readStoredSettings,
  writeStoredSettings,
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

function makeFakeElement({ text = "", value = "", dataset = {}, attrs = {} } = {}) {
  return {
    textContent: text,
    value,
    dataset,
    getAttribute(name) {
      return attrs[name] ?? null;
    },
  };
}

function makeFakeRow({ id = "", text = "", dataset = {}, elements = {}, attrs = {} } = {}) {
  return {
    id,
    textContent: text,
    dataset,
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    querySelector(selector) {
      return elements[selector] || null;
    },
  };
}

function makeMemoryStorage(initialValue = "") {
  const values = new Map(initialValue ? [["webike-cart-splitter-settings-v1", initialValue]] : []);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", "webike-cart", name), "utf8");
}

function camelCaseDataName(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function attrsFromTag(tag) {
  const attrs = {};
  const dataset = {};
  for (const match of tag.matchAll(/([:\w-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
    if (match[1].startsWith("data-")) {
      dataset[camelCaseDataName(match[1].slice(5))] = match[2];
    }
  }
  return { attrs, dataset };
}

function textByClass(html, className) {
  const pattern = new RegExp(`<[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  const match = html.match(pattern);
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : "";
}

function valueByClass(html, className) {
  const pattern = new RegExp(`<input[^>]*class="[^"]*${className}[^"]*"[^>]*>`, "i");
  const tag = html.match(pattern)?.[0] || "";
  return attrsFromTag(tag).attrs.value || "";
}

function valueByName(html, name) {
  const pattern = new RegExp(`<input[^>]*name="${name}"[^>]*>`, "i");
  const tag = html.match(pattern)?.[0] || "";
  return attrsFromTag(tag).attrs.value || "";
}

function addFixtureElement(elements, selector, values) {
  if (values.text || values.value || Object.keys(values.dataset || {}).length || Object.keys(values.attrs || {}).length) {
    elements[selector] = makeFakeElement(values);
  }
}

function fixtureRows(name) {
  const html = readFixture(name);
  const rows = [];
  for (const match of html.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const { attrs, dataset } = attrsFromTag(`<tr${match[1]}>`);
    const elements = {};
    addFixtureElement(elements, ".product-code .code", { text: textByClass(match[2], "code") });
    addFixtureElement(elements, ".product-name a", { text: textByClass(match[2], "product-name") });
    addFixtureElement(elements, ".product-quantity", { value: valueByClass(match[2], "product-quantity") });
    addFixtureElement(elements, ".qty-inp", { value: valueByClass(match[2], "qty-inp") });
    addFixtureElement(elements, "input[name='quantity']", { value: valueByName(match[2], "quantity") });
    addFixtureElement(elements, ".unit-sub-price", { text: textByClass(match[2], "unit-sub-price") });
    addFixtureElement(elements, ".total-sub-price", { text: textByClass(match[2], "total-sub-price") });
    rows.push(makeFakeRow({
      id: attrs.id || "",
      text: match[2].replace(/<[^>]+>/g, " "),
      dataset,
      attrs,
      elements,
    }));
  }
  for (const match of html.matchAll(/<div([^>]*class="[^"]*(?:cart-item|cart-list-item)[^"]*"[^>]*)>([\s\S]*?)<\/div>/gi)) {
    const { attrs, dataset } = attrsFromTag(`<div${match[1]}>`);
    const elements = {};
    addFixtureElement(elements, ".item-name a", { text: textByClass(match[2], "item-name") });
    addFixtureElement(elements, ".product-title", { text: textByClass(match[2], "product-title") });
    addFixtureElement(elements, ".goods-name", { text: textByClass(match[2], "goods-name") });
    addFixtureElement(elements, ".quantity", { text: textByClass(match[2], "quantity") });
    addFixtureElement(elements, ".qty", { text: textByClass(match[2], "qty") });
    addFixtureElement(elements, ".price", { text: textByClass(match[2], "price") });
    rows.push(makeFakeRow({
      id: attrs.id || "",
      text: match[2].replace(/<[^>]+>/g, " "),
      dataset,
      attrs,
      elements,
    }));
  }
  return rows;
}

function productsFromFixture(name) {
  return fixtureRows(name)
    .map((row, index) => api.cartProductFromRow(row, index))
    .filter(Boolean);
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

assert.strictEqual(api.parseJpy("JPY 1,250"), 1250);
assert.strictEqual(api.parseJpy("1,250円"), 1250);
assert.strictEqual(api.parseJpy("￥1,250"), 1250);

const legacyCartRow = makeFakeRow({
  id: "product-item-13225MY9003",
  dataset: { sku: "13225MY9003" },
  elements: {
    ".product-code .code": makeFakeElement({ text: "13225MY9003" }),
    ".product-name a": makeFakeElement({ text: "HONDA OEM Bearing" }),
    ".product-quantity": makeFakeElement({ value: "4" }),
    ".unit-sub-price": makeFakeElement({ text: "1,061 JPY" }),
    ".total-sub-price": makeFakeElement({ text: "4,244 JPY" }),
  },
});
assert.deepStrictEqual(api.cartProductFromRow(legacyCartRow, 0), {
  index: 0,
  sku: "13225MY9003",
  code: "13225MY9003",
  name: "HONDA OEM Bearing",
  quantity: 4,
  unitJpy: 1061,
  totalJpy: 4244,
});

const alternateCartRow = makeFakeRow({
  id: "cart-item-99103-MT2-0350",
  text: "Qty: 2",
  dataset: { productCode: "99103-MT2-0350", unitPrice: "831" },
  elements: {
    ".item-name a": makeFakeElement({ text: "HONDA OEM Jet" }),
  },
});
assert.deepStrictEqual(api.cartProductFromRow(alternateCartRow, 1), {
  index: 1,
  sku: "99103-MT2-0350",
  code: "99103-MT2-0350",
  name: "HONDA OEM Jet",
  quantity: 2,
  unitJpy: 831,
  totalJpy: 1662,
});

const tableCartProducts = productsFromFixture("table-cart-current.html");
assert.deepStrictEqual(tableCartProducts.map((item) => ({
  code: item.code,
  name: item.name,
  quantity: item.quantity,
  unitJpy: item.unitJpy,
  totalJpy: item.totalJpy,
})), [
  {
    code: "13225MY9003",
    name: "HONDA OEM BearingB, connecting",
    quantity: 4,
    unitJpy: 1061,
    totalJpy: 4244,
  },
  {
    code: "99103-MT2-0350",
    name: "HONDA OEM Jet, Slow #35",
    quantity: 2,
    unitJpy: 831,
    totalJpy: 1662,
  },
]);

const attributeCartProducts = productsFromFixture("data-attribute-cart.html");
assert.deepStrictEqual(attributeCartProducts.map((item) => ({
  code: item.code,
  name: item.name,
  quantity: item.quantity,
  unitJpy: item.unitJpy,
  totalJpy: item.totalJpy,
})), [
  {
    code: "ALT-001",
    name: "Attribute Price Item",
    quantity: 2,
    unitJpy: 1200,
    totalJpy: 2400,
  },
  {
    code: "ALT-002",
    name: "Total Price Item",
    quantity: 2,
    unitJpy: 1250,
    totalJpy: 2500,
  },
  {
    code: "ALT-003",
    name: "Yen Symbol Item",
    quantity: 3,
    unitJpy: 850,
    totalJpy: 2550,
  },
]);

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

const copiedManualRows = api.manualRowsFromProducts(sampleProducts.slice(0, 2));
assert.deepStrictEqual(copiedManualRows, [
  {
    code: "13225MY9003",
    name: "HONDA OEM BearingB, connecting",
    quantity: 4,
    unitJpy: 1061,
  },
  {
    code: "13225ML0405",
    name: "HONDA OEM BearingB, connecting",
    quantity: 4,
    unitJpy: 1522,
  },
]);
assert.deepStrictEqual(
  api.normalizeManualProducts(copiedManualRows).products.map((item) => item.totalJpy),
  [4244, 6088],
);

const pastedTsv = api.manualRowsFromPastedText([
  "상품번호\t상품명\t수량\t단가JPY",
  "A-001\tTSV Item\t2\t1,500",
  "B-002\tSecond Item\t1\t250",
].join("\n"));
assert.deepStrictEqual(pastedTsv.errors, []);
assert.deepStrictEqual(pastedTsv.rows, [
  { code: "A-001", name: "TSV Item", quantity: "2", unitJpy: "1,500" },
  { code: "B-002", name: "Second Item", quantity: "1", unitJpy: "250" },
]);

const pastedCsv = api.manualRowsFromPastedText('"C-003","CSV, Item","3","2,000"');
assert.deepStrictEqual(pastedCsv.errors, []);
assert.deepStrictEqual(pastedCsv.rows, [
  { code: "C-003", name: "CSV, Item", quantity: "3", unitJpy: "2,000" },
]);

assert.deepStrictEqual(api.normalizeStoredSettings({
  limitUsd: "200",
  usdKrw: "1500.5",
  jpyKrw: "10.25",
  maxGroups: "6",
  splitQuantity: false,
}), {
  limitUsd: 200,
  usdKrw: 1500.5,
  jpyKrw: 10.25,
  maxGroups: 6,
  splitQuantity: false,
});

const settingsStorage = makeMemoryStorage();
assert.strictEqual(api.writeStoredSettings({
  limitUsd: "200",
  usdKrw: "1500.5",
  jpyKrw: "10.25",
  maxGroups: "6",
  splitQuantity: false,
}, settingsStorage), true);
assert.deepStrictEqual(api.readStoredSettings(settingsStorage), {
  limitUsd: 200,
  usdKrw: 1500.5,
  jpyKrw: 10.25,
  maxGroups: 6,
  splitQuantity: false,
});
assert.deepStrictEqual(api.readStoredSettings(makeMemoryStorage("{bad json")), {
  limitUsd: 150,
  usdKrw: 1476.92,
  jpyKrw: 9.272,
  maxGroups: 8,
  splitQuantity: true,
});

console.log("cart_group_calculator tests passed");
