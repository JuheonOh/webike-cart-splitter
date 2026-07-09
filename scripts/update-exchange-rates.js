const fs = require("fs/promises");
const path = require("path");

const DEFAULT_SOURCE_URL = "https://www.forwarder.kr/curr/index.php?curr=ex_rate";
const DEFAULT_OUTPUT_PATH = path.join("data", "exchange-rates.json");

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

function parsePeriod(lines) {
  const text = lines.join(" ");
  const match = text.match(/적용기간\s*[:：]?\s*(\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2})/);
  return match ? match[1].replace(/\s*~\s*/, " ~ ") : "";
}

function parseUpdatedAt(lines) {
  const text = lines.join(" ");
  const matches = [...text.matchAll(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g)];
  if (!matches.length) return "";
  return matches[matches.length - 1][0].replace(/\s+/, "T") + "+09:00";
}

function parseImportRate(lines, country, currencyCode) {
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== country) continue;

    const currencyIndex = lines
      .slice(index + 1, index + 8)
      .findIndex((line) => line.includes(`(${currencyCode})`));

    if (currencyIndex === -1) continue;

    const start = index + 1 + currencyIndex + 1;
    const numbers = lines
      .slice(start, start + 8)
      .map(parseNumber)
      .filter((number) => number > 0);

    if (numbers.length) return numbers[0];
  }

  return 0;
}

function parseForwarderExchangeRates(html, sourceUrl = DEFAULT_SOURCE_URL) {
  const lines = htmlToLines(html);
  const period = parsePeriod(lines);
  const updatedAt = parseUpdatedAt(lines);
  const usd = parseImportRate(lines, "미국", "USD");
  const jpy = parseImportRate(lines, "일본", "JPY");

  if (!period) throw new Error("적용기간을 찾지 못했습니다.");
  if (usd <= 0) throw new Error("미국 USD 수입환율을 찾지 못했습니다.");
  if (jpy <= 0) throw new Error("일본 JPY 수입환율을 찾지 못했습니다.");

  return {
    source: "forwarder.kr",
    sourceUrl,
    period,
    updatedAt,
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

async function readSourceHtml(sourceUrl) {
  if (process.env.EXCHANGE_RATE_SOURCE_FILE) {
    return fs.readFile(process.env.EXCHANGE_RATE_SOURCE_FILE, "utf8");
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`환율 페이지 요청 실패: HTTP ${response.status}`);
  }
  return response.text();
}

async function updateExchangeRates({
  sourceUrl = process.env.EXCHANGE_RATE_SOURCE_URL || DEFAULT_SOURCE_URL,
  outputPath = process.env.EXCHANGE_RATE_OUTPUT_PATH || DEFAULT_OUTPUT_PATH,
} = {}) {
  const html = await readSourceHtml(sourceUrl);
  const nextData = parseForwarderExchangeRates(html, sourceUrl);
  const existingData = await readExistingJson(outputPath);

  if (sameExchangeRates(existingData, nextData)) {
    nextData.updatedAt = existingData.updatedAt || nextData.updatedAt;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(nextData, null, 2)}\n`);
  return nextData;
}

if (require.main === module) {
  updateExchangeRates()
    .then((data) => {
      console.log(`exchange rates updated: ${data.period} USD=${data.rates.USD} JPY=${data.rates.JPY}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  DEFAULT_SOURCE_URL,
  htmlToLines,
  parseForwarderExchangeRates,
  parseImportRate,
  sameExchangeRates,
  updateExchangeRates,
};
