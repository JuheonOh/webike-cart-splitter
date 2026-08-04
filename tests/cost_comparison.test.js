const assert = require("assert");

const cartCore = require("../assets/js/calculator-core.js");
const costCore = require("../assets/js/cost-comparison-core.js");

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

const measuredTaxableSplit = costCore.compareMeasuredOrderStrategies({
  singleShipment: {
    label: "한 번에 주문",
    productJpy: 40000,
    shippingJpy: 3200,
  },
  splitShipments: [
    {
      label: "과세 예상 주문 1",
      productJpy: 30000,
      shippingJpy: 1800,
    },
    {
      label: "면세 주문 2",
      productJpy: 10000,
      shippingJpy: 800,
    },
  ],
}, {
  ...makeSettings(),
  importDutyRate: 0.08,
  vatRate: 0.1,
});
const measuredTaxableSplitStrategy = measuredTaxableSplit.strategies.find((strategy) => strategy.code === "split_tax_free");
assert.strictEqual(measuredTaxableSplitStrategy.available, true);
assert.strictEqual(measuredTaxableSplitStrategy.totals.shippingJpy, 2600);
assert.strictEqual(measuredTaxableSplitStrategy.shipments[0].taxable, true);
assert.strictEqual(measuredTaxableSplitStrategy.shipments[1].taxable, false);
assert.ok(measuredTaxableSplitStrategy.shipments[0].taxKrw > 0);

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

const mixedOversizeProducts = [
  makeProduct(0, "BIG-002", 1, 30000),
  makeProduct(1, "SMALL-002", 1, 10000),
];
const mixedOversizeRecommendation = cartCore.recommendGroups(mixedOversizeProducts, makeSettings());
const mixedOversizeSplit = costCore.compareOrderStrategies(mixedOversizeProducts, mixedOversizeRecommendation, makeSettings())
  .strategies.find((strategy) => strategy.code === "split_tax_free");
assert.strictEqual(mixedOversizeRecommendation.groups.length, 1);
assert.strictEqual(mixedOversizeRecommendation.taxableGroups.length, 1);
assert.strictEqual(mixedOversizeSplit.available, false, "taxable groups must not be mislabeled as tax-free split orders");
assert.strictEqual(mixedOversizeSplit.reason, "단일 계산 단위가 면세 한도를 초과했습니다.");

console.log("cost comparison tests passed");
