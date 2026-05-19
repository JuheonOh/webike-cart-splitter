
  function classifyResolveError(error) {
    const message = cleanText(error?.message);
    if (/검색 결과 없음/.test(message)) return "검색 결과가 없습니다. 검색 링크로 직접 확인해 주세요.";
    if (/여러 개|확정 불가/.test(message)) return "후보가 여러 개라 직접 선택이 필요합니다.";
    if (/중고 상품/.test(message)) return "중고 상품은 제외 대상입니다. 새 상품 검색 링크로 직접 확인해 주세요.";
    if (/상품 ID/.test(message)) return "상품 정보를 확인하지 못했습니다. 검색 링크로 직접 확인해 주세요.";
    if (/구매 불가|장바구니 담기 불가|품절|배송 제한/.test(message)) return "품절 또는 구매 제한 상품으로 보입니다.";
    if (/HTTP 401|HTTP 403|로그인|세션/.test(message)) return "로그인 또는 세션 확인이 필요합니다.";
    if (/부품번호가 다릅니다/.test(message)) {
      const suffix = /[.!?。]$/.test(message) ? "" : ".";
      return `${message}${suffix} 맞는 상품인지 확인해 주세요.`;
    }
    if (/옵션/.test(message)) return "옵션 선택이 필요한 상품입니다. 상품 페이지에서 직접 확인해 주세요.";
    if (/JSON|파싱/.test(message)) return "검색 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return message || "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }

  function classifyCartError(error) {
    const message = cleanText(error?.message);
    if (/401|403|로그인|세션/.test(message)) return "로그인/세션 문제 가능성";
    if (/error|failed|fail|오류|실패/i.test(message)) return "장바구니 추가 실패";
    return message || "장바구니 추가 실패";
  }

  function statusLabel(status) {
    return {
      pending: "대기",
      searching: "검색 중",
      resolved: "찾음",
      adding: "담는 중",
      cart_added: "장바구니 완료",
      cart_failed: "장바구니 실패",
      need_review: "확인 필요",
      ignored: "무시",
    }[status] || status;
  }

  function cleanText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function cleanMessageText(value) {
    return String(value == null ? "" : value)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(cleanText)
      .filter(Boolean)
      .join("\n");
  }

  function toNumber(value) {
    return Number(String(value == null ? "" : value).replace(/,/g, "").trim()) || 0;
  }

  function normalizePartNumber(value) {
    return cleanText(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  function csvCell(value) {
    const text = String(value == null ? "" : value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
