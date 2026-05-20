const assert = require("assert");
const fs = require("fs");
const path = require("path");

const cartCore = require("../assets/js/calculator-core.js");
const quoteCore = require("../assets/js/webike-quote-core.js");

const productDetailFixture = fs.readFileSync(
  path.join(__dirname, "fixtures/webike-product/product-detail-25427339.html"),
  "utf8",
);
const shippingApiFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures/webike-product/shipping-api-25427339.json"),
  "utf8",
));
const searchApiFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures/webike-product/search-api-34901KY2702.json"),
  "utf8",
));

function makeSettings(overrides = {}) {
  const settings = {
    limitUsd: 150,
    usdKrw: 1500,
    jpyKrw: 10,
    maxGroups: 4,
    splitQuantity: true,
    shippingService: "SEA",
    ...overrides,
  };
  settings.limitJpy = (settings.limitUsd * settings.usdKrw) / settings.jpyKrw;
  return settings;
}

const productDetail = quoteCore.parseProductDetail(
  productDetailFixture,
  "https://www.japan-webike.kr/products/25427339.html",
);
assert.deepStrictEqual({
  productId: productDetail.productId,
  partNumber: productDetail.partNumber,
  unitJpy: productDetail.unitJpy,
  productWeight: productDetail.productWeight,
  productVolume: productDetail.productVolume,
  countryIso2: productDetail.countryIso2,
  shopCode: productDetail.shopCode,
}, {
  productId: "25427339",
  partNumber: "34901KY2702",
  unitJpy: 6733,
  productWeight: 23.7,
  productVolume: 35.6,
  countryIso2: "KR",
  shopCode: "9000",
});

assert.deepStrictEqual(quoteCore.validateProductDetail(productDetail, {
  productUrl: "https://www.japan-webike.kr/products/25427339.html",
  quantity: 1,
}).errors, []);

const shippingCandidates = quoteCore.normalizeShippingApiResponse(shippingApiFixture);
assert.deepStrictEqual(shippingCandidates.map((item) => [item.serviceCode, item.costJpy]), [
  ["SEA", 2700],
  ["STD", 2800],
  ["FEDEXIE", 9900],
]);
assert.strictEqual(quoteCore.selectShippingCandidate(shippingCandidates, { shippingService: "STD" }).costJpy, 2800);

const quoteProduct = quoteCore.productFromDetail({
  partNumber: "",
  quantity: 4,
  name: "Headlight valve",
  unitJpy: 0,
  productUrl: "https://www.japan-webike.kr/products/25427339.html",
}, productDetail, 0);
const shipmentMetrics = quoteCore.shipmentMetricsFromProducts([{ ...quoteProduct, quantity: 2, totalJpy: quoteProduct.unitJpy * 2 }]);
assert.deepStrictEqual(shipmentMetrics, {
  amountJpy: 13466,
  weightPoint: 47.4,
  volumePoint: 71.2,
});

const shippingRequest = quoteCore.buildShippingRequest([{ ...quoteProduct, quantity: 2, totalJpy: quoteProduct.unitJpy * 2 }]);
assert.strictEqual(shippingRequest.url, "https://japan.webike.net/api_shipping.html?wp=47.4&vl=71.2&to=KR&sc=9000&amount=13466");

const productSearchRequest = quoteCore.buildProductSearchRequest("34901KY2702");
assert.strictEqual(productSearchRequest.url, "https://www.japan-webike.kr/api-search-es.html?search=&p.k=34901KY2702&p.ref=product-search-es&smp=sp");
const productSearchLinks = quoteCore.extractProductLinksFromSearchResponse(
  searchApiFixture,
  productSearchRequest.url,
  "34901KY2702",
);
assert.deepStrictEqual(productSearchLinks, [
  {
    href: "https://www.japan-webike.kr/products/25427339.html",
    text: "HONDA OEM Motorcycle parts 밸브,헤드라이트 34901KY2702",
  },
]);

const recommendation = cartCore.recommendGroups([
  {
    index: 0,
    code: quoteProduct.code,
    name: quoteProduct.name,
    quantity: 4,
    unitJpy: quoteProduct.unitJpy,
    totalJpy: quoteProduct.unitJpy * 4,
  },
], makeSettings());
const groupProducts = quoteCore.productsFromGroup(recommendation.groups[0], [{ ...quoteProduct, quantity: 4, totalJpy: quoteProduct.unitJpy * 4 }]);
assert.strictEqual(groupProducts[0].quantity, 2);

const quoteScript = quoteCore.buildQuoteScript({
  items: [{
    partNumber: "34901KY2702",
    productUrl: "https://www.japan-webike.kr/products/25427339.html",
    quantity: 2,
    name: "Headlight <valve>",
    unitJpy: 6733,
  }],
  settings: makeSettings(),
});
assert(quoteScript.includes("www.japan-webike.kr"));
assert(quoteScript.includes("https://japan.webike.net/api_shipping.html"));
assert(quoteScript.includes('"partNumber": "34901KY2702"'));
assert(quoteScript.includes('"shippingService": "SEA"'));
assert(!quoteScript.includes("WebikeQuoteCore"));
assert(!quoteScript.includes("assets/js/webike-quote-core.js"));
assert(!quoteScript.includes("github.io/webike-cart-splitter"));
assert.doesNotThrow(() => new Function(quoteScript));

console.log("webike quote core tests passed");
