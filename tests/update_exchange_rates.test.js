const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  parseForwarderExchangeRates,
  sameExchangeRates,
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

console.log("update_exchange_rates tests passed");
