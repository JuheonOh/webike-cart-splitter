(function initWebikeCartCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WebikeCartCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createWebikeCartCore() {
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
      maxGroups: positiveInteger(source.maxGroups, DEFAULT_SETTINGS.maxGroups),
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

  function escapeHtml(value) {
    return escapeXml(value);
  }

  function xlsxCell(value, style = "", type = "") {
    return { value, style, type };
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

  function buildSummaryRows(products, recommendation, settings) {
    const totalKrw = recommendation.totalJpy * settings.jpyKrw;
    const totalUsd = totalKrw / settings.usdKrw;
    return [
      [xlsxCell("항목", "header"), xlsxCell("값", "header")],
      [xlsxCell("면세 기준(USD)", "label"), xlsxCell(settings.limitUsd, "decimal")],
      [xlsxCell("USD 수입환율(원)", "label"), xlsxCell(settings.usdKrw, "decimal")],
      [xlsxCell("JPY 수입환율(원)", "label"), xlsxCell(settings.jpyKrw, "decimal")],
      [xlsxCell("JPY 한도", "label"), xlsxCell(Math.floor(settings.limitJpy), "integer")],
      [xlsxCell("전체 상품가 JPY", "label"), xlsxCell(recommendation.totalJpy, "integer")],
      [xlsxCell("전체 상품가 USD", "label"), xlsxCell(totalUsd, "decimal")],
      [xlsxCell("전체 상품가 KRW", "label"), xlsxCell(Math.round(totalKrw), "integer")],
      [xlsxCell("추출 상품 수", "label"), xlsxCell(products.length, "integer")],
      [xlsxCell("계산 단위 수", "label"), xlsxCell(recommendation.atoms.length, "integer")],
      [xlsxCell("추천 주문 수", "label"), xlsxCell(recommendation.groups.length, "integer")],
      [xlsxCell("분할 상태", "label"), xlsxCell(recommendation.groups.length ? "가능" : "확인 필요")],
    ];
  }

  function buildGroupRows(products, recommendation, settings) {
    const productHeader = [
      xlsxCell("주문그룹", "header"),
      xlsxCell("상품번호", "header"),
      xlsxCell("상품명", "header"),
      xlsxCell("수량", "header"),
      xlsxCell("단가JPY", "header"),
      xlsxCell("소계JPY", "header"),
      xlsxCell("소계KRW", "header"),
    ];
    const rows = [];

    if (recommendation.groups.length) {
      recommendation.groups.forEach((group, index) => {
        const totals = groupTotals(group, settings);
        const groupItems = aggregateGroup(group);
        const summaryRows = [
          [xlsxCell("그룹합계JPY", "label"), xlsxCell(totals.totalJpy, "totalInteger")],
          [xlsxCell("그룹합계USD", "label"), xlsxCell(totals.totalUsd, "totalDecimal")],
          [xlsxCell("그룹합계KRW", "label"), xlsxCell(Math.round(totals.totalKrw), "totalInteger")],
          [xlsxCell("여유USD", "label"), xlsxCell(totals.marginUsd, "totalDecimal")],
          [xlsxCell("여유KRW", "label"), xlsxCell(Math.round(totals.marginKrw), "totalInteger")],
        ];
        const bodyRowCount = Math.max(groupItems.length, summaryRows.length);

        rows.push([
          ...productHeader,
          xlsxCell("", "boxSpacer"),
          xlsxCell(`주문 ${index + 1} 요약`, "totalText"),
          xlsxCell("", "totalText"),
        ]);
        for (let rowIndex = 0; rowIndex < bodyRowCount; rowIndex += 1) {
          const item = groupItems[rowIndex];
          const productCells = item ? [
            xlsxCell(index + 1, "boxInteger"),
            xlsxCell(item.code, "boxText"),
            xlsxCell(item.name, "boxText"),
            xlsxCell(item.quantity, "boxInteger"),
            xlsxCell(item.unitJpy, "boxInteger"),
            xlsxCell(item.subtotalJpy, "boxInteger"),
            xlsxCell(Math.round(item.subtotalJpy * settings.jpyKrw), "boxInteger"),
          ] : Array.from({ length: productHeader.length }, () => xlsxCell("", "boxSpacer"));
          const summaryCells = summaryRows[rowIndex] || [xlsxCell("", "boxSpacer"), xlsxCell("", "boxSpacer")];
          rows.push([
            ...productCells,
            xlsxCell("", "boxSpacer"),
            ...summaryCells,
          ]);
        }
        if (index < recommendation.groups.length - 1) {
          rows.push([]);
        }
      });
      return rows;
    }

    rows.push(productHeader);
    products.forEach((item) => {
      rows.push([
        xlsxCell("", "boxSpacer"),
        xlsxCell(item.code, "boxText"),
        xlsxCell(item.name, "boxText"),
        xlsxCell(item.quantity, "boxInteger"),
        xlsxCell(item.unitJpy, "boxInteger"),
        xlsxCell(item.totalJpy, "boxInteger"),
        xlsxCell(Math.round(item.totalJpy * settings.jpyKrw), "boxInteger"),
      ]);
    });
    return rows;
  }

  function buildProductRows(products, settings) {
    const rows = [[
      xlsxCell("상품번호", "header"),
      xlsxCell("상품명", "header"),
      xlsxCell("수량", "header"),
      xlsxCell("단가JPY", "header"),
      xlsxCell("소계JPY", "header"),
      xlsxCell("소계KRW", "header"),
    ]];

    products.forEach((item) => {
      rows.push([
        xlsxCell(item.code),
        xlsxCell(item.name),
        xlsxCell(item.quantity, "integer"),
        xlsxCell(item.unitJpy, "integer"),
        xlsxCell(item.totalJpy, "integer"),
        xlsxCell(Math.round(item.totalJpy * settings.jpyKrw), "integer"),
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

  function worksheetXml(rows, widths) {
    const cols = widths.map((width, index) => (
      `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    )).join("");
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
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${cols}</cols>
  <sheetData>${sheetRows}</sheetData>
  </worksheet>`;
  }

  function workbookXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="요약" sheetId="1" r:id="rId1"/>
    <sheet name="추천그룹" sheetId="2" r:id="rId2"/>
    <sheet name="추출상품" sheetId="3" r:id="rId3"/>
  </sheets>
  </workbook>`;
  }

  function workbookRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
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
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  </Types>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="#,##0.00"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1264A3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE7F0FA"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD9E0E8"/></left>
      <right style="thin"><color rgb="FFD9E0E8"/></right>
      <top style="thin"><color rgb="FFD9E0E8"/></top>
      <bottom style="thin"><color rgb="FFD9E0E8"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="165" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
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

  function buildXlsxBytes(products, recommendation, settings) {
    const files = [
      { name: "[Content_Types].xml", content: contentTypesXml() },
      { name: "_rels/.rels", content: rootRelsXml() },
      { name: "xl/workbook.xml", content: workbookXml() },
      { name: "xl/_rels/workbook.xml.rels", content: workbookRelsXml() },
      { name: "xl/styles.xml", content: stylesXml() },
      {
        name: "xl/worksheets/sheet1.xml",
        content: worksheetXml(buildSummaryRows(products, recommendation, settings), [24, 18]),
      },
      {
        name: "xl/worksheets/sheet2.xml",
        content: worksheetXml(buildGroupRows(products, recommendation, settings), [12, 20, 42, 10, 12, 12, 14, 4, 16, 16]),
      },
      {
        name: "xl/worksheets/sheet3.xml",
        content: worksheetXml(buildProductRows(products, settings), [20, 48, 10, 12, 12, 14]),
      },
    ];
    return createZip(files);
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

    if (quantity < 1 || resolvedUnitJpy <= 0) return null;

    return {
      index,
      sku: datasetValue(row, ["sku", "productCode", "productId"]) || productCodeFromId(row?.id) || code,
      code,
      name,
      quantity,
      unitJpy: resolvedUnitJpy,
      totalJpy: totalJpy || resolvedUnitJpy * quantity,
    };
  }

  function normalizeManualProducts(rows) {
    const products = [];
    const errors = [];

    rows.forEach((row, rowIndex) => {
      const code = cleanText(row.code);
      const name = cleanText(row.name);
      const quantity = Math.round(toNumber(row.quantity));
      const unitJpy = Math.round(toNumber(row.unitJpy));
      const hasAnyValue = code || name || String(row.quantity || "").trim() || String(row.unitJpy || "").trim();

      if (!hasAnyValue) return;

      if (!code) errors.push(`${rowIndex + 1}행 상품번호를 입력해 주세요.`);
      if (quantity < 1) errors.push(`${rowIndex + 1}행 수량은 1 이상이어야 합니다.`);
      if (unitJpy <= 0) errors.push(`${rowIndex + 1}행 단가 JPY는 1 이상이어야 합니다.`);
      if (!code || quantity < 1 || unitJpy <= 0) return;

      products.push({
        index: products.length,
        sku: code,
        code,
        name: name || code,
        quantity,
        unitJpy,
        totalJpy: quantity * unitJpy,
      });
    });

    return { products, errors };
  }

  function manualRowsFromProducts(products) {
    return products.map((item) => ({
      code: item.code,
      name: item.name,
      quantity: item.quantity,
      unitJpy: item.unitJpy,
    }));
  }

  function parseDelimitedLine(line, delimiter) {
    if (delimiter === "\t") return line.split("\t").map((cell) => cell.trim());

    const cells = [];
    let current = "";
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    cells.push(current.trim());
    return cells;
  }

  function parseDelimitedRows(text) {
    const value = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!value) return [];
    const delimiter = value.includes("\t") ? "\t" : ",";
    return value.split("\n")
      .map((line) => parseDelimitedLine(line, delimiter))
      .filter((row) => row.some((cell) => cleanText(cell)));
  }

  function normalizeHeader(text) {
    return cleanText(text).toLowerCase().replace(/[\s_()\/-]/g, "");
  }

  function findColumn(headers, names) {
    return headers.findIndex((header) => names.includes(header));
  }

  function detectPasteColumns(row) {
    const headers = row.map(normalizeHeader);
    const columns = {
      code: findColumn(headers, ["상품번호", "품번", "sku", "code", "productcode", "partnumber", "partno"]),
      name: findColumn(headers, ["상품명", "제품명", "name", "productname", "itemname"]),
      quantity: findColumn(headers, ["수량", "qty", "quantity", "count"]),
      unitJpy: findColumn(headers, ["단가jpy", "단가", "price", "unitjpy", "unitprice", "jpy"]),
    };
    const matchedCount = Object.values(columns).filter((index) => index >= 0).length;
    return matchedCount >= 2 ? { columns, hasHeader: true } : {
      columns: { code: 0, name: 1, quantity: 2, unitJpy: 3 },
      hasHeader: false,
    };
  }

  function manualRowsFromPastedText(text) {
    const parsedRows = parseDelimitedRows(text);
    if (!parsedRows.length) return { rows: [], errors: ["붙여넣을 상품 목록을 입력해 주세요."] };

    const { columns, hasHeader } = detectPasteColumns(parsedRows[0]);
    const dataRows = parsedRows.slice(hasHeader ? 1 : 0);
    const rows = dataRows.map((row) => ({
      code: row[columns.code] || "",
      name: row[columns.name] || "",
      quantity: row[columns.quantity] || "",
      unitJpy: row[columns.unitJpy] || "",
    })).filter((row) => row.code || row.name || row.quantity || row.unitJpy);

    if (!rows.length) return { rows: [], errors: ["붙여넣은 상품 행을 찾지 못했습니다."] };

    const normalized = normalizeManualProducts(rows);
    return { rows, errors: normalized.errors };
  }

  function makeAtoms(products, splitQuantity) {
    const atoms = [];
    products.forEach((product) => {
      if (splitQuantity) {
        for (let count = 0; count < product.quantity; count += 1) {
          atoms.push({
            productIndex: product.index,
            code: product.code,
            name: product.name,
            quantity: 1,
            unitJpy: product.unitJpy,
            totalJpy: product.unitJpy,
          });
        }
        return;
      }

      atoms.push({
        productIndex: product.index,
        code: product.code,
        name: product.name,
        quantity: product.quantity,
        unitJpy: product.unitJpy,
        totalJpy: product.totalJpy,
      });
    });
    return atoms;
  }

  function twoGroupDp(atoms, limitJpy) {
    const total = atoms.reduce((sum, item) => sum + item.totalJpy, 0);
    const dp = new Map([[0, null]]);

    atoms.forEach((atom, index) => {
      const entries = [...dp.keys()];
      entries.forEach((sum) => {
        const next = sum + atom.totalJpy;
        if (next <= limitJpy && !dp.has(next)) {
          dp.set(next, { previous: sum, index });
        }
      });
    });

    let bestSum = null;
    dp.forEach((_, sum) => {
      const other = total - sum;
      if (other > limitJpy) return;
      if (bestSum === null || Math.abs(total / 2 - sum) < Math.abs(total / 2 - bestSum)) {
        bestSum = sum;
      }
    });

    if (bestSum === null) return null;

    const selected = new Set();
    let cursor = bestSum;
    while (cursor > 0) {
      const node = dp.get(cursor);
      selected.add(node.index);
      cursor = node.previous;
    }

    const groups = [[], []];
    atoms.forEach((atom, index) => {
      groups[selected.has(index) ? 0 : 1].push(atom);
    });
    return groups;
  }

  function firstFitDecreasing(atoms, groupCount, limitJpy) {
    const groups = Array.from({ length: groupCount }, () => []);
    const sums = Array(groupCount).fill(0);
    const sorted = [...atoms].sort((a, b) => b.totalJpy - a.totalJpy);

    for (const atom of sorted) {
      let target = -1;
      let lowestSum = Infinity;
      for (let index = 0; index < groupCount; index += 1) {
        if (sums[index] + atom.totalJpy <= limitJpy && sums[index] < lowestSum) {
          target = index;
          lowestSum = sums[index];
        }
      }
      if (target === -1) return null;
      groups[target].push(atom);
      sums[target] += atom.totalJpy;
    }

    return groups.filter((group) => group.length > 0);
  }

  function recommendGroups(products, settings) {
    const atoms = makeAtoms(products, settings.splitQuantity);
    const totalJpy = atoms.reduce((sum, item) => sum + item.totalJpy, 0);
    const oversize = atoms.filter((item) => item.totalJpy > settings.limitJpy);
    if (oversize.length) {
      return { totalJpy, groups: [], oversize, atoms };
    }

    const minimumGroups = Math.max(1, Math.ceil(totalJpy / settings.limitJpy));
    if (minimumGroups === 1) {
      return { totalJpy, groups: [atoms], oversize: [], atoms };
    }

    if (minimumGroups === 2) {
      const exactTwoGroups = twoGroupDp(atoms, settings.limitJpy);
      if (exactTwoGroups) {
        return { totalJpy, groups: exactTwoGroups, oversize: [], atoms };
      }
    }

    for (let count = minimumGroups; count <= settings.maxGroups; count += 1) {
      const groups = firstFitDecreasing(atoms, count, settings.limitJpy);
      if (groups) {
        return { totalJpy, groups, oversize: [], atoms };
      }
    }

    return { totalJpy, groups: [], oversize: [], atoms };
  }

  function aggregateGroup(group) {
    const map = new Map();
    group.forEach((atom) => {
      const key = `${atom.productIndex}:${atom.code}`;
      const current = map.get(key) || {
        code: atom.code,
        name: atom.name,
        quantity: 0,
        unitJpy: atom.unitJpy,
        subtotalJpy: 0,
      };
      current.quantity += atom.quantity;
      current.subtotalJpy += atom.totalJpy;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.subtotalJpy - a.subtotalJpy);
  }


  return {
    DEFAULT_SETTINGS,
    EXCHANGE_RATE_SOURCE_URL,
    CART_ROW_SELECTORS,
    PRODUCT_CODE_SELECTORS,
    PRODUCT_NAME_SELECTORS,
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
    firstNumber,
    parseJpy,
    cleanText,
    datasetValue,
    attributeValue,
    firstElement,
    textFrom,
    productCodeFromRow,
    productNameFromRow,
    productCodeFromId,
    priceFromRow,
    quantityFromRow,
    hasProductSignal,
    escapeXml,
    escapeHtml,
    makeXlsxFileName,
    groupTotals,
    buildSummaryRows,
    buildGroupRows,
    buildProductRows,
    createZip,
    buildXlsxBytes,
    parseProducts,
    cartProductFromRow,
    normalizeManualProducts,
    manualRowsFromProducts,
    manualRowsFromPastedText,
    makeAtoms,
    twoGroupDp,
    firstFitDecreasing,
    recommendGroups,
    aggregateGroup,
  };
});
