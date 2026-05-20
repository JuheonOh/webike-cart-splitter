(function initWebikeQuoteCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WebikeQuoteCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createWebikeQuoteCore() {
  const DEFAULT_PRODUCT_BASE_URL = "https://www.japan-webike.kr/";
  const DEFAULT_SEARCH_API_URL = "https://www.japan-webike.kr/api-search-es.html";
  const DEFAULT_SHIPPING_API_URL = "https://japan.webike.net/api_shipping.html";

  function toNumber(value) {
    return Number(String(value ?? "").replace(/,/g, "").trim()) || 0;
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizePartNumber(value) {
    return cleanText(value).toUpperCase().replace(/[\s-]/g, "");
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
    for (const match of String(html || "").matchAll(pattern)) {
      const body = match[1].trim().replace(/^<!--/, "").replace(/-->$/, "").trim();
      if (!body) continue;
      try {
        visit(JSON.parse(body));
      } catch {
        // Ignore malformed structured data; page variables/selectors remain fallbacks.
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

  function absoluteUrl(value, baseUrl) {
    try {
      return new URL(value, baseUrl || DEFAULT_PRODUCT_BASE_URL).href;
    } catch {
      throw new Error(`유효하지 않은 URL입니다: ${value}`);
    }
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

  function productsFromGroup(group, products) {
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
    const serviceCode = cleanText(typeof options === "string" ? options : options.shippingService).toUpperCase();
    if (!serviceCode) return candidates[0];
    const selected = candidates.find((item) => item.serviceCode.toUpperCase() === serviceCode);
    if (!selected) throw new Error(`배송 서비스 ${serviceCode}를 배송비 API 결과에서 찾지 못했습니다.`);
    return selected;
  }

  function safeJsonForScript(value) {
    return JSON.stringify(value, null, 2)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");
  }

function buildQuoteScript(input = {}) {
  const items = Array.isArray(input.items) ? input.items.map((row) => ({
    partNumber: cleanText(row.partNumber),
    productUrl: cleanText(row.productUrl),
    quantity: Math.max(1, Math.round(toNumber(row.quantity) || 1)),
    name: cleanText(row.name),
    unitJpy: Math.round(toNumber(row.unitJpy)),
  })) : [];
  const settings = input.settings || {};

  return `// Webike Cart Splitter quote script.
// Open https://www.japan-webike.kr/, then paste this whole script into DevTools Console.
(async function () {
  const items = ${safeJsonForScript(items)};
  const settings = ${safeJsonForScript(settings)};
  const requiredHost = "www.japan-webike.kr";
  const searchEndpoint = "/api-search-es.html";
  const defaultShippingApiUrl = "https://japan.webike.net/api_shipping.html";

  if (location.hostname !== requiredHost) {
    console.error("Webike Korea 페이지에서 실행해 주세요: https://" + requiredHost + "/");
    return;
  }

  function cleanText(value) {
    return String(value == null ? "" : value).replace(/\\s+/g, " ").trim();
  }

  function toNumber(value) {
    return Number(String(value == null ? "" : value).replace(/,/g, "").trim()) || 0;
  }

  function normalizePartNumber(value) {
    return cleanText(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  function collectStrings(value, output) {
    output = output || [];
    if (typeof value === "string") {
      output.push(value);
      return output;
    }
    if (Array.isArray(value)) {
      value.forEach(function (item) { collectStrings(item, output); });
      return output;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(function (item) { collectStrings(item, output); });
    }
    return output;
  }

  function productUrlsFromText(text) {
    const urls = [];
    const pattern = /https?:\\/\\/www\\.japan-webike\\.kr\\/products\\/\\d+\\.html|\\/products\\/\\d+\\.html/g;
    for (const match of String(text || "").matchAll(pattern)) {
      urls.push(new URL(match[0], location.origin).href);
    }
    return urls;
  }

  function productUrlFromSearchData(data, item) {
    if (data && data.redirectUrl) return new URL(data.redirectUrl, location.origin).href;
    const expected = normalizePartNumber(item.partNumber);
    const candidates = collectStrings(data).flatMap(function (text) {
      return productUrlsFromText(text).map(function (url) {
        return { url: url, text: text };
      });
    });
    const exact = candidates.find(function (candidate) {
      return normalizePartNumber(candidate.text).includes(expected);
    });
    if (exact) return exact.url;
    if (candidates.length === 1) return candidates[0].url;
    throw new Error(item.partNumber + " 검색 결과에서 상품 상세 URL을 1개로 확정하지 못했습니다.");
  }

  function jsVariable(html, name) {
    const pattern = new RegExp("(?:var|let|const)\\\\s+" + name + "\\\\s*=\\\\s*([^;\\\\n]+)", "i");
    const raw = cleanText((html.match(pattern) || [])[1] || "");
    return raw.replace(/^['"]|['"]$/g, "");
  }

  function firstValue(doc, selectors) {
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (!element) continue;
      const value = element.value || element.dataset.prdid || element.dataset.prdId || element.dataset.priceRetail || element.textContent;
      if (cleanText(value)) return cleanText(value);
    }
    return "";
  }

  async function fetchText(url, fetchOptions) {
    const response = await fetch(url, fetchOptions || { credentials: "include" });
    if (!response.ok) throw new Error("HTTP " + response.status + ": " + url);
    return response.text();
  }

  async function fetchJson(url, fetchOptions) {
    const text = await fetchText(url, fetchOptions);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error("JSON 응답을 파싱하지 못했습니다: " + url);
    }
  }

  async function resolveProductUrl(item) {
    if (item.productUrl) return new URL(item.productUrl, location.origin).href;
    const params = new URLSearchParams({
      search: "",
      "p.k": item.partNumber,
      "p.ref": "product-search-es",
      smp: "sp"
    });
    return productUrlFromSearchData(await fetchJson(searchEndpoint + "?" + params), item);
  }

  function parseProductDetail(html, productUrl, item) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const productId = firstValue(doc, ["#prod_id", "input[name='prod_id']", "[data-prdId]", "[data-prdid]"]) || jsVariable(html, "productsId") || (productUrl.match(/\\/products\\/(\\d+)\\.html/i) || [])[1] || "";
    const partNumber = firstValue(doc, ["#product_id"]) || jsVariable(html, "productsModel") || item.partNumber || productId;
    const unitJpy = Math.round(toNumber(firstValue(doc, ["#priceYen", "input[name='priceYen']", "[data-priceRetail]"]) || jsVariable(html, "priceYen") || item.unitJpy));
    const name = jsVariable(html, "SYOUHIN_NAME") || doc.querySelector("h1")?.textContent || item.name || partNumber || productId;
    return {
      index: item.index,
      code: cleanText(partNumber || item.partNumber || productId),
      partNumber: cleanText(partNumber),
      name: cleanText(name),
      quantity: Math.max(1, Math.round(toNumber(item.quantity))),
      unitJpy: unitJpy,
      totalJpy: unitJpy * Math.max(1, Math.round(toNumber(item.quantity))),
      productUrl: productUrl,
      productId: cleanText(productId),
      shippingWeight: toNumber(jsVariable(html, "productWeight")),
      shippingVolume: toNumber(jsVariable(html, "productVolume")),
      countryIso2: cleanText(jsVariable(html, "currentCountryIso2") || "KR").toUpperCase(),
      shopCode: cleanText(jsVariable(html, "shopCode") || "9000"),
      shippingApiUrl: cleanText(jsVariable(html, "API_SHIPPING_URL") || defaultShippingApiUrl),
      canNotAddCart: ["1", "true", "yes", "y"].includes(cleanText(jsVariable(html, "canNotAddCart")).toLowerCase()),
      restrictedCountry: ["1", "true", "yes", "y"].includes(cleanText(jsVariable(html, "restrictedCountry")).toLowerCase()),
      optionRequired: Boolean(doc.querySelector(".option-select, [name='selectedOptions']"))
    };
  }

  function validateProduct(product, item) {
    const errors = [];
    if (!product.productId) errors.push("상품 ID를 찾지 못했습니다.");
    if (!product.code) errors.push("부품번호를 찾지 못했습니다.");
    if (!product.unitJpy) errors.push("JPY 단가를 찾지 못했습니다.");
    if (!product.shippingWeight) errors.push("productWeight 값을 찾지 못했습니다.");
    if (!product.shippingVolume) errors.push("productVolume 값을 찾지 못했습니다.");
    if (product.canNotAddCart) errors.push("장바구니 담기 불가 상태입니다.");
    if (product.restrictedCountry) errors.push("배송 제한 국가 상품입니다.");
    if (product.optionRequired) errors.push("옵션 선택이 필요한 상품입니다.");
    if (item.partNumber) {
      const requested = normalizePartNumber(item.partNumber);
      const actual = [product.code, product.productId].map(normalizePartNumber).filter(Boolean);
      if (!actual.includes(requested)) errors.push("요청 상품번호(" + item.partNumber + ")와 상세(" + product.code + ")가 다릅니다.");
    }
    return errors;
  }

  function makeAtoms(products, splitQuantity) {
    const atoms = [];
    products.forEach(function (product) {
      if (splitQuantity) {
        for (let count = 0; count < product.quantity; count += 1) {
          atoms.push({ productIndex: product.index, code: product.code, productUrl: product.productUrl || "", name: product.name, quantity: 1, unitJpy: product.unitJpy, totalJpy: product.unitJpy });
        }
      } else {
        atoms.push({ productIndex: product.index, code: product.code, productUrl: product.productUrl || "", name: product.name, quantity: product.quantity, unitJpy: product.unitJpy, totalJpy: product.totalJpy });
      }
    });
    return atoms;
  }

  function twoGroupDp(atoms, limitJpy) {
    const total = atoms.reduce(function (sum, item) { return sum + item.totalJpy; }, 0);
    const dp = new Map([[0, null]]);
    atoms.forEach(function (atom, index) {
      Array.from(dp.keys()).forEach(function (sum) {
        const next = sum + atom.totalJpy;
        if (next <= limitJpy && !dp.has(next)) dp.set(next, { previous: sum, index: index });
      });
    });
    let bestSum = null;
    dp.forEach(function (_, sum) {
      const other = total - sum;
      if (other > limitJpy) return;
      if (bestSum === null || Math.abs(total / 2 - sum) < Math.abs(total / 2 - bestSum)) bestSum = sum;
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
    atoms.forEach(function (atom, index) {
      groups[selected.has(index) ? 0 : 1].push(atom);
    });
    return groups;
  }

  function firstFitDecreasing(atoms, groupCount, limitJpy) {
    const groups = Array.from({ length: groupCount }, function () { return []; });
    const sums = Array(groupCount).fill(0);
    const sorted = atoms.slice().sort(function (a, b) { return b.totalJpy - a.totalJpy; });
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
    return groups.filter(function (group) { return group.length > 0; });
  }

  function recommendGroups(products, groupSettings) {
    const atoms = makeAtoms(products, groupSettings.splitQuantity);
    const totalJpy = atoms.reduce(function (sum, item) { return sum + item.totalJpy; }, 0);
    const oversize = atoms.filter(function (item) { return item.totalJpy > groupSettings.limitJpy; });
    if (oversize.length) return { totalJpy: totalJpy, groups: [], oversize: oversize, atoms: atoms };
    const minimumGroups = Math.max(1, Math.ceil(totalJpy / groupSettings.limitJpy));
    if (minimumGroups === 1) return { totalJpy: totalJpy, groups: [atoms], oversize: [], atoms: atoms };
    if (minimumGroups === 2) {
      const exactTwoGroups = twoGroupDp(atoms, groupSettings.limitJpy);
      if (exactTwoGroups) return { totalJpy: totalJpy, groups: exactTwoGroups, oversize: [], atoms: atoms };
    }
    for (let count = minimumGroups; count <= groupSettings.maxGroups; count += 1) {
      const groups = firstFitDecreasing(atoms, count, groupSettings.limitJpy);
      if (groups) return { totalJpy: totalJpy, groups: groups, oversize: [], atoms: atoms };
    }
    return { totalJpy: totalJpy, groups: [], oversize: [], atoms: atoms };
  }

  function productsFromGroup(group, products) {
    const quantities = new Map();
    group.forEach(function (atom) {
      quantities.set(atom.productIndex, (quantities.get(atom.productIndex) || 0) + atom.quantity);
    });
    return Array.from(quantities.entries()).map(function (entry) {
      const product = products.find(function (item) { return item.index === entry[0]; });
      const quantity = entry[1];
      return Object.assign({}, product, { quantity: quantity, totalJpy: quantity * product.unitJpy });
    });
  }

  function shipmentMetrics(products) {
    return products.reduce(function (sum, item) {
      const quantity = Math.max(1, Math.round(toNumber(item.quantity)));
      const totalJpy = Math.round(toNumber(item.totalJpy || item.unitJpy * quantity));
      return {
        amountJpy: sum.amountJpy + totalJpy,
        weightPoint: Number((sum.weightPoint + toNumber(item.shippingWeight) * quantity).toFixed(2)),
        volumePoint: Number((sum.volumePoint + toNumber(item.shippingVolume) * quantity).toFixed(2))
      };
    }, { amountJpy: 0, weightPoint: 0, volumePoint: 0 });
  }

  function decimalParam(value) {
    return Number(toNumber(value).toFixed(2)).toString();
  }

  function buildShippingRequest(products) {
    const first = products[0] || {};
    const metrics = shipmentMetrics(products);
    const url = new URL(first.shippingApiUrl || defaultShippingApiUrl);
    url.searchParams.set("wp", decimalParam(metrics.weightPoint));
    url.searchParams.set("vl", decimalParam(metrics.volumePoint));
    url.searchParams.set("to", cleanText(first.countryIso2 || "KR").toUpperCase());
    url.searchParams.set("sc", cleanText(first.shopCode || "9000"));
    url.searchParams.set("amount", decimalParam(metrics.amountJpy));
    return { url: url.href, metrics: metrics };
  }

  function normalizeShippingResponse(data) {
    const response = data.response || data || {};
    const status = cleanText(response.status || "OK").toUpperCase();
    const results = Array.isArray(response.results) ? response.results : [];
    if (status !== "OK") throw new Error("배송비 API 상태가 OK가 아닙니다: " + (response.status || "unknown"));
    if (!results.length) throw new Error("배송비 API 결과가 비어 있습니다.");
    return results.map(function (item) {
      return {
        serviceCode: cleanText(item.service_code || item.serviceCode),
        serviceId: cleanText(item.service_id_dobar || item.serviceId),
        costJpy: Math.round(toNumber(item.cost)),
        durationMin: Math.round(toNumber(item.duration_min || item.durationMin)),
        durationMax: Math.round(toNumber(item.duration_max || item.durationMax)),
        type: cleanText(item.type)
      };
    }).filter(function (item) {
      return item.serviceCode && item.costJpy >= 0;
    }).sort(function (a, b) {
      return a.costJpy - b.costJpy;
    });
  }

  function selectShippingCandidate(candidates) {
    const serviceCode = cleanText(settings.shippingService).toUpperCase();
    if (!serviceCode) return candidates[0];
    const selected = candidates.find(function (item) { return item.serviceCode.toUpperCase() === serviceCode; });
    if (!selected) throw new Error("배송 서비스 " + serviceCode + "를 배송비 API 결과에서 찾지 못했습니다.");
    return selected;
  }

  async function quoteShipment(products, label) {
    const request = buildShippingRequest(products);
    const candidates = normalizeShippingResponse(await fetchJson(request.url, { credentials: "omit" }));
    const selected = selectShippingCandidate(candidates);
    return {
      label: label,
      productJpy: request.metrics.amountJpy,
      shippingJpy: selected.costJpy,
      shippingServiceCode: selected.serviceCode,
      shippingType: selected.type,
      products: products.map(function (item) {
        return { code: item.code, name: item.name, quantity: item.quantity, unitJpy: item.unitJpy, totalJpy: item.totalJpy, productId: item.productId, productUrl: item.productUrl };
      }),
      request: request,
      shippingCandidates: candidates
    };
  }

  function splitUnavailableReason(recommendation) {
    if (recommendation.groups && recommendation.groups.length > 1) return "";
    if (recommendation.groups && recommendation.groups.length === 1) return "전체 상품가가 면세 기준 안이라 분할 주문이 필요하지 않습니다.";
    if (recommendation.oversize && recommendation.oversize.length) return "단일 계산 단위가 면세 한도를 초과했습니다.";
    return "지정한 최대 주문 수 안에서 분할 그룹을 찾지 못했습니다.";
  }

  function recommendationSummary(recommendation) {
    return {
      totalJpy: recommendation.totalJpy,
      groupCount: recommendation.groups.length,
      oversizeCount: recommendation.oversize.length
    };
  }

  async function quoteSplitStrategy(products, recommendation, labelPrefix) {
    const splitShipments = [];
    if (recommendation.groups.length > 1) {
      for (const [index, group] of recommendation.groups.entries()) {
        splitShipments.push(await quoteShipment(productsFromGroup(group, products), labelPrefix + " " + (index + 1)));
      }
    }
    return {
      recommendationSummary: recommendationSummary(recommendation),
      splitShipments: splitShipments,
      splitUnavailableReason: splitUnavailableReason(recommendation)
    };
  }

  function showResult(result) {
    const json = JSON.stringify(result, null, 2);
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:16px;z-index:2147483647;background:#fff;border:2px solid #1769aa;border-radius:8px;padding:14px;box-shadow:0 10px 32px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:10px;";
    wrap.innerHTML = '<div style="font:700 16px system-ui">Webike 견적 결과</div><textarea style="flex:1;width:100%;font:12px ui-monospace,Menlo,Consolas,monospace"></textarea><div style="display:flex;gap:8px;justify-content:flex-end"><button data-copy>결과 복사</button><button data-close>닫기</button></div>';
    wrap.querySelector("textarea").value = json;
    wrap.querySelector("[data-close]").onclick = function () { wrap.remove(); };
    wrap.querySelector("[data-copy]").onclick = async function () {
      try {
        await navigator.clipboard.writeText(json);
        this.textContent = "복사됨";
      } catch (error) {
        wrap.querySelector("textarea").focus();
        wrap.querySelector("textarea").select();
      }
    };
    document.body.appendChild(wrap);
    navigator.clipboard?.writeText(json).catch(function () {});
    console.log("Webike 견적 결과:", result);
  }

  const products = [];
  const automationResults = [];
  for (const [index, item] of items.entries()) {
    const sourceItem = Object.assign({}, item, { index: index });
    const prefix = "[" + (index + 1) + "/" + items.length + "] " + (item.partNumber || item.productUrl);
    try {
      console.log(prefix + " 상품 상세 확인");
      const productUrl = await resolveProductUrl(sourceItem);
      const product = parseProductDetail(await fetchText(productUrl), productUrl, sourceItem);
      const errors = validateProduct(product, sourceItem);
      automationResults.push({ rowIndex: index + 1, partNumber: sourceItem.partNumber, productUrl: productUrl, status: errors.length ? "failed" : "parsed", errors: errors, product: product });
      if (errors.length) {
        console.error(prefix + " 실패", errors);
        continue;
      }
      products.push(product);
      console.log(prefix + " 완료: " + product.code + ", " + product.unitJpy + " JPY");
    } catch (error) {
      automationResults.push({ rowIndex: index + 1, partNumber: sourceItem.partNumber, productUrl: sourceItem.productUrl, status: "failed", errors: [error.message] });
      console.error(prefix + " 실패", error);
    }
  }

  if (automationResults.some(function (item) { return item.status === "failed"; }) || !products.length) {
    showResult({
      source: "webike-cart-splitter-wizard",
      status: "failed",
      generatedAt: new Date().toISOString(),
      settings: settings,
      products: products,
      automationResults: automationResults
    });
    return;
  }

  const groupSettings = Object.assign({}, settings, {
    limitJpy: settings.limitUsd * settings.usdKrw / settings.jpyKrw
  });
  const splitQuantityRecommendation = recommendGroups(products, Object.assign({}, groupSettings, { splitQuantity: true }));
  const rowUnitRecommendation = recommendGroups(products, Object.assign({}, groupSettings, { splitQuantity: false }));
  const singleShipment = await quoteShipment(products, "한 번에 주문");
  const splitQuantityMeasurement = await quoteSplitStrategy(products, splitQuantityRecommendation, "수량 분할 주문");
  const rowUnitMeasurement = await quoteSplitStrategy(products, rowUnitRecommendation, "행 단위 주문");

  showResult({
    source: "webike-cart-splitter-wizard",
    status: "measured",
    generatedAt: new Date().toISOString(),
    settings: settings,
    products: products,
    recommendationSummary: {
      splitQuantity: splitQuantityMeasurement.recommendationSummary,
      rowUnit: rowUnitMeasurement.recommendationSummary
    },
    measurement: {
      singleShipment: singleShipment,
      strategies: {
        split_quantity: splitQuantityMeasurement,
        row_unit: rowUnitMeasurement
      }
    },
    automationResults: automationResults
  });
})();
`;
}


  return {
    DEFAULT_PRODUCT_BASE_URL,
    DEFAULT_SEARCH_API_URL,
    DEFAULT_SHIPPING_API_URL,
    toNumber,
    cleanText,
    normalizePartNumber,
    safeJsonForScript,
    parseProductDetail,
    validateProductDetail,
    extractProductLinks,
    productLinksFromStructuredData,
    buildProductSearchRequest,
    extractProductLinksFromSearchResponse,
    productFromDetail,
    productsFromGroup,
    shipmentMetricsFromProducts,
    buildShippingRequest,
    normalizeShippingApiResponse,
    selectShippingCandidate,
    buildQuoteScript,
  };
});
