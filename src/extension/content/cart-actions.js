  async function addResolvedItemsToCart() {
    if (state.busy) return;
    const targets = state.results.filter(isAddableCartItem);
    if (!targets.length) {
      setMessage("warn", "장바구니에 담을 수 있는 확인 완료 부품이 없습니다.");
      render();
      return;
    }

    setBusy(true, "cart");
    setMessage("", "");
    beginCartAddProgress(targets.length);
    render();

    for (const item of targets) {
      item.status = "adding";
      item.reason = "장바구니 담는 중";
      render();
      try {
        await addToCart(item);
        item.status = "cart_added";
        item.reason = "장바구니 추가 완료";
      } catch (error) {
        item.status = "cart_failed";
        item.reason = classifyCartError(error);
      } finally {
        advanceCartAddProgress();
      }
      render();
    }

    finishCartAddProgress();
    setBusy(false);
    const failed = state.results.filter((item) => item.status === "cart_failed").length;
    setMessage(failed ? "warn" : "success", failed ? `${failed}개 부품은 장바구니 추가에 실패했습니다.` : "확인 완료 부품을 장바구니에 담았습니다.");
    render();
  }

  async function copyFailedRows() {
    const failed = reviewItems();
    if (!failed.length) return;
    const lines = [
      ["부품번호", "수량", "부품명", "상품URL", "사유", "검색URL"],
      ...failed.map((item) => [
        item.partNumber,
        item.quantity,
        item.name,
        item.resolvedProductUrl,
        item.reason,
        item.searchUrl,
      ]),
    ];
    await copyText(lines.map((row) => row.map(csvCell).join(",")).join("\n"));
    setMessage("success", "확인 필요 부품 CSV를 복사했습니다.");
    render();
  }

  function openCartPage() {
    persistState();
    location.assign(new URL(CART_PAGE_PATH, location.origin).href);
  }

  async function clearCartPage() {
    if (state.busy || isCartClearActionLocked()) return;
    setCartClearActionLocked(true);
    try {
      if (!isLikelyCartPage()) {
        openCartPage();
        return;
      }

      const items = detectCartItems();
      if (!items.length) {
        state.cartSummary = "삭제 가능한 장바구니 항목을 찾지 못했습니다.";
        setMessage("warn", "장바구니가 비어 있거나 삭제 버튼을 찾지 못했습니다.");
        render();
        return;
      }

      const confirmed = await requestPanelConfirm({
        title: `장바구니 상품 ${items.length}개를 모두 삭제할까요?`,
        message: "이 작업은 되돌릴 수 없습니다.",
        tone: "danger",
      });
      if (!confirmed) return;

      setBusy(true, "cart_clear");
      setMessage("", `장바구니 ${items.length}개 삭제를 시도합니다.`);
      beginCartProgress(items.length);
      render();

      const removableItems = items.filter((item) => item.removeUrl);
      const clickItems = items.filter((item) => !item.removeUrl);
      const removeResult = await removeCartItemsByUrl(removableItems);
      let clicked = 0;
      const failures = [];
      failures.push(...removeResult.failures);

      for (const item of clickItems) {
        try {
          if (!item.control || !document.contains(item.control)) {
            failures.push(`${item.label}: 삭제 버튼을 찾지 못했습니다.`);
            continue;
          }
          item.control.click();
          clicked += 1;
          await delay(500);
        } catch (error) {
          failures.push(`${item.label}: ${cleanText(error?.message) || "삭제 클릭 실패"}`);
        } finally {
          advanceCartProgress();
        }
      }

      state.cartSummary = {
        type: "clear_result",
        total: items.length,
        done: removeResult.removed + clicked,
        failed: failures.length,
        failures,
      };
      finishCartProgress();
      setBusy(false);
      setMessage(
        failures.length ? "warn" : "success",
        failures.length
          ? "일부 항목 삭제에 실패했습니다. 장바구니 화면을 새로고침합니다."
          : "장바구니 전체 비우기 요청을 완료했습니다. 장바구니 화면을 새로고침합니다.",
      );
      render();
      await delay(700);
      location.reload();
    } finally {
      releaseCartClearActionLockSoon();
    }
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
