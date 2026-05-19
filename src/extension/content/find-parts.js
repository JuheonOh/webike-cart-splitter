  async function findPartsFromInput() {
    if (state.busy || isFindPartsActionLocked()) return;
    setFindPartsActionLocked(true);
    try {
      if (state.results.length) {
        if (!(await confirmResetSearchResults())) return;
        clearSearchResultsForRefind();
        render();
      }
      state.inputValue = elements.input.value;
      const parsed = parseInputRows(elements.input.value);
      state.results = parsed.rows.map((row) => ({
        ...row,
        status: "pending",
        reason: "대기",
        candidates: [],
      }));

      if (!state.results.length) {
        setMessage("error", parsed.errors[0] || "상품 목록을 입력해 주세요.");
        render();
        return;
      }

      setBusy(true, "finding");
      setMessage(parsed.errors.length ? "warn" : "", formatParseWarnings(parsed.errors));
      beginFindProgress(state.results.length);
      render();

      await resolveRowsInChunks(state.results);

      finishFindProgress();
      setBusy(false);
      const needReview = state.results.filter((item) => item.status === "need_review").length;
      setMessage(needReview ? "warn" : "success", needReview ? `${needReview}개 부품은 확인이 필요합니다.` : "모든 부품을 찾았습니다.");
      render();
    } finally {
      releaseFindPartsActionLockSoon();
    }
  }

  function confirmResetSearchResults() {
    return requestPanelConfirm({
      title: "기존 검색 결과를 지우고 다시 찾을까요?",
      message: "선택한 후보와 진행 상태가 초기화됩니다.",
    });
  }

  function clearSearchResultsForRefind() {
    state.results = [];
    state.findProgress = { active: false, done: 0, total: 0 };
    state.cartAddProgress = { active: false, done: 0, total: 0 };
  }

  function isFindPartsActionLocked() {
    return host?.dataset.wcsFindPartsLocked === "1";
  }

  function setFindPartsActionLocked(value) {
    if (!host) return;
    if (value) {
      host.dataset.wcsFindPartsLocked = "1";
      return;
    }
    delete host.dataset.wcsFindPartsLocked;
  }

  function releaseFindPartsActionLockSoon() {
    window.setTimeout(() => setFindPartsActionLocked(false), 0);
  }

  function isCartClearActionLocked() {
    return host?.dataset.wcsCartClearLocked === "1";
  }

  function setCartClearActionLocked(value) {
    if (!host) return;
    if (value) {
      host.dataset.wcsCartClearLocked = "1";
      return;
    }
    delete host.dataset.wcsCartClearLocked;
  }

  function releaseCartClearActionLockSoon() {
    window.setTimeout(() => setCartClearActionLocked(false), 0);
  }

  function formatParseWarnings(errors) {
    const messages = errors.map(cleanText).filter(Boolean);
    const duplicateLabels = [];
    const otherMessages = [];

    messages.forEach((message) => {
      const duplicateLabel = duplicateMergeLabel(message);
      if (duplicateLabel) {
        duplicateLabels.push(duplicateLabel);
        return;
      }
      otherMessages.push(message);
    });

    const lines = [...otherMessages];
    if (duplicateLabels.length) {
      lines.push(`중복 부품 ${duplicateLabels.length}건은 수량을 합산했습니다.`);
      duplicateLabels.forEach((label) => lines.push(`- ${label}`));
    }
    return lines.join("\n");
  }

  function duplicateMergeLabel(message) {
    const suffix = " 중복 부품은 수량을 합산했습니다.";
    if (!message.endsWith(suffix)) return "";
    return cleanText(message.slice(0, -suffix.length));
  }

  async function retryRow(rowId) {
    const item = findResult(rowId);
    if (!item || state.busy) return;
    setBusy(true, "row");
    await resolveRow(item);
    setBusy(false);
    render();
  }

  async function chooseCandidate(rowId, url) {
    const item = findResult(rowId);
    if (!item || !url || isReviewActionBlocked()) return;
    item.resolvedProductUrl = url;
    item.reason = "후보 상품 선택";
    await resolveReviewItem(item);
  }

  function ignoreRow(rowId) {
    const item = findResult(rowId);
    if (!item || isReviewActionBlocked()) return;
    item.status = "ignored";
    item.reason = "사용자가 무시 처리";
    if (!state.busy) updateReviewMessage();
    render();
  }

  function isReviewActionBlocked() {
    return state.busy && state.busyMode !== "finding";
  }

  function shouldSkipAutoResolve(item) {
    return ["resolved", "ignored", "cart_added", "cart_failed", "adding"].includes(item.status);
  }

  async function resolveRowsInChunks(items) {
    for (let index = 0; index < items.length; index += FIND_PARTS_CONCURRENCY) {
      const chunk = items.slice(index, index + FIND_PARTS_CONCURRENCY);
      await Promise.all(chunk.map(resolveFindItem));
    }
  }

  async function resolveFindItem(item) {
    try {
      if (shouldSkipAutoResolve(item)) return;
      await resolveRow(item);
    } catch (error) {
      item.status = "need_review";
      item.reason = cleanText(error?.message) || "검색 중 오류";
      item.candidates = [];
      render();
    } finally {
      advanceFindProgress();
    }
  }

  async function resolveReviewItem(item) {
    const keepGlobalBusy = state.busy;
    if (!keepGlobalBusy) setBusy(true, "row");
    await resolveRow(item);
    if (!keepGlobalBusy) {
      setBusy(false);
      updateReviewMessage();
    }
    render();
  }

  async function resolveRow(item) {
    item.status = "searching";
    item.reason = "검색 중";
    item.candidates = [];
    render();

    try {
      const product = await resolveProduct(item);
      Object.assign(item, product, {
        status: "resolved",
        reason: "상품 확인 완료",
        candidates: [],
      });
    } catch (error) {
      item.status = "need_review";
      item.reason = classifyResolveError(error);
      item.candidates = Array.isArray(error.candidates) ? error.candidates : [];
    }
    render();
  }
