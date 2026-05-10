const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const cartCore = require("../assets/js/calculator-core.js");
const costCore = require("../assets/js/cost-comparison-core.js");
const quoteCli = require("../scripts/webike-quote.js");

const productDetailFixture = fs.readFileSync(
  path.join(__dirname, "fixtures/webike-product/product-detail-25427339.html"),
  "utf8",
);
const shippingApiFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures/webike-product/shipping-api-25427339.json"),
  "utf8",
));
const searchApiFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures/webike-product/search-api-34901KY2702.json"),
  "utf8",
));

function makeProduct(index, code, quantity, unitJpy) {
  return {
    index,
    code,
    name: code,
    quantity,
    unitJpy,
    totalJpy: quantity * unitJpy,
  };
}

function makeSettings(overrides = {}) {
  const settings = {
    limitUsd: 150,
    usdKrw: 1500,
    jpyKrw: 10,
    maxGroups: 4,
    splitQuantity: true,
    ...overrides,
  };
  settings.limitJpy = (settings.limitUsd * settings.usdKrw) / settings.jpyKrw;
  return settings;
}

const products = [
  makeProduct(0, "A-001", 1, 15000),
  makeProduct(1, "B-002", 1, 15000),
];
const recommendation = cartCore.recommendGroups(products, makeSettings());

assert.strictEqual(quoteCli.parseArgs(["--mode", "quote-api", "--input", "parts.csv", "--quiet"]).quiet, true);
const progressLogs = [];
quoteCli.logProgress({
  logProgress: true,
  progressLogger: (message) => progressLogs.push(message),
}, "[1/1] 검색 중");
quoteCli.logProgress({
  logProgress: true,
  quiet: true,
  progressLogger: (message) => progressLogs.push(message),
}, "quiet");
assert.deepStrictEqual(progressLogs, ["[1/1] 검색 중"]);

assert.strictEqual(recommendation.groups.length, 2);
assert.deepStrictEqual(costCore.normalizeCostSettings({ importDutyRate: 8, vatRate: 10 }), {
  limitUsd: 150,
  usdKrw: 1465.73,
  jpyKrw: 9.3399,
  importDutyRate: 0.08,
  vatRate: 0.1,
  singleShippingJpy: 0,
  splitShippingJpy: 0,
  fixedFeeKrw: 0,
});

const splitCheaper = costCore.compareOrderStrategies(products, recommendation, {
  ...makeSettings(),
  importDutyRate: 0.08,
  vatRate: 0.1,
  singleShippingJpy: 5000,
  splitShippingJpy: 2500,
});
const singleStrategy = splitCheaper.strategies.find((strategy) => strategy.code === "single_order");
const splitStrategy = splitCheaper.strategies.find((strategy) => strategy.code === "split_tax_free");

assert.strictEqual(singleStrategy.shipmentCount, 1);
assert.strictEqual(splitStrategy.shipmentCount, 2);
assert.strictEqual(singleStrategy.shipments[0].taxable, true);
assert.strictEqual(splitStrategy.shipments.every((shipment) => !shipment.taxable), true);
assert.strictEqual(singleStrategy.totals.totalKrw, 415800);
assert.strictEqual(splitStrategy.totals.totalKrw, 350000);
assert.strictEqual(splitCheaper.cheapestCode, "split_tax_free");
assert.strictEqual(splitCheaper.differenceKrw, 65800);
assert.strictEqual(splitCheaper.measurementMode, "fixed_shipping");

const singleCheaper = costCore.compareOrderStrategies(products, recommendation, {
  ...makeSettings(),
  importDutyRate: 0.08,
  vatRate: 0.1,
  singleShippingJpy: 5000,
  splitShippingJpy: 7000,
});

assert.strictEqual(singleCheaper.strategies.find((strategy) => strategy.code === "split_tax_free").totals.totalKrw, 440000);
assert.strictEqual(singleCheaper.cheapestCode, "single_order");
assert.strictEqual(singleCheaper.differenceKrw, 24200);

const measuredCheaper = costCore.compareMeasuredOrderStrategies({
  singleShipment: {
    label: "한 번에 주문",
    productJpy: 30000,
    shippingJpy: 5000,
  },
  splitShipments: [
    {
      label: "분할 주문 1",
      productJpy: 15000,
      shippingJpy: 2200,
    },
    {
      label: "분할 주문 2",
      productJpy: 15000,
      shippingJpy: 3100,
    },
  ],
}, {
  ...makeSettings(),
  importDutyRate: 0.08,
  vatRate: 0.1,
});

assert.strictEqual(measuredCheaper.measurementMode, "measured_shipping");
assert.strictEqual(measuredCheaper.strategies.find((strategy) => strategy.code === "single_order").totals.totalKrw, 415800);
assert.strictEqual(measuredCheaper.strategies.find((strategy) => strategy.code === "split_tax_free").totals.totalKrw, 353000);
assert.strictEqual(measuredCheaper.cheapestCode, "split_tax_free");
assert.strictEqual(measuredCheaper.differenceKrw, 62800);

const measuredNoSplit = costCore.compareMeasuredOrderStrategies({
  singleShipment: {
    label: "한 번에 주문",
    productJpy: 10000,
    shippingJpy: 2000,
  },
  splitUnavailableReason: "분할 불필요",
}, makeSettings());

assert.strictEqual(measuredNoSplit.strategies.find((strategy) => strategy.code === "split_tax_free").available, false);
assert.strictEqual(measuredNoSplit.differenceKrw, null);

const oversizeProducts = [
  makeProduct(0, "BIG-001", 1, 30000),
];
const oversizeRecommendation = cartCore.recommendGroups(oversizeProducts, makeSettings());
const unavailableSplit = costCore.compareOrderStrategies(oversizeProducts, oversizeRecommendation, makeSettings())
  .strategies.find((strategy) => strategy.code === "split_tax_free");

assert.strictEqual(unavailableSplit.available, false);
assert.strictEqual(unavailableSplit.reason, "단일 계산 단위가 면세 한도를 초과했습니다.");

const groupItems = quoteCli.scenarioItemsFromGroup(recommendation.groups[0]);
assert.deepStrictEqual(groupItems.map((item) => ({
  partNumber: item.partNumber,
  quantity: item.quantity,
  expectedSubtotalJpy: item.expectedSubtotalJpy,
})), [
  {
    partNumber: "A-001",
    quantity: 1,
    expectedSubtotalJpy: 15000,
  },
]);

assert.deepStrictEqual(quoteCli.quantityWarnings([
  { partNumber: "A-001", quantity: 2 },
], [
  { code: "A001", quantity: 1 },
]), ["A001 수량이 요청 2개, 장바구니 1개로 다릅니다."]);

const failedScenario = quoteCli.validateScenarioResult({
  items: [{ partNumber: "A-001", quantity: 1 }],
  addResults: [{ partNumber: "A-001", status: "added_to_cart" }],
  quote: {
    products: [{ code: "A-001", quantity: 1, totalJpy: 15000 }],
    productJpy: 15000,
    shippingJpy: null,
  },
});
assert(failedScenario.errors.includes("장바구니 배송비를 읽지 못했습니다."));

const inputPath = path.join(os.tmpdir(), `webike-quote-${Date.now()}.csv`);
fs.writeFileSync(inputPath, [
  "part_number,quantity,name,unit_jpy",
  "A-001,1,Alpha,15000",
  "A001,2,,15000",
].join("\n"));
const inputRows = quoteCli.readInputRows(inputPath);
assert.deepStrictEqual(inputRows, [
  {
    partNumber: "A-001",
    quantity: 3,
    name: "Alpha",
    unitJpy: 15000,
  },
]);
fs.unlinkSync(inputPath);

const productUrlInputPath = path.join(os.tmpdir(), `webike-quote-url-${Date.now()}.csv`);
fs.writeFileSync(productUrlInputPath, [
  "product_url,quantity,name",
  "https://www.japan-webike.kr/products/25427339.html,4,Headlight valve",
].join("\n"));
const productUrlRows = quoteCli.readInputRows(productUrlInputPath);
assert.deepStrictEqual(productUrlRows, [
  {
    partNumber: "",
    quantity: 4,
    name: "Headlight valve",
    unitJpy: 0,
    productUrl: "https://www.japan-webike.kr/products/25427339.html",
  },
]);
fs.unlinkSync(productUrlInputPath);

const productDetail = quoteCli.parseProductDetail(
  productDetailFixture,
  "https://www.japan-webike.kr/products/25427339.html",
);
assert.deepStrictEqual({
  productId: productDetail.productId,
  partNumber: productDetail.partNumber,
  unitJpy: productDetail.unitJpy,
  productWeight: productDetail.productWeight,
  productVolume: productDetail.productVolume,
  countryIso2: productDetail.countryIso2,
  shopCode: productDetail.shopCode,
}, {
  productId: "25427339",
  partNumber: "34901KY2702",
  unitJpy: 6733,
  productWeight: 23.7,
  productVolume: 35.6,
  countryIso2: "KR",
  shopCode: "9000",
});

assert.deepStrictEqual(quoteCli.validateProductDetail(productDetail, {
  productUrl: "https://www.japan-webike.kr/products/25427339.html",
  quantity: 1,
}).errors, []);
assert.deepStrictEqual(quoteCli.validateCartScriptProductDetail({
  productId: "25427339",
  partNumber: "34901KY2702",
  unitJpy: 6733,
  canNotAddCart: false,
  restrictedCountry: false,
  optionRequired: false,
}, {
  partNumber: "34901KY2702",
  quantity: 2,
}).errors, []);

const shippingCandidates = quoteCli.normalizeShippingApiResponse(shippingApiFixture);
assert.deepStrictEqual(shippingCandidates.map((item) => [item.serviceCode, item.costJpy]), [
  ["SEA", 2700],
  ["STD", 2800],
  ["FEDEXIE", 9900],
]);

const quoteProduct = quoteCli.productFromDetail(productUrlRows[0], productDetail, 0);
const shipmentMetrics = quoteCli.shipmentMetricsFromProducts([{ ...quoteProduct, quantity: 2, totalJpy: quoteProduct.unitJpy * 2 }]);
assert.deepStrictEqual(shipmentMetrics, {
  amountJpy: 13466,
  weightPoint: 47.4,
  volumePoint: 71.2,
});

const shippingRequest = quoteCli.buildShippingRequest([{ ...quoteProduct, quantity: 2, totalJpy: quoteProduct.unitJpy * 2 }]);
assert.strictEqual(shippingRequest.url, "https://japan.webike.net/api_shipping.html?wp=47.4&vl=71.2&to=KR&sc=9000&amount=13466");

const productSearchRequest = quoteCli.buildProductSearchRequest("34901KY2702");
assert.strictEqual(productSearchRequest.url, "https://www.japan-webike.kr/api-search-es.html?search=&p.k=34901KY2702&p.ref=product-search-es&smp=sp");
const productSearchLinks = quoteCli.extractProductLinksFromSearchResponse(
  searchApiFixture,
  productSearchRequest.url,
  "34901KY2702",
);
assert.deepStrictEqual(productSearchLinks, [
  {
    href: "https://www.japan-webike.kr/products/25427339.html",
    text: "HONDA OEM Motorcycle parts 밸브,헤드라이트 34901KY2702",
  },
]);

const report = quoteCli.buildReport({
  mode: "plan-only",
  inputRows,
  products: quoteCli.productsFromInput(inputRows),
  groupSettings: makeSettings(),
});

assert.strictEqual(report.inputCount, 1);
assert.strictEqual(report.comparison.measurementMode, "fixed_shipping");

const cartScript = quoteCli.buildCartScript([{
  partNumber: "34901KY2702",
  productsId: "25427339",
  quantity: 2,
  name: "Headlight valve",
  unitJpy: 6733,
  productUrl: "https://www.japan-webike.kr/products/25427339.html",
}]);
assert(cartScript.includes("/api_shopping_cart.html?action=add_product&ajax_action=1"));
assert(cartScript.includes('"productsId": "25427339"'));
assert(cartScript.includes("products_id: item.productsId"));
assert(cartScript.includes("cart_quantity: String(item.quantity)"));
assert(cartScript.includes('location.href = "/shopping_cart.html";'));

const cartScriptPath = path.join(os.tmpdir(), `webike-add-cart-${Date.now()}.js`);
assert.strictEqual(quoteCli.writeCartScript(cartScript, cartScriptPath), cartScriptPath);
assert(fs.readFileSync(cartScriptPath, "utf8").includes("Webike Cart Splitter generated add-cart script"));
fs.unlinkSync(cartScriptPath);

(async () => {
  const quoteProgressLogs = [];
  const quoteApiResult = await quoteCli.runQuoteApiMode({
    logProgress: true,
    progressLogger: (message) => quoteProgressLogs.push(message),
    fetchText: async () => productDetailFixture,
    fetchJson: async () => shippingApiFixture,
  }, productUrlRows, makeSettings());

  assert.strictEqual(quoteApiResult.products[0].code, "34901KY2702");
  assert.strictEqual(quoteApiResult.products[0].quantity, 4);
  assert.strictEqual(quoteApiResult.measurement.singleShipment.shippingJpy, 2700);
  assert.strictEqual(quoteApiResult.measurement.splitShipments.length, 2);
  assert.strictEqual(quoteApiResult.comparison.measurementMode, "measured_shipping");
  assert.strictEqual(quoteApiResult.comparison.cheapestCode, "split_tax_free");
  assert(quoteProgressLogs.includes("[1/1] 상품 정보 확인: 34901KY2702, 6733 JPY, 수량 4"));
  assert(quoteProgressLogs.includes("[배송비] 한 번에 주문: SEA 2700 JPY"));

  const quoteApiSearchResult = await quoteCli.runQuoteApiMode({
    fetchText: async (url) => {
      assert.strictEqual(url, "https://www.japan-webike.kr/products/25427339.html");
      return productDetailFixture;
    },
    fetchJson: async (url) => (url.includes("api-search-es.html") ? searchApiFixture : shippingApiFixture),
  }, [
    {
      partNumber: "34901KY2702",
      quantity: 4,
      name: "Headlight valve",
      unitJpy: 0,
    },
  ], makeSettings());

  assert.strictEqual(quoteApiSearchResult.products[0].productUrl, "https://www.japan-webike.kr/products/25427339.html");
  assert.strictEqual(quoteApiSearchResult.products[0].code, "34901KY2702");

  const cartScriptResult = await quoteCli.runCartScriptMode({
    fetchText: async (url) => {
      assert.strictEqual(url, "https://www.japan-webike.kr/products/25427339.html");
      return productDetailFixture;
    },
    fetchJson: async (url) => {
      assert(url.includes("api-search-es.html"));
      return searchApiFixture;
    },
  }, [
    {
      partNumber: "34901KY2702",
      quantity: 2,
      name: "Headlight valve",
      unitJpy: 6733,
    },
  ]);

  assert.strictEqual(cartScriptResult.items[0].productsId, "25427339");
  assert.strictEqual(cartScriptResult.items[0].quantity, 2);
  assert(cartScriptResult.script.includes('"productsId": "25427339"'));
  assert.strictEqual(cartScriptResult.automationResults[0].status, "parsed");

  console.log("cost comparison tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
