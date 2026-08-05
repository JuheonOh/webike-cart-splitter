const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseForwarderExchangeRates,
  sameExchangeRates,
  updateExchangeRates,
} = require("../scripts/update-exchange-rates");

const fixturePath = path.join(__dirname, "fixtures", "exchange-rates", "forwarder-sample.html");
const fixtureHtml = fs.readFileSync(fixturePath, "utf8");

const rates = parseForwarderExchangeRates(fixtureHtml);
const ratesWithoutPeriodColon = parseForwarderExchangeRates(
  fixtureHtml.replace("적용기간 :", "적용기간"),
);

assert.deepStrictEqual(rates, {
  source: "forwarder.kr",
  sourceUrl: "https://www.forwarder.kr/curr/index.php?curr=ex_rate",
  period: "2026-05-10 ~ 2026-05-16",
  updatedAt: "2026-05-10T16:08:02+09:00",
  rates: {
    USD: 1465.73,
    JPY: 9.3399,
  },
});

assert.strictEqual(ratesWithoutPeriodColon.period, rates.period);

const currentLayoutRates = parseForwarderExchangeRates(`
  <div>적용기간 2026-07-05 ~ 2026-07-11</div>
  <div>USD</div><div>US Dollar</div><div>미국</div><div>1,548.52</div><div>1,548.52</div>
  <div>JPY</div><div>Yen</div><div>일본</div><div>9.56</div><div>9.56</div>
  <div>2026-07-10 19:21:05</div>
`);
assert.deepStrictEqual(currentLayoutRates, {
  source: "forwarder.kr",
  sourceUrl: "https://www.forwarder.kr/curr/index.php?curr=ex_rate",
  period: "2026-07-05 ~ 2026-07-11",
  updatedAt: "2026-07-10T19:21:05+09:00",
  rates: { USD: 1548.52, JPY: 9.56 },
});

assert.strictEqual(sameExchangeRates(rates, {
  period: "2026-05-10 ~ 2026-05-16",
  rates: {
    USD: "1465.73",
    JPY: "9.3399",
  },
}), true);

assert.throws(
  () => parseForwarderExchangeRates(fixtureHtml.replace("미국", "캐나다")),
  /미국 USD 수입환율/,
);

async function runUpdateExchangeRatesTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "webike-rates-"));
  const outputPath = path.join(tempDir, "exchange-rates.json");
  const previousSourceFile = process.env.EXCHANGE_RATE_SOURCE_FILE;
  delete process.env.EXCHANGE_RATE_SOURCE_FILE;
  try {
    const response = { ok: true, status: 200, text: async () => fixtureHtml };
    const first = await updateExchangeRates({
      outputPath,
      fetchImpl: async () => response,
    });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")), first);

    const preservedUpdatedAt = "2026-01-01T00:00:00+09:00";
    fs.writeFileSync(outputPath, `${JSON.stringify({ ...first, updatedAt: preservedUpdatedAt })}\n`);
    const second = await updateExchangeRates({
      outputPath,
      fetchImpl: async () => response,
    });
    assert.strictEqual(second.updatedAt, preservedUpdatedAt, "동일 환율은 기존 updatedAt을 보존해야 함");

    await assert.rejects(
      () => updateExchangeRates({
        outputPath,
        fetchImpl: async () => ({ ok: false, status: 503 }),
      }),
      /HTTP 503/,
    );
    await assert.rejects(
      () => updateExchangeRates({
        outputPath,
        timeoutMs: 5,
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
