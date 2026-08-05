(function initWebikeQuoteResultCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WebikeQuoteResultCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createWebikeQuoteResultCore() {
  const QUOTE_RESULT_SOURCE = "webike-cart-splitter-wizard";
  const QUOTE_RESULT_SCHEMA_VERSION = 1;
  const STRATEGY_CODES = ["split_quantity", "row_unit"];
  const MAX_GROUPS = 20;

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function finiteNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : null;
  }

  function positiveNumber(value) {
    const number = finiteNumber(value);
    return number !== null && number > 0 ? number : null;
  }

  function nonNegativeNumber(value) {
    const number = finiteNumber(value);
    return number !== null && number >= 0 ? number : null;
  }

  function positiveInteger(value) {
    const number = finiteNumber(value);
    return number !== null && Number.isInteger(number) && number > 0 ? number : null;
  }

  function normalizedPartNumber(value) {
    return cleanText(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  function canonicalProductUrl(value) {
    const text = cleanText(value);
    if (!text) return "";
    try {
      const url = new URL(text, "https://www.japan-webike.kr/");
      if (url.origin !== "https://www.japan-webike.kr" || url.username || url.password || url.search || url.hash ||
        !/^\/products\/\d+\.html$/i.test(url.pathname)) {
        return "";
      }
      return `https://www.japan-webike.kr${url.pathname}`;
    } catch {
      return "";
    }
  }

  function sameNumber(left, right) {
    const leftNumber = finiteNumber(left);
    const rightNumber = finiteNumber(right);
    if (leftNumber === null || rightNumber === null) return false;
    return Math.abs(leftNumber - rightNumber) < 1e-9;
  }

  function normalizeSettings(settings, errors) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      errors.push("견적 결과의 계산 기준이 올바르지 않습니다.");
      return null;
    }

    const normalized = {
      limitUsd: positiveNumber(settings.limitUsd),
      usdKrw: positiveNumber(settings.usdKrw),
      jpyKrw: positiveNumber(settings.jpyKrw),
      maxGroups: positiveInteger(settings.maxGroups),
      shippingService: cleanText(settings.shippingService).toUpperCase(),
      importDutyRate: nonNegativeNumber(settings.importDutyRate),
      vatRate: nonNegativeNumber(settings.vatRate),
    };

    if (!normalized.limitUsd) errors.push("견적 결과의 면세 기준이 올바르지 않습니다.");
    if (!normalized.usdKrw) errors.push("견적 결과의 USD 환율이 올바르지 않습니다.");
    if (!normalized.jpyKrw) errors.push("견적 결과의 JPY 환율이 올바르지 않습니다.");
    if (!normalized.maxGroups || normalized.maxGroups > MAX_GROUPS) {
      errors.push(`견적 결과의 최대 주문 수는 1~${MAX_GROUPS} 사이여야 합니다.`);
    }
    if (normalized.importDutyRate === null) errors.push("견적 결과의 관세율이 올바르지 않습니다.");
    if (normalized.vatRate === null) errors.push("견적 결과의 부가세율이 올바르지 않습니다.");
    return normalized;
  }

  function validateExpectedSettings(actual, expected, errors) {
    if (!expected || !actual) return;
    const numericKeys = ["limitUsd", "usdKrw", "jpyKrw", "maxGroups", "importDutyRate", "vatRate"];
    const changed = numericKeys.some((key) => !sameNumber(actual?.[key], expected?.[key])) ||
      cleanText(actual?.shippingService).toUpperCase() !== cleanText(expected?.shippingService).toUpperCase();
    if (changed) {
      errors.push("견적 스크립트 생성 후 계산 기준이 변경되었습니다. 견적 스크립트를 다시 실행해 주세요.");
    }
  }

  function normalizeProducts(products, errors, expectedInputRows) {
    if (!Array.isArray(products) || !products.length) {
      errors.push("견적 결과에 상품이 없습니다.");
      return [];
    }
    if (expectedInputRows && products.length !== expectedInputRows.length) {
      errors.push("견적 상품 수가 현재 입력 상품 수와 다릅니다.");
    }

    const seenIndexes = new Set();
    const normalized = products.map((item, position) => {
      const index = finiteNumber(item?.index);
      const productId = cleanText(item?.productId);
      const code = cleanText(item?.code || item?.partNumber);
      const quantity = positiveInteger(item?.quantity);
      const unitJpy = positiveNumber(item?.unitJpy);
      const totalJpy = positiveNumber(item?.totalJpy);
      const label = `${position + 1}번째 상품`;

      if (index === null || !Number.isInteger(index) || index < 0) {
        errors.push(`${label}의 index가 올바르지 않습니다.`);
      } else if (seenIndexes.has(index)) {
        errors.push(`${label}의 index가 중복되었습니다.`);
      } else {
        seenIndexes.add(index);
      }
      if (!productId) errors.push(`${label}의 상품 ID가 없습니다.`);
      if (!code) errors.push(`${label}의 상품번호가 없습니다.`);
      const actualUrl = canonicalProductUrl(item?.productUrl);
      if (!actualUrl) {
        errors.push(`${label}의 상품 URL이 올바른 Webike 상품 주소가 아닙니다.`);
      } else {
        const urlProductId = (new URL(actualUrl).pathname.match(/^\/products\/(\d+)\.html$/i) || [])[1] || "";
        if (urlProductId !== productId) errors.push(`${label}의 상품 URL ID와 상품 ID가 다릅니다.`);
      }
      if (!quantity) errors.push(`${label}의 수량이 올바르지 않습니다.`);
      if (!unitJpy) errors.push(`${label}의 단가가 올바르지 않습니다.`);
      if (!totalJpy || (quantity && unitJpy && totalJpy !== quantity * unitJpy)) {
        errors.push(`${label}의 합계 금액이 수량과 단가에 맞지 않습니다.`);
      }

      const expectedRow = expectedInputRows?.[index];
      if (expectedRow) {
        if (quantity && quantity !== positiveInteger(expectedRow.quantity)) {
          errors.push(`${label}의 수량이 현재 입력과 다릅니다.`);
        }
        const requestedPartNumber = normalizedPartNumber(expectedRow.partNumber);
        const actualIdentifiers = [code, productId].map(normalizedPartNumber).filter(Boolean);
        if (requestedPartNumber && !actualIdentifiers.includes(requestedPartNumber)) {
          errors.push(`${label}의 상품번호가 현재 입력과 다릅니다.`);
        }
        const requestedUrlText = cleanText(expectedRow.productUrl);
        const requestedUrl = canonicalProductUrl(requestedUrlText);
        if (requestedUrlText && !requestedUrl) {
          errors.push(`${label}의 현재 입력 상품 URL이 허용되지 않는 주소입니다.`);
        } else if (requestedUrl && requestedUrl !== actualUrl) {
          errors.push(`${label}의 상품 URL이 현재 입력과 다릅니다.`);
        }
      }

      return {
        ...item,
        index,
        productId,
        code,
        name: cleanText(item?.name || code),
        productUrl: cleanText(item?.productUrl),
        quantity,
        unitJpy,
        totalJpy,
      };
    });

    if (normalized.some((item, index) => item.index !== index)) {
      errors.push("견적 상품 index가 현재 입력 순서와 일치하지 않습니다.");
    }
    return normalized;
  }

  function inventorySignature(products) {
    return products.map((item) => `${item.index}:${item.productId}:${item.quantity}:${item.unitJpy}`)
      .sort()
      .join("|");
  }

  function shipmentSetSignature(shipments) {
    return shipments.map((shipment) => inventorySignature(shipment.products)).sort().join("||");
  }

  function recommendationInventorySignature(recommendation) {
    const quantities = new Map();
    const groups = [
      ...(Array.isArray(recommendation?.taxableGroups) ? recommendation.taxableGroups : []),
      ...(Array.isArray(recommendation?.groups) ? recommendation.groups : []),
    ];
    groups.forEach((group) => {
      group.forEach((atom) => {
        const index = Number(atom?.productIndex);
        if (!Number.isInteger(index)) return;
        quantities.set(index, (quantities.get(index) || 0) + Number(atom?.quantity || 0));
      });
    });
    return [...quantities.entries()].sort((left, right) => left[0] - right[0])
      .map(([index, quantity]) => `${index}:${quantity}`)
      .join("|");
  }

  function productInventorySignature(products) {
    return [...products]
      .sort((left, right) => Number(left.index) - Number(right.index))
      .map((product) => `${product.index}:${product.quantity}`)
      .join("|");
  }

  function validateShipment(shipment, label, productByIndex, errors) {
    if (!shipment || typeof shipment !== "object" || Array.isArray(shipment)) {
      errors.push(`${label} 정보가 올바르지 않습니다.`);
      return null;
    }
    const shippingJpy = nonNegativeNumber(shipment.shippingJpy);
    if (shippingJpy === null) errors.push(`${label} 배송비가 올바르지 않습니다.`);
    if (!Array.isArray(shipment.products) || !shipment.products.length) {
      errors.push(`${label}에 상품이 없습니다.`);
      return null;
    }

    const seenIndexes = new Set();
    const products = shipment.products.map((item, position) => {
      const itemLabel = `${label}의 ${position + 1}번째 상품`;
      const index = finiteNumber(item?.index);
      const expected = productByIndex.get(index);
      const quantity = positiveInteger(item?.quantity);
      const unitJpy = positiveNumber(item?.unitJpy);
      const totalJpy = positiveNumber(item?.totalJpy);
      const productId = cleanText(item?.productId);

      if (index === null || !Number.isInteger(index) || !expected) {
        errors.push(`${itemLabel} index가 원본 상품과 일치하지 않습니다.`);
      } else if (seenIndexes.has(index)) {
        errors.push(`${itemLabel} index가 중복되었습니다.`);
      } else {
        seenIndexes.add(index);
      }
      if (!productId || (expected && productId !== expected.productId)) {
        errors.push(`${itemLabel} ID가 원본 상품과 일치하지 않습니다.`);
      }
      if (!quantity) errors.push(`${itemLabel} 수량이 올바르지 않습니다.`);
      if (!unitJpy || (expected && unitJpy !== expected.unitJpy)) {
        errors.push(`${itemLabel} 단가가 원본 상품과 일치하지 않습니다.`);
      }
      if (!totalJpy || (quantity && unitJpy && totalJpy !== quantity * unitJpy)) {
        errors.push(`${itemLabel} 합계 금액이 수량과 단가에 맞지 않습니다.`);
      }

      return { index, productId, quantity, unitJpy, totalJpy };
    });

    const productJpy = positiveNumber(shipment.productJpy);
    const calculatedProductJpy = products.reduce((sum, item) => sum + (item.totalJpy || 0), 0);
    if (!productJpy || productJpy !== calculatedProductJpy) {
      errors.push(`${label} 상품가 합계가 상품 구성과 일치하지 않습니다.`);
    }
    return { ...shipment, productJpy, shippingJpy, products };
  }

  function validateQuoteResultEnvelope(result) {
    const errors = [];
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return { valid: false, errors: ["견적 결과는 JSON 객체여야 합니다."] };
    }
    if (result.source !== QUOTE_RESULT_SOURCE) {
      errors.push("Webike Cart Splitter가 생성한 견적 결과가 아닙니다.");
    }
    if (result.schemaVersion !== QUOTE_RESULT_SCHEMA_VERSION) {
      errors.push("지원하지 않는 견적 결과 버전입니다. 견적 스크립트를 다시 생성해 주세요.");
    }
    if (!["measured", "failed"].includes(result.status)) {
      errors.push("견적 결과 상태가 올바르지 않습니다.");
    }
    return { valid: errors.length === 0, errors };
  }

  function validateFailedQuoteResult(result) {
    const envelope = validateQuoteResultEnvelope(result);
    if (!envelope.valid) return envelope;

    const errors = [];
    if (result.status !== "failed") {
      errors.push("실패 상태의 견적 결과가 아닙니다.");
    }
    if (!Array.isArray(result.products)) {
      errors.push("실패 견적의 상품 목록이 올바르지 않습니다.");
    }
    if (!Array.isArray(result.automationResults) || !result.automationResults.length) {
      errors.push("실패 견적의 자동화 결과가 올바르지 않습니다.");
    } else {
      result.automationResults.forEach((item, index) => {
        const label = `${index + 1}번째 자동화 결과`;
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          errors.push(`${label}가 올바르지 않습니다.`);
          return;
        }
        if (!["parsed", "failed"].includes(item.status)) {
          errors.push(`${label}의 상태가 올바르지 않습니다.`);
        }
        if (!Array.isArray(item.errors)) {
          errors.push(`${label}의 오류 목록이 올바르지 않습니다.`);
          return;
        }
        if (item.errors.some((error) => typeof error !== "string" || !cleanText(error))) {
          errors.push(`${label}의 오류 메시지가 올바르지 않습니다.`);
        }
        if (item.status === "failed" && !item.errors.length) {
          errors.push(`${label}에 실패 사유가 없습니다.`);
        }
      });
    }
    return { valid: errors.length === 0, errors };
  }

  function validateQuoteResult(result, options = {}) {
    const envelope = validateQuoteResultEnvelope(result);
    const errors = [...envelope.errors];
    if (!envelope.valid) return { valid: false, errors, products: [], settings: null, measurement: null };
    if (result.status !== "measured") {
      errors.push("배송비 측정이 완료된 견적 결과가 아닙니다.");
    }

    const settings = normalizeSettings(result.settings, errors);
    validateExpectedSettings(settings, options.expectedSettings, errors);
    const products = normalizeProducts(result.products, errors, options.expectedInputRows);
    const productByIndex = new Map(products.map((item) => [item.index, item]));
    const measurement = result.measurement;
    if (!measurement || typeof measurement !== "object" || Array.isArray(measurement)) {
      errors.push("견적 결과에 배송비 측정 정보가 없습니다.");
    } else {
      const single = validateShipment(measurement.singleShipment, "한 번에 주문", productByIndex, errors);
      if (single && inventorySignature(single.products) !== inventorySignature(products)) {
        errors.push("한 번에 주문의 상품 구성이 원본 상품과 일치하지 않습니다.");
      }
      if (!measurement.strategies || typeof measurement.strategies !== "object" || Array.isArray(measurement.strategies)) {
        errors.push("견적 결과에 분할 주문 전략 정보가 없습니다.");
      } else {
        STRATEGY_CODES.forEach((code) => {
          const strategy = measurement.strategies[code];
          if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) {
            errors.push(`${code} 측정 정보가 없습니다.`);
            return;
          }
          if (!Array.isArray(strategy.splitShipments)) {
            errors.push(`${code} 배송 그룹 정보가 올바르지 않습니다.`);
            return;
          }
          strategy.splitShipments.forEach((shipment, index) => {
            validateShipment(shipment, `${code} 주문 ${index + 1}`, productByIndex, errors);
          });
        });
      }
    }

    return { valid: errors.length === 0, errors, products, settings, measurement };
  }

  function productsFromRecommendationGroup(group, productByIndex) {
    const quantities = new Map();
    group.forEach((atom) => {
      quantities.set(atom.productIndex, (quantities.get(atom.productIndex) || 0) + atom.quantity);
    });
    return [...quantities.entries()].map(([index, quantity]) => {
      const product = productByIndex.get(index);
      return {
        index,
        productId: product?.productId || "",
        quantity,
        unitJpy: product?.unitJpy || 0,
      };
    });
  }

  function validateRecommendationMeasurements(recommendations, measurement, products) {
    const errors = [];
    const productByIndex = new Map(products.map((item) => [item.index, item]));
    STRATEGY_CODES.forEach((code) => {
      const recommendation = recommendations?.[code];
      const measured = measurement?.strategies?.[code];
      if (!recommendation || !measured) {
        errors.push(`${code} 추천 또는 측정 정보가 없습니다.`);
        return;
      }
      const summary = measured.recommendationSummary;
      const taxableGroupCount = recommendation.taxableGroups?.length || 0;
      const orderGroupCount = taxableGroupCount + recommendation.groups.length;
      if (!summary || summary.totalJpy !== recommendation.totalJpy ||
        summary.groupCount !== recommendation.groups.length ||
        summary.oversizeCount !== recommendation.oversize.length ||
        (summary.taxableGroupCount !== undefined &&
          summary.taxableGroupCount !== taxableGroupCount) ||
        (summary.orderGroupCount !== undefined && summary.orderGroupCount !== orderGroupCount)) {
        errors.push(`${code} 추천 요약이 현재 계산 결과와 일치하지 않습니다.`);
      }
      if (recommendation.complete === false ||
        recommendationInventorySignature(recommendation) !== productInventorySignature(products)) {
        errors.push(`${code} 추천 그룹이 전체 상품 수량을 포함하지 않습니다.`);
      }

      const usesCurrentShippingMeasurement = summary?.orderGroupCount !== undefined;
      const orderedRecommendationGroups = usesCurrentShippingMeasurement
        ? [
          ...(recommendation.taxableGroups || []),
          ...(recommendation.groups || []),
        ]
        : recommendation.taxableGroups?.length
        ? []
        : recommendation.groups;
      const expectedGroups = orderedRecommendationGroups.length > 1
        ? orderedRecommendationGroups.map((group) => ({ products: productsFromRecommendationGroup(group, productByIndex) }))
        : [];
      const measuredGroups = Array.isArray(measured.splitShipments) ? measured.splitShipments : [];
      if (shipmentSetSignature(expectedGroups) !== shipmentSetSignature(measuredGroups)) {
        errors.push(`${code} 배송비 측정 그룹이 현재 추천 그룹과 일치하지 않습니다.`);
      }
    });
    return { valid: errors.length === 0, errors };
  }

  return {
    QUOTE_RESULT_SOURCE,
    QUOTE_RESULT_SCHEMA_VERSION,
    STRATEGY_CODES,
    canonicalProductUrl,
    inventorySignature,
    shipmentSetSignature,
    validateQuoteResultEnvelope,
    validateFailedQuoteResult,
    validateQuoteResult,
    validateRecommendationMeasurements,
  };
});
