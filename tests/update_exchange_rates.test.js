const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  DEFAULT_REQUEST_HEADERS,
  DEFAULT_FETCH_URL,
  DEFAULT_SOURCE_URL,
  buildSourceRequestUrl,
  describeHtmlResponse,
  formatKoreaDate,
  formatKoreaTimestamp,
  parseCustomsExchangeRates,
  parseForwarderExchangeRates,
  LEGACY_FORWARDER_SOURCE_URL,
  reportGitHubActionsResult,
  sameExchangeRates,
  updateExchangeRates,
  validateExchangeRateData,
} = require("../scripts/update-exchange-rates");

const fixturePath = path.join(__dirname, "fixtures", "exchange-rates", "forwarder-sample.html");
const fixtureHtml = fs.readFileSync(fixturePath, "utf8");
const fixedNowMs = Date.parse("2026-08-16T03:30:00Z");
const fixedObservedAt = "2026-08-16T12:30:00+09:00";
const customsFixture = {
  count: 2,
  items: [
    { aplyBgnDt: "20260816", currCd: "JPY", weekFxrtIm: "8.9032" },
    { aplyBgnDt: "20260816", currCd: "USD", weekFxrtIm: "1416.06" },
  ],
};
const customsFixtureJson = JSON.stringify(customsFixture);

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
assert.strictEqual(formatKoreaDate(fixedNowMs), "2026-08-16");
assert.strictEqual(
  buildSourceRequestUrl(DEFAULT_FETCH_URL, fixedNowMs),
  `${DEFAULT_FETCH_URL}?aplyBgnDt=2026-08-16&summary=01&pageIndex=1&pageUnit=20`,
);
assert.match(
  describeHtmlResponse("<html><head><title> 점검 중 </title></head></html>"),
  /^응답 \d+바이트, 제목=점검 중$/,
);
assert.deepStrictEqual(
  parseCustomsExchangeRates(customsFixtureJson, undefined, fixedObservedAt),
  {
    source: "customs.go.kr",
    sourceUrl: DEFAULT_SOURCE_URL,
    period: "2026-08-16 ~ 2026-08-22",
    updatedAt: fixedObservedAt,
    rates: { USD: 1416.06, JPY: 8.9032 },
  },
);
assert.throws(
  () => parseCustomsExchangeRates(JSON.stringify({
    ...customsFixture,
    items: customsFixture.items.map((item) => (
      item.currCd === "JPY" ? { ...item, weekFxrtIm: "", weekFxrtEx: "8.9032" } : item
    )),
  }), undefined, fixedObservedAt),
  /일본 JPY 수입환율/,
  "관세청 응답도 수입환율이 비어 있으면 수출환율로 대체하지 않아야 함",
);
assert.throws(
  () => parseCustomsExchangeRates(JSON.stringify({
    ...customsFixture,
    items: customsFixture.items.map((item) => (
      item.currCd === "JPY" ? { ...item, aplyBgnDt: "20260809" } : item
    )),
  }), undefined, fixedObservedAt),
  /적용기간/,
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
  source: "forwarder.kr",
  sourceUrl: LEGACY_FORWARDER_SOURCE_URL,
  period: "2026-05-10 ~ 2026-05-16",
  rates: {
    USD: "1465.73",
    JPY: "9.3399",
  },
}), true);
assert.strictEqual(sameExchangeRates(legacyLayoutRates, {
  ...legacyLayoutRates,
  source: "customs.go.kr",
}), false);

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
  const previousSourceUrl = process.env.EXCHANGE_RATE_SOURCE_URL;
  const previousFetchUrl = process.env.EXCHANGE_RATE_FETCH_URL;
  delete process.env.EXCHANGE_RATE_SOURCE_FILE;
  delete process.env.EXCHANGE_RATE_SOURCE_URL;
  delete process.env.EXCHANGE_RATE_FETCH_URL;
  const response = { ok: true, status: 200, text: async () => customsFixtureJson };
  const quietLogger = { warn() {} };

  try {
    let firstRequestUrl;
    let firstRequestOptions;
    const first = await updateExchangeRates({
      outputPath,
      fetchImpl: async (url, options) => {
        firstRequestUrl = url;
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
    assert.strictEqual(
      firstRequestUrl,
      `${DEFAULT_FETCH_URL}?aplyBgnDt=2026-08-16&summary=01&pageIndex=1&pageUnit=20`,
    );
    assert.deepStrictEqual(firstRequestOptions.headers, DEFAULT_REQUEST_HEADERS);
    assert.strictEqual(firstRequestOptions.redirect, "follow");

    const previousSourceObservedAt = "2026-08-16T10:00:00+09:00";
    fs.writeFileSync(outputPath, `${JSON.stringify({
      ...first.data,
      source: "forwarder.kr",
      sourceUrl: LEGACY_FORWARDER_SOURCE_URL,
      updatedAt: previousSourceObservedAt,
    })}\n`);
    const sourceMigrated = await updateExchangeRates({
      outputPath,
      fetchImpl: async () => response,
      maxAttempts: 1,
      nowImpl: () => fixedNowMs,
      logger: quietLogger,
    });
    assert.strictEqual(sourceMigrated.status, "updated");
    assert.strictEqual(sourceMigrated.data.source, "customs.go.kr");
    assert.strictEqual(sourceMigrated.data.updatedAt, fixedObservedAt);

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

    const clipHtmlRejected = await updateExchangeRates({
      outputPath,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => fixtureHtml }),
      maxAttempts: 1,
      nowImpl: () => fixedNowMs,
      logger: quietLogger,
    });
    assert.strictEqual(clipHtmlRejected.status, "retained");
    assert.match(clipHtmlRejected.error, /올바른 JSON/);

    const legacyOutputPath = path.join(tempDir, "legacy-exchange-rates.json");
    const explicitLegacy = await updateExchangeRates({
      sourceUrl: LEGACY_FORWARDER_SOURCE_URL,
      fetchUrl: LEGACY_FORWARDER_SOURCE_URL,
      outputPath: legacyOutputPath,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => fixtureHtml }),
      maxAttempts: 1,
      nowImpl: () => fixedNowMs,
      logger: quietLogger,
    });
    assert.strictEqual(explicitLegacy.status, "updated");
    assert.strictEqual(explicitLegacy.data.source, "forwarder.kr");
    assert.strictEqual(explicitLegacy.data.sourceUrl, LEGACY_FORWARDER_SOURCE_URL);

    await assert.rejects(
      () => updateExchangeRates({
        fetchUrl: LEGACY_FORWARDER_SOURCE_URL,
        outputPath: legacyOutputPath,
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => fixtureHtml }),
        maxAttempts: 1,
        nowImpl: () => fixedNowMs,
        logger: quietLogger,
      }),
      /sourceUrl과 fetchUrl/,
    );
    await assert.rejects(
      () => updateExchangeRates({
        sourceUrl: LEGACY_FORWARDER_SOURCE_URL,
        outputPath: legacyOutputPath,
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => fixtureHtml }),
        maxAttempts: 1,
        nowImpl: () => fixedNowMs,
        logger: quietLogger,
      }),
      /sourceUrl과 fetchUrl/,
    );

    process.env.EXCHANGE_RATE_SOURCE_URL = LEGACY_FORWARDER_SOURCE_URL;
    const environmentLegacy = await updateExchangeRates({
      outputPath: legacyOutputPath,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => fixtureHtml }),
      maxAttempts: 1,
      nowImpl: () => fixedNowMs,
      logger: quietLogger,
    });
    assert.strictEqual(environmentLegacy.data.sourceUrl, LEGACY_FORWARDER_SOURCE_URL);
    delete process.env.EXCHANGE_RATE_SOURCE_URL;

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
    assert.match(retained.error, /올바른 JSON/);
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

    const olderHtml = customsFixtureJson.replaceAll("20260816", "20260809");
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
    if (previousSourceUrl === undefined) delete process.env.EXCHANGE_RATE_SOURCE_URL;
    else process.env.EXCHANGE_RATE_SOURCE_URL = previousSourceUrl;
    if (previousFetchUrl === undefined) delete process.env.EXCHANGE_RATE_FETCH_URL;
    else process.env.EXCHANGE_RATE_FETCH_URL = previousFetchUrl;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runUpdateExchangeRatesTests()
  .then(() => console.log("update_exchange_rates tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
