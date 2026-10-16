(function initWebikeCostComparisonCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WebikeCostComparisonCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createWebikeCostComparisonCore() {
  const DEFAULT_COST_SETTINGS = {
    limitUsd: 150,
    usdKrw: 1465.73,
    jpyKrw: 9.3399,
    importDutyRate: 0.08,
    vatRate: 0.1,
  };

  function toNumber(value) {
    const number = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : 0;
  }

  function positiveNumber(value, fallback) {
    const number = toNumber(value);
    return number > 0 ? number : fallback;
  }

  function nonNegativeNumber(value, fallback = 0) {
    const number = toNumber(value);
    return number >= 0 ? number : fallback;
  }

  function normalizeRate(value, fallback) {
    const number = toNumber(value);
    if (number <= 0) return fallback;
    return number > 1 ? number / 100 : number;
  }

  function normalizeCostSettings(settings = {}) {
    return {
      limitUsd: positiveNumber(settings.limitUsd, DEFAULT_COST_SETTINGS.limitUsd),
      usdKrw: positiveNumber(settings.usdKrw, DEFAULT_COST_SETTINGS.usdKrw),
      jpyKrw: positiveNumber(settings.jpyKrw, DEFAULT_COST_SETTINGS.jpyKrw),
      importDutyRate: normalizeRate(settings.importDutyRate, DEFAULT_COST_SETTINGS.importDutyRate),
      vatRate: normalizeRate(settings.vatRate, DEFAULT_COST_SETTINGS.vatRate),
    };
  }

  function roundKrw(value) {
    return Math.round(toNumber(value));
  }

  function jpyToKrw(jpy, settings) {
    return roundKrw(toNumber(jpy) * settings.jpyKrw);
  }

  function krwToUsd(krw, settings) {
    return toNumber(krw) / settings.usdKrw;
  }

  function jpyToUsd(jpy, settings) {
    return krwToUsd(toNumber(jpy) * settings.jpyKrw, settings);
  }

  function productTotalJpy(products) {
    return products.reduce((sum, item) => sum + toNumber(item.totalJpy || (item.unitJpy * item.quantity)), 0);
  }

  function taxableByProductValue(productJpy, settings) {
    return jpyToUsd(productJpy, settings) > settings.limitUsd;
  }

  function calculateImportTaxes(productJpy, shippingJpy, settingsInput = {}) {
    const settings = normalizeCostSettings(settingsInput);
    const normalizedProductJpy = nonNegativeNumber(productJpy);
    const normalizedShippingJpy = nonNegativeNumber(shippingJpy);
    const taxable = taxableByProductValue(normalizedProductJpy, settings);

    if (!taxable) {
      return {
        taxable: false,
        customsValueJpy: normalizedProductJpy,
        customsValueKrw: jpyToKrw(normalizedProductJpy, settings),
        dutyKrw: 0,
        vatKrw: 0,
        taxKrw: 0,
      };
    }

    const customsValueJpy = normalizedProductJpy + normalizedShippingJpy;
    const customsValueKrw = jpyToKrw(customsValueJpy, settings);
    const dutyKrw = roundKrw(customsValueKrw * settings.importDutyRate);
    const vatKrw = roundKrw((customsValueKrw + dutyKrw) * settings.vatRate);

    return {
      taxable: true,
      customsValueJpy,
      customsValueKrw,
      dutyKrw,
      vatKrw,
      taxKrw: dutyKrw + vatKrw,
    };
  }

  function buildShipment(shipment, settingsInput = {}) {
    const settings = normalizeCostSettings(settingsInput);
    const productJpy = nonNegativeNumber(shipment?.productJpy);
    const shippingJpy = nonNegativeNumber(shipment?.shippingJpy);
    const taxes = calculateImportTaxes(productJpy, shippingJpy, settings);
    const productKrw = jpyToKrw(productJpy, settings);
    const shippingKrw = jpyToKrw(shippingJpy, settings);

    return {
      label: shipment?.label || "",
      productJpy,
      shippingJpy,
      productUsd: jpyToUsd(productJpy, settings),
      productKrw,
      shippingKrw,
      totalBeforeTaxKrw: productKrw + shippingKrw,
      totalKrw: productKrw + shippingKrw + taxes.taxKrw,
      ...taxes,
    };
  }

  function summarizeStrategy(code, label, shipments) {
    const totals = shipments.reduce((sum, item) => ({
      productJpy: sum.productJpy + item.productJpy,
      shippingJpy: sum.shippingJpy + item.shippingJpy,
      productKrw: sum.productKrw + item.productKrw,
      shippingKrw: sum.shippingKrw + item.shippingKrw,
      dutyKrw: sum.dutyKrw + item.dutyKrw,
      vatKrw: sum.vatKrw + item.vatKrw,
      taxKrw: sum.taxKrw + item.taxKrw,
      totalKrw: sum.totalKrw + item.totalKrw,
    }), {
      productJpy: 0,
      shippingJpy: 0,
      productKrw: 0,
      shippingKrw: 0,
      dutyKrw: 0,
      vatKrw: 0,
      taxKrw: 0,
      totalKrw: 0,
    });

    return {
      code,
      label,
      available: true,
      shipmentCount: shipments.length,
      shipments,
      totals,
    };
  }

  function unavailableStrategy(code, label, reason) {
    return {
      code,
      label,
      available: false,
      reason,
      shipmentCount: 0,
      shipments: [],
      totals: null,
    };
  }

  return {
    DEFAULT_COST_SETTINGS,
    toNumber,
    positiveNumber,
    nonNegativeNumber,
    normalizeRate,
    normalizeCostSettings,
    jpyToKrw,
    jpyToUsd,
    productTotalJpy,
    taxableByProductValue,
    calculateImportTaxes,
    buildShipment,
    summarizeStrategy,
    unavailableStrategy,
  };
});
