  function setBusy(value, mode) {
    state.busy = value;
    state.busyMode = value ? (mode || "busy") : "";
    renderActions();
  }

  function beginCartProgress(total) {
    state.cartProgress = { active: true, done: 0, total };
  }

  function advanceCartProgress() {
    if (!state.cartProgress.active) return;
    state.cartProgress.done = Math.min(state.cartProgress.done + 1, state.cartProgress.total);
    render();
  }

  function finishCartProgress() {
    state.cartProgress = { active: false, done: 0, total: 0 };
  }

  function beginFindProgress(total) {
    state.findProgress = { active: true, done: 0, total };
  }

  function advanceFindProgress() {
    if (!state.findProgress.active) return;
    state.findProgress.done = Math.min(state.findProgress.done + 1, state.findProgress.total);
    render();
  }

  function finishFindProgress() {
    state.findProgress = { active: false, done: 0, total: 0 };
  }

  function beginCartAddProgress(total) {
    state.cartAddProgress = { active: true, done: 0, total };
  }

  function advanceCartAddProgress() {
    if (!state.cartAddProgress.active) return;
    state.cartAddProgress.done = Math.min(state.cartAddProgress.done + 1, state.cartAddProgress.total);
    render();
  }

  function finishCartAddProgress() {
    state.cartAddProgress = { active: false, done: 0, total: 0 };
  }

  function setMessage(type, text) {
    state.message = { type, text };
  }

  function updateReviewMessage() {
    const needReview = reviewItems().length;
    setMessage(needReview ? "warn" : "success", needReview ? `${needReview}개 부품은 확인이 필요합니다.` : "모든 부품을 찾았습니다.");
  }

  function reviewItems() {
    return state.results.filter((item) => ["need_review", "cart_failed"].includes(item.status));
  }

  function findResult(rowId) {
    return state.results.find((item) => item.rowId === rowId);
  }
