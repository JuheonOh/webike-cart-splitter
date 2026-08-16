const fs = require("fs/promises");
const path = require("path");
const {
  DEFAULT_MAX_FUTURE_DAYS,
  DEFAULT_MAX_STALE_DAYS,
  normalizeDayLimit,
  validateExchangeRateData,
} = require("../assets/js/exchange-rate-policy.js");

const DEFAULT_SOURCE_URL = "https://www.forwarder.kr/curr/index.php?curr=ex_rate";
const DEFAULT_OUTPUT_PATH = path.join("data", "exchange-rates.json");
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_REQUEST_HEADERS = Object.freeze({
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: "https://www.forwarder.kr/",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    + "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
});

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function htmlToLines(html) {
  return decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:tr|td|th|div|p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function htmlFragmentToText(value) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePeriod(value) {
  const match = String(value || "").match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  return match ? `${match[1]} ~ ${match[2]}` : "";
}

function parseStructuredPeriod(html) {
  const match = String(html || "").match(
    /<div\b[^>]*class=["'][^"']*\ber-period-bar\b[^"']*["'][^>]*>[\s\S]*?<strong\b[^>]*>([\s\S]*?)<\/strong>/i,
  );
  return match ? normalizePeriod(htmlFragmentToText(match[1])) : "";
}

function parseStructuredImportRate(html, currencyCode) {
  const rows = String(html || "").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const codeMatch = row.match(
      /<(?:div|span)\b[^>]*class=["'][^"']*\ber-curr-code\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span)>/i,
    );
    if (!codeMatch || htmlFragmentToText(codeMatch[1]).toUpperCase() !== currencyCode) continue;

    const rateMatch = row.match(
      /<td\b[^>]*class=["'][^"']*\ber-rate-in\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i,
    );
    return rateMatch ? parseNumber(htmlFragmentToText(rateMatch[1])) : 0;
  }
  return 0;
}

function parsePeriod(lines) {
  const text = lines.join(" ");
  const match = text.match(/적용기간\s*[:：]?\s*(\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2})/);
  return match ? normalizePeriod(match[1]) : "";
}

function parseRowCells(rowHtml) {
  return [...String(rowHtml || "").matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
    .map((match) => htmlFragmentToText(match[1]));
}

function parseLegacyImportRates(html) {
  const tables = String(html || "").match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const rows = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const parsedRows = rows.map(parseRowCells).filter((cells) => cells.length);
    const headerIndex = parsedRows.findIndex((cells) => cells.includes("수입환율"));
    if (headerIndex === -1) continue;

    const header = parsedRows[headerIndex];
    const countryIndex = header.findIndex((cell) => cell === "국가");
    const importRateIndex = header.findIndex((cell) => cell === "수입환율");
    if (countryIndex === -1 || importRateIndex === -1) continue;

    const result = { USD: 0, JPY: 0 };
    for (const cells of parsedRows.slice(headerIndex + 1)) {
      if (cells.length !== header.length) continue;
      const country = cells[countryIndex];
      const rowText = cells.join(" ");
      if (country === "미국" && /(?:^|\W)USD(?:\W|$)/i.test(rowText)) {
        result.USD = parseNumber(cells[importRateIndex]);
      }
      if (country === "일본" && /(?:^|\W)JPY(?:\W|$)/i.test(rowText)) {
        result.JPY = parseNumber(cells[importRateIndex]);
      }
    }
    return result;
  }
  return { USD: 0, JPY: 0 };
}

function formatKoreaTimestamp(nowMs = Date.now()) {
  const timestamp = Number(nowMs);
  if (!Number.isFinite(timestamp)) throw new Error("환율 조회 시각이 올바르지 않습니다.");
  return `${new Date(timestamp + (9 * 60 * 60 * 1000)).toISOString().slice(0, 19)}+09:00`;
}

function describeHtmlResponse(html) {
  const source = String(html || "");
  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `응답 ${Buffer.byteLength(source, "utf8")}바이트, 제목=${title || "없음"}`;
}

function parseForwarderExchangeRates(
  html,
  sourceUrl = DEFAULT_SOURCE_URL,
  observedAt = formatKoreaTimestamp(),
) {
  const lines = htmlToLines(html);
  const hasStructuredLayout = /\b(?:er-period-bar|er-curr-code|er-rate-in)\b/i.test(String(html || ""));
  const legacyRates = hasStructuredLayout ? null : parseLegacyImportRates(html);
  const period = hasStructuredLayout ? parseStructuredPeriod(html) : parsePeriod(lines);
  const usd = hasStructuredLayout
    ? parseStructuredImportRate(html, "USD")
    : legacyRates.USD;
  const jpy = hasStructuredLayout
    ? parseStructuredImportRate(html, "JPY")
    : legacyRates.JPY;

  if (!period) throw new Error("적용기간을 찾지 못했습니다.");
  if (usd <= 0) throw new Error("미국 USD 수입환율을 찾지 못했습니다.");
  if (jpy <= 0) throw new Error("일본 JPY 수입환율을 찾지 못했습니다.");

  return {
    source: "forwarder.kr",
    sourceUrl,
    period,
    updatedAt: observedAt,
    rates: {
      USD: usd,
      JPY: jpy,
    },
  };
}

function sameExchangeRates(left, right) {
  return Boolean(
    left
      && right
      && left.period === right.period
      && Number(left.rates?.USD) === Number(right.rates?.USD)
      && Number(left.rates?.JPY) === Number(right.rates?.JPY),
  );
}

async function readExistingJson(outputPath) {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8"));
  } catch {
    return null;
  }
}

function periodEndTimestamp(period) {
  const match = String(period || "").match(/^\d{4}-\d{2}-\d{2}\s*~\s*(\d{4}-\d{2}-\d{2})$/);
  return match ? Date.parse(`${match[1]}T00:00:00Z`) : NaN;
}

function isOlderPeriod(candidate, existing) {
  const candidateEnd = periodEndTimestamp(candidate?.period);
  const existingEnd = periodEndTimestamp(existing?.period);
  return Number.isFinite(candidateEnd) && Number.isFinite(existingEnd) && candidateEnd < existingEnd;
}

function escapeWorkflowCommand(value) {
  return String(value || "")
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

async function reportGitHubActionsResult(
  result,
  { env = process.env, logger = console, appendFile = fs.appendFile } = {},
) {
  if (result?.status !== "retained" || env.GITHUB_ACTIONS !== "true") return;

  const message = `외부 환율 조회 실패로 기존 데이터 유지: ${result.data.period}; `
    + `시도=${result.attempts}; 경과일=${result.staleDays}; 마지막 오류=${result.error}`;
  logger.warn?.(`::warning title=환율 갱신 폴백::${escapeWorkflowCommand(message)}`);

  if (env.GITHUB_STEP_SUMMARY) {
    const summary = [
      "## 환율 갱신 경고",
      "",
      "- 상태: 기존 데이터 유지",
      `- 적용기간: ${result.data.period}`,
      `- 조회 시도: ${result.attempts}회`,
      `- 적용기간 경과: ${result.staleDays}일`,
      `- 마지막 오류: ${result.error}`,
      "",
    ].join("\n");
    await appendFile(env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }
}

async function readSourceHtml(
  sourceUrl,
  { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (process.env.EXCHANGE_RATE_SOURCE_FILE) {
    return fs.readFile(process.env.EXCHANGE_RATE_SOURCE_FILE, "utf8");
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("환율 페이지 요청을 위한 fetch 구현이 없습니다.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(sourceUrl, {
      headers: DEFAULT_REQUEST_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response || !response.ok) {
      throw new Error(`환율 페이지 요청 실패: HTTP ${response?.status ?? "응답 없음"}`);
    }
    return await response.text();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`환율 페이지 요청 시간 초과 (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function updateExchangeRates({
  sourceUrl = process.env.EXCHANGE_RATE_SOURCE_URL || DEFAULT_SOURCE_URL,
  outputPath = process.env.EXCHANGE_RATE_OUTPUT_PATH || DEFAULT_OUTPUT_PATH,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = Number(process.env.EXCHANGE_RATE_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS),
  retryDelayMs = Number(process.env.EXCHANGE_RATE_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS),
  maxStaleDays = Number(process.env.EXCHANGE_RATE_MAX_STALE_DAYS || DEFAULT_MAX_STALE_DAYS),
  maxFutureDays = Number(process.env.EXCHANGE_RATE_MAX_FUTURE_DAYS || DEFAULT_MAX_FUTURE_DAYS),
  nowImpl = Date.now,
  sleepImpl = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  logger = console,
} = {}) {
  const existingData = await readExistingJson(outputPath);
  const attempts = Math.max(1, Math.floor(Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  const delayMs = Math.max(0, Number(retryDelayMs) || 0);
  const staleDaysLimit = normalizeDayLimit(maxStaleDays, DEFAULT_MAX_STALE_DAYS, "최대 경과일");
  const futureDaysLimit = normalizeDayLimit(maxFutureDays, DEFAULT_MAX_FUTURE_DAYS, "최대 미래일");
  const validationNowMs = nowImpl();
  const existingValidation = validateExchangeRateData(existingData, {
    maxStaleDays: staleDaysLimit,
    maxFutureDays: futureDaysLimit,
    nowMs: validationNowMs,
  });
  let nextData = null;
  let lastError = null;
  let completedAttempts = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    completedAttempts = attempt;
    try {
      const html = await readSourceHtml(sourceUrl, { fetchImpl, timeoutMs });
      let candidate;
      try {
        candidate = parseForwarderExchangeRates(
          html,
          sourceUrl,
          formatKoreaTimestamp(validationNowMs),
        );
      } catch (error) {
        throw new Error(`${error.message} (${describeHtmlResponse(html)})`);
      }
      const candidateValidation = validateExchangeRateData(candidate, {
        maxStaleDays: staleDaysLimit,
        maxFutureDays: futureDaysLimit,
        nowMs: validationNowMs,
      });
      if (!candidateValidation.valid) {
        throw new Error(`조회한 환율 데이터 검증 실패: ${candidateValidation.reason}`);
      }
      if (existingValidation.valid && isOlderPeriod(candidate, existingData)) {
        throw new Error(
          `조회한 적용기간(${candidate.period})이 기존 적용기간(${existingData.period})보다 오래됐습니다.`,
        );
      }
      nextData = candidate;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        logger.warn?.(`환율 조회 실패 (${attempt}/${attempts}): ${error.message}; 재시도합니다.`);
        await sleepImpl(delayMs * attempt);
      }
    }
  }

  if (!nextData) {
    if (!existingValidation.valid) {
      throw new Error(`${lastError?.message || "환율 조회 실패"} ${existingValidation.reason}`);
    }
    logger.warn?.(
      `환율 조회를 ${completedAttempts}회 실패해 기존 데이터를 유지합니다: ${existingData.period}`,
    );
    return {
      data: existingData,
      status: "retained",
      attempts: completedAttempts,
      error: lastError?.message || "",
      staleDays: existingValidation.periodStatus.staleDays,
    };
  }

  const unchanged = sameExchangeRates(existingData, nextData);
  if (unchanged) {
    nextData.updatedAt = existingData.updatedAt || nextData.updatedAt;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(nextData, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, outputPath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
  return {
    data: nextData,
    status: unchanged ? "unchanged" : "updated",
    attempts: completedAttempts,
    error: "",
    staleDays: 0,
  };
}

if (require.main === module) {
  updateExchangeRates()
    .then(async (result) => {
      await reportGitHubActionsResult(result);
      const { data, status, attempts } = result;
      console.log(
        `exchange rates ${status}: ${data.period} USD=${data.rates.USD} JPY=${data.rates.JPY} attempts=${attempts}`,
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  DEFAULT_SOURCE_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_REQUEST_HEADERS,
  DEFAULT_MAX_STALE_DAYS,
  DEFAULT_MAX_FUTURE_DAYS,
  describeHtmlResponse,
  formatKoreaTimestamp,
  htmlToLines,
  parseForwarderExchangeRates,
  parseLegacyImportRates,
  parseStructuredImportRate,
  parseStructuredPeriod,
  reportGitHubActionsResult,
  sameExchangeRates,
  readSourceHtml,
  updateExchangeRates,
  validateExchangeRateData,
};
