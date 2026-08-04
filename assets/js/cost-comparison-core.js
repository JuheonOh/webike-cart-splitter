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
    singleShippingJpy: 0,
    splitShippingJpy: 0,
    fixedFeeKrw: 0,
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
      singleShippingJpy: nonNegativeNumber(settings.singleShippingJpy, DEFAULT_COST_SETTINGS.singleShippingJpy),
      splitShippingJpy: nonNegativeNumber(settings.splitShippingJpy, DEFAULT_COST_SETTINGS.splitShippingJpy),
      fixedFeeKrw: nonNegativeNumber(settings.fixedFeeKrw, DEFAULT_COST_SETTINGS.fixedFeeKrw),
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
      totalKrw: productKrw + shippingKrw + taxes.taxKrw + settings.fixedFeeKrw,
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

  function groupProductTotalJpy(group) {
    return group.reduce((sum, item) => sum + toNumber(item.totalJpy), 0);
  }

  function cheapestStrategy(strategies) {
    return strategies.filter((strategy) => strategy.available).reduce((best, strategy) => {
      if (!best) return strategy;
      return strategy.totals.totalKrw < best.totals.totalKrw ? strategy : best;
    }, null);
  }

  function comparisonResult(settings, strategies, extra = {}) {
    const single = strategies.find((strategy) => strategy.code === "single_order");
    const split = strategies.find((strategy) => strategy.code === "split_tax_free");
    const cheapest = cheapestStrategy(strategies);
    const canCompare = Boolean(single?.available && split?.available);

    return {
      settings,
      strategies,
      cheapestCode: cheapest?.code || "",
      differenceKrw: canCompare ? Math.abs(single.totals.totalKrw - split.totals.totalKrw) : null,
      comparedAt: new Date().toISOString(),
      ...extra,
    };
  }

  function compareOrderStrategies(products, recommendation, settingsInput = {}) {
    const settings = normalizeCostSettings(settingsInput);
    const productJpy = productTotalJpy(products);
    const single = summarizeStrategy("single_order", "한 번에 주문", [
      buildShipment({
        label: "주문 1",
        productJpy,
        shippingJpy: settings.singleShippingJpy,
      }, settings),
    ]);

    const groups = Array.isArray(recommendation?.groups) ? recommendation.groups : [];
    const taxableGroups = Array.isArray(recommendation?.taxableGroups) ? recommendation.taxableGroups : [];
    const split = groups.length && recommendation?.complete !== false && !taxableGroups.length
      ? summarizeStrategy("split_tax_free", "150 USD 이하 분할 주문", groups.map((group, index) => buildShipment({
        label: `주문 ${index + 1}`,
        productJpy: groupProductTotalJpy(group),
        shippingJpy: settings.splitShippingJpy,
      }, settings)))
      : unavailableStrategy(
        "split_tax_free",
        "150 USD 이하 분할 주문",
        recommendation?.oversize?.length
          ? "단일 계산 단위가 면세 한도를 초과했습니다."
          : "지정한 최대 주문 수 안에서 분할 그룹을 찾지 못했습니다.",
      );

    return comparisonResult(settings, [single, split], { measurementMode: "fixed_shipping" });
  }

  function normalizeMeasuredShipment(shipment, label) {
    const products = Array.isArray(shipment?.products) ? shipment.products : [];
    return {
      label: shipment?.label || label,
      productJpy: nonNegativeNumber(shipment?.productJpy || productTotalJpy(products)),
      shippingJpy: nonNegativeNumber(shipment?.shippingJpy),
    };
  }

  function compareMeasuredOrderStrategies(measurement = {}, settingsInput = {}) {
    const settings = normalizeCostSettings(settingsInput);
    const singleInput = measurement.singleShipment || measurement.single;
    const splitInputs = Array.isArray(measurement.splitShipments) ? measurement.splitShipments : [];
    const single = singleInput
      ? summarizeStrategy("single_order", "한 번에 주문", [
        buildShipment(normalizeMeasuredShipment(singleInput, "주문 1"), settings),
      ])
      : unavailableStrategy("single_order", "한 번에 주문", "단일 주문 배송비 실측값이 없습니다.");
    const split = splitInputs.length
      ? summarizeStrategy("split_tax_free", "150 USD 이하 분할 주문", splitInputs.map((shipment, index) => (
        buildShipment(normalizeMeasuredShipment(shipment, `주문 ${index + 1}`), settings)
      )))
      : unavailableStrategy(
        "split_tax_free",
        "150 USD 이하 분할 주문",
        measurement.splitUnavailableReason || "분할 주문 배송비 실측값이 없습니다.",
      );

    return comparisonResult(settings, [single, split], { measurementMode: "measured_shipping" });
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
    compareOrderStrategies,
    compareMeasuredOrderStrategies,
  };
});
