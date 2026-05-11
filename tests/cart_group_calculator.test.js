const assert = require("assert");
const fs = require("fs");
const path = require("path");

const api = require("../assets/js/calculator-core.js");
const uiScriptPath = path.join(__dirname, "..", "assets", "js", "cart-group-calculator.js");
const uiScript = fs.readFileSync(uiScriptPath, "utf8");
const uiRuntimeScript = uiScript.replace(/\s*applyStoredSettingsToForm\(\);[\s\S]*$/, "");
const uiApi = new Function("window", "document", `${uiRuntimeScript}
return {
  buildWebikeCartScript,
  groupFingerprint,
  renderGroups,
  renderProducts,
  readStoredDraft,
  removeStoredDraft,
  writeStoredDraft,
};
`)({ WebikeCartCore: api }, { querySelector: () => null });

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
    usdKrw: 1465.73,
    jpyKrw: 9.3399,
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
    removeItem(key) {
      values.delete(key);
    },
  };
}

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", "webike-cart", name), "utf8");
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24);
}

function unzipStoredEntries(bytes) {
  const decoder = new TextDecoder();
  const entries = {};
  let offset = 0;

  while (offset < bytes.length && readUint32(bytes, offset) === 0x04034b50) {
    const method = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const fileNameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength));

    assert.strictEqual(method, 0, `${name} must use stored ZIP method in tests`);
    entries[name] = decoder.decode(bytes.slice(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }

  return entries;
}

function assertCellXfsCount(stylesXml) {
  const match = stylesXml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  assert(match, "styles.xml must include cellXfs");
  const declaredCount = Number(match[1]);
  const actualCount = (match[2].match(/<xf /g) || []).length;
  assert.strictEqual(actualCount, declaredCount, "cellXfs count must match xf entries");
}

function sheetColumnWidths(sheetXml) {
  const widths = [];
  for (const match of sheetXml.matchAll(/<col min="(\d+)" max="\d+" width="([^"]+)"/g)) {
    widths[Number(match[1]) - 1] = Number(match[2]);
  }
  return widths;
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
assert.strictEqual(Math.floor(settings.limitJpy), 23539);
assert.strictEqual(recommendation.groups.length, 2);
assert.deepStrictEqual(totals, [21350, 21349]);

const xlsxBytes = api.buildXlsxBytes(sampleProducts, recommendation, settings);
assert(xlsxBytes instanceof Uint8Array, "xlsx output must be bytes");
assert(xlsxBytes.length > 1000, "xlsx output is unexpectedly small");
assert.deepStrictEqual([...xlsxBytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

const xlsxEntries = unzipStoredEntries(xlsxBytes);
assert(xlsxEntries["xl/workbook.xml"].includes('<sheet name="추천그룹"'));
assert(xlsxEntries["xl/workbook.xml"].includes('<sheet name="추출상품"'));
assert(!xlsxEntries["xl/workbook.xml"].includes('<sheet name="요약"'));
assert(!xlsxEntries["xl/worksheets/sheet3.xml"], "xlsx output should only include group and product worksheets");
assertCellXfsCount(xlsxEntries["xl/styles.xml"]);
assert(xlsxEntries["xl/styles.xml"].includes('wrapText="1"'));
assert(xlsxEntries["xl/styles.xml"].includes('formatCode="#,##0&quot; JPY&quot;"'));
assert(xlsxEntries["xl/styles.xml"].includes('formatCode="#,##0.00&quot; USD&quot;"'));
assert(xlsxEntries["xl/styles.xml"].includes('<font><u/><sz val="16"/><color rgb="FF0563C1"'));
assert(xlsxEntries["xl/worksheets/sheet1.xml"].includes('<pane ySplit="1" topLeftCell="A2"'));
assert(xlsxEntries["xl/worksheets/sheet1.xml"].includes('<autoFilter ref="A1:K'));
assert(xlsxEntries["xl/worksheets/sheet1.xml"].includes("주문 1 요약"));
assert(xlsxEntries["xl/worksheets/sheet1.xml"].includes("실행확인"));
assert(xlsxEntries["xl/worksheets/sheet1.xml"].includes("Webike 최종 금액 확인"));
assert(xlsxEntries["xl/worksheets/sheet2.xml"].includes('<pane ySplit="3" topLeftCell="A4"'));
assert(xlsxEntries["xl/worksheets/sheet2.xml"].includes('<autoFilter ref="A3:H'));
assert(xlsxEntries["xl/worksheets/sheet2.xml"].includes("추천그룹 산출에 사용된 상품 원본/보정값입니다."));
assert(
  xlsxEntries["xl/worksheets/sheet2.xml"].indexOf("비고") <
    xlsxEntries["xl/worksheets/sheet2.xml"].indexOf("상품URL"),
  "product URL column should be the last product-sheet column",
);
const groupColumnWidths = sheetColumnWidths(xlsxEntries["xl/worksheets/sheet1.xml"]);
const productColumnWidths = sheetColumnWidths(xlsxEntries["xl/worksheets/sheet2.xml"]);
assert(groupColumnWidths[3] < 64, "group product name width should be data-driven, not the old fixed width");
assert(productColumnWidths[1] < 72, "product name width should ignore the title note and use product data");

const longNameProducts = [
  makeProduct(0, "LONG-001", "HONDA OEM Extra Long Replacement Product Name For Auto Width Verification", 1, 1000),
];
const longNameSettings = makeSettings();
const longNameRecommendation = api.recommendGroups(longNameProducts, longNameSettings);
const longNameXlsx = api.buildXlsxBytes(longNameProducts, longNameRecommendation, longNameSettings);
const longNameProductWidths = sheetColumnWidths(unzipStoredEntries(longNameXlsx)["xl/worksheets/sheet2.xml"]);
assert(longNameProductWidths[1] > productColumnWidths[1], "product name width should grow with longer data");

const noGroupProducts = [
  makeProduct(0, "LIMIT-001", "Limit Test Item A", 1, 10000),
  makeProduct(1, "LIMIT-002", "Limit Test Item B", 1, 10000),
  makeProduct(2, "LIMIT-003", "Limit Test Item C", 1, 10000),
];
const noGroupSettings = makeSettings({ limitUsd: 95, maxGroups: 2, splitQuantity: false });
const noGroupRecommendation = api.recommendGroups(noGroupProducts, noGroupSettings);
const noGroupXlsxBytes = api.buildXlsxBytes(noGroupProducts, noGroupRecommendation, noGroupSettings);
const noGroupSheet = unzipStoredEntries(noGroupXlsxBytes)["xl/worksheets/sheet1.xml"];
assert(noGroupSheet.includes("추천 실패"));
assert(noGroupSheet.includes("최대 주문 수를 늘리거나 수량 분할을 켜고 다시 계산하세요."));

const csvZipProducts = [
  {
    ...makeProduct(0, "CSV-001", 'CSV Test "Quoted", Item', 2, 1500),
    productUrl: "https://www.japan-webike.kr/products/25427339.html",
  },
];
const csvZipRecommendation = api.recommendGroups(csvZipProducts, makeSettings());
const productUrlXlsxEntries = unzipStoredEntries(api.buildXlsxBytes(csvZipProducts, csvZipRecommendation, makeSettings()));
assert(productUrlXlsxEntries["xl/worksheets/sheet2.xml"].includes('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'));
assert(productUrlXlsxEntries["xl/worksheets/sheet2.xml"].includes('<hyperlinks><hyperlink ref="H4" r:id="rId1"/></hyperlinks>'));
assert(productUrlXlsxEntries["xl/worksheets/sheet2.xml"].includes('<c r="H4" t="inlineStr" s="28">'));
assert(productUrlXlsxEntries["xl/worksheets/_rels/sheet2.xml.rels"].includes('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"'));
assert(productUrlXlsxEntries["xl/worksheets/_rels/sheet2.xml.rels"].includes('Target="https://www.japan-webike.kr/products/25427339.html"'));
assert(productUrlXlsxEntries["xl/worksheets/_rels/sheet2.xml.rels"].includes('TargetMode="External"'));
const csvZipEntries = unzipStoredEntries(api.buildGroupCsvZipBytes(csvZipRecommendation));
assert.deepStrictEqual(Object.keys(csvZipEntries), ["webike_order_group_01.csv"]);
assert.strictEqual(
  csvZipEntries["webike_order_group_01.csv"],
  'part_number,quantity,name,unit_jpy,product_url\r\nCSV-001,2,"CSV Test ""Quoted"", Item",1500,https://www.japan-webike.kr/products/25427339.html',
);
assert.deepStrictEqual(unzipStoredEntries(api.buildGroupCsvZipBytes(noGroupRecommendation)), {});
assert(/^webike_order_groups_\d{8}_\d{4}\.zip$/.test(api.makeGroupCsvZipFileName()));

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
const productHtml = uiApi.renderProducts(unsafeProducts);
assert(!productHtml.includes("<script>"), "product name must not render as raw HTML");
assert(productHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
assert(productHtml.includes('data-action="apply-product-edits"'));
assert(productHtml.includes('id="productEditDirtyNotice"'));
assert(productHtml.includes('class="result-product-quantity result-product-edit"'));
assert(productHtml.includes('class="result-product-unit-jpy result-product-edit"'));
assert(productHtml.includes('value="1"'));
assert(productHtml.includes('value="100"'));

const groupHtml = uiApi.renderGroups(recommendation, settings);
assert(groupHtml.includes('data-action="copy-group-cart-script"'));
assert(groupHtml.includes('data-group-index="0"'));
assert(groupHtml.includes('id="groupScriptStatus0"'));
assert(groupHtml.includes('class="group-checks"'));
assert(groupHtml.includes("group-script-copied"));
assert(groupHtml.includes('data-progress-field="finalAmountChecked"'));
assert(groupHtml.includes('data-progress-field="ordered"'));
assert(!groupHtml.includes('data-action="generate-webike-cart-script"'));

const progressKey = uiApi.groupFingerprint(recommendation.groups[0]);
const progressedGroupHtml = uiApi.renderGroups(recommendation, settings, {
  [progressKey]: {
    scriptCopied: true,
    finalAmountChecked: true,
    ordered: false,
  },
});
assert(progressedGroupHtml.includes(`data-group-key="${progressKey}"`));
assert(progressedGroupHtml.includes('data-progress-field="scriptCopied" checked'));
assert(progressedGroupHtml.includes('data-progress-field="finalAmountChecked" checked'));

const firstGroupProducts = api.aggregateGroup(recommendation.groups[0]);
const secondGroupProducts = api.aggregateGroup(recommendation.groups[1]);
const firstGroupCodes = new Set(firstGroupProducts.map((item) => item.code));
const secondGroupOnlyProduct = secondGroupProducts.find((item) => !firstGroupCodes.has(item.code));
const firstGroupScript = uiApi.buildWebikeCartScript(firstGroupProducts);
assert(firstGroupScript.includes(`"partNumber": "${firstGroupProducts[0].code}"`));
assert(secondGroupOnlyProduct, "fixture should have at least one product unique to the second group");
assert(!firstGroupScript.includes(`"partNumber": "${secondGroupOnlyProduct.code}"`));

const webikeCartScript = uiApi.buildWebikeCartScript(sampleProducts.slice(0, 2));
assert(webikeCartScript.includes("www.japan-webike.kr"));
assert(webikeCartScript.includes("/api-search-es.html"));
assert(webikeCartScript.includes("/api_shopping_cart.html?action=add_product&ajax_action=1"));
assert(webikeCartScript.includes('"partNumber": "13225MY9003"'));
assert(webikeCartScript.includes('"quantity": 4'));
assert(webikeCartScript.includes("products_id: item.productsId"));
assert(webikeCartScript.includes('location.href = "/shopping_cart.html";'));
assert.doesNotThrow(() => new Function(webikeCartScript));

const productUrlCartScript = uiApi.buildWebikeCartScript([{
  code: "",
  productUrl: "https://www.japan-webike.kr/products/25427339.html",
  name: "URL only item",
  quantity: 1,
  unitJpy: 1000,
}]);
assert(productUrlCartScript.includes('"productUrl": "https://www.japan-webike.kr/products/25427339.html"'));
assert.doesNotThrow(() => new Function(productUrlCartScript));

const normalizedProductUrlOnly = api.normalizeManualProducts([{
  code: "",
  productUrl: "https://www.japan-webike.kr/products/25427339.html",
  name: "URL normalized item",
  quantity: "1",
  unitJpy: "1000",
}]);
assert.deepStrictEqual(normalizedProductUrlOnly.errors, []);
const normalizedProductUrlScript = uiApi.buildWebikeCartScript(normalizedProductUrlOnly.products);
assert(normalizedProductUrlScript.includes('"partNumber": ""'));
assert(normalizedProductUrlScript.includes('"productUrl": "https://www.japan-webike.kr/products/25427339.html"'));
assert.doesNotThrow(() => new Function(normalizedProductUrlScript));
const productUrlOnlyRecommendation = api.recommendGroups(normalizedProductUrlOnly.products, makeSettings());
const productUrlOnlyCsv = unzipStoredEntries(api.buildGroupCsvZipBytes(productUrlOnlyRecommendation));
assert.strictEqual(
  productUrlOnlyCsv["webike_order_group_01.csv"],
  "part_number,quantity,name,unit_jpy,product_url\r\n,1,URL normalized item,1000,https://www.japan-webike.kr/products/25427339.html",
);

const unsafeCartScript = uiApi.buildWebikeCartScript(unsafeProducts);
assert(!unsafeCartScript.includes("<script>"), "generated script must escape HTML-like product data");
assert(unsafeCartScript.includes("\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"));

const oversizeRecommendation = api.recommendGroups(unsafeProducts, makeSettings({ limitUsd: 1 }));
const oversizeHtml = uiApi.renderGroups(oversizeRecommendation, makeSettings({ limitUsd: 1 }));
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

["단가", "금액", "가격", "판매가"].forEach((priceHeader) => {
  const pastedKoreanPriceAlias = api.manualRowsFromPastedText([
    `상품번호,수량,상품명,${priceHeader}`,
    "K-001,2,한글 헤더 상품,6733",
  ].join("\n"));
  assert.deepStrictEqual(pastedKoreanPriceAlias.errors, []);
  assert.deepStrictEqual(pastedKoreanPriceAlias.rows, [
    { code: "K-001", name: "한글 헤더 상품", quantity: "2", unitJpy: "6733" },
  ]);
});

const pastedXlsxProductRows = api.manualRowsFromPastedText([
  "상품번호\t상품명\t수량\t단가 (JPY)\t소계 (JPY)\t소계 (KRW)",
  "34901KY2702\tHONDA OEM Motorcycle parts : Valve , Headlight 34901KY2702\t2\t6,733 JPY\t13,466 JPY\t125,771 KRW",
  "16016MAS670\tHONDA OEM Motorcycle parts : Screw Set\t4\t2,670 JPY\t10,680 JPY\t99,750 KRW",
].join("\n"));
assert.deepStrictEqual(pastedXlsxProductRows.errors, []);
assert.deepStrictEqual(pastedXlsxProductRows.rows, [
  {
    code: "34901KY2702",
    name: "HONDA OEM Motorcycle parts : Valve , Headlight 34901KY2702",
    quantity: "2",
    unitJpy: "6,733 JPY",
  },
  {
    code: "16016MAS670",
    name: "HONDA OEM Motorcycle parts : Screw Set",
    quantity: "4",
    unitJpy: "2,670 JPY",
  },
]);
assert.deepStrictEqual(
  api.normalizeManualProducts(pastedXlsxProductRows.rows).products.map((item) => item.unitJpy),
  [6733, 2670],
);

const pastedProductUrlCsv = api.manualRowsFromPastedText([
  "product_url,quantity,name,unit_jpy",
  "https://www.japan-webike.kr/products/25427339.html,2,URL Item,1500",
].join("\n"));
assert.deepStrictEqual(pastedProductUrlCsv.errors, []);
assert.deepStrictEqual(pastedProductUrlCsv.rows, [
  {
    code: "",
    productUrl: "https://www.japan-webike.kr/products/25427339.html",
    name: "URL Item",
    quantity: "2",
    unitJpy: "1500",
  },
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
  usdKrw: 1465.73,
  jpyKrw: 9.3399,
  maxGroups: 8,
  splitQuantity: true,
});

const draftStorage = makeMemoryStorage();
const draftGroupKey = uiApi.groupFingerprint(recommendation.groups[0]);
assert.strictEqual(uiApi.writeStoredDraft({
  inputMode: "manual",
  settings: {
    limitUsd: 150,
    usdKrw: 1465.73,
    jpyKrw: 9.3399,
    maxGroups: 8,
    splitQuantity: true,
  },
  cartHtml: "<table-cart>",
  bulkPasteInput: "상품번호\t상품명\t수량\t단가JPY",
  manualRows: [{
    code: "DRAFT-001",
    productUrl: "https://www.japan-webike.kr/products/25427339.html",
    name: "Draft Item",
    quantity: "2",
    unitJpy: "1500",
  }],
  analysis: {
    products: [{
      code: "DRAFT-001",
      productUrl: "https://www.japan-webike.kr/products/25427339.html",
      name: "Draft Item",
      quantity: 2,
      unitJpy: 1500,
    }],
    settings,
    dirtyProductRows: [{
      index: "0",
      quantity: "3",
      unitJpy: "1600",
    }],
  },
  groupProgress: {
    [draftGroupKey]: {
      scriptCopied: true,
      finalAmountChecked: true,
      ordered: false,
    },
  },
}, draftStorage), true);
const storedDraft = uiApi.readStoredDraft(draftStorage);
assert.strictEqual(storedDraft.version, 1);
assert.strictEqual(storedDraft.inputMode, "manual");
assert.strictEqual(storedDraft.cartHtml, "<table-cart>");
assert.deepStrictEqual(storedDraft.manualRows[0], {
  code: "DRAFT-001",
  productUrl: "https://www.japan-webike.kr/products/25427339.html",
  name: "Draft Item",
  quantity: "2",
  unitJpy: "1500",
});
assert.strictEqual(storedDraft.analysis.products[0].totalJpy, 3000);
assert.deepStrictEqual(storedDraft.analysis.dirtyProductRows[0], {
  index: "0",
  quantity: "3",
  unitJpy: "1600",
});
assert.deepStrictEqual(storedDraft.groupProgress[draftGroupKey], {
  scriptCopied: true,
  finalAmountChecked: true,
  ordered: false,
  updatedAt: "",
});
assert.strictEqual(uiApi.removeStoredDraft(draftStorage), true);
assert.strictEqual(uiApi.readStoredDraft(draftStorage), null);

assert.deepStrictEqual(api.normalizeExchangeRateData({
  source: "forwarder.kr",
  sourceUrl: "https://www.forwarder.kr/curr/index.php?curr=ex_rate",
  period: "2026-05-10 ~ 2026-05-16",
  updatedAt: "2026-05-10T16:08:02+09:00",
  rates: {
    USD: "1465.73",
    JPY: "9.3399",
  },
}), {
  source: "forwarder.kr",
  sourceUrl: "https://www.forwarder.kr/curr/index.php?curr=ex_rate",
  period: "2026-05-10 ~ 2026-05-16",
  updatedAt: "2026-05-10T16:08:02+09:00",
  rates: {
    USD: 1465.73,
    JPY: 9.3399,
  },
});

assert.strictEqual(api.normalizeExchangeRateData({
  rates: {
    USD: 1465.73,
    JPY: 0,
  },
}), null);

console.log("cart_group_calculator tests passed");
