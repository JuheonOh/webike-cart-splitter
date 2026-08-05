const $ = (selector) => document.querySelector(selector);
const formatter = new Intl.NumberFormat("ko-KR");
let latestAnalysis = null;
let latestExchangeRateData = null;
let groupProgress = {};
let draftSaveTimer = null;
let isRestoringDraft = false;
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_MIME_TYPE = "application/zip";
const EXCHANGE_RATE_DATA_URL = "data/exchange-rates.json";
const WEBIKE_CART_SCRIPT_HOST = "www.japan-webike.kr";
const WEBIKE_PRODUCT_URL_PATTERN = /^\/products\/\d+\.html$/;
const DRAFT_STORAGE_KEY = "webike-cart-splitter-draft-v1";
const DRAFT_VERSION = 1;
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const GROUPING_INPUT_ERROR_CODES = new Set([
  "invalid_input",
  "product_count_limit_exceeded",
  "quantity_limit_exceeded",
  "atom_count_limit_exceeded",
  "max_groups_limit_exceeded",
]);
const {
  EXCHANGE_RATE_SOURCE_URL,
  toNumber,
  normalizeExchangeRateData,
  getExchangeRatePeriodStatus,
  readStoredSettings,
  writeStoredSettings,
  hasStoredSettings,
  buildXlsxBytes,
  buildGroupCsvZipBytes,
  makeXlsxFileName,
  makeGroupCsvZipFileName,
  parseProducts,
  normalizeManualProducts,
  manualRowsFromProducts,
  manualRowsFromPastedText,
  recommendGroups,
  aggregateGroup,
  escapeHtml,
} = window.WebikeCartCore;
function rateMoney(value) {
  return Number(value).toLocaleString("ko-KR", {
    maximumFractionDigits: 4,
  });
}

function setExchangeRateSourceMessage(message, tone = "") {
  const sourceBox = $("#exchangeRateSource");
  if (!sourceBox) return;

  sourceBox.classList.toggle("warn", tone === "warn");
  sourceBox.textContent = `${message} `;
  const link = document.createElement("a");
  link.href = EXCHANGE_RATE_SOURCE_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "관세청 고시환율 조회";
  sourceBox.appendChild(link);
}

function renderExchangeRateSource(data, applied) {
  const prefix = applied ? "자동환율 적용" : "자동환율 확인";
  const period = data.period ? `적용기간 ${data.period}, ` : "";
  const suffix = applied ? "" : " 저장된 설정이 있어 입력값은 유지했습니다.";
  const freshness = getExchangeRatePeriodStatus(data.period);
  const freshnessMessage = freshness.state === "expired"
    ? ` 적용기간이 ${freshness.staleDays}일 지났습니다. 최신 고시환율을 직접 확인해 주세요.`
    : freshness.state === "upcoming"
      ? ` 아직 적용 전 환율입니다. 적용 시작일을 확인해 주세요.`
      : freshness.state === "invalid"
        ? " 적용기간 형식을 확인할 수 없습니다. 최신 고시환율을 직접 확인해 주세요."
        : "";
  setExchangeRateSourceMessage(
    `${prefix}: ${period}USD ${rateMoney(data.rates.USD)}원, JPY ${rateMoney(data.rates.JPY)}원.${suffix}${freshnessMessage}`,
    freshness.state === "current" ? "" : "warn",
  );
}

function applyExchangeRatesToForm(data) {
  $("#usdKrw").value = data.rates.USD;
  $("#jpyKrw").value = data.rates.JPY;
  resetExportData();
}

async function loadExchangeRates({ applyToForm = false } = {}) {
  if (typeof fetch !== "function" || window.location.protocol === "file:") {
    setExchangeRateSourceMessage("파일로 연 화면에서는 자동환율을 불러올 수 없습니다. 최신 고시환율을 직접 확인해 주세요.", "warn");
    return;
  }

  try {
    const response = await fetch(`${EXCHANGE_RATE_DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = normalizeExchangeRateData(await response.json());
    if (!data) throw new Error("invalid exchange rate data");

    latestExchangeRateData = data;
    if (applyToForm) applyExchangeRatesToForm(data);
    renderExchangeRateSource(data, applyToForm);
  } catch {
    latestExchangeRateData = null;
    setExchangeRateSourceMessage("자동환율을 불러오지 못했습니다. 현재 입력값을 사용합니다.", "warn");
  }
}

function money(value, digits = 0) {
  return Number(value || 0).toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function orderGroupsForRecommendation(recommendation) {
  const taxableGroups = Array.isArray(recommendation?.taxableGroups) ? recommendation.taxableGroups : [];
  const taxFreeGroups = Array.isArray(recommendation?.groups) ? recommendation.groups : [];
  return [
    ...taxableGroups.map((group, index) => ({ group, taxable: true, groupIndex: index })),
    ...taxFreeGroups.map((group, index) => ({ group, taxable: false, groupIndex: index })),
  ];
}

function setExportEnabled(enabled) {
  const recommendation = latestAnalysis?.recommendation;
  const complete = recommendation?.complete !== false;
  $("#exportXlsxButton").disabled = !(enabled && complete);
  $("#exportCsvZipButton").disabled = !(enabled && complete && orderGroupsForRecommendation(recommendation).length);
}

function publishCalculatorState(state) {
  if (typeof window === "undefined" || typeof window.CustomEvent !== "function") return;
  window.__webikeFeatureState = window.__webikeFeatureState || {};
  window.__webikeFeatureState["webike:calculator-state"] = state;
  window.dispatchEvent(new CustomEvent("webike:calculator-state", { detail: { state } }));
}

function resetExportData() {
  latestAnalysis = null;
  setExportEnabled(false);
  setGroupScriptButtonsEnabled(false, "다시 분석 필요");
  setProductEditDirtyNotice(false);
  publishCalculatorState(getInputMode() === "manual" ? "manual" : "initial");
}

function markResultEditsDirty() {
  if (!latestAnalysis) return;
  setExportEnabled(false);
  setGroupScriptButtonsEnabled(false, "수정 반영 후 복사 가능");
  setProductEditDirtyNotice(true);
  publishCalculatorState("dirty-disabled");
}

function downloadXlsx() {
  if (!latestAnalysis) {
    showError("먼저 분석을 실행해 주세요.");
    return;
  }
  if (latestAnalysis.recommendation.complete === false) {
    showError("최대 주문 수 안에 모든 품목을 배치하지 못했습니다. 최대 주문 수를 늘린 뒤 다시 계산해 주세요.");
    return;
  }

  const xlsxBytes = buildXlsxBytes(
    latestAnalysis.products,
    latestAnalysis.recommendation,
    latestAnalysis.settings,
  );
  const blob = new Blob([xlsxBytes], { type: XLSX_MIME_TYPE });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = makeXlsxFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadGroupCsvZip() {
  if (!latestAnalysis) {
    showError("먼저 분석을 실행해 주세요.");
    return;
  }
  if (latestAnalysis.recommendation.complete === false) {
    showError("최대 주문 수 안에 모든 품목을 배치하지 못했습니다. 최대 주문 수를 늘린 뒤 다시 계산해 주세요.");
    return;
  }
  if (!orderGroupsForRecommendation(latestAnalysis.recommendation).length) {
    showError("CSV로 내보낼 추천 주문 그룹이 없습니다.");
    return;
  }

  const zipBytes = buildGroupCsvZipBytes(latestAnalysis.recommendation);
  const blob = new Blob([zipBytes], { type: ZIP_MIME_TYPE });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = makeGroupCsvZipFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readManualProducts() {
  const rows = [...document.querySelectorAll("#manualRows tr")].map((row) => ({
    code: row.querySelector(".manual-code")?.value,
    productUrl: row.querySelector(".manual-product-url")?.value,
    name: row.querySelector(".manual-name")?.value,
    quantity: row.querySelector(".manual-quantity")?.value,
    unitJpy: row.querySelector(".manual-unit-jpy")?.value,
  }));
  return normalizeManualProducts(rows);
}

function plainString(value) {
  return String(value ?? "");
}

function serializeSettings(settings = {}) {
  return {
    limitUsd: plainString(settings.limitUsd),
    usdKrw: plainString(settings.usdKrw),
    jpyKrw: plainString(settings.jpyKrw),
    maxGroups: plainString(settings.maxGroups),
    splitQuantity: typeof settings.splitQuantity === "boolean" ? settings.splitQuantity : true,
  };
}

function serializeManualRow(row = {}) {
  return {
    code: plainString(row.code),
    productUrl: plainString(row.productUrl),
    name: plainString(row.name),
    quantity: plainString(row.quantity),
    unitJpy: plainString(row.unitJpy),
  };
}

function serializeProduct(product = {}) {
  const quantity = Math.max(1, Math.round(toNumber(product.quantity)));
  const unitJpy = Math.max(0, Math.round(toNumber(product.unitJpy)));
  return {
    code: plainString(product.code),
    productUrl: plainString(product.productUrl),
    name: plainString(product.name || product.code || product.productUrl),
    quantity,
    unitJpy,
    totalJpy: quantity * unitJpy,
  };
}

function normalizeDraftProgress(progress) {
  const source = progress && typeof progress === "object" ? progress : {};
  return Object.fromEntries(Object.entries(source).map(([key, state]) => {
    const value = state && typeof state === "object" ? state : {};
    return [key, {
      scriptCopied: value.scriptCopied === true,
      finalAmountChecked: value.finalAmountChecked === true,
      ordered: value.ordered === true,
      updatedAt: plainString(value.updatedAt),
    }];
  }).filter(([, state]) => state.scriptCopied || state.finalAmountChecked || state.ordered));
}

function normalizeDraft(draft) {
  if (!draft || typeof draft !== "object") return null;
  const source = draft;
  const analysis = source.analysis && typeof source.analysis === "object" ? source.analysis : null;
  const products = Array.isArray(analysis?.products) ? analysis.products.map(serializeProduct)
    .filter((product) => (product.code || product.productUrl) && product.quantity > 0 && product.unitJpy > 0) : [];
  const dirtyProductRows = Array.isArray(analysis?.dirtyProductRows)
    ? analysis.dirtyProductRows.map((row) => ({
      index: plainString(row.index),
      quantity: plainString(row.quantity),
      unitJpy: plainString(row.unitJpy),
    })).filter((row) => row.index || row.quantity || row.unitJpy)
    : [];

  return {
    version: DRAFT_VERSION,
    savedAt: plainString(source.savedAt),
    inputMode: source.inputMode === "manual" ? "manual" : "html",
    settings: serializeSettings(source.settings || analysis?.settings || {}),
    cartHtml: plainString(source.cartHtml),
    bulkPasteInput: plainString(source.bulkPasteInput),
    manualRows: Array.isArray(source.manualRows) ? source.manualRows.map(serializeManualRow) : [],
    analysis: products.length ? {
      products,
      settings: serializeSettings(analysis?.settings || source.settings || {}),
      dirtyProductRows,
    } : null,
    groupProgress: normalizeDraftProgress(source.groupProgress),
  };
}

function readStoredDraft(storage) {
  try {
    const target = storage || window.localStorage;
    const draft = normalizeDraft(JSON.parse(target.getItem(DRAFT_STORAGE_KEY) || "null"));
    if (!draft) return null;
    const savedAt = Date.parse(draft.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > DRAFT_MAX_AGE_MS) {
      target.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

function writeStoredDraft(draft, storage) {
  try {
    const target = storage || window.localStorage;
    const normalized = normalizeDraft(draft);
    if (!normalized) return false;
    target.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
      ...normalized,
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

function removeStoredDraft(storage) {
  try {
    const target = storage || window.localStorage;
    target.removeItem(DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function groupFingerprint(group) {
  const items = aggregateGroup(group).map((item) => ({
    code: plainString(item.code),
    productUrl: plainString(item.productUrl),
    quantity: Math.max(1, Math.round(toNumber(item.quantity))),
    unitJpy: Math.max(0, Math.round(toNumber(item.unitJpy))),
    subtotalJpy: Math.max(0, Math.round(toNumber(item.subtotalJpy))),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return `group-${hashString(JSON.stringify(items))}`;
}

function renderSummary(products, recommendation, settings) {
  const totalKrw = recommendation.totalJpy * settings.jpyKrw;
  const totalUsd = totalKrw / settings.usdKrw;
  const limitKrw = settings.limitUsd * settings.usdKrw;
  const orderGroups = orderGroupsForRecommendation(recommendation);
  const taxableCount = orderGroups.filter((item) => item.taxable).length;
  const taxFreeCount = orderGroups.length - taxableCount;
  const statusText = taxableCount
    ? (recommendation.complete === false ? "확인 필요" : (taxFreeCount ? "과세 포함" : "과세 주문"))
    : (taxFreeCount ? "가능" : "확인 필요");
  const statusClass = recommendation.complete === false ? "warn" : (taxableCount ? "warn" : (taxFreeCount ? "ok" : "warn"));
  const exactSearchFallback = recommendation.warnings?.includes("exact_search_budget_exceeded");

  return `
    <section class="summary" aria-label="요약">
      <div class="metric"><span>추출 상품</span><b>${products.length}종</b><small>${recommendation.atoms.length}개 단위 계산</small></div>
      <div class="metric"><span>전체 상품가</span><b>${money(recommendation.totalJpy)} JPY</b><small>약 ${money(totalUsd, 2)} USD</small></div>
      <div class="metric"><span>150달러 한도</span><b>${money(Math.floor(settings.limitJpy))} JPY</b><small>${money(limitKrw)}원</small></div>
      <div class="metric"><span>주문 분할</span><b class="${statusClass}">${statusText}</b><small>${orderGroups.length || "-"}개 주문${taxableCount ? ` · 과세 예상 ${taxableCount}개` : ""}</small></div>
    </section>
    ${exactSearchFallback ? `
      <p class="calculation-warning warn" role="status">
        정확 탐색 한도를 넘어 빠른 방식으로 계산했습니다. 더 적은 주문 조합이 있을 수 있습니다.
      </p>
    ` : ""}
  `;
}

function renderProducts(products) {
  const rows = products.map((item) => `
    <tr data-product-index="${item.index}">
      <td>${escapeHtml(item.code)}</td>
      <td>${isAllowedWebikeProductUrl(item.productUrl) ? `<a href="${escapeHtml(item.productUrl)}" target="_blank" rel="noopener noreferrer">열기</a>` : (item.productUrl ? escapeHtml(item.productUrl) : "-")}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="num">
        <input class="result-product-quantity result-product-edit" type="text" inputmode="numeric" aria-label="${escapeHtml(item.code)} 수량" value="${escapeHtml(item.quantity)}">
      </td>
      <td class="num">
        <input class="result-product-unit-jpy result-product-edit" type="text" inputmode="numeric" aria-label="${escapeHtml(item.code)} 단가 JPY" value="${escapeHtml(item.unitJpy)}">
      </td>
      <td class="num result-product-total">${formatter.format(item.totalJpy)}</td>
    </tr>
  `).join("");

  return `
    <section class="panel">
      <div class="section-head">
        <h2>추출된 상품</h2>
        <div class="section-actions">
          <button type="button" class="compact" data-action="apply-product-edits">수정 반영</button>
          <button type="button" class="secondary compact" data-action="copy-products-to-manual">직접 입력으로 가져오기</button>
        </div>
      </div>
      <p id="productEditDirtyNotice" class="dirty-notice" role="status" hidden>
        수량이나 단가가 바뀌었습니다. 주문 그룹, 내보내기, 스크립트를 다시 만들려면 수정 반영을 누르세요.
      </p>
      <div class="table-wrap">
        <table class="result-product-table">
          <thead>
            <tr>
              <th>상품번호</th>
              <th>상품URL</th>
              <th>상품명</th>
              <th class="num">수량</th>
              <th class="num">단가(JPY)</th>
              <th class="num">소계(JPY)</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function isAllowedWebikeProductUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.origin === `https://${WEBIKE_CART_SCRIPT_HOST}`
      && !url.username && !url.password && !url.search && !url.hash
      && WEBIKE_PRODUCT_URL_PATTERN.test(url.pathname);
  } catch {
    return false;
  }
}

function cartScriptItemFromProduct(item) {
  const productUrl = String(item.productUrl || "").trim();
  const code = String(item.code || "").trim();
  const codeIsProductUrl = productUrl && code === productUrl;

  return {
    partNumber: codeIsProductUrl ? "" : code,
    productUrl,
    quantity: Math.max(1, Math.round(toNumber(item.quantity))),
    name: String(item.name || code || productUrl || "").trim(),
    unitJpy: Math.max(0, Math.round(toNumber(item.unitJpy))),
  };
}

function jsonForGeneratedScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function buildWebikeCartScript(products) {
  const items = products
    .map(cartScriptItemFromProduct)
    .filter((item) => (item.partNumber || item.productUrl) && item.quantity > 0);

  return `// Webike Cart Splitter generated add-cart script.
// Open https://${WEBIKE_CART_SCRIPT_HOST}/, then paste this whole script into DevTools Console.
(async () => {
  const items = ${jsonForGeneratedScript(items)};
  const requiredHost = "${WEBIKE_CART_SCRIPT_HOST}";
  const searchEndpoint = "/api-search-es.html";
  const cartEndpoint = "/api_shopping_cart.html?action=add_product&ajax_action=1";
  const failures = [];
  let successCount = 0;

  if (location.origin !== \`https://\${requiredHost}\`) {
    console.error(\`Webike 페이지에서 실행해 주세요: https://\${requiredHost}/\`);
    return;
  }

  function normalizePartNumber(value) {
    return String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  function allowedProductUrl(value) {
    try {
      const url = new URL(String(value || "").trim(), location.origin);
      return url.origin === "https://" + requiredHost && !url.username && !url.password && !url.search && !url.hash
        && /^\\/products\\/\\d+\\.html$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function collectStrings(value, output = []) {
    if (typeof value === "string") {
      output.push(value);
      return output;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectStrings(item, output));
      return output;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach((item) => collectStrings(item, output));
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
    if (data?.redirectUrl) return new URL(data.redirectUrl, location.origin).href;

    const expected = normalizePartNumber(item.partNumber);
    const candidates = collectStrings(data).flatMap((text) => {
      return productUrlsFromText(text).map((url) => ({ url, text }));
    });
    const exact = candidates.find((candidate) => normalizePartNumber(candidate.text).includes(expected));
    if (exact) return exact.url;
    if (candidates.length === 1) return candidates[0].url;
    throw new Error(\`\${item.partNumber} 검색 결과에서 상품 상세 URL을 1개로 확정하지 못했습니다.\`);
  }

  function jsVariable(html, name) {
    const pattern = new RegExp(\`(?:var|let|const)\\\\s+\${name}\\\\s*=\\\\s*["']([^"']+)["']\`);
    return html.match(pattern)?.[1] || "";
  }

  function firstFieldValue(doc, selectors) {
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      const value = element?.value || element?.dataset?.prdid || element?.dataset?.prdId || element?.textContent;
      if (String(value || "").trim()) return String(value).trim();
    }
    return "";
  }

  async function fetchTextWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(\`요청 시간 초과(\${timeoutMs / 1000}초): \${url}\`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchJson(url) {
    const { response, text } = await fetchTextWithTimeout(url, { credentials: "include" });
    if (!response.ok) throw new Error(\`HTTP \${response.status}: \${url}\`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(\`JSON 응답을 파싱하지 못했습니다: \${url}\`);
    }
  }

  async function fetchText(url) {
    const { response, text } = await fetchTextWithTimeout(url, { credentials: "include" });
    if (!response.ok) throw new Error(\`HTTP \${response.status}: \${url}\`);
    return text;
  }

  async function resolveProduct(item) {
    let productUrl = item.productUrl ? new URL(item.productUrl, location.origin).href : "";
    if (productUrl && !allowedProductUrl(productUrl)) throw new Error(\`허용되지 않은 Webike 상품 URL입니다: \${productUrl}\`);
    if (!productUrl) {
      const searchParams = new URLSearchParams({
        search: "",
        "p.k": item.partNumber,
        "p.ref": "product-search-es",
        smp: "sp",
      });
      const searchData = await fetchJson(\`\${searchEndpoint}?\${searchParams}\`);
      productUrl = productUrlFromSearchData(searchData, item);
    }
    if (!allowedProductUrl(productUrl)) throw new Error(\`허용되지 않은 Webike 상품 URL입니다: \${productUrl}\`);
    const html = await fetchText(productUrl);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const productsId = firstFieldValue(doc, [
      "#prod_id",
      "input[name='prod_id']",
      "[data-prdId]",
      "[data-prdid]",
    ]) || jsVariable(html, "productsId");
    const detailPartNumber = firstFieldValue(doc, ["#product_id"]) || jsVariable(html, "productsModel");
    const urlProductId = (new URL(productUrl).pathname.match(/^\\/products\\/(\\d+)\\.html$/) || [])[1] || "";

    if (!productsId) throw new Error(\`\${item.partNumber} products_id를 찾지 못했습니다.\`);
    if (!urlProductId || String(productsId).trim() !== urlProductId) {
      throw new Error(\`상품 URL ID(\${urlProductId || "없음"})와 상세 상품 ID(\${productsId})가 다릅니다.\`);
    }
    if (!detailPartNumber) {
      throw new Error(\`\${item.partNumber || item.productUrl} 상세 페이지에서 부품번호를 확인하지 못했습니다.\`);
    }
    if (item.partNumber && detailPartNumber && normalizePartNumber(detailPartNumber) !== normalizePartNumber(item.partNumber)) {
      throw new Error(\`요청 \${item.partNumber}, 상세 \${detailPartNumber} 부품번호가 다릅니다.\`);
    }
    if (jsVariable(html, "canNotAddCart") === "true") {
      throw new Error(\`\${item.partNumber} 상품은 장바구니 담기 불가 상태입니다.\`);
    }
    if (jsVariable(html, "restrictedCountry") === "true") {
      throw new Error(\`\${item.partNumber} 상품은 배송 제한 상태입니다.\`);
    }

    return { ...item, productsId, productUrl };
  }

  function responseLooksFailed(parsed, text) {
    if (parsed && typeof parsed === "object") {
      const result = String(parsed.result || parsed.status || parsed.resultcode || "").toLowerCase();
      const message = String(parsed.message || parsed.errmsg || parsed.errsmsg || "").toLowerCase();
      return ["error", "failed", "fail", "ng"].includes(result) || message.includes("error") || message.includes("fail");
    }
    return /(?:error|failed|fail|오류|실패)/i.test(String(text || ""));
  }

  async function addToCart(item) {
    const { response, text } = await fetchTextWithTimeout(cartEndpoint, {
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
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!response.ok || responseLooksFailed(parsed, text)) {
      throw new Error(\`\${response.status} \${text.slice(0, 240)}\`);
    }
  }

  async function runItems(runItems) {
    for (const [index, item] of runItems.entries()) {
      const prefix = \`[\${index + 1}/\${runItems.length}] \${item.partNumber || item.productUrl}\`;
      try {
        console.log(\`\${prefix} 검색 및 상품 확인\`);
        const resolved = await resolveProduct(item);
        console.log(\`\${prefix} 장바구니 담기 요청: products_id \${resolved.productsId}, 수량 \${resolved.quantity}\`);
        await addToCart(resolved);
        successCount += 1;
        console.log(\`\${prefix} 완료\`);
      } catch (error) {
        failures.push({ item, error: error.message });
        console.error(\`\${prefix} 실패\`, error);
      }
    }
  }

  await runItems(items);

  if (failures.length) {
    window.__webikeCartSplitterRetry = async () => {
      const retryItems = failures.splice(0).map(({ item }) => item);
      console.log(\`실패 상품 재시도: \${retryItems.length}개\`);
      await runItems(retryItems);
      console.log(\`재시도 후 남은 실패: \${failures.length}개\`);
    };
    console.error(\`장바구니 담기 결과: 성공 \${successCount}개, 실패 \${failures.length}개. 실패 상품(재시도: __webikeCartSplitterRetry()):\`, failures);
    return;
  }

  console.log(\`완료: \${items.length}개 상품을 장바구니에 담았습니다.\`);
  location.href = "/shopping_cart.html";
})();
`;
}

function checkedAttr(value) {
  return value ? " checked" : "";
}

function renderGroups(recommendation, settings, progress = {}) {
  const orderGroups = orderGroupsForRecommendation(recommendation);
  if (!orderGroups.length) {
    const message = recommendation.message || "지정한 최대 주문 수 안에서 한도 이하 그룹을 찾지 못했습니다.";
    const oversizeList = recommendation.oversize?.length
      ? `<ul>${recommendation.oversize.map((item) => `<li>${escapeHtml(item.code)} - ${escapeHtml(item.name)}: ${money(item.totalJpy)} JPY</li>`).join("")}</ul>`
      : "";
    return `<section class="panel"><h2>그룹 추천</h2><p class="warn">${escapeHtml(message)}</p>${oversizeList}</section>`;
  }

  const cards = orderGroups.map(({ group, taxable, groupIndex }, orderIndex) => {
    const groupKey = groupFingerprint(group);
    const progressState = progress[groupKey] || {};
    const totalJpy = group.reduce((sum, item) => sum + item.totalJpy, 0);
    const totalKrw = totalJpy * settings.jpyKrw;
    const totalUsd = totalKrw / settings.usdKrw;
    const marginUsd = settings.limitUsd - totalUsd;
    const marginJpy = settings.limitJpy - totalJpy;
    const statusText = taxable ? "과세 예상" : (marginUsd >= 0 ? "면세 예상" : "한도 초과");
    const marginText = taxable
      ? "추가 통관 절차 및 관세·부가세 확인"
      : `여유 약 ${money(marginUsd, 2)} USD / ${money(Math.floor(marginJpy))} JPY`;
    const planComplete = recommendation.complete !== false;
    const rows = aggregateGroup(group).map((item) => `
      <tr>
        <td>${escapeHtml(item.code)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td class="num">${formatter.format(item.quantity)}</td>
        <td class="num">${formatter.format(item.unitJpy)}</td>
        <td class="num">${formatter.format(item.subtotalJpy)}</td>
      </tr>
    `).join("");

    return `
      <article class="group-card" data-group-key="${escapeHtml(groupKey)}">
        <div class="group-head">
          <div class="group-heading">
            <div><b>주문 ${orderIndex + 1}</b> <span class="badge ${taxable ? "bad" : ""}">${statusText} · 약 ${money(totalUsd, 2)} USD</span></div>
            <div class="${taxable || marginUsd < 0 ? "bad" : "ok"}">${marginText}</div>
          </div>
          <div class="group-script-actions">
            <button
              type="button"
              class="compact"
              data-action="copy-group-cart-script"
              data-group-kind="${taxable ? "taxable" : "tax-free"}"
              data-group-index="${groupIndex}"
              aria-describedby="groupScriptStatus${orderIndex}"
              ${planComplete ? "" : " disabled"}
            >스크립트 만들기</button>
            <span id="groupScriptStatus${orderIndex}" class="group-script-status" role="status" aria-live="polite"></span>
          </div>
        </div>
        <div class="group-checks" aria-label="주문 ${orderIndex + 1} 실행 상태">
          <label><input type="checkbox" class="group-script-copied group-progress-check" data-progress-field="scriptCopied"${checkedAttr(progressState.scriptCopied)}> 스크립트 복사</label>
          <label><input type="checkbox" class="group-progress-check" data-progress-field="finalAmountChecked"${checkedAttr(progressState.finalAmountChecked)}> Webike 최종 금액 확인</label>
          <label><input type="checkbox" class="group-progress-check" data-progress-field="ordered"${checkedAttr(progressState.ordered)}> 주문 완료</label>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>상품번호</th>
                <th>상품명</th>
                <th class="num">수량</th>
                <th class="num">단가(JPY)</th>
                <th class="num">소계(JPY)</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
              <tr>
                <td colspan="4"><b>합계 / 약 ${money(totalKrw)}원</b></td>
                <td class="num"><b>${money(totalJpy)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    `;
  }).join("");

  const taxableNotice = recommendation.taxableGroups?.length
    ? `<p class="warn">${escapeHtml(recommendation.message || "개당 한도 초과 품목을 과세 예상 주문으로 분리했습니다.")}</p>`
    : "";
  return `<section class="group-grid"><h2>추천 주문 그룹</h2>${taxableNotice}<p class="subtle">과세 예상 주문을 먼저 표시했습니다. 통관 절차가 긴 주문부터 진행하세요.</p>${cards}</section>`;
}

function getSettings() {
  const limitUsd = toNumber($("#limitUsd").value);
  const usdKrw = toNumber($("#usdKrw").value);
  const jpyKrw = toNumber($("#jpyKrw").value);
  const maxGroups = Math.round(toNumber($("#maxGroups").value));
  const exchangeRateDataMatches = latestExchangeRateData &&
    latestExchangeRateData.rates.USD === usdKrw &&
    latestExchangeRateData.rates.JPY === jpyKrw;

  return {
    limitUsd,
    usdKrw,
    jpyKrw,
    maxGroups,
    splitQuantity: $("#splitQuantity").checked,
    limitJpy: (limitUsd * usdKrw) / jpyKrw,
    exchangeRateSource: exchangeRateDataMatches ? latestExchangeRateData.sourceUrl : "",
    exchangeRatePeriod: exchangeRateDataMatches ? latestExchangeRateData.period : "",
    exchangeRateUpdatedAt: exchangeRateDataMatches ? latestExchangeRateData.updatedAt : "",
  };
}

function getSettingsFormValues() {
  return {
    limitUsd: $("#limitUsd").value,
    usdKrw: $("#usdKrw").value,
    jpyKrw: $("#jpyKrw").value,
    maxGroups: $("#maxGroups").value,
    splitQuantity: $("#splitQuantity").checked,
  };
}

function applySettingsToForm(settings) {
  $("#limitUsd").value = settings.limitUsd;
  $("#usdKrw").value = settings.usdKrw;
  $("#jpyKrw").value = settings.jpyKrw;
  $("#maxGroups").value = settings.maxGroups;
  $("#splitQuantity").checked = settings.splitQuantity;
}

function applyStoredSettingsToForm() {
  applySettingsToForm(readStoredSettings());
}

function saveSettingsFromForm() {
  writeStoredSettings(getSettingsFormValues());
}

function readManualRowsDraft() {
  return [...document.querySelectorAll("#manualRows tr")].map((row) => serializeManualRow({
    code: row.querySelector(".manual-code")?.value,
    productUrl: row.querySelector(".manual-product-url")?.value,
    name: row.querySelector(".manual-name")?.value,
    quantity: row.querySelector(".manual-quantity")?.value,
    unitJpy: row.querySelector(".manual-unit-jpy")?.value,
  }));
}

function resultProductEditsAreDirty() {
  const notice = $("#productEditDirtyNotice");
  return Boolean(notice && !notice.hidden);
}

function readResultProductDraftRows() {
  if (!latestAnalysis || !resultProductEditsAreDirty()) return [];
  return [...document.querySelectorAll(".result-product-table tbody tr")].map((row) => ({
    index: row.dataset.productIndex || "",
    quantity: row.querySelector(".result-product-quantity")?.value || "",
    unitJpy: row.querySelector(".result-product-unit-jpy")?.value || "",
  }));
}

function buildDraftFromPage() {
  return {
    version: DRAFT_VERSION,
    inputMode: getInputMode(),
    settings: getSettingsFormValues(),
    cartHtml: $("#cartHtml").value,
    bulkPasteInput: $("#bulkPasteInput").value,
    manualRows: readManualRowsDraft(),
    analysis: latestAnalysis ? {
      products: latestAnalysis.products.map(serializeProduct),
      settings: serializeSettings(latestAnalysis.settings),
      dirtyProductRows: readResultProductDraftRows(),
    } : null,
    groupProgress,
  };
}

function saveDraftFromPage() {
  if (isRestoringDraft) return false;
  return writeStoredDraft(buildDraftFromPage());
}

function scheduleDraftSave() {
  if (isRestoringDraft) return;
  if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    draftSaveTimer = null;
    saveDraftFromPage();
  }, 200);
}

function cssString(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

function applyResultProductDraftRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return false;
  let restored = false;
  rows.forEach((savedRow) => {
    const row = document.querySelector(`.result-product-table tbody tr[data-product-index="${cssString(savedRow.index)}"]`);
    if (!row) return;
    const quantity = row.querySelector(".result-product-quantity");
    const unitJpy = row.querySelector(".result-product-unit-jpy");
    if (quantity && savedRow.quantity) quantity.value = savedRow.quantity;
    if (unitJpy && savedRow.unitJpy) unitJpy.value = savedRow.unitJpy;
    updateEditedProductSubtotal(row);
    restored = true;
  });
  if (restored) markResultEditsDirty();
  return restored;
}

function restoreDraftToPage() {
  const draft = readStoredDraft();
  if (!draft) return false;

  isRestoringDraft = true;
  try {
    groupProgress = draft.groupProgress;
    const formSettings = toNumber(draft.settings.limitUsd) && toNumber(draft.settings.usdKrw) && toNumber(draft.settings.jpyKrw)
      ? draft.settings
      : readStoredSettings();
    applySettingsToForm(formSettings);
    document.querySelector(`input[name='inputMode'][value='${draft.inputMode}']`).checked = true;
    $("#cartHtml").value = draft.cartHtml;
    $("#bulkPasteInput").value = draft.bulkPasteInput;
    fillManualInputRows(draft.manualRows);
    setInputMode(draft.inputMode);

    if (draft.analysis?.products?.length) {
      const normalized = normalizeManualProducts(draft.analysis.products);
      const settings = {
        ...draft.analysis.settings,
        limitUsd: toNumber(draft.analysis.settings.limitUsd),
        usdKrw: toNumber(draft.analysis.settings.usdKrw),
        jpyKrw: toNumber(draft.analysis.settings.jpyKrw),
        maxGroups: Math.max(1, Math.round(toNumber(draft.analysis.settings.maxGroups))),
        splitQuantity: draft.analysis.settings.splitQuantity,
      };
      settings.limitJpy = (settings.limitUsd * settings.usdKrw) / settings.jpyKrw;
      if (normalized.products.length && settings.limitUsd && settings.usdKrw && settings.jpyKrw) {
        renderAnalysis(normalized.products, settings);
        applyResultProductDraftRows(draft.analysis.dirtyProductRows);
      }
    }
  } finally {
    isRestoringDraft = false;
  }
  return true;
}

function getInputMode() {
  return document.querySelector("input[name='inputMode']:checked")?.value || "html";
}

function setInputMode(mode) {
  $("#htmlInputPanel").hidden = mode !== "html";
  $("#manualInputPanel").hidden = mode !== "manual";
  clearError();
  publishCalculatorState(mode === "manual" ? "manual" : "initial");
}

function showError(message) {
  const errorBox = $("#errorBox");
  errorBox.textContent = message;
  errorBox.style.display = "block";
}

function clearError() {
  const errorBox = $("#errorBox");
  errorBox.textContent = "";
  errorBox.style.display = "none";
}

function updateManualRemoveButtons() {
  const buttons = [...document.querySelectorAll(".manual-remove")];
  buttons.forEach((button) => {
    button.disabled = buttons.length <= 1;
  });
}

function addManualRow(values = {}) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="manual-code" type="text" aria-label="상품번호" placeholder="13225MY9003"><input class="manual-product-url" type="hidden"></td>
    <td><input class="manual-name" type="text" aria-label="상품명" placeholder="HONDA OEM Ring Set"></td>
    <td><input class="manual-quantity" type="text" inputmode="numeric" value="1" aria-label="수량"></td>
    <td><input class="manual-unit-jpy" type="text" inputmode="numeric" aria-label="단가 JPY" placeholder="5599"></td>
    <td><button type="button" class="danger compact manual-remove">삭제</button></td>
  `;
  $("#manualRows").appendChild(row);
  row.querySelector(".manual-code").value = values.code || "";
  row.querySelector(".manual-product-url").value = values.productUrl || "";
  row.querySelector(".manual-name").value = values.name || "";
  row.querySelector(".manual-quantity").value = values.quantity || 1;
  row.querySelector(".manual-unit-jpy").value = values.unitJpy || "";
  updateManualRemoveButtons();
  return row;
}

function clearManualRows() {
  $("#manualRows").innerHTML = "";
  addManualRow();
}

function fillManualInputRows(rows) {
  $("#manualRows").innerHTML = "";
  const createdRows = rows.map((row) => addManualRow(row));
  if (!rows.length) createdRows.push(addManualRow());
  return createdRows;
}

function fillManualRows(products) {
  return fillManualInputRows(manualRowsFromProducts(products));
}

function highlightManualRows(rows) {
  rows.forEach((row) => {
    row.classList.remove("manual-row-imported");
    void row.offsetWidth;
    row.classList.add("manual-row-imported");
  });
  window.setTimeout(() => {
    rows.forEach((row) => row.classList.remove("manual-row-imported"));
  }, 2600);
}

function focusFirstManualRow(rows) {
  const firstEditableInput = rows[0]?.querySelector(".manual-quantity") ||
    rows[0]?.querySelector("input");
  if (!firstEditableInput) return;

  firstEditableInput.focus({ preventScroll: true });
  firstEditableInput.select?.();
}

function copyLatestProductsToManual() {
  if (!latestAnalysis?.products?.length) {
    showError("직접 입력으로 가져올 상품이 없습니다.");
    return;
  }
  const editResult = readResultProductEdits();
  if (editResult.errors.length) {
    showError(editResult.errors[0]);
    setExportEnabled(false);
    return;
  }

  const importedRows = fillManualRows(editResult.products);
  document.querySelector("input[name='inputMode'][value='manual']").checked = true;
  setInputMode("manual");
  $("#manualInputPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  highlightManualRows(importedRows);
  window.requestAnimationFrame(() => focusFirstManualRow(importedRows));
  saveDraftFromPage();
}

function setGroupScriptButtonsEnabled(enabled, message = "") {
  document.querySelectorAll('[data-action="copy-group-cart-script"]').forEach((button) => {
    button.disabled = !enabled;
    const status = button.closest(".group-card")?.querySelector(".group-script-status");
    if (!status) return;
    status.textContent = message;
    status.classList.remove("ok", "bad");
  });
}

function setProductEditDirtyNotice(visible) {
  const notice = $("#productEditDirtyNotice");
  if (notice) notice.hidden = !visible;
}

function setGroupScriptStatus(button, message, copied) {
  const status = button.closest(".group-card")?.querySelector(".group-script-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("ok", copied);
  status.classList.toggle("bad", !copied);
}

function setGroupScriptCopied(button, copied) {
  const checkbox = button.closest(".group-card")?.querySelector(".group-script-copied");
  if (checkbox) checkbox.checked = copied;
  updateGroupProgressFromCard(button.closest(".group-card"));
}

function updateGroupProgressFromCard(card) {
  const groupKey = card?.dataset?.groupKey;
  if (!groupKey) return;
  const state = {};
  card.querySelectorAll(".group-progress-check").forEach((checkbox) => {
    state[checkbox.dataset.progressField] = checkbox.checked;
  });
  if (state.scriptCopied || state.finalAmountChecked || state.ordered) {
    groupProgress[groupKey] = {
      scriptCopied: state.scriptCopied === true,
      finalAmountChecked: state.finalAmountChecked === true,
      ordered: state.ordered === true,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete groupProgress[groupKey];
  }
  saveDraftFromPage();
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.top = "-9999px";
  fallback.style.left = "-9999px";
  document.body.appendChild(fallback);
  try {
    fallback.focus({ preventScroll: true });
    fallback.select();
    return document.execCommand("copy");
  } finally {
    fallback.remove();
  }
}

async function copyGroupWebikeCartScript(button) {
  clearError();
  const groupKind = button.dataset.groupKind === "taxable" ? "taxable" : "tax-free";
  const groupIndex = Number(button.dataset.groupIndex);
  const recommendation = latestAnalysis?.recommendation;
  const groups = groupKind === "taxable" ? recommendation?.taxableGroups : recommendation?.groups;
  const group = groups?.[groupIndex];
  if (!group) {
    showError("복사할 주문 그룹이 없습니다. 다시 분석해 주세요.");
    setGroupScriptButtonsEnabled(false, "다시 분석 필요");
    return;
  }

  const originalText = button.textContent;
  const script = buildWebikeCartScript(aggregateGroup(group));
  button.disabled = true;
  button.textContent = "복사 중";

  try {
    const copied = await copyTextToClipboard(script);
    setGroupScriptStatus(
      button,
      copied ? `주문 스크립트 복사됨` : "복사 실패. 브라우저 권한을 확인하세요.",
      copied,
    );
    setGroupScriptCopied(button, copied);
  } catch {
    setGroupScriptStatus(button, "복사 실패. 브라우저 권한을 확인하세요.", false);
    setGroupScriptCopied(button, false);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function readResultProductEdits() {
  if (!latestAnalysis?.products?.length) {
    return { products: [], errors: ["수정 반영할 분석 결과가 없습니다."] };
  }

  const productMap = new Map(latestAnalysis.products.map((product) => [String(product.index), product]));
  const rows = [...document.querySelectorAll(".result-product-table tbody tr")].map((row) => {
    const product = productMap.get(row.dataset.productIndex) || {};
    return {
      code: product.code || "",
      productUrl: product.productUrl || "",
      name: product.name || product.code || "",
      quantity: row.querySelector(".result-product-quantity")?.value,
      unitJpy: row.querySelector(".result-product-unit-jpy")?.value,
    };
  });
  return normalizeManualProducts(rows);
}

function updateEditedProductSubtotal(row) {
  if (!row) return;
  const quantity = Math.round(toNumber(row.querySelector(".result-product-quantity")?.value));
  const unitJpy = Math.round(toNumber(row.querySelector(".result-product-unit-jpy")?.value));
  const totalCell = row.querySelector(".result-product-total");
  if (!totalCell) return;
  totalCell.textContent = quantity > 0 && unitJpy > 0 ? formatter.format(quantity * unitJpy) : "-";
}

function renderAnalysis(products, settings) {
  const recommendation = recommendGroups(products, settings);
  if (GROUPING_INPUT_ERROR_CODES.has(recommendation.reasonCode)) {
    latestAnalysis = null;
    setExportEnabled(false);
    showError(recommendation.message || "상품 또는 주문 설정을 확인해 주세요.");
    publishCalculatorState(getInputMode() === "manual" ? "manual" : "initial");
    return false;
  }
  latestAnalysis = { products, recommendation, settings };
  setExportEnabled(true);
  $("#resultArea").innerHTML = [
    renderSummary(products, recommendation, settings),
    renderGroups(recommendation, settings, groupProgress),
    renderProducts(products),
  ].join("");
  saveDraftFromPage();
  publishCalculatorState("analyzed");
  return true;
}

function applyProductEdits() {
  clearError();
  const settings = getSettings();
  if (!settings.limitUsd || !settings.usdKrw || !settings.jpyKrw) {
    showError("면세 기준과 환율 값을 확인해 주세요.");
    return;
  }

  const editResult = readResultProductEdits();
  if (editResult.errors.length) {
    showError(editResult.errors[0]);
    setExportEnabled(false);
    return;
  }
  if (!editResult.products.length) {
    showError("수정 반영할 상품을 1개 이상 입력해 주세요.");
    setExportEnabled(false);
    return;
  }

  renderAnalysis(editResult.products, settings);
}

function applyBulkPasteToManual() {
  const result = manualRowsFromPastedText($("#bulkPasteInput").value);
  if (result.errors.length) {
    showError(result.errors[0]);
    return;
  }
  fillManualInputRows(result.rows);
  clearError();
  resetExportData();
  saveDraftFromPage();
}

function handleManualPaste(event) {
  const text = event.clipboardData?.getData("text/plain") || "";
  const result = manualRowsFromPastedText(text);
  if (!result.rows.length || result.errors.length) return;

  event.preventDefault();
  fillManualInputRows(result.rows);
  clearError();
  resetExportData();
  saveDraftFromPage();
}

function analyze() {
  clearError();
  resetExportData();
  const settings = getSettings();
  const inputMode = getInputMode();
  let products = [];

  if (!settings.limitUsd || !settings.usdKrw || !settings.jpyKrw) {
    showError("면세 기준과 환율 값을 확인해 주세요.");
    return;
  }

  if (inputMode === "html") {
    const html = $("#cartHtml").value.trim();
    if (!html) {
      showError("분석할 HTML을 붙여넣어 주세요.");
      return;
    }
    products = parseProducts(html);
    if (!products.length) {
      showError("상품 행을 찾지 못했습니다. table-cart 영역의 HTML을 붙여넣었는지 확인해 주세요.");
      return;
    }
  } else {
    const manualResult = readManualProducts();
    if (manualResult.errors.length) {
      showError(manualResult.errors[0]);
      return;
    }
    products = manualResult.products;
    if (!products.length) {
      showError("직접 입력할 상품을 1개 이상 입력해 주세요.");
      return;
    }
  }

  renderAnalysis(products, settings);
}

applyStoredSettingsToForm();
clearManualRows();
const restoredDraft = restoreDraftToPage();
loadExchangeRates({ applyToForm: !hasStoredSettings() && !restoredDraft });
if (!restoredDraft) setInputMode(getInputMode());

$("#analyzeButton").addEventListener("click", analyze);
$("#exportXlsxButton").addEventListener("click", downloadXlsx);
$("#exportCsvZipButton").addEventListener("click", downloadGroupCsvZip);
$("#resultArea").addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;

  if (actionTarget.dataset.action === "copy-products-to-manual") {
    copyLatestProductsToManual();
    return;
  }
  if (actionTarget.dataset.action === "apply-product-edits") {
    applyProductEdits();
    return;
  }
  if (actionTarget.dataset.action === "copy-group-cart-script") {
    copyGroupWebikeCartScript(actionTarget);
  }
});
$("#resultArea").addEventListener("input", (event) => {
  if (!event.target.classList.contains("result-product-edit")) return;
  markResultEditsDirty();
  updateEditedProductSubtotal(event.target.closest("tr"));
  scheduleDraftSave();
});
$("#resultArea").addEventListener("change", (event) => {
  if (event.target.classList.contains("group-progress-check")) {
    updateGroupProgressFromCard(event.target.closest(".group-card"));
    return;
  }
  if (!event.target.classList.contains("result-product-edit")) return;
  markResultEditsDirty();
  updateEditedProductSubtotal(event.target.closest("tr"));
  scheduleDraftSave();
});
$("#addManualRowButton").addEventListener("click", () => {
  addManualRow();
  resetExportData();
  saveDraftFromPage();
});
$("#applyBulkPasteButton").addEventListener("click", applyBulkPasteToManual);
$("#clearBulkPasteButton").addEventListener("click", () => {
  $("#bulkPasteInput").value = "";
  clearError();
  saveDraftFromPage();
});
$("#manualRows").addEventListener("click", (event) => {
  if (!event.target.classList.contains("manual-remove")) return;
  const rows = [...document.querySelectorAll("#manualRows tr")];
  if (rows.length <= 1) return;
  event.target.closest("tr").remove();
  updateManualRemoveButtons();
  resetExportData();
  saveDraftFromPage();
});
$("#manualRows").addEventListener("paste", handleManualPaste);
$("#clearButton").addEventListener("click", () => {
  $("#cartHtml").value = "";
  $("#bulkPasteInput").value = "";
  clearManualRows();
  groupProgress = {};
  clearError();
  resetExportData();
  $("#resultArea").innerHTML = '<div class="empty">분석 결과가 여기에 표시됩니다.</div>';
  removeStoredDraft();
});
document.querySelectorAll("input[name='inputMode']").forEach((input) => {
  input.addEventListener("change", () => {
    setInputMode(getInputMode());
    saveDraftFromPage();
  });
});
$("#manualRows").addEventListener("input", () => {
  resetExportData();
  scheduleDraftSave();
});
$("#manualRows").addEventListener("change", () => {
  resetExportData();
  saveDraftFromPage();
});
["cartHtml", "bulkPasteInput", "limitUsd", "usdKrw", "jpyKrw", "maxGroups", "splitQuantity"].forEach((id) => {
  $(`#${id}`).addEventListener("input", () => {
    resetExportData();
    scheduleDraftSave();
  });
  $(`#${id}`).addEventListener("change", () => {
    resetExportData();
    saveDraftFromPage();
  });
});
["limitUsd", "usdKrw", "jpyKrw", "maxGroups", "splitQuantity"].forEach((id) => {
  $(`#${id}`).addEventListener("change", saveSettingsFromForm);
});
