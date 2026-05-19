  function render() {
    if (!elements.summary) return;
    renderMessage();
    renderSummary();
    renderRestoreNotice();
    renderConfirmDialog();
    renderCartSummary();
    renderLists();
    renderActions();
    persistState();
  }

  function renderMessage() {
    elements.message.className = `wcs-message ${state.message.type || ""}`;
    elements.message.textContent = state.message.text || "CSV 파일 또는 CSV/TSV 텍스트를 입력하세요.";
  }

  function renderSummary() {
    if (state.findProgress.active) {
      elements.summary.replaceChildren(loadingNode(`부품 조회 중... ${state.findProgress.done} / ${state.findProgress.total}`));
      return;
    }
    if (state.cartAddProgress.active) {
      elements.summary.replaceChildren(loadingNode(`장바구니 담는 중... ${state.cartAddProgress.done} / ${state.cartAddProgress.total}`));
      return;
    }
    const total = state.results.length;
    const found = state.results.filter((item) => ["resolved", "adding", "cart_added", "cart_failed"].includes(item.status)).length;
    const needReview = reviewItems().length;
    const ignored = state.results.filter((item) => item.status === "ignored").length;
    const cartAdded = state.results.filter((item) => item.status === "cart_added").length;
    elements.summary.replaceChildren(summaryBadges([
      ["처리 대상", total],
      ["찾음", found],
      ["확인 필요", needReview, needReview ? "warn" : ""],
      ["무시", ignored],
      ["장바구니 추가", cartAdded, cartAdded ? "success" : ""],
    ]));
  }

  function summaryBadges(items) {
    const wrap = document.createElement("div");
    wrap.className = "wcs-summary-badges";
    items.forEach(([label, count, tone]) => wrap.appendChild(summaryBadge(label, count, tone)));
    return wrap;
  }

  function summaryBadge(label, count, tone = "") {
    const badge = document.createElement("span");
    badge.className = `wcs-summary-badge ${tone}`.trim();

    const labelNode = document.createElement("span");
    labelNode.className = "wcs-summary-label";
    labelNode.textContent = label;

    const valueNode = document.createElement("strong");
    valueNode.className = "wcs-summary-value";
    valueNode.textContent = String(count);

    badge.append(labelNode, valueNode);
    return badge;
  }

  function renderRestoreNotice() {
    if (elements.restoreText) {
      elements.restoreText.textContent = state.restoreExpired
        ? "이전 작업은 오래되어 새 작업으로 시작합니다."
        : "이전 작업이 복원되었습니다.";
    }
    elements.restoreNotice.hidden = !state.restoreNotice;
  }

  function renderConfirmDialog() {
    if (!elements.confirmDialog) return;
    const dialog = state.confirmDialog;
    elements.confirmDialog.hidden = !dialog;
    elements.confirmDialog.className = `wcs-confirm ${dialog?.tone || ""}`.trim();
    if (!dialog) return;
    elements.confirmTitle.textContent = dialog.title || "확인이 필요합니다.";
    elements.confirmMessage.textContent = dialog.message || "";
  }

  function renderActions() {
    const canAddToCart = hasAddableCartItems();
    elements.findButton.disabled = state.busy;
    elements.addCartButton.disabled = state.busy || !canAddToCart;
    elements.addCartButton.classList.toggle("cart-ready", !state.busy && canAddToCart);
    elements.copyFailedButton.disabled = state.busy || !reviewItems().length;
    elements.clearButton.disabled = state.busy || (!elements.input.value && !state.results.length);
    elements.cartOpenButton.disabled = state.busy;
    elements.clearCartPageButton.disabled = state.busy || !isLikelyCartPage();
  }

  function hasAddableCartItems() {
    return state.results.some(isAddableCartItem);
  }

  function isAddableCartItem(item) {
    return ["resolved", "cart_failed"].includes(item.status) && item.productsId;
  }

  function renderCartSummary() {
    if (state.cartProgress.active) {
      elements.cartSummary.replaceChildren(loadingNode(`장바구니 삭제 중... ${state.cartProgress.done} / ${state.cartProgress.total}`));
      return;
    }

    if (isCartClearResultSummary(state.cartSummary)) {
      const nodes = [summaryBadges([
        ["삭제 대상", state.cartSummary.total],
        ["삭제 완료", state.cartSummary.done, state.cartSummary.done ? "success" : ""],
        ["실패", state.cartSummary.failed, state.cartSummary.failed ? "error" : ""],
      ])];
      if (state.cartSummary.failures?.length) nodes.push(failureList(state.cartSummary.failures));
      elements.cartSummary.replaceChildren(...nodes);
      return;
    }

    elements.cartSummary.textContent = state.cartSummary || defaultCartSummaryText();
  }

  function defaultCartSummaryText() {
    return isLikelyCartPage()
      ? "장바구니 전체 비우기를 실행할 수 있습니다."
      : "장바구니를 연 뒤 전체 비우기를 실행하세요.";
  }

  function isCartClearResultSummary(value) {
    return value?.type === "clear_result";
  }

  function restoreCartSummary(value) {
    if (isCartClearResultSummary(value)) {
      return {
        type: "clear_result",
        total: Math.max(0, Math.round(toNumber(value.total))),
        done: Math.max(0, Math.round(toNumber(value.done))),
        failed: Math.max(0, Math.round(toNumber(value.failed))),
        failures: Array.isArray(value.failures) ? value.failures.map(cleanText).filter(Boolean) : [],
      };
    }
    return cleanText(value);
  }

  function failureList(failures) {
    const list = document.createElement("ul");
    list.className = "wcs-failure-list";
    failures.forEach((failure) => {
      const item = document.createElement("li");
      item.textContent = failure;
      list.appendChild(item);
    });
    return list;
  }

  function renderLists() {
    elements.foundList.replaceChildren();
    elements.reviewList.replaceChildren();

    const found = state.results.filter((item) => ["searching", "resolved", "adding", "cart_added", "cart_failed", "ignored"].includes(item.status));
    const review = reviewItems();

    if (!found.length) elements.foundList.appendChild(emptyBox("찾은 부품이 아직 없습니다."));
    found.forEach((item) => elements.foundList.appendChild(renderResultCard(item, false)));

    if (!review.length) elements.reviewList.appendChild(emptyBox("확인 필요 부품이 없습니다."));
    review.forEach((item) => elements.reviewList.appendChild(renderResultCard(item, true)));
  }

  function renderResultCard(item, needsReview) {
    const card = document.createElement("article");
    card.className = `wcs-card ${item.status === "need_review" ? "need-review" : ""} ${item.status === "cart_failed" ? "cart-failed" : ""} ${item.status === "ignored" ? "ignored" : ""}`;

    const head = document.createElement("div");
    head.className = "wcs-card-head";
    const main = document.createElement("div");
    const part = document.createElement("div");
    part.className = "wcs-part";
    part.textContent = displayPartLabel(item);
    const meta = document.createElement("div");
    meta.className = "wcs-meta";
    meta.textContent = `수량 ${item.quantity || 1} / ${cleanText(item.productName) || "상품명 확인 전"}`;
    main.append(part, meta);

    const badge = document.createElement("span");
    badge.className = `wcs-badge ${item.status.replace("_", "-")}`;
    badge.textContent = statusLabel(item.status);
    head.append(main, badge);
    card.appendChild(head);

    const reason = document.createElement("div");
    reason.className = "wcs-meta";
    reason.textContent = item.reason || "";
    card.appendChild(reason);

    const actions = document.createElement("div");
    actions.className = "wcs-card-actions";
    if (item.resolvedProductUrl) actions.appendChild(link("상품 열기", item.resolvedProductUrl));
    if (item.searchUrl) actions.appendChild(link("Webike 검색 열기", item.searchUrl));
    card.appendChild(actions);

    if (needsReview) {
      renderCandidates(card, item);
      const row = document.createElement("div");
      row.className = "wcs-card-actions";
      row.appendChild(actionButton("재검색", "retry", item.rowId));
      row.appendChild(actionButton("무시", "ignore", item.rowId));
      card.appendChild(row);
    }

    return card;
  }

  function renderCandidates(card, item) {
    if (!item.candidates?.length) return;
    const wrap = document.createElement("div");
    wrap.className = "wcs-candidates";
    item.candidates.forEach((candidate, index) => {
      const row = document.createElement("div");
      row.className = "wcs-candidate";
      const title = document.createElement("div");
      title.className = "wcs-meta";
      title.textContent = `${index + 1}. ${candidate.displayName || candidate.name || candidate.url}`;
      const actions = document.createElement("div");
      actions.className = "wcs-card-actions";
      actions.appendChild(link("열기", candidate.url));
      const choose = actionButton("이 상품 선택", "choose-candidate", item.rowId);
      choose.dataset.url = candidate.url;
      actions.appendChild(choose);
      row.append(title, actions);
      wrap.appendChild(row);
    });
    card.appendChild(wrap);
  }

  function emptyBox(text) {
    const element = document.createElement("div");
    element.className = "wcs-empty";
    element.textContent = text;
    return element;
  }

  function displayPartLabel(item) {
    const label = item.partNumber || item.resolvedProductUrl || `${item.lineNumber}행`;
    const typedName = cleanText(item.inputName);
    return typedName ? `${label} (${typedName})` : label;
  }

  function loadingNode(textValue) {
    const wrap = document.createElement("div");
    wrap.className = "wcs-loading";
    const spinner = document.createElement("span");
    spinner.className = "wcs-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = textValue;
    wrap.append(spinner, text);
    return wrap;
  }

  function link(text, href) {
    const element = document.createElement("a");
    element.className = "wcs-link";
    element.href = href;
    element.target = "_blank";
    element.rel = "noopener noreferrer";
    element.textContent = text;
    return element;
  }

  function actionButton(text, action, rowId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wcs-small-button";
    button.dataset.action = action;
    if (rowId) button.dataset.rowId = rowId;
    button.textContent = text;
    button.disabled = state.busy && !isReviewAction(action);
    return button;
  }

  function isReviewAction(action) {
    return ["choose-candidate", "ignore"].includes(action) && !isReviewActionBlocked();
  }
