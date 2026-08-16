const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DEFAULT_MAX_FUTURE_DAYS,
  DEFAULT_MAX_STALE_DAYS,
  validateExchangeRateData,
} = require("../assets/js/exchange-rate-policy.js");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publicPages = ["index.html", "cart_group_calculator.html", "webike_quote_wizard.html"];
const htmlPages = [...publicPages, "styleguide.html"];

function assertExists(relativePath) {
  assert.ok(fs.existsSync(path.join(distDir, relativePath)), `${relativePath} should exist in dist`);
}

function readDist(relativePath) {
  return fs.readFileSync(path.join(distDir, relativePath), "utf8");
}

function isLocalArtifactReference(value) {
  return (
    value &&
    !value.startsWith("#") &&
    !value.startsWith("http://") &&
    !value.startsWith("https://") &&
    !value.startsWith("mailto:") &&
    !value.startsWith("tel:") &&
    !value.startsWith("data:") &&
    !value.startsWith("javascript:")
  );
}

function resolveArtifactReference(page, value) {
  const withoutQuery = value.split(/[?#]/, 1)[0];
  if (!withoutQuery || withoutQuery.endsWith("/")) return null;
  const candidate = path.resolve(distDir, path.dirname(page), withoutQuery);
  const relative = path.relative(distDir, candidate);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `${page} references outside dist: ${value}`);
  return candidate;
}

function extractReferences(html) {
  const references = [];
  const patterns = [
    /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
    /<link\b[^>]*\brel=["'][^"']*stylesheet[^"']*["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (isLocalArtifactReference(match[1])) references.push(match[1]);
    }
  }

  return references;
}

for (const page of htmlPages) assertExists(page);
assertExists("assets");
[
  path.join("assets", "css", "cart-group-calculator.css"),
  path.join("assets", "js", "delimited-core.js"),
  path.join("assets", "js", "calculator-grouping.js"),
  path.join("assets", "js", "exchange-rate-policy.js"),
  path.join("assets", "js", "calculator-core.js"),
  path.join("assets", "js", "cart-group-calculator.js"),
  path.join("assets", "js", "cost-comparison-core.js"),
  path.join("assets", "js", "quote-result-core.js"),
].forEach(assertExists);
assertExists(path.join("data", "exchange-rates.json"));
assertExists(".nojekyll");

const exchangeRates = JSON.parse(readDist(path.join("data", "exchange-rates.json")));
const exchangeRateValidation = validateExchangeRateData(exchangeRates, {
  maxStaleDays: Number(process.env.EXCHANGE_RATE_MAX_STALE_DAYS || DEFAULT_MAX_STALE_DAYS),
  maxFutureDays: Number(process.env.EXCHANGE_RATE_MAX_FUTURE_DAYS || DEFAULT_MAX_FUTURE_DAYS),
});
assert.ok(exchangeRateValidation.valid, exchangeRateValidation.reason);

for (const page of publicPages) {
  const html = readDist(page);
  assert.ok(!/<a\b[^>]*href=["'](?:\.\/)?styleguide\.html(?:[?#][^"']*)?["']/i.test(html), `${page} should not link to styleguide.html`);
  assert.ok(!/<nav\b[^>]*data-public-nav[^>]*>[\s\S]*?styleguide\.html[\s\S]*?<\/nav>/i.test(html), `${page} public nav should not include styleguide.html`);
}

for (const page of htmlPages) {
  const html = readDist(page);
  for (const reference of extractReferences(html)) {
    const artifactPath = resolveArtifactReference(page, reference);
    if (!artifactPath) continue;
    assert.ok(fs.existsSync(artifactPath), `${page} references missing artifact ${reference}`);
  }
}

console.log("dist artifact audit passed");
