const $ = (selector) => document.querySelector(selector);
const formatter = new Intl.NumberFormat("ko-KR");
let latestAnalysis = null;
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EXCHANGE_RATE_DATA_URL = "data/exchange-rates.json";
const WEBIKE_CART_SCRIPT_HOST = "www.japan-webike.kr";
const {
  EXCHANGE_RATE_SOURCE_URL,
  toNumber,
  normalizeExchangeRateData,
  readStoredSettings,
  writeStoredSettings,
  hasStoredSettings,
  buildXlsxBytes,
  makeXlsxFileName,
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

function setExchangeRateSourceMessage(message) {
  const sourceBox = $("#exchangeRateSource");
  if (!sourceBox) return;

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
  setExchangeRateSourceMessage(
    `${prefix}: ${period}USD ${rateMoney(data.rates.USD)}원, JPY ${rateMoney(data.rates.JPY)}원.${suffix}`,
  );
}

function applyExchangeRatesToForm(data) {
  $("#usdKrw").value = data.rates.USD;
  $("#jpyKrw").value = data.rates.JPY;
  resetExportData();
}

async function loadExchangeRates({ applyToForm = false } = {}) {
  if (typeof fetch !== "function" || window.location.protocol === "file:") return;

  try {
    const response = await fetch(`${EXCHANGE_RATE_DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = normalizeExchangeRateData(await response.json());
    if (!data) throw new Error("invalid exchange rate data");

    if (applyToForm) applyExchangeRatesToForm(data);
    renderExchangeRateSource(data, applyToForm);
  } catch {
    setExchangeRateSourceMessage("자동환율을 불러오지 못했습니다. 현재 입력값을 사용합니다.");
  }
}

function money(value, digits = 0) {
  return Number(value || 0).toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function setExportEnabled(enabled) {
  $("#exportXlsxButton").disabled = !enabled;
}

function resetExportData() {
  latestAnalysis = null;
  setExportEnabled(false);
  clearCartScriptOutput("입력이 바뀌었습니다. 다시 분석해 주세요.");
}

function markResultEditsDirty() {
  if (!latestAnalysis) return;
  setExportEnabled(false);
  clearCartScriptOutput("상품 값이 바뀌었습니다. 다시 만들기를 눌러주세요.");
}

function downloadXlsx() {
  if (!latestAnalysis) {
    showError("먼저 분석을 실행해 주세요.");
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

function readManualProducts() {
  const rows = [...document.querySelectorAll("#manualRows tr")].map((row) => ({
    code: row.querySelector(".manual-code")?.value,
    name: row.querySelector(".manual-name")?.value,
    quantity: row.querySelector(".manual-quantity")?.value,
    unitJpy: row.querySelector(".manual-unit-jpy")?.value,
  }));
  return normalizeManualProducts(rows);
}

function renderSummary(products, recommendation, settings) {
  const totalKrw = recommendation.totalJpy * settings.jpyKrw;
  const totalUsd = totalKrw / settings.usdKrw;
  const limitKrw = settings.limitUsd * settings.usdKrw;
  const statusText = recommendation.groups.length ? "가능" : "확인 필요";
  const statusClass = recommendation.groups.length ? "ok" : "warn";

  return `
    <section class="summary" aria-label="요약">
      <div class="metric"><span>추출 상품</span><b>${products.length}종</b><small>${recommendation.atoms.length}개 단위 계산</small></div>
      <div class="metric"><span>전체 상품가</span><b>${money(recommendation.totalJpy)} JPY</b><small>약 ${money(totalUsd, 2)} USD</small></div>
      <div class="metric"><span>150달러 한도</span><b>${money(Math.floor(settings.limitJpy))} JPY</b><small>${money(limitKrw)}원</small></div>
      <div class="metric"><span>주문 분할</span><b class="${statusClass}">${statusText}</b><small>${recommendation.groups.length || "-"}개 주문</small></div>
    </section>
  `;
}

function renderProducts(products) {
  const rows = products.map((item) => `
    <tr data-product-index="${item.index}">
      <td>${escapeHtml(item.code)}</td>
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
      <div class="table-wrap">
        <table class="result-product-table">
          <thead>
            <tr>
              <th>상품번호</th>
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

function cartScriptItemFromProduct(item) {
  return {
    partNumber: String(item.code || "").trim(),
    quantity: Math.max(1, Math.round(toNumber(item.quantity))),
    name: String(item.name || item.code || "").trim(),
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
    .filter((item) => item.partNumber && item.quantity > 0);

  return `// Webike Cart Splitter generated add-cart script.
// Open https://${WEBIKE_CART_SCRIPT_HOST}/, then paste this whole script into DevTools Console.
(async () => {
  const items = ${jsonForGeneratedScript(items)};
  const requiredHost = "${WEBIKE_CART_SCRIPT_HOST}";
  const searchEndpoint = "/api-search-es.html";
  const cartEndpoint = "/api_shopping_cart.html?action=add_product&ajax_action=1";
  const failures = [];

  if (location.hostname !== requiredHost) {
    console.error(\`Webike 페이지에서 실행해 주세요: https://\${requiredHost}/\`);
    return;
  }

  function normalizePartNumber(value) {
    return String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
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

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(\`HTTP \${response.status}: \${url}\`);
    return response.json();
  }

  async function fetchText(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(\`HTTP \${response.status}: \${url}\`);
    return response.text();
  }

  async function resolveProduct(item) {
    const searchParams = new URLSearchParams({
      search: "",
      "p.k": item.partNumber,
      "p.ref": "product-search-es",
      smp: "sp",
    });
    const searchData = await fetchJson(\`\${searchEndpoint}?\${searchParams}\`);
    const productUrl = productUrlFromSearchData(searchData, item);
    const html = await fetchText(productUrl);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const productsId = firstFieldValue(doc, [
      "#prod_id",
      "input[name='prod_id']",
      "[data-prdId]",
      "[data-prdid]",
    ]) || jsVariable(html, "productsId");
    const detailPartNumber = firstFieldValue(doc, ["#product_id"]) || jsVariable(html, "productsModel");

    if (!productsId) throw new Error(\`\${item.partNumber} products_id를 찾지 못했습니다.\`);
    if (detailPartNumber && normalizePartNumber(detailPartNumber) !== normalizePartNumber(item.partNumber)) {
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
    const response = await fetch(cartEndpoint, {
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
  }

  for (const [index, item] of items.entries()) {
    const prefix = \`[\${index + 1}/\${items.length}] \${item.partNumber}\`;
    try {
      console.log(\`\${prefix} 검색 및 상품 확인\`);
      const resolved = await resolveProduct(item);
      console.log(\`\${prefix} 장바구니 담기 요청: products_id \${resolved.productsId}, 수량 \${resolved.quantity}\`);
      await addToCart(resolved);
      console.log(\`\${prefix} 완료\`);
    } catch (error) {
      failures.push({ item, error: error.message });
      console.error(\`\${prefix} 실패\`, error);
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

function renderCartScriptPanel() {
  return `
    <section class="panel webike-script-panel">
      <div class="section-head">
        <h2>Webike 장바구니 담기</h2>
        <div class="section-actions">
          <button type="button" class="compact" data-action="generate-webike-cart-script">스크립트 만들기</button>
          <button type="button" class="secondary compact" data-action="copy-webike-cart-script" disabled>스크립트 복사</button>
        </div>
      </div>
      <ol class="script-steps">
        <li>Webike 페이지 열기</li>
        <li>생성된 스크립트를 DevTools Console에 붙여넣기</li>
        <li>장바구니 페이지에서 상품과 배송비 확인</li>
      </ol>
      <div class="script-output-area" hidden>
        <label for="webikeCartScriptOutput">생성된 스크립트</label>
        <textarea id="webikeCartScriptOutput" class="script-output" readonly spellcheck="false"></textarea>
        <p id="webikeCartScriptStatus" class="source" role="status"></p>
      </div>
    </section>
  `;
}

function renderGroups(recommendation, settings) {
  if (recommendation.oversize.length) {
    const list = recommendation.oversize.map((item) => `<li>${escapeHtml(item.code)} - ${escapeHtml(item.name)}: ${money(item.totalJpy)} JPY</li>`).join("");
    return `<section class="panel"><h2>그룹 추천</h2><p class="bad">단일 품목이 한도를 초과했습니다.</p><ul>${list}</ul></section>`;
  }

  if (!recommendation.groups.length) {
    return `<section class="panel"><h2>그룹 추천</h2><p class="warn">지정한 최대 주문 수 안에서 한도 이하 그룹을 찾지 못했습니다.</p></section>`;
  }

  const cards = recommendation.groups.map((group, index) => {
    const totalJpy = group.reduce((sum, item) => sum + item.totalJpy, 0);
    const totalKrw = totalJpy * settings.jpyKrw;
    const totalUsd = totalKrw / settings.usdKrw;
    const marginUsd = settings.limitUsd - totalUsd;
    const marginJpy = settings.limitJpy - totalJpy;
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
      <article class="group-card">
        <div class="group-head">
          <div><b>주문 ${index + 1}</b> <span class="badge">약 ${money(totalUsd, 2)} USD</span></div>
          <div class="${marginUsd >= 0 ? "ok" : "bad"}">여유 약 ${money(marginUsd, 2)} USD / ${money(Math.floor(marginJpy))} JPY</div>
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

  return `<section class="group-grid"><h2>추천 주문 그룹</h2>${cards}</section>`;
}

function getSettings() {
  const limitUsd = toNumber($("#limitUsd").value);
  const usdKrw = toNumber($("#usdKrw").value);
  const jpyKrw = toNumber($("#jpyKrw").value);
  const maxGroups = Math.max(1, Math.round(toNumber($("#maxGroups").value)));

  return {
    limitUsd,
    usdKrw,
    jpyKrw,
    maxGroups,
    splitQuantity: $("#splitQuantity").checked,
    limitJpy: (limitUsd * usdKrw) / jpyKrw,
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

function applyStoredSettingsToForm() {
  const settings = readStoredSettings();
  $("#limitUsd").value = settings.limitUsd;
  $("#usdKrw").value = settings.usdKrw;
  $("#jpyKrw").value = settings.jpyKrw;
  $("#maxGroups").value = settings.maxGroups;
  $("#splitQuantity").checked = settings.splitQuantity;
}

function saveSettingsFromForm() {
  writeStoredSettings(getSettingsFormValues());
}

function getInputMode() {
  return document.querySelector("input[name='inputMode']:checked")?.value || "html";
}

function setInputMode(mode) {
  $("#htmlInputPanel").hidden = mode !== "html";
  $("#manualInputPanel").hidden = mode !== "manual";
  clearError();
  resetExportData();
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
    <td><input class="manual-code" type="text" aria-label="상품번호" placeholder="13225MY9003"></td>
    <td><input class="manual-name" type="text" aria-label="상품명" placeholder="HONDA OEM Ring Set"></td>
    <td><input class="manual-quantity" type="text" inputmode="numeric" value="1" aria-label="수량"></td>
    <td><input class="manual-unit-jpy" type="text" inputmode="numeric" aria-label="단가 JPY" placeholder="5599"></td>
    <td><button type="button" class="danger compact manual-remove">삭제</button></td>
  `;
  $("#manualRows").appendChild(row);
  row.querySelector(".manual-code").value = values.code || "";
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

function clearCartScriptOutput(message = "") {
  const outputArea = document.querySelector(".script-output-area");
  const output = $("#webikeCartScriptOutput");
  const status = $("#webikeCartScriptStatus");
  const copyButton = document.querySelector('[data-action="copy-webike-cart-script"]');
  if (!outputArea || !output || !status || !copyButton) return;

  output.value = "";
  outputArea.hidden = !message;
  status.textContent = message;
  copyButton.disabled = true;
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
}

function showCartScriptOutput(script, message) {
  const outputArea = document.querySelector(".script-output-area");
  const output = $("#webikeCartScriptOutput");
  const status = $("#webikeCartScriptStatus");
  const copyButton = document.querySelector('[data-action="copy-webike-cart-script"]');
  if (!outputArea || !output || !status || !copyButton) return;

  output.value = script;
  outputArea.hidden = false;
  status.textContent = message;
  copyButton.disabled = !script;
  if (script) output.focus({ preventScroll: true });
}

function generateWebikeCartScriptFromResult() {
  clearError();
  const editResult = readResultProductEdits();
  if (editResult.errors.length) {
    showError(editResult.errors[0]);
    setExportEnabled(false);
    return;
  }
  if (!editResult.products.length) {
    showError("스크립트를 만들 상품이 없습니다.");
    return;
  }

  const script = buildWebikeCartScript(editResult.products);
  showCartScriptOutput(
    script,
    `${editResult.products.length}개 상품 기준으로 스크립트를 만들었습니다.`,
  );
}

async function copyTextToClipboard(text, sourceElement) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  sourceElement.focus({ preventScroll: true });
  sourceElement.select();
  return document.execCommand("copy");
}

async function copyWebikeCartScript() {
  const output = $("#webikeCartScriptOutput");
  const status = $("#webikeCartScriptStatus");
  if (!output?.value) {
    showError("먼저 스크립트를 만들어 주세요.");
    return;
  }

  try {
    const copied = await copyTextToClipboard(output.value, output);
    status.textContent = copied ? "스크립트를 복사했습니다." : "복사하지 못했습니다. 스크립트 영역을 직접 선택해 복사해 주세요.";
  } catch {
    status.textContent = "복사하지 못했습니다. 스크립트 영역을 직접 선택해 복사해 주세요.";
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
  latestAnalysis = { products, recommendation, settings };
  setExportEnabled(true);
  $("#resultArea").innerHTML = [
    renderSummary(products, recommendation, settings),
    renderGroups(recommendation, settings),
    renderProducts(products),
    renderCartScriptPanel(),
  ].join("");
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
}

function handleManualPaste(event) {
  const text = event.clipboardData?.getData("text/plain") || "";
  const result = manualRowsFromPastedText(text);
  if (!result.rows.length || result.errors.length) return;

  event.preventDefault();
  fillManualInputRows(result.rows);
  clearError();
  resetExportData();
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
loadExchangeRates({ applyToForm: !hasStoredSettings() });
clearManualRows();
setInputMode(getInputMode());

$("#analyzeButton").addEventListener("click", analyze);
$("#exportXlsxButton").addEventListener("click", downloadXlsx);
$("#resultArea").addEventListener("click", (event) => {
  if (event.target.dataset.action === "copy-products-to-manual") {
    copyLatestProductsToManual();
    return;
  }
  if (event.target.dataset.action === "apply-product-edits") {
    applyProductEdits();
    return;
  }
  if (event.target.dataset.action === "generate-webike-cart-script") {
    generateWebikeCartScriptFromResult();
    return;
  }
  if (event.target.dataset.action === "copy-webike-cart-script") {
    copyWebikeCartScript();
  }
});
$("#resultArea").addEventListener("input", (event) => {
  if (!event.target.classList.contains("result-product-edit")) return;
  markResultEditsDirty();
  updateEditedProductSubtotal(event.target.closest("tr"));
});
$("#resultArea").addEventListener("change", (event) => {
  if (!event.target.classList.contains("result-product-edit")) return;
  markResultEditsDirty();
  updateEditedProductSubtotal(event.target.closest("tr"));
});
$("#addManualRowButton").addEventListener("click", () => {
  addManualRow();
  resetExportData();
});
$("#applyBulkPasteButton").addEventListener("click", applyBulkPasteToManual);
$("#clearBulkPasteButton").addEventListener("click", () => {
  $("#bulkPasteInput").value = "";
  clearError();
});
$("#manualRows").addEventListener("click", (event) => {
  if (!event.target.classList.contains("manual-remove")) return;
  const rows = [...document.querySelectorAll("#manualRows tr")];
  if (rows.length <= 1) return;
  event.target.closest("tr").remove();
  updateManualRemoveButtons();
  resetExportData();
});
$("#manualRows").addEventListener("paste", handleManualPaste);
$("#clearButton").addEventListener("click", () => {
  $("#cartHtml").value = "";
  $("#bulkPasteInput").value = "";
  clearManualRows();
  clearError();
  resetExportData();
  $("#resultArea").innerHTML = '<div class="empty">분석 결과가 여기에 표시됩니다.</div>';
});
document.querySelectorAll("input[name='inputMode']").forEach((input) => {
  input.addEventListener("change", () => setInputMode(getInputMode()));
});
$("#manualRows").addEventListener("input", resetExportData);
$("#manualRows").addEventListener("change", resetExportData);
["cartHtml", "bulkPasteInput", "limitUsd", "usdKrw", "jpyKrw", "maxGroups", "splitQuantity"].forEach((id) => {
  $(`#${id}`).addEventListener("input", resetExportData);
  $(`#${id}`).addEventListener("change", resetExportData);
});
["limitUsd", "usdKrw", "jpyKrw", "maxGroups", "splitQuantity"].forEach((id) => {
  $(`#${id}`).addEventListener("change", saveSettingsFromForm);
});
