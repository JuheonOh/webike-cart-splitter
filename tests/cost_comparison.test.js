const assert = require("assert");
const costCore = require("../assets/js/cost-comparison-core.js");

const settings = {
  limitUsd: 150,
  usdKrw: 1500,
  jpyKrw: 10,
  importDutyRate: 0.08,
  vatRate: 0.1,
};

assert.deepStrictEqual(costCore.normalizeCostSettings({ importDutyRate: 8, vatRate: 10 }), {
  limitUsd: 150,
  usdKrw: 1465.73,
  jpyKrw: 9.3399,
  importDutyRate: 0.08,
  vatRate: 0.1,
});

const taxFree = costCore.calculateImportTaxes(22500, 50000, settings);
assert.strictEqual(taxFree.taxable, false, "shipping must not push an otherwise tax-free product value over the threshold");
assert.strictEqual(taxFree.taxKrw, 0);
assert.strictEqual(costCore.calculateImportTaxes(22501, 0, settings).taxable, true);

const single = costCore.buildShipment({ productJpy: 30000, shippingJpy: 5000 }, settings);
assert.deepStrictEqual(single, {
  label: "",
  productJpy: 30000,
  shippingJpy: 5000,
  productUsd: 200,
  productKrw: 300000,
  shippingKrw: 50000,
  totalBeforeTaxKrw: 350000,
  totalKrw: 415800,
  taxable: true,
  customsValueJpy: 35000,
  customsValueKrw: 350000,
  dutyKrw: 28000,
  vatKrw: 37800,
  taxKrw: 65800,
});

const split = costCore.summarizeStrategy("split_quantity", "분할 주문", [
  costCore.buildShipment({ productJpy: 15000, shippingJpy: 2200 }, settings),
  costCore.buildShipment({ productJpy: 15000, shippingJpy: 3100 }, settings),
]);
assert.strictEqual(split.available, true);
assert.strictEqual(split.shipmentCount, 2);
assert.deepStrictEqual(split.totals, {
  productJpy: 30000,
  shippingJpy: 5300,
  productKrw: 300000,
  shippingKrw: 53000,
  dutyKrw: 0,
  vatKrw: 0,
  taxKrw: 0,
  totalKrw: 353000,
});
assert.strictEqual(single.totalKrw - split.totals.totalKrw, 62800);

const mixed = costCore.summarizeStrategy("row_unit", "과세 예상 포함", [
  costCore.buildShipment({ productJpy: 30000, shippingJpy: 1800 }, settings),
  costCore.buildShipment({ productJpy: 10000, shippingJpy: 800 }, settings),
]);
assert.strictEqual(mixed.shipments[0].taxable, true);
assert.strictEqual(mixed.shipments[1].taxable, false);
assert.strictEqual(mixed.totals.taxKrw, 59784);
assert.strictEqual(mixed.totals.totalKrw, 485784);
assert.strictEqual(costCore.buildShipment({ productJpy: -1, shippingJpy: -1 }, settings).totalKrw, 0);

assert.deepStrictEqual(costCore.unavailableStrategy("split_quantity", "분할 주문", "분할 불필요"), {
  code: "split_quantity",
  label: "분할 주문",
  available: false,
  reason: "분할 불필요",
  shipmentCount: 0,
  shipments: [],
  totals: null,
});

console.log("cost comparison tests passed");
