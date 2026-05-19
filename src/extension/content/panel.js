  async function openPanel() {
    if (location.hostname !== REQUIRED_HOST) return;
    state.panelOpen = true;
    if (!host) {
      await mountPanel();
      return;
    }
    setPanelVisible(true);
    persistState();
    elements.input?.focus();
  }

  async function togglePanel() {
    if (location.hostname !== REQUIRED_HOST) return;
    if (!host) {
      await openPanel();
      return;
    }
    setPanelVisible(!state.panelOpen);
    persistState();
    if (state.panelOpen) elements.input?.focus();
  }

  async function mountPanel() {
    removeStalePanelHost();
    host = document.createElement("div");
    host.id = ROOT_ID;
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    const css = await loadPanelCss();
    shadow.innerHTML = `
      <style>${css}</style>
      <section class="wcs-panel" role="dialog" aria-label="위바이크 장바구니 자동화">
        <header class="wcs-header">
          <div>
            <span class="wcs-title">위바이크 장바구니 자동화</span>
            <span class="wcs-subtitle">CSV 부품 검색 및 장바구니 담기</span>
          </div>
          <button type="button" class="wcs-close" data-action="close" aria-label="닫기">×</button>
        </header>
        <div class="wcs-body">
          <label class="wcs-field">
            <span>CSV 파일</span>
            <input class="wcs-file" data-role="file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values">
          </label>
          <label class="wcs-field">
            <span>CSV/TSV 붙여넣기</span>
            <textarea class="wcs-textarea" data-role="input" spellcheck="false" placeholder="[부품번호],[수량],부품명&#10;16016MAS670,1,파일럿스크류"></textarea>
          </label>
          <div class="wcs-button-row">
            <button type="button" class="wcs-button" data-action="find-parts">부품 찾기</button>
            <button type="button" class="wcs-button warning" data-action="add-cart">장바구니 담기</button>
            <button type="button" class="wcs-button secondary" data-action="copy-failed">실패 CSV 복사</button>
            <button type="button" class="wcs-button secondary" data-action="clear">비우기</button>
          </div>
          <div class="wcs-message" data-role="message"></div>
          <div class="wcs-summary" data-role="summary"></div>
          <div class="wcs-restore" data-role="restore-notice" hidden>
            <span data-role="restore-text">이전 작업이 복원되었습니다.</span>
            <button type="button" class="wcs-small-button" data-action="new-work">새 작업 시작</button>
          </div>
          <div class="wcs-confirm" data-role="confirm-dialog" hidden>
            <div>
              <strong data-role="confirm-title"></strong>
              <p data-role="confirm-message"></p>
            </div>
            <div class="wcs-confirm-actions">
              <button type="button" class="wcs-small-button" data-action="confirm-cancel">취소</button>
              <button type="button" class="wcs-small-button primary" data-action="confirm-ok">확인</button>
            </div>
          </div>
          <section class="wcs-section">
            <h2 class="wcs-section-title">장바구니 관리</h2>
            <div class="wcs-summary" data-role="cart-summary"></div>
            <div class="wcs-button-row">
              <button type="button" class="wcs-button secondary" data-action="open-cart">장바구니 열기</button>
              <button type="button" class="wcs-button danger" data-action="clear-cart-page">장바구니 전체 비우기</button>
            </div>
          </section>
          <section class="wcs-section">
            <h2 class="wcs-section-title">못 찾은 부품</h2>
            <div class="wcs-list" data-role="review-list"></div>
          </section>
          <section class="wcs-section">
            <h2 class="wcs-section-title">찾은 부품</h2>
            <div class="wcs-list" data-role="found-list"></div>
          </section>
        </div>
      </section>
    `;

    elements = {
      file: shadow.querySelector('[data-role="file"]'),
      input: shadow.querySelector('[data-role="input"]'),
      message: shadow.querySelector('[data-role="message"]'),
      summary: shadow.querySelector('[data-role="summary"]'),
      restoreNotice: shadow.querySelector('[data-role="restore-notice"]'),
      restoreText: shadow.querySelector('[data-role="restore-text"]'),
      confirmDialog: shadow.querySelector('[data-role="confirm-dialog"]'),
      confirmTitle: shadow.querySelector('[data-role="confirm-title"]'),
      confirmMessage: shadow.querySelector('[data-role="confirm-message"]'),
      cartSummary: shadow.querySelector('[data-role="cart-summary"]'),
      foundList: shadow.querySelector('[data-role="found-list"]'),
      reviewList: shadow.querySelector('[data-role="review-list"]'),
      findButton: shadow.querySelector('[data-action="find-parts"]'),
      addCartButton: shadow.querySelector('[data-action="add-cart"]'),
      copyFailedButton: shadow.querySelector('[data-action="copy-failed"]'),
      clearButton: shadow.querySelector('[data-action="clear"]'),
      cartOpenButton: shadow.querySelector('[data-action="open-cart"]'),
      clearCartPageButton: shadow.querySelector('[data-action="clear-cart-page"]'),
    };

    shadow.addEventListener("click", onPanelClick);
    elements.file.addEventListener("change", onFileSelected);
    elements.input.value = state.inputValue;
    elements.input.addEventListener("input", onInputChanged);
    setPanelVisible(state.panelOpen);
    render();
    if (state.panelOpen) elements.input.focus();
  }

  function removeStalePanelHost() {
    const staleHost = document.getElementById(ROOT_ID);
    if (staleHost) staleHost.remove();
  }

  function setPanelVisible(visible) {
    if (!host) return;
    host.hidden = !visible;
    if (visible) {
      host.style.removeProperty("display");
    } else {
      host.style.setProperty("display", "none", "important");
    }
    state.panelOpen = Boolean(visible);
  }

  async function loadPanelCss() {
    try {
      const response = await fetch(chrome.runtime.getURL(STYLE_PATH));
      if (response.ok) return response.text();
    } catch {
      return FALLBACK_STYLE;
    }
    return FALLBACK_STYLE;
  }

  function restoreSavedState() {
    const saved = readSavedState();
    if (!saved) return;
    if (savedStateExpired(saved)) {
      clearSavedState();
      state.restoreExpired = true;
      state.restoreNotice = true;
      return;
    }
    state.inputValue = typeof saved.inputValue === "string" ? saved.inputValue : "";
    state.results = Array.isArray(saved.results) ? saved.results.map(normalizeSavedResult) : [];
    state.message = saved.message && typeof saved.message === "object"
      ? { type: cleanText(saved.message.type), text: cleanMessageText(saved.message.text) }
      : { type: "", text: "" };
    state.cartSummary = restoreCartSummary(saved.cartSummary);
    state.panelOpen = Boolean(saved.panelOpen);
    state.busy = false;
    state.busyMode = "";
    state.restoreNotice = Boolean(state.inputValue || state.results.length);
  }

  function savedStateExpired(saved) {
    const savedAt = Date.parse(saved?.savedAt || "");
    return Number.isFinite(savedAt) && Date.now() - savedAt > STORAGE_TTL_MS;
  }

  function normalizeSavedResult(item) {
    if (!item || typeof item !== "object") return item;
    const resolvedProductUrl = cleanText(item.resolvedProductUrl || item.productUrl);
    const normalized = { ...item, resolvedProductUrl };
    delete normalized.productUrl;
    return normalized;
  }

  function readSavedState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function persistState() {
    if (location.hostname !== REQUIRED_HOST) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        inputValue: elements.input?.value ?? state.inputValue,
        results: state.results.map(stripTransientResultFields),
        message: state.message,
        cartSummary: state.cartSummary,
        panelOpen: Boolean(state.panelOpen),
        savedAt: new Date().toISOString(),
      }));
    } catch {
      // Storage can be unavailable in strict privacy modes. The panel still works for the current page.
    }
  }

  function stripTransientResultFields(item) {
    if (!item || typeof item !== "object") return item;
    const normalized = { ...item };
    delete normalized.productUrl;
    return normalized;
  }

  function clearSavedState() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors; clearing the visible panel state is still enough for this page.
    }
  }

  async function onFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    state.inputValue = await file.text();
    elements.input.value = state.inputValue;
    setMessage("success", `${file.name} 파일을 불러왔습니다. 부품 찾기를 눌러 확인하세요.`);
    render();
  }

  function onInputChanged() {
    state.inputValue = elements.input.value;
    state.restoreNotice = false;
    state.restoreExpired = false;
    renderActions();
    persistState();
  }

  function onPanelClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (action === "close") {
      setPanelVisible(false);
      persistState();
      return;
    }
    if (action === "confirm-ok") {
      resolveConfirmDialog(true);
      return;
    }
    if (action === "confirm-cancel") {
      resolveConfirmDialog(false);
      return;
    }
    if (action === "find-parts") void findPartsFromInput();
    if (action === "add-cart") void addResolvedItemsToCart();
    if (action === "copy-failed") void copyFailedRows();
    if (action === "clear") clearPanel();
    if (action === "new-work") clearPanel();
    if (action === "open-cart") openCartPage();
    if (action === "clear-cart-page") void clearCartPage();
    if (action === "retry") void retryRow(target.dataset.rowId);
    if (action === "ignore") ignoreRow(target.dataset.rowId);
    if (action === "choose-candidate") void chooseCandidate(target.dataset.rowId, target.dataset.url);
  }

  function requestPanelConfirm({ title, message, tone = "" }) {
    if (state.confirmDialog?.resolve) state.confirmDialog.resolve(false);
    return new Promise((resolve) => {
      state.confirmDialog = { title, message, tone, resolve };
      renderConfirmDialog();
    });
  }

  function resolveConfirmDialog(confirmed) {
    const active = state.confirmDialog;
    state.confirmDialog = null;
    renderConfirmDialog();
    if (active?.resolve) active.resolve(Boolean(confirmed));
  }

  function clearPanel() {
    if (state.busy) return;
    state.results = [];
    state.inputValue = "";
    state.message = { type: "", text: "" };
    state.cartSummary = "";
    state.findProgress = { active: false, done: 0, total: 0 };
    state.cartAddProgress = { active: false, done: 0, total: 0 };
    state.cartProgress = { active: false, done: 0, total: 0 };
    state.restoreNotice = false;
    state.restoreExpired = false;
    state.confirmDialog = null;
    elements.input.value = "";
    elements.file.value = "";
    render();
    clearSavedState();
  }
