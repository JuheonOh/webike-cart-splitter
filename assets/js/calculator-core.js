(function initWebikeCartCore(root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WebikeCartCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createWebikeCartCore(root = {}) {
  const groupingApi = root.WebikeCartGrouping ||
    (typeof require !== "undefined" ? require("./calculator-grouping.js") : null);
  if (!groupingApi) {
    throw new Error("WebikeCartGrouping 모듈을 불러오지 못했습니다.");
  }
  const delimitedApi = root.WebikeDelimitedCore ||
    (typeof require !== "undefined" ? require("./delimited-core.js") : null);
  if (!delimitedApi) {
    throw new Error("WebikeDelimitedCore 모듈을 불러오지 못했습니다.");
  }
  const exchangeRatePolicyApi = root.WebikeExchangeRatePolicy ||
    (typeof require !== "undefined" ? require("./exchange-rate-policy.js") : null);
  if (!exchangeRatePolicyApi) {
    throw new Error("WebikeExchangeRatePolicy 모듈을 불러오지 못했습니다.");
  }
  const {
    parseDelimitedRows,
    normalizeHeader,
    findColumn,
  } = delimitedApi;
  const {
    GROUPING_LIMITS,
    validateGroupingRequest,
    makeAtoms,
    twoGroupDp,
    twoGroupDpResult,
    firstFitDecreasing,
    recommendGroups,
    aggregateGroup,
  } = groupingApi;
  const { getExchangeRatePeriodStatus } = exchangeRatePolicyApi;
  const SETTINGS_STORAGE_KEY = "webike-cart-splitter-settings-v1";
  const EXCHANGE_RATE_SOURCE_URL = "https://www.forwarder.kr/curr/index.php?curr=ex_rate";
  const DEFAULT_SETTINGS = {
    limitUsd: 150,
    usdKrw: 1465.73,
    jpyKrw: 9.3399,
    maxGroups: 8,
    splitQuantity: true,
  };
  const CART_ROW_SELECTORS = [
    ".table-cart tbody tr.item",
    ".table-cart tbody tr[id^='product-item']",
    ".table-cart tbody tr[data-sku]",
    ".table-cart tbody tr[data-product-code]",
    ".table-cart tbody tr[data-product-id]",
    ".table-cart tbody tr",
    "tr[id^='product-item']",
    "tr[data-sku]",
    "tr[data-product-code]",
    "tr[data-product-id]",
    ".cart-item",
    ".cart-list-item",
    "[data-cart-item]",
  ];
  const PRODUCT_CODE_SELECTORS = [
    ".product-code .code",
    ".product-code",
    ".goods-code",
    ".item-code",
    ".sku",
    "[data-product-code]",
    "[data-sku]",
    "input[name='prdSku']",
    "input[name='sku']",
    "input[name='productCode']",
    "input[name='product_code']",
  ];
  const PRODUCT_NAME_SELECTORS = [
    ".product-name a",
    ".product-name",
    ".goods-name a",
    ".goods-name",
    ".item-name a",
    ".item-name",
    ".product-title a",
    ".product-title",
    "[data-product-name]",
  ];
  const PRODUCT_URL_SELECTORS = [
    ".product-name a",
    ".goods-name a",
    ".item-name a",
    ".product-title a",
    "a[href*='/products/']",
    "[data-product-url]",
    "[data-url]",
  ];
  const QUANTITY_SELECTORS = [
    ".product-quantity",
    ".qty-inp",
    ".quantity input",
    ".quantity",
    ".qty",
    "input[name='quantity']",
    "input[name='qty']",
    "input[name*='quantity' i]",
    "input[name*='qty' i]",
    "select[name*='quantity' i]",
    "select[name*='qty' i]",
    "[data-quantity]",
    "[data-qty]",
  ];
  const UNIT_PRICE_SELECTORS = [
    ".unit-sub-price",
    ".unit-price",
    ".price-unit",
    ".product-price",
    ".item-price",
    ".price",
    "[data-unit-price]",
    "[data-price]",
  ];
  const TOTAL_PRICE_SELECTORS = [
    ".total-sub-price",
    ".subtotal-price",
    ".subtotal",
    ".total-price",
    ".line-total",
    ".amount",
    "[data-total-price]",
    "[data-subtotal]",
  ];

  function toNumber(value) {
    const number = Number(String(value || "").replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : 0;
  }

  function positiveNumber(value, fallback) {
    const number = toNumber(value);
    return number > 0 ? number : fallback;
  }

  function positiveInteger(value, fallback) {
    const number = Math.round(toNumber(value));
    return number > 0 ? number : fallback;
  }

  function normalizeStoredSettings(settings) {
    const source = settings && typeof settings === "object" ? settings : {};
    return {
      limitUsd: positiveNumber(source.limitUsd, DEFAULT_SETTINGS.limitUsd),
      usdKrw: positiveNumber(source.usdKrw, DEFAULT_SETTINGS.usdKrw),
      jpyKrw: positiveNumber(source.jpyKrw, DEFAULT_SETTINGS.jpyKrw),
      maxGroups: Math.min(positiveInteger(source.maxGroups, DEFAULT_SETTINGS.maxGroups), GROUPING_LIMITS.maxGroups),
      splitQuantity: typeof source.splitQuantity === "boolean" ? source.splitQuantity : DEFAULT_SETTINGS.splitQuantity,
    };
  }

  function readStoredSettings(storage) {
    try {
      const target = storage || window.localStorage;
      return normalizeStoredSettings(JSON.parse(target.getItem(SETTINGS_STORAGE_KEY) || "{}"));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function writeStoredSettings(settings, storage) {
    try {
      const target = storage || window.localStorage;
      target.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalizeStoredSettings(settings)));
      return true;
    } catch {
      return false;
    }
  }

  function hasStoredSettings(storage) {
    try {
      const target = storage || window.localStorage;
      return target.getItem(SETTINGS_STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  function normalizeExchangeRateData(data) {
    const source = data && typeof data === "object" ? data : {};
    const rates = source.rates && typeof source.rates === "object" ? source.rates : {};
    const usd = positiveNumber(rates.USD, 0);
    const jpy = positiveNumber(rates.JPY, 0);

    if (!usd || !jpy) return null;

    return {
      source: cleanText(source.source || "forwarder.kr"),
      sourceUrl: cleanText(source.sourceUrl || EXCHANGE_RATE_SOURCE_URL),
      period: cleanText(source.period || ""),
      updatedAt: cleanText(source.updatedAt || ""),
      rates: {
        USD: usd,
        JPY: jpy,
      },
    };
  }

  function firstNumber(value) {
    const match = String(value || "").match(/[\d,]+(?:\.\d+)?/);
    return match ? toNumber(match[0]) : 0;
  }

  function parseJpy(text) {
    const value = String(text || "").replace(/\u00a0/g, " ");
    const patterns = [
      /(?:JPY|￥|¥)\s*([\d,]+(?:\.\d+)?)/i,
      /([\d,]+(?:\.\d+)?)\s*(?:JPY|円)/i,
    ];

    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) return Math.round(toNumber(match[1]));
    }

    return /^[\s\d,.]+$/.test(value) ? Math.round(firstNumber(value)) : 0;
  }

  function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function datasetValue(element, keys) {
    for (const key of keys) {
      const value = element?.dataset?.[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return cleanText(value);
      }
    }
    return "";
  }

  function attributeValue(element, names) {
    for (const name of names) {
      const value = element?.getAttribute?.(name);
      if (value !== undefined && value !== null && String(value).trim()) {
        return cleanText(value);
      }
    }
    return "";
  }

  function firstElement(root, selectors) {
    for (const selector of selectors) {
      const element = root?.querySelector?.(selector);
      if (element) return element;
    }
    return null;
  }

  function textFrom(root, selectors) {
    const element = firstElement(root, selectors);
    return cleanText(element?.textContent) ||
      cleanText(element?.value) ||
      attributeValue(element, ["value", "title", "aria-label"]);
  }

  function productCodeFromRow(row) {
    return textFrom(row, PRODUCT_CODE_SELECTORS) ||
      datasetValue(row, ["sku", "productCode", "productId", "code"]) ||
      attributeValue(row, ["data-sku", "data-product-code", "data-product-id"]);
  }

  function productNameFromRow(row) {
    return textFrom(row, PRODUCT_NAME_SELECTORS) ||
      datasetValue(row, ["productName", "name"]) ||
      attributeValue(row, ["data-product-name", "title", "aria-label"]);
  }

  function productUrlFromRow(row) {
    const rowValue = datasetValue(row, ["productUrl", "url", "href"]) ||
      attributeValue(row, ["data-product-url", "data-url", "href"]);
    if (rowValue) return rowValue;

    const element = firstElement(row, PRODUCT_URL_SELECTORS);
    return attributeValue(element, ["href", "data-product-url", "data-url"]) ||
      cleanText(element?.href);
  }

  function productCodeFromId(id) {
    const value = cleanText(id);
    if (!value) return "";
    const cleaned = value.replace(/^(product-item|cart-item|item)[_-]?/i, "");
    if (cleaned !== value) return cleanText(cleaned);
    return /^[A-Z0-9][A-Z0-9._-]{4,}$/i.test(value) ? value : "";
  }

  function priceFromRow(row, selectors, datasetKeys, attributeNames) {
    for (const selector of selectors) {
      const element = row?.querySelector?.(selector);
      const parsed = parseJpy(
        cleanText(element?.textContent) ||
        cleanText(element?.value) ||
        attributeValue(element, ["value", "data-price", "data-unit-price", "data-total-price", "data-subtotal"]),
      );
      if (parsed > 0) return parsed;
    }

    const dataValue = datasetValue(row, datasetKeys);
    if (dataValue) {
      const parsed = parseJpy(dataValue);
      if (parsed > 0) return parsed;
    }

    const attrValue = attributeValue(row, attributeNames);
    if (attrValue) {
      const parsed = parseJpy(attrValue);
      if (parsed > 0) return parsed;
    }

    return 0;
  }

  function quantityFromRow(row) {
    const quantityText = textFrom(row, QUANTITY_SELECTORS) ||
      datasetValue(row, ["quantity", "qty"]) ||
      attributeValue(row, ["data-quantity", "data-qty"]);
    const quantity = firstNumber(quantityText);
    if (quantity > 0) return Math.max(1, Math.round(quantity));

    const rowMatch = cleanText(row?.textContent).match(/(?:수량|数量|qty|quantity)\s*[:：]?\s*([\d,]+)/i);
    return rowMatch ? Math.max(1, Math.round(toNumber(rowMatch[1]))) : 1;
  }

  function hasProductSignal(row) {
    const hasIdentity = Boolean(productCodeFromRow(row) || productNameFromRow(row) || productCodeFromId(row?.id));
    const hasPrice = Boolean(
      priceFromRow(row, UNIT_PRICE_SELECTORS, ["unitJpy", "unitPrice", "price"], ["data-unit-price", "data-price"]) ||
      priceFromRow(row, TOTAL_PRICE_SELECTORS, ["totalJpy", "totalPrice", "subtotal"], ["data-total-price", "data-subtotal"]),
    );
    return hasIdentity && hasPrice;
  }

  function escapeXml(value) {
    return String(value ?? "").replace(/[<>&'"]/g, (char) => ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    }[char]));
  }

  function unescapeXml(value) {
    return String(value ?? "")
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");
  }

  function escapeHtml(value) {
    return escapeXml(value);
  }

  function xlsxCell(value, style = "", type = "", hyperlink = "") {
    return { value, style, type, hyperlink };
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function makeXlsxFileName() {
    const now = new Date();
    return [
      "webike_cart_groups_",
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      "_",
      pad(now.getHours()),
      pad(now.getMinutes()),
      ".xlsx",
    ].join("");
  }

  function groupTotals(group, settings) {
    const totalJpy = group.reduce((sum, item) => sum + item.totalJpy, 0);
    const totalKrw = totalJpy * settings.jpyKrw;
    const totalUsd = totalKrw / settings.usdKrw;
    return {
      totalJpy,
      totalKrw,
      totalUsd,
      marginUsd: settings.limitUsd - totalUsd,
      marginKrw: (settings.limitUsd * settings.usdKrw) - totalKrw,
    };
  }

  function recommendationStatus(recommendation) {
    if (recommendation.complete === false && recommendation.reasonCode === "atom_over_limit") {
      return {
        label: "주문 계획 미완성",
        style: "statusWarn",
        reason: "최대 주문 수 안에 모든 품목을 배치하지 못했습니다.",
        action: "최대 주문 수를 늘린 뒤 다시 계산하세요.",
      };
    }
    if (recommendation.taxableGroups?.length) {
      return {
        label: "과세 예상 주문 포함",
        style: "statusBad",
        reason: "개당 한도 초과 품목을 별도 주문으로 분리했습니다.",
        action: "해당 주문은 관세·부가세와 추가 통관 절차를 확인하세요.",
      };
    }
    if (recommendation.oversize.length) {
      return {
        label: "단일 품목 한도 초과",
        style: "statusBad",
        reason: "단일 품목 가격이 JPY 한도를 초과했습니다.",
        action: "수량 분할 또는 주문 조건을 다시 확인하세요.",
      };
    }
    if (!recommendation.groups.length) {
      return {
        label: "추천 실패",
        style: "statusWarn",
        reason: "지정한 최대 주문 수 안에서 한도 이하 그룹을 찾지 못했습니다.",
        action: "최대 주문 수를 늘리거나 수량 분할을 켜고 다시 계산하세요.",
      };
    }
    return {
      label: "분할 가능",
      style: "statusOk",
      reason: "모든 추천 주문이 면세 기준 이하입니다.",
      action: "Webike 최종 금액, 배송비, 쿠폰, 포인트, 품절 상태를 주문 전 확인하세요.",
    };
  }

  function groupMarginStatus(marginUsd) {
    if (marginUsd < 0) {
      return { label: "한도 초과", style: "statusBad", marginStyle: "marginBad" };
    }
    if (marginUsd < 5) {
      return { label: "한도 근접", style: "statusWarn", marginStyle: "marginWarn" };
    }
    return { label: "정상", style: "statusOk", marginStyle: "marginOk" };
  }

  function buildGroupRows(products, recommendation, settings) {
    const productHeader = [
      xlsxCell("주문", "header"),
      xlsxCell("상태", "header"),
      xlsxCell("상품번호", "header"),
      xlsxCell("상품명", "header"),
      xlsxCell("수량", "header"),
      xlsxCell("단가 (JPY)", "header"),
      xlsxCell("소계 (JPY)", "header"),
      xlsxCell("그룹합계 (USD)", "header"),
      xlsxCell("여유 (USD)", "header"),
      xlsxCell("실행확인", "header"),
      xlsxCell("메모", "header"),
    ];
    const rows = [];

    const taxableGroups = Array.isArray(recommendation.taxableGroups) ? recommendation.taxableGroups : [];
    const taxFreeGroups = Array.isArray(recommendation.groups) ? recommendation.groups : [];
    const orderGroups = [
      ...taxableGroups.map((group) => ({ group, taxable: true })),
      ...taxFreeGroups.map((group) => ({ group, taxable: false })),
    ];

    if (orderGroups.length) {
      rows.push(productHeader);
      if (recommendation.complete === false) {
        rows.push([
          xlsxCell("-", "sectionText"),
          xlsxCell("주문 계획 미완성", "statusWarn"),
          xlsxCell("확인 필요", "sectionText"),
          xlsxCell("최대 주문 수 안에 모든 품목을 배치하지 못했습니다.", "sectionText"),
          xlsxCell("", "sectionText"),
          xlsxCell("", "sectionText"),
          xlsxCell("", "sectionText"),
          xlsxCell("", "sectionText"),
          xlsxCell("", "sectionText"),
          xlsxCell("미확인", "checkCell"),
          xlsxCell("최대 주문 수를 늘린 뒤 다시 계산하세요.", "noteBox"),
        ]);
      }
      orderGroups.forEach(({ group, taxable }, index) => {
        const totals = groupTotals(group, settings);
        const groupItems = aggregateGroup(group);
        const status = taxable
          ? { label: "과세 예상", style: "statusBad", marginStyle: "marginBad" }
          : groupMarginStatus(totals.marginUsd);
        const note = taxable
          ? "관세·부가세 및 추가 통관 절차 확인"
          : "Webike 최종 금액 확인";
        rows.push([
          xlsxCell(index + 1, "sectionInteger"),
          xlsxCell(status.label, status.style),
          xlsxCell(`주문 ${index + 1} 요약`, "sectionText"),
          xlsxCell(`${groupItems.length}개 상품`, "sectionText"),
          xlsxCell("", "sectionText"),
          xlsxCell("", "sectionText"),
          xlsxCell(totals.totalJpy, "sectionJpy"),
          xlsxCell(totals.totalUsd, "sectionUsd"),
          xlsxCell(totals.marginUsd, status.marginStyle),
          xlsxCell("미확인", "checkCell"),
          xlsxCell(note, "noteBox"),
        ]);

        groupItems.forEach((item) => {
          rows.push([
            xlsxCell(index + 1, "boxInteger"),
            xlsxCell(status.label, status.style),
            xlsxCell(item.code, "boxText"),
            xlsxCell(item.name, "boxText"),
            xlsxCell(item.quantity, "boxInteger"),
            xlsxCell(item.unitJpy, "jpyInteger"),
            xlsxCell(item.subtotalJpy, "jpyInteger"),
            xlsxCell("", "boxSpacer"),
            xlsxCell("", "boxSpacer"),
            xlsxCell("", "checkCell"),
            xlsxCell("", "checkCell"),
          ]);
        });
        if (index < orderGroups.length - 1) {
          rows.push([]);
        }
      });
      return rows;
    }

    rows.push(productHeader);
    const status = recommendationStatus(recommendation);
    rows.push([
      xlsxCell("-", "sectionText"),
      xlsxCell(status.label, status.style),
      xlsxCell("추천 결과 없음", "sectionText"),
      xlsxCell(status.reason, "sectionText"),
      xlsxCell("", "sectionText"),
      xlsxCell("", "sectionText"),
      xlsxCell("", "sectionText"),
      xlsxCell("", "sectionText"),
      xlsxCell("", "sectionText"),
      xlsxCell("미확인", "checkCell"),
      xlsxCell(status.action, "noteBox"),
    ]);
    const fallbackItems = recommendation.oversize.length ? recommendation.oversize : products;
    fallbackItems.forEach((item) => {
      rows.push([
        xlsxCell("-", "boxText"),
        xlsxCell(status.label, status.style),
        xlsxCell(item.code, "boxText"),
        xlsxCell(item.name, "boxText"),
        xlsxCell(item.quantity, "boxInteger"),
        xlsxCell(item.unitJpy, "jpyInteger"),
        xlsxCell(item.totalJpy, "jpyInteger"),
        xlsxCell("", "boxSpacer"),
        xlsxCell("", "boxSpacer"),
        xlsxCell("", "checkCell"),
        xlsxCell(status.action, "noteBox"),
      ]);
    });
    return rows;
  }

  function buildProductRows(products, settings) {
    const rows = [
      [
        xlsxCell("추출상품", "title"),
        xlsxCell("추천그룹 산출에 사용된 상품 원본/보정값입니다.", "note"),
        xlsxCell(""),
        xlsxCell(""),
        xlsxCell(""),
        xlsxCell(""),
        xlsxCell(""),
        xlsxCell(""),
      ],
      [],
      [
        xlsxCell("상품번호", "header"),
        xlsxCell("상품명", "header"),
        xlsxCell("수량", "header"),
        xlsxCell("단가 (JPY)", "header"),
        xlsxCell("소계 (JPY)", "header"),
        xlsxCell("소계 (KRW)", "header"),
        xlsxCell("비고", "header"),
        xlsxCell("상품URL", "header"),
      ],
    ];

    products.forEach((item) => {
      rows.push([
        xlsxCell(item.code, "boxText"),
        xlsxCell(item.name, "boxText"),
        xlsxCell(item.quantity, "boxInteger"),
        xlsxCell(item.unitJpy, "jpyInteger"),
        xlsxCell(item.totalJpy, "jpyInteger"),
        xlsxCell(Math.round(item.totalJpy * settings.jpyKrw), "krwInteger"),
        xlsxCell("", "checkCell"),
        xlsxCell(item.productUrl || "", item.productUrl ? "hyperlink" : "boxText", "", item.productUrl || ""),
      ]);
    });
    return rows;
  }

  function styleId(style) {
    return {
      header: 1,
      integer: 2,
      decimal: 3,
      label: 4,
      totalText: 5,
      totalInteger: 6,
      totalDecimal: 7,
      boxText: 8,
      boxSpacer: 8,
      boxInteger: 9,
      title: 10,
      note: 11,
      sectionText: 12,
      sectionInteger: 13,
      sectionJpy: 14,
      sectionUsd: 15,
      jpyInteger: 16,
      krwInteger: 17,
      usdDecimal: 18,
      rateDecimal: 19,
      statusOk: 20,
      statusWarn: 21,
      statusBad: 22,
      marginOk: 23,
      marginWarn: 24,
      marginBad: 25,
      checkCell: 26,
      noteBox: 27,
      hyperlink: 28,
    }[style] || 0;
  }

  function columnName(index) {
    let name = "";
    while (index > 0) {
      const remainder = (index - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      index = Math.floor((index - 1) / 26);
    }
    return name;
  }

  function formatWidthNumber(value, digits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const sign = number < 0 ? "-" : "";
    const [integerPart, decimalPart] = Math.abs(number).toFixed(digits).split(".");
    const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return decimalPart ? `${sign}${grouped}.${decimalPart}` : `${sign}${grouped}`;
  }

  function displayTextForWidth(cell) {
    if (!cell || cell.value === "" || cell.value === null || cell.value === undefined) return "";
    const value = cell.value;
    const number = Number(value);
    if (Number.isFinite(number) && (cell.type === "number" || typeof value === "number")) {
      if (["jpyInteger", "sectionJpy"].includes(cell.style)) return `${formatWidthNumber(number)} JPY`;
      if (cell.style === "krwInteger") return `${formatWidthNumber(number)} KRW`;
      if (["usdDecimal", "sectionUsd", "marginOk", "marginWarn", "marginBad"].includes(cell.style)) return `${formatWidthNumber(number, 2)} USD`;
      if (cell.style === "rateDecimal") return formatWidthNumber(number, 4);
      if (["decimal", "totalDecimal"].includes(cell.style)) return formatWidthNumber(number, 2);
      return formatWidthNumber(number);
    }
    return String(value);
  }

  function isWideCharacter(char) {
    const code = char.codePointAt(0);
    return (
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff01 && code <= 0xff60)
    );
  }

  function displayWidth(text) {
    return [...String(text)].reduce((sum, char) => sum + (isWideCharacter(char) ? 2 : 1), 0);
  }

  function autoColumnWidths(rows, options = {}) {
    const columnCount = Math.max(0, ...rows.map((row) => row.length));
    const minWidths = options.minWidths || [];
    const maxWidths = options.maxWidths || [];
    const minWidth = options.minWidth || 8;
    const maxWidth = options.maxWidth || 90;
    const padding = options.padding ?? 3;
    const sourceRows = rows.slice(options.startRow || 0);

    return Array.from({ length: columnCount }, (_, columnIndex) => {
      let width = minWidths[columnIndex] || minWidth;
      sourceRows.forEach((row) => {
        const text = displayTextForWidth(row[columnIndex]);
        if (!text) return;
        width = Math.max(width, displayWidth(text) + padding);
      });
      return Math.ceil(Math.min(width, maxWidths[columnIndex] || maxWidth));
    });
  }

  function worksheetHyperlinks(rows) {
    const links = [];
    rows.forEach((row, rowIndex) => {
      row.forEach((cell, cellIndex) => {
        const target = cleanText(cell?.hyperlink);
        if (!target) return;
        links.push({
          ref: `${columnName(cellIndex + 1)}${rowIndex + 1}`,
          target,
        });
      });
    });
    return links;
  }

  function worksheetRelsXml(hyperlinks) {
    const relationships = hyperlinks.map((link, index) => (
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(link.target)}" TargetMode="External"/>`
    )).join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationships}
  </Relationships>`;
  }

  function worksheetXml(rows, widths, options = {}) {
    const hyperlinks = options.hyperlinks || worksheetHyperlinks(rows);
    const showGridLines = options.showGridLines === false ? ' showGridLines="0"' : "";
    const tabColor = options.tabColor ? `<tabColor rgb="${options.tabColor}"/>` : "";
    const sheetPr = tabColor ? `<sheetPr>${tabColor}</sheetPr>` : "";
    const relationshipNamespace = hyperlinks.length ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' : "";
    const freezeRow = Number(options.freezeRow || 0);
    const pane = freezeRow > 0 ? [
      `<pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/>`,
      `<selection pane="bottomLeft" activeCell="A${freezeRow + 1}" sqref="A${freezeRow + 1}"/>`,
    ].join("") : "";
    const sheetViews = `<sheetViews><sheetView workbookViewId="0"${showGridLines}>${pane}</sheetView></sheetViews>`;
    const sheetFormatPr = options.defaultRowHeight ? `<sheetFormatPr defaultRowHeight="${options.defaultRowHeight}"/>` : "";
    const cols = widths.map((width, index) => (
      `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    )).join("");
    const rowHeights = options.rowHeights || {};
    const sheetRows = rows.map((row, rowIndex) => {
      const cells = row.map((cell, cellIndex) => {
        const ref = `${columnName(cellIndex + 1)}${rowIndex + 1}`;
        const style = styleId(cell.style);
        const styleAttr = style ? ` s="${style}"` : "";
        if (cell.value === "" || cell.value === null || cell.value === undefined) {
          return style ? `<c r="${ref}"${styleAttr}/>` : "";
        }
        if ((cell.type === "number" || typeof cell.value === "number") && Number.isFinite(Number(cell.value))) {
          return `<c r="${ref}"${styleAttr}><v>${Number(cell.value)}</v></c>`;
        }
        const text = escapeXml(cell.value);
        const spaceAttr = /^\s|\s$/.test(String(cell.value)) ? ' xml:space="preserve"' : "";
        return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t${spaceAttr}>${text}</t></is></c>`;
      }).join("");
      const rowNumber = rowIndex + 1;
      const rowHeight = rowHeights[rowNumber];
      const rowHeightAttr = rowHeight ? ` ht="${rowHeight}" customHeight="1"` : "";
      return `<row r="${rowNumber}"${rowHeightAttr}>${cells}</row>`;
    }).join("");
    const autoFilter = options.autoFilterRef ? `<autoFilter ref="${options.autoFilterRef}"/>` : "";
    const hyperlinkXml = hyperlinks.length ? `<hyperlinks>${hyperlinks.map((link, index) => (
      `<hyperlink ref="${link.ref}" r:id="rId${index + 1}"/>`
    )).join("")}</hyperlinks>` : "";

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${relationshipNamespace}>
  ${sheetPr}
  ${sheetViews}
  ${sheetFormatPr}
  <cols>${cols}</cols>
  <sheetData>${sheetRows}</sheetData>
  ${autoFilter}
  ${hyperlinkXml}
  </worksheet>`;
  }

  function workbookXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets>
    <sheet name="추천그룹" sheetId="1" r:id="rId1"/>
    <sheet name="추출상품" sheetId="2" r:id="rId2"/>
  </sheets>
  </workbook>`;
  }

  function workbookRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  </Relationships>`;
  }

  function rootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  </Relationships>`;
  }

  function contentTypesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  </Types>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="6">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="#,##0.00"/>
    <numFmt numFmtId="166" formatCode="#,##0&quot; JPY&quot;"/>
    <numFmt numFmtId="167" formatCode="#,##0&quot; KRW&quot;"/>
    <numFmt numFmtId="168" formatCode="#,##0.00&quot; USD&quot;"/>
    <numFmt numFmtId="169" formatCode="#,##0.0000"/>
  </numFmts>
  <fonts count="9">
    <font><sz val="16"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="16"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="22"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="16"/><color rgb="FF4F5B67"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FF137333"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FF8A5A00"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FFC5221F"/><name val="Calibri"/><family val="2"/></font>
    <font><u/><sz val="16"/><color rgb="FF0563C1"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1264A3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE7F0FA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCEAF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE6F4EA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF4CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFCE8E6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F3E5C"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFB7C4D1"/></left>
      <right style="thin"><color rgb="FFB7C4D1"/></right>
      <top style="thin"><color rgb="FFB7C4D1"/></top>
      <bottom style="thin"><color rgb="FFB7C4D1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="29">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="168" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="169" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="168" fontId="5" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="168" fontId="6" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="168" fontId="7" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  </styleSheet>`;
  }

  const CRC_TABLE = (() => {
    const table = [];
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    bytes.forEach((byte) => {
      crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    });
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosTimeDate(date) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function writeUint16(target, value) {
    target.push(value & 0xff, (value >>> 8) & 0xff);
  }

  function writeUint32(target, value) {
    target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  function bytesFromText(text) {
    return new TextEncoder().encode(text);
  }

  function textFromBytes(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function combineBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function createZip(files) {
    const createdAt = dosTimeDate(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = bytesFromText(file.name);
      const dataBytes = typeof file.content === "string" ? bytesFromText(file.content) : file.content;
      const crc = crc32(dataBytes);
      const localHeader = [];

      writeUint32(localHeader, 0x04034b50);
      writeUint16(localHeader, 20);
      writeUint16(localHeader, 0x0800);
      writeUint16(localHeader, 0);
      writeUint16(localHeader, createdAt.time);
      writeUint16(localHeader, createdAt.date);
      writeUint32(localHeader, crc);
      writeUint32(localHeader, dataBytes.length);
      writeUint32(localHeader, dataBytes.length);
      writeUint16(localHeader, nameBytes.length);
      writeUint16(localHeader, 0);
      const localRecord = combineBytes([new Uint8Array(localHeader), nameBytes, dataBytes]);
      localParts.push(localRecord);

      const centralHeader = [];
      writeUint32(centralHeader, 0x02014b50);
      writeUint16(centralHeader, 20);
      writeUint16(centralHeader, 20);
      writeUint16(centralHeader, 0x0800);
      writeUint16(centralHeader, 0);
      writeUint16(centralHeader, createdAt.time);
      writeUint16(centralHeader, createdAt.date);
      writeUint32(centralHeader, crc);
      writeUint32(centralHeader, dataBytes.length);
      writeUint32(centralHeader, dataBytes.length);
      writeUint16(centralHeader, nameBytes.length);
      writeUint16(centralHeader, 0);
      writeUint16(centralHeader, 0);
      writeUint16(centralHeader, 0);
      writeUint16(centralHeader, 0);
      writeUint32(centralHeader, 0);
      writeUint32(centralHeader, offset);
      centralParts.push(combineBytes([new Uint8Array(centralHeader), nameBytes]));
      offset += localRecord.length;
    });

    const centralDirectory = combineBytes(centralParts);
    const endRecord = [];
    writeUint32(endRecord, 0x06054b50);
    writeUint16(endRecord, 0);
    writeUint16(endRecord, 0);
    writeUint16(endRecord, files.length);
    writeUint16(endRecord, files.length);
    writeUint32(endRecord, centralDirectory.length);
    writeUint32(endRecord, offset);
    writeUint16(endRecord, 0);

    return combineBytes([...localParts, centralDirectory, new Uint8Array(endRecord)]);
  }

  function rowWithOptionalProductUrl(row, columns) {
    const productUrl = columns.productUrl >= 0 ? row[columns.productUrl] || "" : "";
    const productRow = {
      code: row[columns.code] || "",
      name: row[columns.name] || "",
      quantity: row[columns.quantity] || "",
      unitJpy: row[columns.unitJpy] || "",
    };
    if (productUrl) productRow.productUrl = productUrl;
    return productRow;
  }

  function buildXlsxBytes(products, recommendation, settings) {
    const groupRows = buildGroupRows(products, recommendation, settings);
    const productRows = buildProductRows(products, settings);
    const productHyperlinks = worksheetHyperlinks(productRows);
    const groupWidths = autoColumnWidths(groupRows, {
      minWidths: [8, 10, 14, 20, 8, 12, 12, 14, 12, 10, 18],
      maxWidths: [18, 24, 42, 90, 14, 26, 26, 30, 26, 20, 70],
      padding: 3,
    });
    const productWidths = autoColumnWidths(productRows, {
      startRow: 2,
      minWidths: [14, 20, 8, 12, 12, 12, 16, 20],
      maxWidths: [42, 90, 14, 26, 26, 28, 70, 80],
      padding: 3,
    });
    const files = [
      { name: "[Content_Types].xml", content: contentTypesXml() },
      { name: "_rels/.rels", content: rootRelsXml() },
      { name: "xl/workbook.xml", content: workbookXml() },
      { name: "xl/_rels/workbook.xml.rels", content: workbookRelsXml() },
      { name: "xl/styles.xml", content: stylesXml() },
      {
        name: "xl/worksheets/sheet1.xml",
        content: worksheetXml(groupRows, groupWidths, {
          freezeRow: 1,
          autoFilterRef: `A1:K${Math.max(groupRows.length, 1)}`,
          defaultRowHeight: 26,
          rowHeights: { 1: 36 },
          showGridLines: false,
          tabColor: "FF0F3E5C",
        }),
      },
      {
        name: "xl/worksheets/sheet2.xml",
        content: worksheetXml(productRows, productWidths, {
          freezeRow: 3,
          autoFilterRef: `A3:H${Math.max(productRows.length, 3)}`,
          defaultRowHeight: 26,
          rowHeights: { 1: 40, 3: 36 },
          showGridLines: false,
          tabColor: "FF6A7D13",
          hyperlinks: productHyperlinks,
        }),
      },
      ...(productHyperlinks.length ? [{
        name: "xl/worksheets/_rels/sheet2.xml.rels",
        content: worksheetRelsXml(productHyperlinks),
      }] : []),
    ];
    return createZip(files);
  }

  function csvCell(value) {
    const rawText = String(value ?? "");
    // Excel treats cells beginning with these characters (including control
    // characters) as formulas. Prefixing an apostrophe keeps the displayed
    // value intact while preventing formula execution when the CSV is opened.
    const text = /^[\t\r\n=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function groupCsvContent(group) {
    const rows = [
      ["part_number", "quantity", "name", "unit_jpy", "product_url"],
      ...aggregateGroup(group).map((item) => [
        item.productUrl && item.code === item.productUrl ? "" : item.code,
        item.quantity,
        item.name,
        item.unitJpy,
        item.productUrl || "",
      ]),
    ];
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  }

  function buildGroupCsvZipBytes(recommendation) {
    const taxableGroups = Array.isArray(recommendation.taxableGroups) ? recommendation.taxableGroups : [];
    const taxFreeGroups = Array.isArray(recommendation.groups) ? recommendation.groups : [];
    const orderGroups = [
      ...taxableGroups.map((group) => ({ group, taxable: true })),
      ...taxFreeGroups.map((group) => ({ group, taxable: false })),
    ];
    if (!orderGroups.length || recommendation.complete === false) return createZip([]);
    const files = orderGroups.map(({ group, taxable }, index) => ({
      name: taxable
        ? `webike_taxable_order_group_${String(index + 1).padStart(2, "0")}.csv`
        : `webike_order_group_${String(index - taxableGroups.length + 1).padStart(2, "0")}.csv`,
      content: groupCsvContent(group),
    }));
    return createZip(files);
  }

  function makeGroupCsvZipFileName() {
    const now = new Date();
    return [
      "webike_order_groups_",
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      "_",
      pad(now.getHours()),
      pad(now.getMinutes()),
      ".zip",
    ].join("");
  }

  function parseProducts(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [];
    const seen = new Set();

    CART_ROW_SELECTORS.forEach((selector) => {
      doc.querySelectorAll(selector).forEach((row) => {
        if (seen.has(row)) return;
        seen.add(row);
        if (hasProductSignal(row)) rows.push(row);
      });
    });

    const products = [];
    rows.forEach((row) => {
      const product = cartProductFromRow(row, products.length);
      if (product) products.push(product);
    });
    return products;
  }

  function cartProductFromRow(row, index) {
    const quantity = quantityFromRow(row);
    const unitJpy = priceFromRow(row, UNIT_PRICE_SELECTORS, ["unitJpy", "unitPrice", "price"], ["data-unit-price", "data-price"]);
    const totalJpy = priceFromRow(row, TOTAL_PRICE_SELECTORS, ["totalJpy", "totalPrice", "subtotal"], ["data-total-price", "data-subtotal"]) ||
      (unitJpy * quantity);
    const resolvedUnitJpy = unitJpy || (totalJpy ? Math.round(totalJpy / quantity) : 0);
    const code = productCodeFromRow(row) ||
      productCodeFromId(row?.id) ||
      `item-${index + 1}`;
    const name = productNameFromRow(row) || code;
    const productUrl = productUrlFromRow(row);

    if (quantity < 1 || resolvedUnitJpy <= 0) return null;

    const product = {
      index,
      sku: datasetValue(row, ["sku", "productCode", "productId"]) || productCodeFromId(row?.id) || code,
      code,
      name,
      quantity,
      unitJpy: resolvedUnitJpy,
      totalJpy: totalJpy || resolvedUnitJpy * quantity,
    };
    if (productUrl) product.productUrl = productUrl;
    return product;
  }

  function normalizeManualProducts(rows) {
    const products = [];
    const errors = [];

    if (!Array.isArray(rows)) return { products, errors: ["상품 목록 형식이 올바르지 않습니다."] };
    if (rows.length > GROUPING_LIMITS.maxProducts) {
      return { products, errors: [`상품은 최대 ${GROUPING_LIMITS.maxProducts}개까지 입력할 수 있습니다.`] };
    }

    rows.forEach((row, rowIndex) => {
      const productUrl = cleanText(row.productUrl);
      const code = cleanText(row.code) || productUrl;
      const name = cleanText(row.name);
      const quantity = Math.round(toNumber(row.quantity));
      const unitJpy = parseJpy(row.unitJpy);
      const hasAnyValue = code || productUrl || name || String(row.quantity || "").trim() || String(row.unitJpy || "").trim();

      if (!hasAnyValue) return;

      if (!code) errors.push(`${rowIndex + 1}행 상품번호를 입력해 주세요.`);
      if (quantity < 1) errors.push(`${rowIndex + 1}행 수량은 1 이상이어야 합니다.`);
      if (quantity > GROUPING_LIMITS.maxQuantityPerProduct) {
        errors.push(`${rowIndex + 1}행 수량은 ${GROUPING_LIMITS.maxQuantityPerProduct} 이하여야 합니다.`);
      }
      if (unitJpy <= 0) errors.push(`${rowIndex + 1}행 단가 JPY는 1 이상이어야 합니다.`);
      if (!code || quantity < 1 || quantity > GROUPING_LIMITS.maxQuantityPerProduct || unitJpy <= 0) return;

      const product = {
        index: products.length,
        sku: code,
        code,
        name: name || code,
        quantity,
        unitJpy,
        totalJpy: quantity * unitJpy,
      };
      if (productUrl) product.productUrl = productUrl;
      products.push(product);
    });

    return { products, errors };
  }

  function manualRowsFromProducts(products) {
    return products.map((item) => {
      const row = {
        code: item.code,
        name: item.name,
        quantity: item.quantity,
        unitJpy: item.unitJpy,
      };
      if (item.productUrl) row.productUrl = item.productUrl;
      return row;
    });
  }

  function detectPasteColumns(row) {
    const headers = row.map(normalizeHeader);
    const columns = {
      code: findColumn(headers, ["상품번호", "품번", "sku", "code", "productcode", "partnumber", "partno"]),
      productUrl: findColumn(headers, ["상품url", "상품주소", "링크", "url", "producturl", "productlink"]),
      name: findColumn(headers, ["상품명", "제품명", "name", "productname", "itemname"]),
      quantity: findColumn(headers, ["수량", "qty", "quantity", "count"]),
      unitJpy: findColumn(headers, ["단가jpy", "단가", "금액", "가격", "판매가", "price", "unitjpy", "unitprice", "jpy"]),
    };
    const matchedCount = Object.values(columns).filter((index) => index >= 0).length;
    return matchedCount >= 2 ? { columns, hasHeader: true } : {
      columns: { code: 0, productUrl: -1, name: 1, quantity: 2, unitJpy: 3 },
      hasHeader: false,
    };
  }

  function manualRowsFromPastedText(text) {
    const parsedRows = parseDelimitedRows(text);
    if (!parsedRows.length) return { rows: [], errors: ["붙여넣을 상품 목록을 입력해 주세요."] };

    const { columns, hasHeader } = detectPasteColumns(parsedRows[0]);
    const dataRows = parsedRows.slice(hasHeader ? 1 : 0);
    const rows = dataRows.map((row) => rowWithOptionalProductUrl(row, columns))
      .filter((row) => row.code || row.productUrl || row.name || row.quantity || row.unitJpy);

    if (!rows.length) return { rows: [], errors: ["붙여넣은 상품 행을 찾지 못했습니다."] };

    const normalized = normalizeManualProducts(rows);
    return { rows, errors: normalized.errors };
  }

  return {
    GROUPING_LIMITS,
    DEFAULT_SETTINGS,
    EXCHANGE_RATE_SOURCE_URL,
    CART_ROW_SELECTORS,
    PRODUCT_CODE_SELECTORS,
    PRODUCT_NAME_SELECTORS,
    PRODUCT_URL_SELECTORS,
    QUANTITY_SELECTORS,
    UNIT_PRICE_SELECTORS,
    TOTAL_PRICE_SELECTORS,
    toNumber,
    positiveNumber,
    positiveInteger,
    normalizeStoredSettings,
    readStoredSettings,
    writeStoredSettings,
    hasStoredSettings,
    normalizeExchangeRateData,
    getExchangeRatePeriodStatus,
    firstNumber,
    parseJpy,
    cleanText,
    datasetValue,
    attributeValue,
    firstElement,
    textFrom,
    productCodeFromRow,
    productNameFromRow,
    productUrlFromRow,
    productCodeFromId,
    priceFromRow,
    quantityFromRow,
    hasProductSignal,
    escapeXml,
    escapeHtml,
    makeXlsxFileName,
    groupTotals,
    buildGroupRows,
    buildProductRows,
    createZip,
    buildXlsxBytes,
    buildGroupCsvZipBytes,
    csvCell,
    makeGroupCsvZipFileName,
    parseProducts,
    cartProductFromRow,
    normalizeManualProducts,
    manualRowsFromProducts,
    manualRowsFromPastedText,
    validateGroupingRequest,
    makeAtoms,
    twoGroupDp,
    twoGroupDpResult,
    firstFitDecreasing,
    recommendGroups,
    aggregateGroup,
  };
});
