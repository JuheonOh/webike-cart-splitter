const assert = require("assert");

const grouping = require("../assets/js/calculator-grouping.js");
const quoteResultCore = require("../assets/js/quote-result-core.js");

const settings = {
  limitUsd: 150,
  usdKrw: 1465.73,
  jpyKrw: 9.3399,
  maxGroups: 8,
  shippingService: "STD",
  importDutyRate: 0.08,
  vatRate: 0.1,
};

const products = [
  {
    index: 0,
    code: "PART-A",
    productId: "10001",
    productUrl: "https://www.japan-webike.kr/products/10001.html",
    name: "Part A",
    quantity: 1,
    unitJpy: 15000,
    totalJpy: 15000,
  },
  {
    index: 1,
    code: "PART-B",
    productId: "10002",
    productUrl: "https://www.japan-webike.kr/products/10002.html",
    name: "Part B",
    quantity: 1,
    unitJpy: 15000,
    totalJpy: 15000,
  },
];

function shipment(label, items, shippingJpy = 1000) {
  return {
    label,
    productJpy: items.reduce((sum, item) => sum + item.totalJpy, 0),
    shippingJpy,
    products: items.map((item) => ({ ...item })),
  };
}

function strategyMeasurement(groups, recommendation) {
  return {
    recommendationSummary: {
      totalJpy: recommendation.totalJpy,
      groupCount: recommendation.groups.length,
      oversizeCount: recommendation.oversize.length,
      taxableGroupCount: recommendation.taxableGroups.length,
      orderGroupCount: recommendation.taxableGroups.length + recommendation.groups.length,
    },
    splitShipments: groups,
    splitUnavailableReason: "",
  };
}

const groupSettings = {
  ...settings,
  limitJpy: settings.limitUsd * settings.usdKrw / settings.jpyKrw,
};
const recommendations = {
  split_quantity: grouping.recommendGroups(products, { ...groupSettings, splitQuantity: true }),
  row_unit: grouping.recommendGroups(products, { ...groupSettings, splitQuantity: false }),
};
const splitShipments = [
  shipment("분할 주문 1", [products[0]]),
  shipment("분할 주문 2", [products[1]]),
];
const validResult = {
  source: quoteResultCore.QUOTE_RESULT_SOURCE,
  schemaVersion: quoteResultCore.QUOTE_RESULT_SCHEMA_VERSION,
  status: "measured",
  generatedAt: "2026-07-10T00:00:00.000Z",
  settings,
  products,
  measurement: {
    singleShipment: shipment("한 번에 주문", products, 2000),
    strategies: {
      split_quantity: strategyMeasurement(splitShipments, recommendations.split_quantity),
      row_unit: strategyMeasurement(splitShipments, recommendations.row_unit),
    },
  },
  automationResults: [],
};
const expectedInputRows = products.map((item) => ({
  partNumber: item.code,
  productUrl: item.productUrl,
  quantity: item.quantity,
}));

const structuralValidation = quoteResultCore.validateQuoteResult(validResult, {
  expectedInputRows,
  expectedSettings: settings,
});
assert.deepStrictEqual(structuralValidation.errors, []);
assert.strictEqual(structuralValidation.valid, true);
assert.deepStrictEqual(
  quoteResultCore.validateRecommendationMeasurements(recommendations, validResult.measurement, structuralValidation.products),
  { valid: true, errors: [] },
);

const mixedTaxableProducts = [
  { ...products[0], index: 0, code: "BIG-PART", unitJpy: 30000, totalJpy: 30000 },
  { ...products[1], index: 1, code: "SMALL-PART", unitJpy: 10000, totalJpy: 10000 },
];
const mixedTaxableRecommendations = {
  split_quantity: grouping.recommendGroups(mixedTaxableProducts, { ...groupSettings, splitQuantity: true }),
  row_unit: grouping.recommendGroups(mixedTaxableProducts, { ...groupSettings, splitQuantity: false }),
};
const mixedTaxableMeasurement = {
  strategies: {
    split_quantity: strategyMeasurement([
      shipment("과세 예상 주문 1", [mixedTaxableProducts[0]], 1800),
      shipment("분할 주문 2", [mixedTaxableProducts[1]], 800),
    ], mixedTaxableRecommendations.split_quantity),
    row_unit: strategyMeasurement([
      shipment("과세 예상 주문 1", [mixedTaxableProducts[0]], 1800),
      shipment("분할 주문 2", [mixedTaxableProducts[1]], 800),
    ], mixedTaxableRecommendations.row_unit),
  },
};
assert.deepStrictEqual(
  quoteResultCore.validateRecommendationMeasurements(
    mixedTaxableRecommendations,
    mixedTaxableMeasurement,
    mixedTaxableProducts,
  ),
  { valid: true, errors: [] },
);

const manyProducts = Array.from({ length: 12 }, (_, index) => ({
  ...products[0],
  index,
  code: `PART-${index}`,
  productId: `2000${index}`,
  quantity: 1,
  unitJpy: 1000,
  totalJpy: 1000,
}));
const manyProductRecommendations = {
  split_quantity: grouping.recommendGroups(manyProducts, { ...groupSettings, splitQuantity: true }),
  row_unit: grouping.recommendGroups(manyProducts, { ...groupSettings, splitQuantity: false }),
};
const manyProductMeasurement = {
  strategies: {
    split_quantity: strategyMeasurement([], manyProductRecommendations.split_quantity),
    row_unit: strategyMeasurement([], manyProductRecommendations.row_unit),
  },
};
assert.deepStrictEqual(
  quoteResultCore.validateRecommendationMeasurements(
    manyProductRecommendations,
    manyProductMeasurement,
    manyProducts,
  ),
  { valid: true, errors: [] },
);

const missingProductId = structuredClone(validResult);
missingProductId.products[0].productId = "";
assert.ok(
  quoteResultCore.validateQuoteResult(missingProductId, { expectedInputRows, expectedSettings: settings })
    .errors.some((error) => error.includes("상품 ID")),
);

const wrongSource = structuredClone(validResult);
wrongSource.source = "unknown";
assert.ok(quoteResultCore.validateQuoteResult(wrongSource).errors.some((error) => error.includes("생성한 견적 결과")));

const wrongVersion = structuredClone(validResult);
wrongVersion.schemaVersion = 999;
assert.ok(quoteResultCore.validateQuoteResult(wrongVersion).errors.some((error) => error.includes("버전")));

assert.deepStrictEqual(
  quoteResultCore.validateQuoteResultEnvelope({
    source: quoteResultCore.QUOTE_RESULT_SOURCE,
    schemaVersion: quoteResultCore.QUOTE_RESULT_SCHEMA_VERSION,
    status: "failed",
  }),
  { valid: true, errors: [] },
);
assert.ok(
  quoteResultCore.validateQuoteResultEnvelope({ source: "unknown", schemaVersion: 1, status: "failed" })
    .errors.some((error) => error.includes("생성한 견적 결과")),
);

const validFailedResult = {
  source: quoteResultCore.QUOTE_RESULT_SOURCE,
  schemaVersion: quoteResultCore.QUOTE_RESULT_SCHEMA_VERSION,
  status: "failed",
  products: [],
  automationResults: [{
    rowIndex: 1,
    partNumber: "PART-A",
    productUrl: products[0].productUrl,
    status: "failed",
    errors: ["상품 상세 확인 실패"],
  }],
};
assert.deepStrictEqual(
  quoteResultCore.validateFailedQuoteResult(validFailedResult),
  { valid: true, errors: [] },
);

const invalidFailedAutomationResults = structuredClone(validFailedResult);
invalidFailedAutomationResults.automationResults = {};
assert.ok(
  quoteResultCore.validateFailedQuoteResult(invalidFailedAutomationResults)
    .errors.some((error) => error.includes("자동화 결과")),
);

const invalidFailedErrors = structuredClone(validFailedResult);
invalidFailedErrors.automationResults[0].errors = "상품 상세 확인 실패";
assert.ok(
  quoteResultCore.validateFailedQuoteResult(invalidFailedErrors)
    .errors.some((error) => error.includes("오류 목록")),
);

const invalidFailedErrorMessage = structuredClone(validFailedResult);
invalidFailedErrorMessage.automationResults[0].errors = [{ message: "상품 상세 확인 실패" }];
assert.ok(
  quoteResultCore.validateFailedQuoteResult(invalidFailedErrorMessage)
    .errors.some((error) => error.includes("오류 메시지")),
);

const excessiveGroups = structuredClone(validResult);
excessiveGroups.settings.maxGroups = 21;
assert.ok(quoteResultCore.validateQuoteResult(excessiveGroups).errors.some((error) => error.includes("1~20")));

const mismatchedProductUrlRows = structuredClone(expectedInputRows);
mismatchedProductUrlRows[0].partNumber = "";
mismatchedProductUrlRows[0].productUrl = "https://www.japan-webike.kr/products/99999.html";
assert.ok(
  quoteResultCore.validateQuoteResult(validResult, { expectedInputRows: mismatchedProductUrlRows, expectedSettings: settings })
    .errors.some((error) => error.includes("상품 URL")),
);

const changedSettings = { ...settings, usdKrw: settings.usdKrw + 1 };
assert.ok(
  quoteResultCore.validateQuoteResult(validResult, { expectedInputRows, expectedSettings: changedSettings })
    .errors.some((error) => error.includes("계산 기준이 변경")),
);

const mismatchedMeasurement = structuredClone(validResult.measurement);
mismatchedMeasurement.strategies.split_quantity.splitShipments = [shipment("잘못된 그룹", products)];
assert.ok(
  quoteResultCore.validateRecommendationMeasurements(recommendations, mismatchedMeasurement, products)
    .errors.some((error) => error.includes("측정 그룹")),
);

const wrongSingleTotal = structuredClone(validResult);
wrongSingleTotal.measurement.singleShipment.productJpy += 1;
assert.ok(
  quoteResultCore.validateQuoteResult(wrongSingleTotal).errors.some((error) => error.includes("상품가 합계")),
);

console.log("quote result tests passed");
