(function initWebikeExchangeRatePolicy(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WebikeExchangeRatePolicy = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createExchangeRatePolicy() {
  const DEFAULT_MAX_STALE_DAYS = 14;
  const DEFAULT_MAX_FUTURE_DAYS = 1;

  function parseIsoDateParts(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = Date.UTC(year, month - 1, day);
    const date = new Date(utc);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return null;
    }
    return { year, month, day, utc };
  }

  function getExchangeRatePeriodStatus(period, nowMs = Date.now()) {
    const match = String(period || "").trim().match(/^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/);
    const start = match ? parseIsoDateParts(match[1]) : null;
    const end = match ? parseIsoDateParts(match[2]) : null;
    if (!start || !end || start.utc > end.utc || !Number.isFinite(Number(nowMs))) {
      return { state: "invalid", staleDays: null, daysUntilStart: null, startDate: "", endDate: "" };
    }

    const koreaNow = new Date(Number(nowMs) + (9 * 60 * 60 * 1000));
    const today = Date.UTC(koreaNow.getUTCFullYear(), koreaNow.getUTCMonth(), koreaNow.getUTCDate());
    const dayMs = 24 * 60 * 60 * 1000;
    if (today < start.utc) {
      return {
        state: "upcoming",
        staleDays: 0,
        daysUntilStart: Math.ceil((start.utc - today) / dayMs),
        startDate: match[1],
        endDate: match[2],
      };
    }
    if (today > end.utc) {
      return {
        state: "expired",
        staleDays: Math.floor((today - end.utc) / dayMs),
        daysUntilStart: 0,
        startDate: match[1],
        endDate: match[2],
      };
    }
    return { state: "current", staleDays: 0, daysUntilStart: 0, startDate: match[1], endDate: match[2] };
  }

  function normalizeDayLimit(value, fallback, label) {
    const candidate = value === undefined || value === "" ? fallback : Number(value);
    if (!Number.isFinite(candidate) || candidate < 0) {
      throw new Error(`${label} 설정은 0 이상의 숫자여야 합니다.`);
    }
    return candidate;
  }

  function validateExchangeRateData(
    data,
    {
      maxStaleDays = DEFAULT_MAX_STALE_DAYS,
      maxFutureDays = DEFAULT_MAX_FUTURE_DAYS,
      nowMs = Date.now(),
    } = {},
  ) {
    let staleLimit;
    let futureLimit;
    try {
      staleLimit = normalizeDayLimit(maxStaleDays, DEFAULT_MAX_STALE_DAYS, "최대 경과일");
      futureLimit = normalizeDayLimit(maxFutureDays, DEFAULT_MAX_FUTURE_DAYS, "최대 미래일");
    } catch (error) {
      return { valid: false, reason: error.message, periodStatus: null };
    }

    if (!data || typeof data !== "object") return { valid: false, reason: "환율 데이터가 없습니다." };
    if (typeof data.source !== "string" || !data.source.trim()
      || typeof data.sourceUrl !== "string" || !data.sourceUrl.trim()) {
      return { valid: false, reason: "환율 데이터의 출처가 올바르지 않습니다." };
    }
    if (!data.rates || typeof data.rates.USD !== "number" || typeof data.rates.JPY !== "number") {
      return { valid: false, reason: "환율 데이터의 통화 값 형식이 올바르지 않습니다." };
    }
    if (data.rates.USD <= 0 || data.rates.JPY <= 0) {
      return { valid: false, reason: "환율 데이터의 통화 값이 0 이하입니다." };
    }
    if (!Number.isFinite(Date.parse(data.updatedAt))) {
      return { valid: false, reason: "환율 데이터의 조회 시각이 올바르지 않습니다." };
    }

    const periodStatus = getExchangeRatePeriodStatus(data.period, nowMs);
    if (periodStatus.state === "invalid") {
      return { valid: false, reason: "환율 데이터의 적용기간이 올바르지 않습니다.", periodStatus };
    }
    if (periodStatus.state === "expired" && periodStatus.staleDays > staleLimit) {
      return {
        valid: false,
        reason: `환율 데이터가 ${periodStatus.staleDays}일 지났습니다 (최대 ${staleLimit}일).`,
        periodStatus,
      };
    }
    if (periodStatus.state === "upcoming" && periodStatus.daysUntilStart > futureLimit) {
      return {
        valid: false,
        reason: `환율 데이터가 ${periodStatus.daysUntilStart}일 뒤에 시작합니다 (최대 ${futureLimit}일).`,
        periodStatus,
      };
    }
    return { valid: true, reason: "", periodStatus };
  }

  return {
    DEFAULT_MAX_STALE_DAYS,
    DEFAULT_MAX_FUTURE_DAYS,
    getExchangeRatePeriodStatus,
    normalizeDayLimit,
    validateExchangeRateData,
  };
});
