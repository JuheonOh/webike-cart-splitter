  function isLikelyCartPage() {
    return /\/shopping_cart\.html$/i.test(location.pathname) || /^\/cart\/?$/i.test(location.pathname);
  }

  function detectCartItems() {
    const rowMatches = [
      ...document.querySelectorAll(".table-cart tbody tr.item"),
      ...document.querySelectorAll(".table-cart tbody tr[id^='product-item']"),
      ...document.querySelectorAll(".table-cart tbody tr[data-sku]"),
      ...document.querySelectorAll(".table-cart tbody tr[data-product-code]"),
      ...document.querySelectorAll(".cart-item"),
      ...document.querySelectorAll(".cart-list-item"),
      ...document.querySelectorAll("[data-cart-item]"),
    ];
    const controlRows = [...document.querySelectorAll("button, a, input[type='button'], input[type='submit']")]
      .filter((element) => !element.closest(`#${ROOT_ID}`))
      .filter((element) => isUsableControl(element) && deleteControlText(element))
      .map(findCartRowForControl)
      .filter(Boolean);
    const rows = uniqueElements([...rowMatches, ...controlRows]).filter((row) => !row.closest(`#${ROOT_ID}`));

    return rows.map((row, index) => {
      const control = findDeleteControl(row);
      return {
        row,
        control,
        removeUrl: removeUrlFromControl(control),
        label: cartItemLabel(row, index),
      };
    }).filter((item) => item.control);
  }

  function findCartRowForControl(control) {
    return control.closest([
      ".table-cart tbody tr",
      "tr",
      ".cart-item",
      ".cart-list-item",
      "[data-cart-item]",
      "li",
      "article",
    ].join(",")) || control.parentElement;
  }

  function findDeleteControl(row) {
    const selectorMatches = row.querySelectorAll([
      "[data-action*='delete' i]",
      "[data-action*='remove' i]",
      "[onclick*='delete' i]",
      "[onclick*='remove' i]",
      "a[href*='delete' i]",
      "a[href*='remove' i]",
      "button[class*='delete' i]",
      "button[class*='remove' i]",
      "a[class*='delete' i]",
      "a[class*='remove' i]",
      ".btn-delete",
      ".btn-remove-product",
      ".btn-remove",
      ".cart-delete",
      ".cart-remove",
      ".delete",
      ".remove",
    ].join(","));
    const direct = [...selectorMatches].find(isUsableControl);
    if (direct) return direct;

    return [...row.querySelectorAll("button, a, input[type='button'], input[type='submit']")]
      .find((element) => isUsableControl(element) && deleteControlText(element));
  }

  function isUsableControl(element) {
    return element instanceof HTMLElement && !element.disabled && element.offsetParent !== null;
  }

  function deleteControlText(element) {
    const value = [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("alt"),
      element.getAttribute("value"),
      element.className,
      element.id,
      element.getAttribute("href"),
      element.getAttribute("data-href"),
      element.getAttribute("onclick"),
      element.dataset?.action,
      element.dataset?.href,
    ].map(cleanText).join(" ");
    return /삭제|제거|delete|remove|delcart|cartdelete/i.test(value);
  }

  function removeUrlFromControl(control) {
    if (!control) return "";
    const raw = cleanText(control.dataset?.href || control.getAttribute("data-href") || control.getAttribute("href"));
    if (!raw) return "";
    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return "";
      if (!/\/shopping_cart\.html$/i.test(url.pathname)) return "";
      if (url.searchParams.get("action") !== "remove_product") return "";
      if (!url.searchParams.get("product_id")) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  async function removeCartItemByUrl(removeUrl) {
    const response = await fetch(removeUrl, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.text();
  }

  async function removeCartItemsByUrl(items) {
    let removed = 0;
    const failures = [];
    for (const item of items) {
      try {
        await removeCartItemByUrl(item.removeUrl);
        removed += 1;
      } catch (error) {
        failures.push(`${item.label}: ${cleanText(error?.message) || "삭제 요청 실패"}`);
      } finally {
        advanceCartProgress();
      }
      await delay(250);
    }
    return { removed, failures };
  }

  function cartItemLabel(row, index) {
    return cleanText(
      row.dataset?.sku ||
      row.dataset?.productCode ||
      row.querySelector(".product-code, .goods-code, .item-code, .sku")?.textContent ||
      row.querySelector("a[href*='/products/']")?.textContent ||
      `장바구니 ${index + 1}번 항목`,
    );
  }

  function uniqueElements(elements) {
    return [...new Set(elements)];
  }
