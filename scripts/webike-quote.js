#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const cartCore = require("../assets/js/calculator-core.js");
const costCore = require("../assets/js/cost-comparison-core.js");

const DEFAULT_BASE_URL = "https://japan.webike.net/";
const DEFAULT_PRODUCT_BASE_URL = "https://www.japan-webike.kr/";
const DEFAULT_SEARCH_API_URL = "https://www.japan-webike.kr/api-search-es.html";
const DEFAULT_SHIPPING_API_URL = "https://japan.webike.net/api_shipping.html";
const DEFAULT_OUTPUT_DIR = "reports";
const SEARCH_INPUT_SELECTORS = [
  "input[name='q']",
  "input[name='keyword']",
  "input[type='search']",
  "input[placeholder*='Search' i]",
  "input[placeholder*='part' i]",
  "input[placeholder*='품번' i]",
];
const QUANTITY_SELECTORS = [
  "input[name='quantity']",
  "input[name='qty']",
  "select[name='quantity']",
  "select[name='qty']",
  ".quantity input",
  ".qty input",
];
const ADD_TO_CART_SELECTORS = [
  "button[name='add']",
  "button[type='submit']",
  "input[type='submit'][value*='Cart' i]",
  "button:has-text('Add to Cart')",
  "button:has-text('Add To Cart')",
  "a:has-text('Add to Cart')",
  "button:has-text('장바구니')",
  "button:has-text('カート')",
  "a:has-text('カート')",
];
const CART_LINK_SELECTORS = [
  "a[href*='cart' i]",
  "a:has-text('Cart')",
  "a:has-text('장바구니')",
  "a:has-text('カート')",
];

function usage() {
  return [
    "Usage:",
    "  node scripts/webike-quote.js --mode quote-api --input parts.csv",
    "  node scripts/webike-quote.js --mode cart-script --input parts.csv --output webike_add_cart.js",
    "  node scripts/webike-quote.js --mode plan-only --input parts.csv --single-shipping-jpy 5000 --split-shipping-jpy 2500",
    "  node scripts/webike-quote.js --mode cart --input parts.csv --headed",
    "",
    "Input columns:",
    "  part_number, product_url, quantity, name(optional), unit_jpy(plan-only required)",
    "",
    "Options:",
    "  --mode quote-api|cart-script|plan-only|cart",
    "  --input <path>",
    "  --output <path>",
    "  --base-url <url>",
    "  --product-base-url <url>",
    "  --search-api-url <url>",
    "  --shipping-api-url <url>",
    "  --country-iso2 <KR>",
    "  --shop-code <9000>",
    "  --shipping-service <service_code>",
    "  --cart-url <url>",
    "  --headed",
    "  --quiet",
    "  --limit-usd <number>",
    "  --usd-krw <number>",
    "  --jpy-krw <number>",
    "  --max-groups <number>",
    "  --no-split-quantity",
    "  --single-shipping-jpy <number>  plan-only mode",
    "  --split-shipping-jpy <number>   plan-only mode",
    "  --duty-rate <0.08|8>",
    "  --vat-rate <0.1|10>",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    mode: "plan-only",
    baseUrl: DEFAULT_BASE_URL,
    productBaseUrl: DEFAULT_PRODUCT_BASE_URL,
    searchApiUrl: DEFAULT_SEARCH_API_URL,
    shippingApiUrl: DEFAULT_SHIPPING_API_URL,
    countryIso2: "KR",
    shopCode: "9000",
    headed: false,
    quiet: false,
    splitQuantity: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--headed") {
      options.headed = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--no-split-quantity") {
      options.splitQuantity = false;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      if (!next || next.startsWith("--")) {
        throw new Error(`${arg} 옵션 값이 필요합니다.`);
      }
      options[key] = next;
      index += 1;
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }

  return options;
}

function toNumber(value) {
  return Number(String(value ?? "").replace(/,/g, "").trim()) || 0;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePartNumber(value) {
  return cleanText(value).toUpperCase().replace(/[\s-]/g, "");
}

function normalizeUrlKey(value) {
  return cleanText(value).replace(/\/+$/, "").toLowerCase();
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

function normalizeHeader(value) {
  return cleanText(value).toLowerCase().replace(/[\s_()/-]/g, "");
}

function findColumn(headers, names, fallback) {
  const index = headers.findIndex((header) => names.includes(header));
  return index >= 0 ? index : fallback;
}

function readInputRows(inputPath) {
  const rawRows = parseDelimitedRows(fs.readFileSync(inputPath, "utf8"));
  if (!rawRows.length) throw new Error("입력 파일에 행이 없습니다.");

  const headers = rawRows[0].map(normalizeHeader);
  const hasHeader = headers.some((header) => (
    ["partnumber", "partno", "품번", "상품번호", "producturl", "url", "링크"].includes(header)
  ));
  const columns = {
    partNumber: findColumn(headers, ["partnumber", "partno", "품번", "상품번호", "sku", "code"], hasHeader ? -1 : 0),
    productUrl: findColumn(headers, ["producturl", "url", "상품url", "상품주소", "링크", "productlink"], -1),
    quantity: findColumn(headers, ["quantity", "qty", "수량", "count"], hasHeader ? -1 : 1),
    name: findColumn(headers, ["name", "productname", "상품명", "제품명"], hasHeader ? -1 : 2),
    unitJpy: findColumn(headers, ["unitjpy", "unitprice", "price", "단가jpy", "단가", "jpy"], hasHeader ? -1 : 3),
  };
  const dataRows = rawRows.slice(hasHeader ? 1 : 0);
  const merged = new Map();

  dataRows.forEach((row, rowIndex) => {
    const partNumber = cleanText(row[columns.partNumber]);
    const productUrl = cleanText(row[columns.productUrl]);
    const quantity = Math.round(toNumber(row[columns.quantity] || 1));
    const name = cleanText(row[columns.name]);
    const unitJpy = Math.round(toNumber(row[columns.unitJpy]));

    if (!partNumber && !productUrl) throw new Error(`${rowIndex + 1}번째 데이터 행의 부품번호 또는 상품 URL이 비어 있습니다.`);
    if (quantity < 1) throw new Error(`${partNumber || productUrl} 수량은 1 이상이어야 합니다.`);

    const key = partNumber ? normalizePartNumber(partNumber) : normalizeUrlKey(productUrl);
    const current = merged.get(key) || {
      partNumber,
      quantity: 0,
      name,
      unitJpy,
    };
    current.quantity += quantity;
    if (!current.partNumber && partNumber) current.partNumber = partNumber;
    if (!current.productUrl && productUrl) current.productUrl = productUrl;
    if (!current.name && name) current.name = name;
    if (!current.unitJpy && unitJpy) current.unitJpy = unitJpy;
    merged.set(key, current);
  });

  return [...merged.values()];
}

function loadExchangeRateSettings(options) {
  const defaults = cartCore.DEFAULT_SETTINGS;
  const exchangePath = path.join(__dirname, "..", "data", "exchange-rates.json");
  let exchangeRates = null;

  try {
    exchangeRates = cartCore.normalizeExchangeRateData(JSON.parse(fs.readFileSync(exchangePath, "utf8")));
  } catch {
    exchangeRates = null;
  }

  const settings = {
    limitUsd: toNumber(options.limitUsd) || defaults.limitUsd,
    usdKrw: toNumber(options.usdKrw) || exchangeRates?.rates?.USD || defaults.usdKrw,
    jpyKrw: toNumber(options.jpyKrw) || exchangeRates?.rates?.JPY || defaults.jpyKrw,
    maxGroups: Math.max(1, Math.round(toNumber(options.maxGroups) || defaults.maxGroups)),
    splitQuantity: options.splitQuantity,
  };
  settings.limitJpy = (settings.limitUsd * settings.usdKrw) / settings.jpyKrw;
  return settings;
}

function costSettingsFromOptions(options, groupSettings) {
  return {
    ...groupSettings,
    singleShippingJpy: toNumber(options.singleShippingJpy),
    splitShippingJpy: toNumber(options.splitShippingJpy),
    importDutyRate: options.dutyRate === undefined ? costCore.DEFAULT_COST_SETTINGS.importDutyRate : options.dutyRate,
    vatRate: options.vatRate === undefined ? costCore.DEFAULT_COST_SETTINGS.vatRate : options.vatRate,
  };
}

function logProgress(options, message) {
  if (!options?.logProgress || options.quiet) return;
  const logger = typeof options.progressLogger === "function" ? options.progressLogger : console.log;
  logger(message);
}

function productsFromInput(rows) {
  const missing = rows.filter((row) => !row.unitJpy);
  if (missing.length) {
    throw new Error(`plan-only 모드는 unit_jpy가 필요합니다: ${missing.map((row) => row.partNumber || row.productUrl).join(", ")}`);
  }

  return rows.map((row, index) => ({
    index,
    sku: row.partNumber || row.productUrl,
    code: row.partNumber || row.productUrl,
    name: row.name || row.partNumber || row.productUrl,
    quantity: row.quantity,
    unitJpy: row.unitJpy,
    totalJpy: row.quantity * row.unitJpy,
  }));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value) {
  return cleanText(String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      try {
        return String.fromCodePoint(parseInt(code, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCodePoint(Number(code));
      } catch {
        return "";
      }
    }));
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function jsonTypeMatches(value, type) {
  return asArray(value?.["@type"]).some((item) => cleanText(item).toLowerCase() === type.toLowerCase());
}

function findProductJsonLd(html) {
  const products = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;
    if (jsonTypeMatches(node, "Product")) products.push(node);
    visit(node["@graph"]);
    visit(node.mainEntity);
    visit(node.itemListElement);
  };

  const pattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const body = match[1].trim().replace(/^<!--/, "").replace(/-->$/, "").trim();
    if (!body) continue;
    try {
      visit(JSON.parse(body));
    } catch {
      continue;
    }
  }

  return products[0] || null;
}

function attributeFromTag(tag, name) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(tag || "").match(pattern);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function classNamesFromTag(tag) {
  return attributeFromTag(tag, "class").split(/\s+/).filter(Boolean);
}

function firstTagByClass(html, className) {
  const tags = String(html || "").match(/<[^>]+>/g) || [];
  return tags.find((tag) => classNamesFromTag(tag).includes(className)) || "";
}

function inputValueByNameOrId(html, nameOrId) {
  const pattern = new RegExp(`<input\\b[^>]*(?:id|name)\\s*=\\s*["']${escapeRegExp(nameOrId)}["'][^>]*>`, "i");
  const tag = String(html || "").match(pattern)?.[0] || "";
  return attributeFromTag(tag, "value");
}

function inputValueByClass(html, className) {
  const inputs = String(html || "").match(/<input\b[^>]*>/gi) || [];
  const tag = inputs.find((input) => classNamesFromTag(input).includes(className)) || "";
  return attributeFromTag(tag, "value");
}

function textById(html, id) {
  const pattern = new RegExp(`<[^>]+\\bid\\s*=\\s*["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  return stripTags(String(html || "").match(pattern)?.[1] || "");
}

function jsVariableValue(html, name) {
  const pattern = new RegExp(`\\b(?:var|let|const)\\s+${escapeRegExp(name)}\\s*=\\s*([\\s\\S]*?);`, "i");
  const raw = String(html || "").match(pattern)?.[1]?.trim() || "";
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith("`") && raw.endsWith("`"))) {
    return decodeHtml(raw.slice(1, -1));
  }
  return decodeHtml(raw.replace(/,$/, ""));
}

function booleanFromJs(value) {
  return ["1", "true", "yes", "y"].includes(cleanText(value).toLowerCase());
}

function productIdFromUrl(url) {
  return cleanText(url).match(/\/products\/(\d+)\.html/i)?.[1] || "";
}

function shippingRatesFromJsonLd(productJson) {
  return asArray(productJson?.shippingDetails).map((detail) => ({
    serviceCode: cleanText(detail?.shippingDestination?.addressCountry || detail?.name),
    costJpy: Math.round(toNumber(detail?.shippingRate?.value)),
    currency: cleanText(detail?.shippingRate?.currency),
  })).filter((item) => item.costJpy >= 0 && item.currency);
}

function parseProductDetail(html, sourceUrl = "", options = {}) {
  const productJson = findProductJsonLd(html);
  const addCartTag = firstTagByClass(html, "btn-add-cart");
  const productId = inputValueByNameOrId(html, "prod_id") ||
    jsVariableValue(html, "productsId") ||
    jsVariableValue(html, "prod_id") ||
    productJson?.sku ||
    productIdFromUrl(sourceUrl);
  const partNumber = textById(html, "product_id") ||
    jsVariableValue(html, "productsModel") ||
    productJson?.mpn ||
    productJson?.gtin8 ||
    productId;
  const name = productJson?.name || jsVariableValue(html, "SYOUHIN_NAME") || partNumber || productId;
  const unitJpy = Math.round(toNumber(
    inputValueByNameOrId(html, "priceYen") ||
    attributeFromTag(addCartTag, "data-priceRetail"),
  ));

  return {
    sourceUrl,
    productId: cleanText(productId),
    partNumber: cleanText(partNumber),
    name: decodeHtml(name),
    unitJpy,
    productWeight: toNumber(jsVariableValue(html, "productWeight")),
    productVolume: toNumber(jsVariableValue(html, "productVolume")),
    countryIso2: cleanText(jsVariableValue(html, "currentCountryIso2") || options.countryIso2 || "KR").toUpperCase(),
    shopCode: cleanText(jsVariableValue(html, "shopCode") || options.shopCode || "9000"),
    shippingApiUrl: cleanText(jsVariableValue(html, "API_SHIPPING_URL") || options.shippingApiUrl || DEFAULT_SHIPPING_API_URL),
    stockInfoStatus: cleanText(inputValueByClass(html, "stockInfoStatus")),
    stockInfoAddTime: cleanText(inputValueByClass(html, "stockInfoAddTime")),
    canNotAddCart: booleanFromJs(jsVariableValue(html, "canNotAddCart")),
    restrictedCountry: booleanFromJs(jsVariableValue(html, "restrictedCountry")),
    optionRequired: Boolean(firstTagByClass(html, "option-select") || inputValueByNameOrId(html, "selectedOptions")),
    jsonLdShippingRates: shippingRatesFromJsonLd(productJson),
  };
}

function validateProductDetail(detail, row = {}) {
  const errors = [];
  const warnings = [];
  const identifier = row.partNumber || row.productUrl || detail.sourceUrl || detail.productId;

  if (!detail.productId) errors.push("상품 ID를 찾지 못했습니다.");
  if (!detail.partNumber) errors.push("부품번호를 찾지 못했습니다.");
  if (!detail.unitJpy && !row.unitJpy) errors.push("JPY 단가를 찾지 못했습니다.");
  if (!detail.productWeight) errors.push("배송비 API에 필요한 productWeight 값을 찾지 못했습니다.");
  if (!detail.productVolume) errors.push("배송비 API에 필요한 productVolume 값을 찾지 못했습니다.");
  if (detail.canNotAddCart) errors.push("상품 페이지가 장바구니 담기 불가 상태입니다.");
  if (detail.restrictedCountry) errors.push("배송 제한 국가 상품입니다.");
  if (detail.optionRequired) errors.push("옵션 선택이 필요한 상품은 자동 견적 대상에서 제외합니다.");

  if (row.partNumber) {
    const requested = normalizePartNumber(row.partNumber);
    const candidates = [detail.partNumber, detail.productId].map(normalizePartNumber).filter(Boolean);
    if (!candidates.includes(requested)) {
      errors.push(`요청 부품번호(${row.partNumber})와 상품 상세(${detail.partNumber || detail.productId})가 다릅니다.`);
    }
  }
  if (row.unitJpy && detail.unitJpy && row.unitJpy !== detail.unitJpy) {
    warnings.push(`${identifier} 입력 단가(${row.unitJpy})와 상품 상세 단가(${detail.unitJpy})가 다릅니다. 상품 상세 단가를 사용합니다.`);
  }

  return { errors, warnings };
}

function validateCartScriptProductDetail(detail, row = {}) {
  const errors = [];
  const warnings = [];
  const identifier = row.partNumber || row.productUrl || detail.sourceUrl || detail.productId;

  if (!detail.productId) errors.push("상품 ID를 찾지 못했습니다.");
  if (!detail.partNumber) errors.push("부품번호를 찾지 못했습니다.");
  if (detail.canNotAddCart) errors.push("상품 페이지가 장바구니 담기 불가 상태입니다.");
  if (detail.restrictedCountry) errors.push("배송 제한 국가 상품입니다.");
  if (detail.optionRequired) errors.push("옵션 선택이 필요한 상품은 자동 담기 대상에서 제외합니다.");

  if (row.partNumber) {
    const requested = normalizePartNumber(row.partNumber);
    const candidates = [detail.partNumber, detail.productId].map(normalizePartNumber).filter(Boolean);
    if (!candidates.includes(requested)) {
      errors.push(`요청 부품번호(${row.partNumber})와 상품 상세(${detail.partNumber || detail.productId})가 다릅니다.`);
    }
  }
  if (row.unitJpy && detail.unitJpy && row.unitJpy !== detail.unitJpy) {
    warnings.push(`${identifier} 입력 단가(${row.unitJpy})와 상품 상세 단가(${detail.unitJpy})가 다릅니다. 장바구니 담기는 상품 상세 ID 기준으로 진행합니다.`);
  }

  return { errors, warnings };
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl || DEFAULT_PRODUCT_BASE_URL).href;
  } catch {
    throw new Error(`유효하지 않은 URL입니다: ${value}`);
  }
}

async function requestText(url, options = {}) {
  if (typeof options.fetchText === "function") return options.fetchText(url);
  if (typeof fetch !== "function") {
    throw new Error("현재 Node.js 런타임은 fetch를 지원하지 않습니다. Node.js 18 이상에서 실행해 주세요.");
  }
  const response = await fetch(url, {
    headers: {
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 WebikeCartSplitter/0.1",
    },
  });
  if (!response.ok) throw new Error(`요청 실패 (${response.status}): ${url}`);
  return response.text();
}

async function requestJson(url, options = {}) {
  if (typeof options.fetchJson === "function") return options.fetchJson(url);
  const text = await requestText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON 응답을 파싱하지 못했습니다: ${url}`);
  }
}

function extractProductLinks(html, baseUrl, partNumber = "") {
  const target = normalizePartNumber(partNumber);
  const unique = new Map();
  const pattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of String(html || "").matchAll(pattern)) {
    const rawHref = decodeHtml(match[1] ?? match[2] ?? match[3] ?? "");
    if (!/\/products\/\d+\.html/i.test(rawHref)) continue;
    const href = absoluteUrl(rawHref, baseUrl);
    const text = stripTags(match[4]);
    if (!unique.has(href)) unique.set(href, { href, text });
  }

  const links = [...unique.values()];
  const matched = links.filter((link) => normalizePartNumber(`${link.text} ${link.href}`).includes(target));
  return matched.length ? matched : links;
}

function productLinksFromStructuredData(data, baseUrl) {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  const links = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;
    const url = cleanText(node.url);
    if (/\/products\/\d+\.html/i.test(url)) {
      links.push({
        href: absoluteUrl(url, baseUrl),
        text: cleanText(node.name),
      });
    }
    Object.values(node).forEach(visit);
  };
  visit(parsed);
  return links;
}

function buildProductSearchRequest(partNumber, options = {}) {
  const searchApiUrl = cleanText(options.searchApiUrl || DEFAULT_SEARCH_API_URL);
  const url = new URL(searchApiUrl, options.productBaseUrl || DEFAULT_PRODUCT_BASE_URL);
  url.searchParams.set("search", "");
  url.searchParams.set("p.k", partNumber);
  url.searchParams.set("p.ref", "product-search-es");
  url.searchParams.set("smp", "sp");

  return {
    url: url.href,
    partNumber,
  };
}

function extractProductLinksFromSearchResponse(data, baseUrl, partNumber = "") {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (parsed?.notFound) return [];

  const unique = new Map();
  const addLinks = (links) => {
    links.forEach((link) => {
      const href = cleanText(link.href);
      if (!href || unique.has(href)) return;
      unique.set(href, link);
    });
  };
  const html = [
    ...(Array.isArray(parsed?.productsList) ? parsed.productsList.map((item) => item?.data || "") : []),
    parsed?.redirectUrl ? `<a href="${parsed.redirectUrl}">${partNumber}</a>` : "",
  ].join("\n");

  addLinks(extractProductLinks(html, baseUrl, partNumber));
  if (parsed?.collectionPageStructuredData) {
    try {
      addLinks(productLinksFromStructuredData(parsed.collectionPageStructuredData, baseUrl));
    } catch {
      // The HTML product list is the primary source; structured data is only a fallback.
    }
  }

  const links = [...unique.values()];
  const target = normalizePartNumber(partNumber);
  const matched = links.filter((link) => normalizePartNumber(`${link.text} ${link.href}`).includes(target));
  return matched.length ? matched : links;
}

async function findProductUrlBySearch(partNumber, options = {}) {
  const request = buildProductSearchRequest(partNumber, options);
  const response = await requestJson(request.url, options);
  const links = extractProductLinksFromSearchResponse(response, request.url, partNumber);

  if (links.length === 1) return links[0].href;
  if (!links.length) throw new Error(`${partNumber} 검색 결과에서 상품 상세 URL을 찾지 못했습니다.`);
  throw new Error(`${partNumber} 검색 결과가 ${links.length}개입니다. product_url을 입력해 주세요.`);
}

async function resolveProductUrl(row, options = {}) {
  if (row.productUrl) return absoluteUrl(row.productUrl, options.productBaseUrl || DEFAULT_PRODUCT_BASE_URL);
  if (!row.partNumber) throw new Error("상품 URL 자동 검색에는 part_number가 필요합니다.");
  return findProductUrlBySearch(row.partNumber, options);
}

function productFromDetail(row, detail, index) {
  const unitJpy = detail.unitJpy || row.unitJpy;
  return {
    index,
    sku: detail.productId,
    code: detail.partNumber || detail.productId,
    name: row.name || detail.name || detail.partNumber || detail.productId,
    quantity: row.quantity,
    unitJpy,
    totalJpy: row.quantity * unitJpy,
    productUrl: detail.sourceUrl,
    productId: detail.productId,
    shippingWeight: detail.productWeight,
    shippingVolume: detail.productVolume,
    countryIso2: detail.countryIso2,
    shopCode: detail.shopCode,
    shippingApiUrl: detail.shippingApiUrl,
  };
}

function scenarioProductsFromGroup(group, products) {
  const quantities = new Map();
  group.forEach((atom) => {
    quantities.set(atom.productIndex, (quantities.get(atom.productIndex) || 0) + atom.quantity);
  });

  return [...quantities.entries()].map(([productIndex, quantity]) => {
    const product = products.find((item) => item.index === productIndex);
    if (!product) throw new Error(`분할 그룹의 상품 index ${productIndex}를 찾지 못했습니다.`);
    return {
      ...product,
      quantity,
      totalJpy: quantity * product.unitJpy,
    };
  }).sort((a, b) => b.totalJpy - a.totalJpy);
}

function shipmentMetricsFromProducts(products) {
  return products.reduce((sum, item) => {
    const quantity = Math.max(1, Math.round(toNumber(item.quantity)));
    const unitJpy = toNumber(item.unitJpy);
    const totalJpy = Math.round(toNumber(item.totalJpy || (unitJpy * quantity)));
    const weight = toNumber(item.shippingWeight ?? item.productWeight ?? item.weightPoint);
    const volume = toNumber(item.shippingVolume ?? item.productVolume ?? item.volumePoint);
    return {
      amountJpy: sum.amountJpy + totalJpy,
      weightPoint: Number((sum.weightPoint + (weight * quantity)).toFixed(2)),
      volumePoint: Number((sum.volumePoint + (volume * quantity)).toFixed(2)),
    };
  }, {
    amountJpy: 0,
    weightPoint: 0,
    volumePoint: 0,
  });
}

function decimalParam(value) {
  return Number(toNumber(value).toFixed(2)).toString();
}

function buildShippingRequest(products, options = {}) {
  const first = products[0] || {};
  const metrics = shipmentMetricsFromProducts(products);
  const countryIso2 = cleanText(options.countryIso2 || first.countryIso2 || "KR").toUpperCase();
  const shopCode = cleanText(options.shopCode || first.shopCode || "9000");
  const shippingApiUrl = cleanText(options.shippingApiUrl || first.shippingApiUrl || DEFAULT_SHIPPING_API_URL);
  const url = new URL(shippingApiUrl);
  url.searchParams.set("wp", decimalParam(metrics.weightPoint));
  url.searchParams.set("vl", decimalParam(metrics.volumePoint));
  url.searchParams.set("to", countryIso2);
  url.searchParams.set("sc", shopCode);
  url.searchParams.set("amount", decimalParam(metrics.amountJpy));

  return {
    url: url.href,
    metrics,
    countryIso2,
    shopCode,
  };
}

function normalizeShippingApiResponse(data) {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  const response = parsed?.response || parsed || {};
  const status = cleanText(response.status || "OK").toUpperCase();
  const results = Array.isArray(response.results) ? response.results : [];
  if (status !== "OK") throw new Error(`배송비 API 상태가 OK가 아닙니다: ${response.status || "unknown"}`);
  if (!results.length) throw new Error("배송비 API 결과가 비어 있습니다.");

  return results.map((item) => ({
    serviceCode: cleanText(item.service_code || item.serviceCode),
    serviceId: cleanText(item.service_id_dobar || item.serviceId),
    costJpy: Math.round(toNumber(item.cost)),
    durationMin: Math.round(toNumber(item.duration_min || item.durationMin)),
    durationMax: Math.round(toNumber(item.duration_max || item.durationMax)),
    type: cleanText(item.type),
  })).filter((item) => item.serviceCode && item.costJpy >= 0)
    .sort((a, b) => a.costJpy - b.costJpy);
}

function selectShippingCandidate(candidates, options = {}) {
  const serviceCode = cleanText(options.shippingService).toUpperCase();
  if (!serviceCode) return candidates[0];
  const selected = candidates.find((item) => item.serviceCode.toUpperCase() === serviceCode);
  if (!selected) throw new Error(`배송 서비스 ${serviceCode}를 배송비 API 결과에서 찾지 못했습니다.`);
  return selected;
}

async function quoteShipmentShipping(products, options = {}, label = "") {
  const request = buildShippingRequest(products, options);
  const response = await requestJson(request.url, options);
  const candidates = normalizeShippingApiResponse(response);
  const selected = selectShippingCandidate(candidates, options);
  const warnings = [];
  const countryCodes = new Set(products.map((item) => item.countryIso2).filter(Boolean));
  const shopCodes = new Set(products.map((item) => item.shopCode).filter(Boolean));
  if (countryCodes.size > 1) warnings.push("상품별 배송 국가 값이 섞여 있어 첫 상품 기준으로 견적했습니다.");
  if (shopCodes.size > 1) warnings.push("상품별 shopCode가 섞여 있어 첫 상품 기준으로 견적했습니다.");

  return {
    label,
    productJpy: request.metrics.amountJpy,
    shippingJpy: selected.costJpy,
    shippingServiceCode: selected.serviceCode,
    shippingType: selected.type,
    products: products.map((item) => ({
      code: item.code,
      name: item.name,
      quantity: item.quantity,
      unitJpy: item.unitJpy,
      totalJpy: item.totalJpy,
    })),
    request,
    shippingCandidates: candidates,
    warnings,
  };
}

function splitUnavailableReason(recommendation) {
  if (recommendation.groups?.length > 1) return "";
  if (recommendation.groups?.length === 1) return "전체 상품가가 면세 기준 안이라 분할 주문이 필요하지 않습니다.";
  if (recommendation.oversize?.length) return "단일 계산 단위가 면세 한도를 초과했습니다.";
  return "지정한 최대 주문 수 안에서 분할 그룹을 찾지 못했습니다.";
}

function defaultOutputPath() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
  return path.join(DEFAULT_OUTPUT_DIR, `webike_quote_${stamp}.json`);
}

function defaultCartScriptOutputPath() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
  return path.join(DEFAULT_OUTPUT_DIR, `webike_add_cart_${stamp}.js`);
}

function buildReport({
  mode,
  inputRows,
  products,
  groupSettings,
  recommendation,
  comparison,
  automationResults = [],
  measurement = null,
}) {
  const resolvedRecommendation = recommendation || cartCore.recommendGroups(products, groupSettings);
  const resolvedComparison = comparison || costCore.compareOrderStrategies(
    products,
    resolvedRecommendation,
    costSettingsFromOptions({}, groupSettings),
  );

  return {
    mode,
    generatedAt: new Date().toISOString(),
    inputCount: inputRows.length,
    products,
    groupSettings,
    recommendation: resolvedRecommendation,
    comparison: resolvedComparison,
    measurement,
    automationResults,
    notice: "장바구니 배송비 실측 자료입니다. 실제 주문, 결제, 통관 결과, 합산과세를 보장하지 않습니다.",
  };
}

function writeReport(report, outputPath) {
  const resolved = path.resolve(outputPath || defaultOutputPath());
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  return resolved;
}

function buildCartScript(items) {
  const safeItems = items.map((item) => ({
    partNumber: item.partNumber,
    productsId: item.productsId,
    quantity: item.quantity,
    name: item.name,
    unitJpy: item.unitJpy,
    productUrl: item.productUrl,
  }));

  return `// Webike Cart Splitter generated add-cart script.
// 1. Open https://www.japan-webike.kr/ in your browser.
// 2. Open DevTools Console and paste this whole script.
// 3. This script adds items to the current browser cart session only.
(async () => {
  const items = ${JSON.stringify(safeItems, null, 2)};
  const endpoint = "/api_shopping_cart.html?action=add_product&ajax_action=1";
  const failures = [];

  function responseLooksFailed(parsed, text) {
    if (parsed && typeof parsed === "object") {
      const result = String(parsed.result || parsed.status || parsed.resultcode || "").toLowerCase();
      const message = String(parsed.message || parsed.errmsg || parsed.errsmsg || "").toLowerCase();
      return ["error", "failed", "fail", "ng"].includes(result) || message.includes("error") || message.includes("fail");
    }
    return /(?:error|failed|fail|오류|실패)/i.test(String(text || ""));
  }

  async function addItem(item, index) {
    console.log(\`[\${index + 1}/\${items.length}] \${item.partNumber} 장바구니 담기 요청\`);
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({
        products_id: item.productsId,
        cart_quantity: String(item.quantity),
      }),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!response.ok || responseLooksFailed(parsed, text)) {
      throw new Error(\`\${response.status} \${text.slice(0, 240)}\`);
    }
    console.log(\`[\${index + 1}/\${items.length}] \${item.partNumber} 완료\`);
    return parsed || text;
  }

  for (const [index, item] of items.entries()) {
    try {
      await addItem(item, index);
    } catch (error) {
      failures.push({ item, error: error.message });
      console.error(\`[\${index + 1}/\${items.length}] \${item.partNumber} 실패\`, error);
    }
  }

  if (failures.length) {
    console.error("장바구니 담기 실패 상품:", failures);
    return;
  }

  console.log(\`완료: \${items.length}개 상품을 장바구니에 담았습니다.\`);
  location.href = "/shopping_cart.html";
})();
`;
}

function writeCartScript(script, outputPath) {
  const resolved = path.resolve(outputPath || defaultCartScriptOutputPath());
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, script);
  return resolved;
}

function requirePlaywright() {
  try {
    return require("playwright");
  } catch {
    throw new Error("Playwright가 설치되어 있지 않습니다. npm install 후 npx playwright install chromium을 실행해 주세요.");
  }
}

async function fillFirst(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count()) {
        await locator.fill(String(value));
        return selector;
      }
    } catch {
      continue;
    }
  }
  return "";
}

async function setQuantity(page, quantity) {
  for (const selector of QUANTITY_SELECTORS) {
    const locator = page.locator(selector).first();
    try {
      if (!(await locator.count())) continue;
      const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());
      if (tagName === "select") {
        await locator.selectOption(String(quantity));
      } else {
        await locator.fill(String(quantity));
      }
      return selector;
    } catch {
      continue;
    }
  }

  if (quantity > 1) {
    throw new Error(`${quantity}개 수량 입력창을 찾지 못했습니다.`);
  }
  return "";
}

async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count()) {
        await locator.click({ timeout: 5000 });
        return selector;
      }
    } catch {
      continue;
    }
  }
  return "";
}

async function waitForPageProgress(page, previousUrl) {
  await Promise.race([
    page.waitForURL((url) => url.href !== previousUrl, { timeout: 15000 }).catch(() => null),
    page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null),
  ]);
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => null);
}

async function searchPart(page, baseUrl, partNumber) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const selector = await fillFirst(page, SEARCH_INPUT_SELECTORS, partNumber);
  if (!selector) throw new Error("검색 입력창을 찾지 못했습니다.");
  const previousUrl = page.url();
  await page.locator(selector).first().press("Enter");
  await waitForPageProgress(page, previousUrl);
  return selector;
}

async function findExactProductUrl(page, partNumber) {
  const target = normalizePartNumber(partNumber);
  const candidates = await page.$$eval("a[href]", (links, wanted) => {
    const normalize = (value) => String(value || "").toUpperCase().replace(/[\s-]/g, "");
    const unique = new Map();
    links.forEach((link) => {
      const text = `${link.textContent || ""} ${link.getAttribute("title") || ""} ${link.getAttribute("href") || ""}`;
      if (!normalize(text).includes(wanted)) return;
      const href = link.href;
      if (!href || unique.has(href)) return;
      unique.set(href, {
        href,
        text: String(link.textContent || "").replace(/\s+/g, " ").trim(),
      });
    });
    return [...unique.values()];
  }, target);

  if (candidates.length !== 1) {
    return {
      status: candidates.length ? "multiple_candidates" : "not_found",
      candidates,
    };
  }

  return {
    status: "matched",
    url: candidates[0].href,
    text: candidates[0].text,
    candidates,
  };
}

async function readProductSnapshot(page, partNumber) {
  return page.evaluate((wanted) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const parseJpy = (value) => {
      const text = String(value || "").replace(/\u00a0/g, " ");
      const match = text.match(/(?:JPY|￥|¥)\s*([\d,]+(?:\.\d+)?)/i) ||
        text.match(/([\d,]+(?:\.\d+)?)\s*(?:JPY|円)/i);
      return match ? Math.round(Number(match[1].replace(/,/g, ""))) : 0;
    };
    const nameSelectors = [
      ".product-name",
      ".goods-name",
      "h1",
      "[itemprop='name']",
    ];
    const priceSelectors = [
      ".price",
      ".product-price",
      ".sale-price",
      "[itemprop='price']",
      "[class*='price' i]",
    ];
    const name = nameSelectors.map((selector) => clean(document.querySelector(selector)?.textContent)).find(Boolean) || wanted;
    const unitJpy = priceSelectors.map((selector) => parseJpy(document.querySelector(selector)?.textContent)).find(Boolean) || 0;

    return {
      partNumber: wanted,
      name,
      unitJpy,
      url: location.href,
    };
  }, partNumber);
}

async function addCurrentProductToCart(page, quantity) {
  const quantitySelector = await setQuantity(page, quantity);
  const previousUrl = page.url();
  const selector = await clickFirst(page, ADD_TO_CART_SELECTORS);
  if (!selector) throw new Error("장바구니 담기 버튼을 찾지 못했습니다.");
  await waitForPageProgress(page, previousUrl);
  return { addButtonSelector: selector, quantitySelector };
}

function cartUrlFromOptions(options) {
  if (options.cartUrl) return options.cartUrl;
  return new URL("/cart/", options.baseUrl || DEFAULT_BASE_URL).href;
}

async function openCart(page, options) {
  const previousUrl = page.url();
  const selector = await clickFirst(page, CART_LINK_SELECTORS);
  if (selector) {
    await waitForPageProgress(page, previousUrl);
    return selector;
  }

  await page.goto(cartUrlFromOptions(options), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  return "direct-cart-url";
}

async function collectCartQuote(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const parseJpy = (value) => {
      const text = String(value || "").replace(/\u00a0/g, " ");
      const match = text.match(/(?:JPY|￥|¥)\s*([\d,]+(?:\.\d+)?)/i) ||
        text.match(/([\d,]+(?:\.\d+)?)\s*(?:JPY|円)/i);
      return match ? Math.round(Number(match[1].replace(/,/g, ""))) : 0;
    };
    const parseAllJpy = (value) => {
      const text = String(value || "").replace(/\u00a0/g, " ");
      const amounts = [];
      for (const pattern of [
        /(?:JPY|￥|¥)\s*([\d,]+(?:\.\d+)?)/gi,
        /([\d,]+(?:\.\d+)?)\s*(?:JPY|円)/gi,
      ]) {
        for (const match of text.matchAll(pattern)) {
          amounts.push(Math.round(Number(match[1].replace(/,/g, ""))));
        }
      }
      return amounts.filter((amount) => Number.isFinite(amount));
    };
    const firstNumber = (value) => {
      const match = String(value || "").match(/[\d,]+(?:\.\d+)?/);
      return match ? Math.round(Number(match[0].replace(/,/g, ""))) : 0;
    };
    const rowSelectors = [
      ".table-cart tbody tr.item",
      ".table-cart tbody tr[id^='product-item']",
      ".table-cart tbody tr[data-sku]",
      ".table-cart tbody tr[data-product-code]",
      ".table-cart tbody tr",
      "tr[data-sku]",
      ".cart-item",
      ".cart-list-item",
      "[data-cart-item]",
    ];
    const rows = [];
    const seenRows = new Set();
    rowSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((row) => {
        if (seenRows.has(row)) return;
        seenRows.add(row);
        rows.push(row);
      });
    });
    const products = rows.map((row, index) => {
      const text = clean(row.textContent);
      const code = clean(row.querySelector(".product-code .code")?.textContent) ||
        clean(row.querySelector(".product-code")?.textContent) ||
        clean(row.querySelector(".goods-code")?.textContent) ||
        clean(row.dataset?.sku || row.dataset?.productCode || row.getAttribute("data-sku")) ||
        clean(row.id || `item-${index + 1}`).replace(/^(product-item|cart-item|item)[_-]?/i, "");
      const name = clean(row.querySelector(".product-name a")?.textContent) ||
        clean(row.querySelector(".product-name")?.textContent) ||
        clean(row.querySelector(".goods-name")?.textContent) ||
        clean(row.querySelector(".item-name")?.textContent) ||
        code;
      const quantityElement = row.querySelector("input[name='quantity'], input[name='qty'], .quantity, .qty");
      const quantity = firstNumber(quantityElement?.value ||
        quantityElement?.textContent ||
        text.match(/(?:Qty|Quantity|수량|数量)\s*[:：]?\s*([\d,]+)/i)?.[1] ||
        "1") || 1;
      const unitJpy = parseJpy(row.querySelector(".unit-sub-price, .unit-price, .price-unit, .product-price, .item-price, .price")?.textContent);
      const totalJpy = parseJpy(row.querySelector(".total-sub-price, .subtotal-price, .subtotal, .total-price, .line-total, .amount")?.textContent) ||
        unitJpy * quantity;
      const resolvedUnitJpy = unitJpy || (totalJpy ? Math.round(totalJpy / quantity) : 0);
      if (!code || !resolvedUnitJpy) return null;
      return {
        index,
        sku: code,
        code,
        name,
        quantity,
        unitJpy: resolvedUnitJpy,
        totalJpy: totalJpy || resolvedUnitJpy * quantity,
      };
    }).filter(Boolean);

    const shippingPatterns = /(shipping|delivery|postage|freight|送料|配送料|配送|국제배송|배송비)/i;
    const totalPatterns = /(grand\s*total|order\s*total|total|合計|総計|주문합계|총합계)/i;
    const excludedShippingPatterns = /(subtotal|product\s*total|goods\s*total|상품합계|소계)/i;
    const moneySelectors = [
      "[class*='shipping' i]",
      "[id*='shipping' i]",
      "[class*='delivery' i]",
      "[id*='delivery' i]",
      "[class*='postage' i]",
      "[id*='postage' i]",
      "[class*='total' i]",
      "[id*='total' i]",
      "tr",
      "li",
      "dl",
      "p",
      "div",
    ];
    const elements = [];
    const seenElements = new Set();
    moneySelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (seenElements.has(element)) return;
        seenElements.add(element);
        elements.push(element);
      });
    });
    const amountCandidates = elements.map((element, index) => {
      const text = clean(element.textContent);
      if (!text || text.length > 260) return null;
      const amounts = parseAllJpy(text);
      const freeShipping = shippingPatterns.test(text) && /(free|무료|無料)/i.test(text);
      if (!amounts.length && !freeShipping) return null;
      return {
        index,
        text,
        amounts,
        amount: amounts.at(-1) ?? 0,
        shipping: shippingPatterns.test(text) && !excludedShippingPatterns.test(text),
        total: totalPatterns.test(text),
      };
    }).filter(Boolean);
    const shippingCandidates = amountCandidates.filter((candidate) => candidate.shipping);
    const totalCandidates = amountCandidates.filter((candidate) => candidate.total);
    const shippingJpy = shippingCandidates.length ? shippingCandidates[0].amount : null;
    const cartTotalJpy = totalCandidates.length ? totalCandidates.at(-1).amount : null;
    const productJpy = products.reduce((sum, item) => sum + item.totalJpy, 0);

    return {
      url: location.href,
      products,
      productJpy,
      shippingJpy,
      cartTotalJpy,
      shippingCandidates,
      totalCandidates,
    };
  });
}

function scenarioItemsFromGroup(group) {
  return cartCore.aggregateGroup(group).map((item) => ({
    partNumber: item.code,
    name: item.name,
    quantity: item.quantity,
    expectedUnitJpy: item.unitJpy,
    expectedSubtotalJpy: item.subtotalJpy,
  }));
}

function quantityWarnings(expectedItems, actualProducts) {
  const expected = new Map();
  const actual = new Map();
  expectedItems.forEach((item) => {
    const key = normalizePartNumber(item.partNumber);
    expected.set(key, (expected.get(key) || 0) + item.quantity);
  });
  actualProducts.forEach((item) => {
    const key = normalizePartNumber(item.code || item.sku);
    actual.set(key, (actual.get(key) || 0) + item.quantity);
  });

  const warnings = [];
  expected.forEach((quantity, key) => {
    if (!actual.has(key)) {
      warnings.push(`${key} 상품이 장바구니 결과에서 확인되지 않았습니다.`);
    } else if (actual.get(key) !== quantity) {
      warnings.push(`${key} 수량이 요청 ${quantity}개, 장바구니 ${actual.get(key)}개로 다릅니다.`);
    }
  });
  return warnings;
}

function validateScenarioResult(result) {
  const errors = [];
  const warnings = [];
  const failedAdds = result.addResults.filter((item) => item.status !== "added_to_cart");
  if (failedAdds.length) {
    errors.push(`장바구니 담기 실패: ${failedAdds.map((item) => item.partNumber).join(", ")}`);
  }
  if (!result.quote?.products?.length) {
    errors.push("장바구니 상품을 읽지 못했습니다.");
  }
  if (!result.quote || result.quote.productJpy <= 0) {
    errors.push("장바구니 상품 합계를 읽지 못했습니다.");
  }
  if (!result.quote || result.quote.shippingJpy === null || result.quote.shippingJpy === undefined) {
    errors.push("장바구니 배송비를 읽지 못했습니다.");
  }
  warnings.push(...quantityWarnings(result.items, result.quote?.products || []));
  return { errors, warnings };
}

function scenarioErrorSummary(result) {
  const validation = result.validation || { errors: [] };
  const details = validation.errors.length ? validation.errors.join(" / ") : result.error;
  return `${result.label} 측정 실패: ${details || "원인을 알 수 없습니다."}`;
}

async function runCartScenario(browser, options, scenario) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const result = {
    code: scenario.code,
    label: scenario.label,
    items: scenario.items,
    status: "pending",
    addResults: [],
  };

  try {
    for (const row of scenario.items) {
      const itemResult = {
        partNumber: row.partNumber,
        quantity: row.quantity,
        status: "pending",
      };
      try {
        itemResult.searchSelector = await searchPart(page, options.baseUrl, row.partNumber);
        const match = await findExactProductUrl(page, row.partNumber);
        itemResult.match = match;
        if (match.status !== "matched") {
          itemResult.status = match.status;
          result.addResults.push(itemResult);
          continue;
        }
        await page.goto(match.url, { waitUntil: "domcontentloaded" });
        itemResult.snapshot = await readProductSnapshot(page, row.partNumber);
        Object.assign(itemResult, await addCurrentProductToCart(page, row.quantity));
        itemResult.status = "added_to_cart";
      } catch (error) {
        itemResult.status = "failed";
        itemResult.error = error.message;
      }
      result.addResults.push(itemResult);
    }

    result.cartOpenSelector = await openCart(page, options);
    result.quote = await collectCartQuote(page);
    result.validation = validateScenarioResult(result);
    result.status = result.validation.errors.length ? "failed" : "measured";
    return result;
  } catch (error) {
    result.status = "failed";
    result.error = error.message;
    result.validation = validateScenarioResult(result);
    return result;
  } finally {
    await context.close();
  }
}

function shipmentFromScenario(result) {
  return {
    label: result.label,
    productJpy: result.quote.productJpy,
    shippingJpy: result.quote.shippingJpy,
    products: result.quote.products,
  };
}

async function runCartMode(options, inputRows, groupSettings) {
  const { chromium } = requirePlaywright();
  const browser = await chromium.launch({ headless: !options.headed });
  const automationResults = [];

  try {
    const singleScenario = await runCartScenario(browser, options, {
      code: "single_order",
      label: "한 번에 주문",
      items: inputRows,
    });
    automationResults.push(singleScenario);
    if (singleScenario.status !== "measured") {
      throw new Error(scenarioErrorSummary(singleScenario));
    }

    const products = singleScenario.quote.products.map((item, index) => ({ ...item, index }));
    const recommendation = cartCore.recommendGroups(products, groupSettings);
    const splitScenarios = [];

    if (recommendation.groups.length > 1) {
      for (const [index, group] of recommendation.groups.entries()) {
        const scenario = await runCartScenario(browser, options, {
          code: `split_order_${index + 1}`,
          label: `분할 주문 ${index + 1}`,
          items: scenarioItemsFromGroup(group),
        });
        splitScenarios.push(scenario);
        automationResults.push(scenario);
        if (scenario.status !== "measured") {
          throw new Error(scenarioErrorSummary(scenario));
        }
      }
    }

    const measurement = {
      singleShipment: shipmentFromScenario(singleScenario),
      splitShipments: splitScenarios.map(shipmentFromScenario),
      splitUnavailableReason: recommendation.groups.length <= 1
        ? "전체 상품가가 면세 기준 안이라 분할 주문이 필요하지 않습니다."
        : "",
    };
    const comparison = costCore.compareMeasuredOrderStrategies(
      measurement,
      costSettingsFromOptions(options, groupSettings),
    );

    return {
      products,
      recommendation,
      comparison,
      automationResults,
      measurement,
    };
  } finally {
    await browser.close();
  }
}

async function runQuoteApiMode(options, inputRows, groupSettings) {
  const automationResults = [];
  const parsedProducts = [];
  const rowCount = inputRows.length;

  for (const [index, row] of inputRows.entries()) {
    const prefix = `[${index + 1}/${rowCount}]`;
    if (row.productUrl) {
      logProgress(options, `${prefix} 상세 페이지 확인 중: ${row.productUrl}`);
    } else {
      logProgress(options, `${prefix} ${row.partNumber} 검색 중`);
    }
    const productUrl = await resolveProductUrl(row, options);
    if (!row.productUrl) {
      logProgress(options, `${prefix} 상세 페이지 확인: ${productUrl}`);
    }
    const html = await requestText(productUrl, options);
    const detail = parseProductDetail(html, productUrl, options);
    const validation = validateProductDetail(detail, row);
    const result = {
      code: "product_detail",
      rowIndex: index + 1,
      partNumber: row.partNumber,
      productUrl,
      status: validation.errors.length ? "failed" : "parsed",
      detail,
      validation,
    };
    automationResults.push(result);

    if (validation.errors.length) {
      logProgress(options, `${prefix} 상품 상세 검증 실패: ${validation.errors.join(" / ")}`);
      throw new Error(`${row.partNumber || productUrl} 상품 상세 검증 실패: ${validation.errors.join(" / ")}`);
    }

    logProgress(
      options,
      `${prefix} 상품 정보 확인: ${detail.partNumber || detail.productId}, ${detail.unitJpy || row.unitJpy} JPY, 수량 ${row.quantity}`,
    );
    parsedProducts.push(productFromDetail(row, detail, index));
  }

  const products = parsedProducts;
  const recommendation = cartCore.recommendGroups(products, groupSettings);
  logProgress(options, `[그룹] 추천 주문 ${recommendation.groups.length || 0}개 계산 완료`);
  logProgress(options, `[배송비] 한 번에 주문 조회 중 (${products.length}종)`);
  const singleShipment = await quoteShipmentShipping(products, options, "한 번에 주문");
  logProgress(options, `[배송비] 한 번에 주문: ${singleShipment.shippingServiceCode} ${singleShipment.shippingJpy} JPY`);
  const splitShipments = [];

  if (recommendation.groups.length > 1) {
    for (const [index, group] of recommendation.groups.entries()) {
      const scenarioProducts = scenarioProductsFromGroup(group, products);
      logProgress(options, `[배송비] 분할 주문 ${index + 1}/${recommendation.groups.length} 조회 중 (${scenarioProducts.length}종)`);
      const splitShipment = await quoteShipmentShipping(scenarioProducts, options, `분할 주문 ${index + 1}`);
      logProgress(options, `[배송비] 분할 주문 ${index + 1}: ${splitShipment.shippingServiceCode} ${splitShipment.shippingJpy} JPY`);
      splitShipments.push(splitShipment);
    }
  }

  const measurement = {
    singleShipment,
    splitShipments,
    splitUnavailableReason: splitUnavailableReason(recommendation),
  };
  const comparison = costCore.compareMeasuredOrderStrategies(
    measurement,
    costSettingsFromOptions(options, groupSettings),
  );

  return {
    products,
    recommendation,
    comparison,
    automationResults,
    measurement,
  };
}

async function runCartScriptMode(options, inputRows) {
  const items = [];
  const automationResults = [];
  const rowCount = inputRows.length;

  for (const [index, row] of inputRows.entries()) {
    const prefix = `[${index + 1}/${rowCount}]`;
    if (row.productUrl) {
      logProgress(options, `${prefix} 상세 페이지 확인 중: ${row.productUrl}`);
    } else {
      logProgress(options, `${prefix} ${row.partNumber} 검색 중`);
    }
    const productUrl = await resolveProductUrl(row, options);
    if (!row.productUrl) {
      logProgress(options, `${prefix} 상세 페이지 확인: ${productUrl}`);
    }
    const html = await requestText(productUrl, options);
    const detail = parseProductDetail(html, productUrl, options);
    const validation = validateCartScriptProductDetail(detail, row);
    const result = {
      code: "cart_script_product",
      rowIndex: index + 1,
      partNumber: row.partNumber,
      productUrl,
      status: validation.errors.length ? "failed" : "parsed",
      detail,
      validation,
    };
    automationResults.push(result);

    if (validation.errors.length) {
      logProgress(options, `${prefix} 상품 상세 검증 실패: ${validation.errors.join(" / ")}`);
      throw new Error(`${row.partNumber || productUrl} 장바구니 스크립트 생성 실패: ${validation.errors.join(" / ")}`);
    }

    const item = {
      partNumber: detail.partNumber || row.partNumber || detail.productId,
      productsId: detail.productId,
      quantity: row.quantity,
      name: row.name || detail.name || detail.partNumber || detail.productId,
      unitJpy: detail.unitJpy || row.unitJpy,
      productUrl,
    };
    items.push(item);
    logProgress(options, `${prefix} 장바구니 항목 준비: ${item.partNumber}, products_id ${item.productsId}, 수량 ${item.quantity}`);
  }

  return {
    items,
    script: buildCartScript(items),
    automationResults,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  options.logProgress = !options.quiet;
  if (!options.input) throw new Error("--input 옵션이 필요합니다.");
  if (!["quote-api", "cart-script", "plan-only", "cart"].includes(options.mode)) {
    throw new Error("--mode는 quote-api, cart-script, plan-only, cart만 사용할 수 있습니다.");
  }

  const inputRows = readInputRows(path.resolve(options.input));
  if (options.mode === "cart-script") {
    const cartScriptResult = await runCartScriptMode(options, inputRows);
    const outputPath = writeCartScript(cartScriptResult.script, options.output);
    console.log(`[완료] 장바구니 스크립트: ${outputPath}`);
    console.log(`[완료] 상품 수: ${cartScriptResult.items.length}`);
    return;
  }

  const groupSettings = loadExchangeRateSettings(options);
  let products;
  let recommendation;
  let comparison;
  let automationResults = [];
  let measurement = null;

  if (options.mode === "plan-only") {
    products = productsFromInput(inputRows);
    recommendation = cartCore.recommendGroups(products, groupSettings);
    comparison = costCore.compareOrderStrategies(products, recommendation, costSettingsFromOptions(options, groupSettings));
  } else if (options.mode === "quote-api") {
    const quoteResult = await runQuoteApiMode(options, inputRows, groupSettings);
    products = quoteResult.products;
    recommendation = quoteResult.recommendation;
    comparison = quoteResult.comparison;
    automationResults = quoteResult.automationResults;
    measurement = quoteResult.measurement;
  } else {
    const cartResult = await runCartMode(options, inputRows, groupSettings);
    products = cartResult.products;
    recommendation = cartResult.recommendation;
    comparison = cartResult.comparison;
    automationResults = cartResult.automationResults;
    measurement = cartResult.measurement;
  }

  const report = buildReport({
    mode: options.mode,
    inputRows,
    products,
    groupSettings,
    recommendation,
    comparison,
    automationResults,
    measurement,
  });
  const outputPath = writeReport(report, options.output);
  const cheapest = report.comparison.strategies.find((strategy) => strategy.code === report.comparison.cheapestCode);

  console.log(`[완료] 결과 파일: ${outputPath}`);
  console.log(`[완료] 추천 방식: ${cheapest ? cheapest.label : "확인 필요"}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  readInputRows,
  productsFromInput,
  loadExchangeRateSettings,
  costSettingsFromOptions,
  buildReport,
  buildCartScript,
  writeCartScript,
  normalizePartNumber,
  logProgress,
  scenarioItemsFromGroup,
  quantityWarnings,
  validateScenarioResult,
  cartUrlFromOptions,
  parseProductDetail,
  validateProductDetail,
  validateCartScriptProductDetail,
  extractProductLinks,
  productLinksFromStructuredData,
  buildProductSearchRequest,
  extractProductLinksFromSearchResponse,
  productFromDetail,
  scenarioProductsFromGroup,
  shipmentMetricsFromProducts,
  buildShippingRequest,
  normalizeShippingApiResponse,
  selectShippingCandidate,
  quoteShipmentShipping,
  runQuoteApiMode,
  runCartScriptMode,
  runCartMode,
};
