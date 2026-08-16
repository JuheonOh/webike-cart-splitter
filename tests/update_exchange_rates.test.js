const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  DEFAULT_REQUEST_HEADERS,
  describeHtmlResponse,
  formatKoreaTimestamp,
  parseForwarderExchangeRates,
  reportGitHubActionsResult,
  sameExchangeRates,
  updateExchangeRates,
  validateExchangeRateData,
} = require("../scripts/update-exchange-rates");

const fixturePath = path.join(__dirname, "fixtures", "exchange-rates", "forwarder-sample.html");
const fixtureHtml = fs.readFileSync(fixturePath, "utf8");
const fixedNowMs = Date.parse("2026-08-16T03:30:00Z");
const fixedObservedAt = "2026-08-16T12:30:00+09:00";

assert.deepStrictEqual(
  parseForwarderExchangeRates(fixtureHtml, undefined, fixedObservedAt),
  {
    source: "forwarder.kr",
    sourceUrl: "https://www.forwarder.kr/curr/index.php?curr=ex_rate",
    period: "2026-08-16 ~ 2026-08-22",
    updatedAt: fixedObservedAt,
    rates: {
      USD: 1416.06,
      JPY: 8.9,
    },
  },
);

assert.strictEqual(formatKoreaTimestamp(fixedNowMs), fixedObservedAt);
assert.match(
  describeHtmlResponse("<html><head><title> 점검 중 </title></head></html>"),
  /^응답 \d+바이트, 제목=점검 중$/,
);

const legacyFixtureHtml = `
  <section>
    <p>적용기간 : 2026-05-10 ~ 2026-05-16</p>
    <table>
      <tr><th>국가</th><th>화폐명</th><th>수입환율</th><th>수출환율</th></tr>
      <tr><td>미국</td><td>US Dollar(USD)</td><td>1465.73</td><td>1450.00</td></tr>
      <tr><td>일본</td><td>Yen(JPY)</td><td>9.3399</td><td>9.1000</td></tr>
    </table>
  </section>
`;
const legacyLayoutRates = parseForwarderExchangeRates(
  legacyFixtureHtml,
  undefined,
  fixedObservedAt,
);
assert.deepStrictEqual(legacyLayoutRates, {
  source: "forwarder.kr",
  sourceUrl: "https://www.forwarder.kr/curr/index.php?curr=ex_rate",
  period: "2026-05-10 ~ 2026-05-16",
  updatedAt: fixedObservedAt,
  rates: { USD: 1465.73, JPY: 9.3399 },
});

assert.strictEqual(sameExchangeRates(legacyLayoutRates, {
  period: "2026-05-10 ~ 2026-05-16",
  rates: {
    USD: "1465.73",
    JPY: "9.3399",
  },
}), true);

assert.throws(
  () => parseForwarderExchangeRates(
    legacyFixtureHtml.replace("<td>1465.73</td>", "<td>-</td>"),
    undefined,
    fixedObservedAt,
  ),
  /미국 USD 수입환율/,
  "레거시 레이아웃도 수입환율이 비어 있으면 수출환율로 대체하지 않아야 함",
);

assert.throws(
  () => parseForwarderExchangeRates(
    legacyFixtureHtml.replace("<td>1465.73</td>", ""),
    undefined,
    fixedObservedAt,
  ),
  /미국 USD 수입환율/,
  "레거시 수입환율 셀이 빠져도 뒤의 수출환율 열을 사용하지 않아야 함",
);

assert.throws(
  () => parseForwarderExchangeRates(
    fixtureHtml.replace(/<tr\b[^>]*data-s="usd [\s\S]*?<\/tr>/i, ""),
    undefined,
    fixedObservedAt,
  ),
  /미국 USD 수입환율/,
);

assert.throws(
  () => parseForwarderExchangeRates(
    fixtureHtml.replace(
      '<td class="er-rate-in">1,416.06</td>',
      '<td class="er-rate-in">-</td>',
    ),
    undefined,
    fixedObservedAt,
  ),
  /미국 USD 수입환율/,
  "현재 레이아웃의 수입환율이 비어 있으면 수출환율로 대체하지 않아야 함",
);

assert.throws(
  () => parseForwarderExchangeRates(`
    <div class="er-period-bar"><strong>2026-08-16 ~ 2026-08-22</strong></div>
    <table>
      <tr><td>미국</td><td>US Dollar(USD)</td><td>1465.73</td></tr>
      <tr><td>일본</td><td>Yen(JPY)</td><td>9.3399</td></tr>
    </table>
  `, undefined, fixedObservedAt),
  /미국 USD 수입환율/,
  "현재 레이아웃 표식이 있으면 레거시 필드와 혼합하지 않아야 함",
);

assert.strictEqual(validateExchangeRateData({
  source: "forwarder.kr",
  sourceUrl: "https://www.forwarder.kr/curr/index.php?curr=ex_rate",
  period: "2026-08-16 ~ 2026-08-22",
  updatedAt: fixedObservedAt,
  rates: { USD: 1416.06, JPY: 8.9 },
}, { nowMs: fixedNowMs, maxStaleDays: 14 }).valid, true);

assert.strictEqual(validateExchangeRateData({
  source: "forwarder.kr",
  sourceUrl: "https://www.forwarder.kr/curr/index.php?curr=ex_rate",
  period: "2026-08-18 ~ 2026-08-24",
  updatedAt: fixedObservedAt,
  rates: { USD: 1416.06, JPY: 8.9 },
}, { nowMs: fixedNowMs, maxStaleDays: 14, maxFutureDays: 1 }).valid, false);

assert.strictEqual(validateExchangeRateData({
  source: "forwarder.kr",
  sourceUrl: "https://www.forwarder.kr/curr/index.php?curr=ex_rate",
  period: "2026-08-16 ~ 2026-08-22",
  updatedAt: fixedObservedAt,
  rates: { USD: 1416.06, JPY: 8.9 },
}, { nowMs: fixedNowMs, maxStaleDays: Number.NaN, maxFutureDays: 1 }).valid, false);

async function runUpdateExchangeRatesTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "webike-rates-"));
  const outputPath = path.join(tempDir, "exchange-rates.json");
  const previousSourceFile = process.env.EXCHANGE_RATE_SOURCE_FILE;
  delete process.env.EXCHANGE_RATE_SOURCE_FILE;
  const response = { ok: true, status: 200, text: async () => fixtureHtml };
  const quietLogger = { warn() {} };

  try {
    let firstRequestOptions;
    const first = await updateExchangeRates({
      outputPath,
      fetchImpl: async (_url, options) => {
        firstRequestOptions = options;
        return response;
      },
      maxAttempts: 1,
      nowImpl: () => fixedNowMs,
      logger: quietLogger,
    });
    assert.strictEqual(first.status, "updated");
    assert.strictEqual(first.attempts, 1);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")), first.data);
    assert.strictEqual(first.data.updatedAt, fixedObservedAt);
    assert.deepStrictEqual(firstRequestOptions.headers, DEFAULT_REQUEST_HEADERS);
    assert.strictEqual(firstRequestOptions.redirect, "follow");

    const preservedUpdatedAt = "2026-08-16T11:00:00+09:00";
    fs.writeFileSync(outputPath, `${JSON.stringify({ ...first.data, updatedAt: preservedUpdatedAt })}\n`);
    const second = await updateExchangeRates({
      outputPath,
      fetchImpl: async () => response,
      maxAttempts: 1,
      nowImpl: () => fixedNowMs,
      logger: quietLogger,
    });
    assert.strictEqual(second.status, "unchanged");
    assert.strictEqual(second.data.updatedAt, preservedUpdatedAt, "동일 환율은 기존 updatedAt을 보존해야 함");

    let retryFetchCount = 0;
    const retried = await updateExchangeRates({
      outputPath,
      fetchImpl: async () => {
        retryFetchCount += 1;
        return retryFetchCount < 3
          ? { ok: true, status: 200, text: async () => "<html><body>점검 중</body></html>" }
          : response;
      },
      maxAttempts: 3,
      retryDelayMs: 0,
      sleepImpl: async () => {},
      nowImpl: () => fixedNowMs,
      logger: quietLogger,
    });
    assert.strictEqual(retried.status, "unchanged");
    assert.strictEqual(retried.attempts, 3);

    const warnings = [];
    const retained = await updateExchangeRates({
      outputPath,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<html>점검 중</html>" }),
      maxAttempts: 2,
      retryDelayMs: 0,
      sleepImpl: async () => {},
      nowImpl: () => fixedNowMs,
      logger: { warn: (message) => warnings.push(message) },
    });
    assert.strictEqual(retained.status, "retained");
    assert.strictEqual(retained.attempts, 2);
    assert.match(retained.error, /적용기간/);
    assert.strictEqual(warnings.length, 2);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")), retained.data);

    const actionWarnings = [];
    let actionSummary = "";
    await reportGitHubActionsResult(retained, {
      env: { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: "summary.md" },
      logger: { warn: (message) => actionWarnings.push(message) },
      appendFile: async (_file, content) => { actionSummary += content; },
    });
    assert.strictEqual(actionWarnings.length, 1);
    assert.match(actionWarnings[0], /^::warning title=환율 갱신 폴백::/);
    assert.match(actionSummary, /기존 데이터 유지/);
    assert.match(actionSummary, /조회 시도: 2회/);

    const olderHtml = fixtureHtml.replace(
      "2026-08-16 ~ 2026-08-22",
      "2026-08-09 ~ 2026-08-15",
    );
    const rollbackPrevented = await updateExchangeRates({
      outputPath,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => olderHtml }),
      maxAttempts: 1,
      nowImpl: () => fixedNowMs,
      logger: quietLogger,
    });
    assert.strictEqual(rollbackPrevented.status, "retained");
    assert.match(rollbackPrevented.error, /기존 적용기간.*보다 오래됐습니다/);
    assert.strictEqual(rollbackPrevented.data.period, "2026-08-16 ~ 2026-08-22");

    const staleData = {
      ...retained.data,
      period: "2026-07-01 ~ 2026-07-07",
      updatedAt: "2026-07-01T12:00:00+09:00",
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(staleData)}\n`);
    await assert.rejects(
      () => updateExchangeRates({
        outputPath,
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<html>점검 중</html>" }),
        maxAttempts: 1,
        nowImpl: () => fixedNowMs,
        logger: quietLogger,
      }),
      /환율 데이터가 40일 지났습니다/,
    );

    await assert.rejects(
      () => updateExchangeRates({
        outputPath,
        fetchImpl: async () => ({ ok: false, status: 503 }),
        maxAttempts: 1,
        nowImpl: () => fixedNowMs,
        logger: quietLogger,
      }),
      /HTTP 503/,
    );
    await assert.rejects(
      () => updateExchangeRates({
        outputPath,
        timeoutMs: 5,
        maxAttempts: 1,
        nowImpl: () => fixedNowMs,
        logger: quietLogger,
        fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      }),
      /시간 초과 \(5ms\)/,
    );
  } finally {
    if (previousSourceFile === undefined) delete process.env.EXCHANGE_RATE_SOURCE_FILE;
    else process.env.EXCHANGE_RATE_SOURCE_FILE = previousSourceFile;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runUpdateExchangeRatesTests()
  .then(() => console.log("update_exchange_rates tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
