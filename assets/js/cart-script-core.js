(function initWebikeCartScriptCore(root, factory) {
  const api = factory();
  api.standaloneApiExpression = () => `(${factory.toString()})()`;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WebikeCartScriptCore = api;
})(typeof window !== "undefined" ? window : globalThis, function createWebikeCartScriptCore() {
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { credentials: "include", ...options, signal: controller.signal });
      return { ok: response.ok, text: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  }

  async function quantities() {
    const response = await request("/api_shopping_cart.html?action=view", {
      cache: "no-store",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!response.ok) throw new Error("Webike 장바구니를 확인하지 못했습니다.");
    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      throw new Error("Webike 장바구니 응답이 올바른 JSON이 아닙니다.");
    }
    if (data?.status !== "OK" || !(data.productArray === null || Array.isArray(data.productArray))) {
      throw new Error("Webike 장바구니 상품 목록을 확인하지 못했습니다.");
    }
    const result = new Map();
    for (const row of data.productArray || []) {
      const id = String(row?.sku ?? "");
      const quantity = Number(row?.quantity);
      if (!["number", "string"].includes(typeof row?.sku) || !/^\d+$/.test(id) || !["number", "string"].includes(typeof row.quantity) || String(row.quantity).trim() === "" || !Number.isSafeInteger(quantity) || quantity < 0) {
        throw new Error("Webike 장바구니 상품 수량을 확인하지 못했습니다.");
      }
      result.set(id, (result.get(id) || 0) + quantity);
    }
    return result;
  }

  function uncertain(message) {
    const error = new Error(`${message} 장바구니를 직접 확인한 뒤 남은 상품만 새로 계산해 주세요. 이 요청은 재시도하지 않습니다.`);
    error.uncertain = true;
    return error;
  }

  async function add(item) {
    const id = String(item.productsId ?? "");
    const quantity = Number(item.quantity);
    if (!["number", "string"].includes(typeof item.productsId) || !/^\d+$/.test(id) || !["number", "string"].includes(typeof item.quantity) || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("장바구니 상품 ID 또는 수량이 올바르지 않습니다.");
    }
    const before = await quantities();
    let response;
    try {
      response = await request("/api_shopping_cart.html?action=add_product&ajax_action=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({ products_id: id, cart_quantity: String(quantity) }),
      });
    } catch {
      // A lost response does not prove that the server rejected the mutation.
    }
    let after;
    try {
      after = await quantities();
    } catch {
      throw uncertain("장바구니 요청 후 상품 수량을 확인하지 못했습니다.");
    }
    const delta = (after.get(id) || 0) - (before.get(id) || 0);
    if (delta === quantity) return;
    if (delta === 0 && response && /Product not found/i.test(response.text)) {
      throw new Error("Webike에서 상품을 찾지 못해 담지 않았습니다.");
    }
    throw uncertain("요청한 수량만큼 장바구니에 담겼는지 확정하지 못했습니다.");
  }

  return { add };
});
