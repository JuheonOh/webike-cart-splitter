const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const cartCore = require("../assets/js/calculator-core.js");
const grouping = require("../assets/js/calculator-grouping.js");
const delimited = require("../assets/js/delimited-core.js");
const quoteCore = require("../assets/js/quote-result-core.js");
const cartScriptCore = require("../assets/js/cart-script-core.js");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "webike_quote_wizard.html"), "utf8");
const wizardSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const calculatorSource = fs.readFileSync(path.join(root, "assets/js/cart-group-calculator.js"), "utf8")
  .replace(/\s*applyStoredSettingsToForm\(\);[\s\S]*$/, "");
const settings = { limitUsd: 150, usdKrw: 1500, jpyKrw: 10, limitJpy: 22500, maxGroups: 8, shippingService: "STD", importDutyRate: 0.08, vatRate: 0.1 };

function element(value = "") {
  const children = new Map();
  const attributes = new Map();
  return {
    value: String(value), textContent: "", style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(name, next) { attributes.set(name, next); },
    getAttribute(name) { return attributes.get(name); },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener() {}, appendChild() {}, remove() {},
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
  };
}

function response(text, ok = true) {
  return { ok, status: ok ? 200 : 500, text: async () => text, json: async () => JSON.parse(text) };
}

async function wizardRuntime() {
  const nodes = new Map(Object.entries(settings).map(([key, value]) => [`#${key}`, element(value)]));
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll: () => [], createElement: () => element(), body: { appendChild() {} },
  };
  const context = vm.createContext({
    document, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, console,
    fetch: async () => response(fs.readFileSync(path.join(root, "data/exchange-rates.json"), "utf8")),
    window: {
      WebikeCartCore: cartCore, WebikeCartGrouping: grouping, WebikeDelimitedCore: delimited,
      WebikeQuoteResultCore: quoteCore, WebikeCostComparisonCore: require("../assets/js/cost-comparison-core.js"),
      WebikeCartScriptCore: cartScriptCore,
      location: { href: "http://localhost/webike_quote_wizard.html", hash: "" },
      history: { pushState() {}, replaceState() {} }, addEventListener() {},
    },
  });
  vm.runInContext(wizardSource, context);
  await vm.runInContext("wizardExchangeRateLoadPromise", context);
  for (const [key, value] of Object.entries(settings)) document.querySelector(`#${key}`).value = String(value);
  return context;
}

const calculator = new Function("window", "document", `${calculatorSource}; return { buildWebikeCartScript };`)(
  { WebikeCartCore: cartCore, WebikeCartScriptCore: cartScriptCore }, { querySelector: () => null },
);

const item = { code: "TEST-001", partNumber: "TEST-001", productId: "100", productUrl: "https://www.japan-webike.kr/products/100.html", name: "Test item", quantity: 2, unitJpy: 1000 };

function detail(product = item, flags = "var canNotAddCart=`false`; var restrictedCountry=`false`;") {
  return `<input id="prod_id" value="${product.productId}"><input id="product_id" value="${product.code}"><input id="priceYen" value="${product.unitJpy}"><script>var productWeight='1'; var productVolume='1'; ${flags}</script>`;
}

class MockDOMParser {
  parseFromString(source) {
    return {
      querySelector(selector) {
        if (!selector.startsWith("#")) return null;
        const match = source.match(new RegExp(`<input id="${selector.slice(1)}" value="([^"]*)">`));
        return match ? { value: match[1], dataset: {} } : null;
      },
    };
  }
}

function generatedContext(fetch) {
  const results = [];
  const errors = [];
  const context = vm.createContext({
    fetch, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, DOMParser: MockDOMParser,
    location: { origin: "https://www.japan-webike.kr", href: "" }, window: {}, navigator: {},
    document: { createElement: () => element(), body: { appendChild() {} } },
    console: { log(...args) { if (args[0] === "Webike 견적 결과:") results.push(args[1]); }, warn() {}, error(...args) { errors.push(args); } },
  });
  return { context, results, errors };
}

async function testCartScripts(wizard) {
  const builders = [
    (items) => calculator.buildWebikeCartScript(items),
    (items) => { wizard.testItems = items; return vm.runInContext("buildAddCartScript(testItems)", wizard); },
  ];
  // GET view's status/productArray and sku/quantity follow Webike's public template-api.min.js.
  // https://img.webike-cdn.net/jp_statics/webike_template/desktop/scripts/template-api.min.js
  // Empty productArray:null was observed read-only; nonempty rows and opaque POST bodies below are synthetic.
  for (const build of builders) {
    for (const scenario of ["success", "success-empty", "login", "empty", "unknown-json", "lost-response-confirmed", "lost-response-confirmed-empty", "lost-response-unconfirmed", "network-no-commit", "rejected", "before-view-failed"]) {
      const initialQuantity = scenario.endsWith("-empty") ? 0 : 3;
      let quantity = initialQuantity;
      let posts = 0;
      let views = 0;
      const runtime = generatedContext(async (url, options = {}) => {
        if (String(url).includes("/products/")) return response(detail());
        if (options.method === "POST") {
          posts += 1;
          if (scenario === "rejected" && posts === 1) return response("Product not found");
          if (scenario === "login") return response("<html><h1>로그인해 주세요</h1></html>");
          if (scenario === "empty") return response("");
          if (scenario === "unknown-json") return response("{}");
          if (scenario !== "network-no-commit") quantity += Number(options.body.get("cart_quantity"));
          if (scenario.startsWith("lost-response") || scenario === "network-no-commit") throw new TypeError("network lost");
          return response("opaque Webike response");
        }
        views += 1;
        assert.strictEqual(options.cache, "no-store", "verify inventory without a cached snapshot");
        if ((scenario === "lost-response-unconfirmed" && views > 1) || (scenario === "before-view-failed" && views === 1)) return response("login page");
        return response(JSON.stringify({ status: "OK", productArray: quantity ? [{ sku: "100", quantity }] : null }));
      });
      await vm.runInContext(build([item]), runtime.context);
      if (["success", "success-empty", "lost-response-confirmed", "lost-response-confirmed-empty"].includes(scenario)) {
        assert.strictEqual(quantity, initialQuantity + 2, scenario);
        assert.strictEqual(posts, 1, scenario);
        assert.strictEqual(runtime.context.location.href, "/shopping_cart.html", scenario);
        assert.strictEqual(runtime.context.window.__webikeCartSplitterRetry, undefined, scenario);
      } else if (["rejected", "before-view-failed"].includes(scenario)) {
        assert.strictEqual(quantity, 3, scenario);
        assert.strictEqual(typeof runtime.context.window.__webikeCartSplitterRetry, "function", scenario);
        await runtime.context.window.__webikeCartSplitterRetry();
        assert.strictEqual(quantity, 5, scenario);
        assert.strictEqual(posts, scenario === "rejected" ? 2 : 1, scenario);
      } else {
        assert.strictEqual(runtime.context.location.href, "", scenario);
        assert.strictEqual(runtime.context.window.__webikeCartSplitterRetry, undefined, scenario);
        assert.strictEqual(posts, 1, scenario);
        assert.ok(runtime.errors.some((args) => args.some((arg) => arg?.uncertain)), scenario);
      }
    }

    let posts = 0;
    const runtime = generatedContext(async (url, options = {}) => {
      if (String(url).includes("/products/")) return response(detail(String(url).includes("101.html") ? { ...item, productId: "101" } : item));
      if (options.method === "POST") { posts += 1; return response("login"); }
      return response(JSON.stringify({ status: "OK", productArray: null }));
    });
    await vm.runInContext(build([item, { ...item, productId: "101", productUrl: "https://www.japan-webike.kr/products/101.html" }]), runtime.context);
    assert.strictEqual(posts, 1, "stop remaining mutations after an uncertain result");

    for (const malformed of [false, true, [3]]) {
      for (const stage of ["before", "after"]) {
        let malformedPosts = 0;
        let reads = 0;
        const malformedRuntime = generatedContext(async (url, options = {}) => {
          if (String(url).includes("/products/")) return response(detail());
          if (options.method === "POST") { malformedPosts += 1; return response("opaque Webike response"); }
          reads += 1;
          const quantity = stage === "before" || reads > 1 ? malformed : 0;
          return response(JSON.stringify({ status: "OK", productArray: [{ sku: "100", quantity }] }));
        });
        await vm.runInContext(build([item]), malformedRuntime.context);
        assert.strictEqual(malformedPosts, stage === "before" ? 0 : 1, `malformed ${stage} inventory: ${JSON.stringify(malformed)}`);
        assert.strictEqual(malformedRuntime.context.location.href, "", "malformed inventory cannot confirm success");
        if (stage === "after") assert.strictEqual(malformedRuntime.context.window.__webikeCartSplitterRetry, undefined, "malformed readback cannot safely retry");
      }
    }
    let invalidIdPosts = 0;
    const invalidIdRuntime = generatedContext(async (url, options = {}) => {
      if (String(url).includes("/products/")) return response(detail());
      if (options.method === "POST") invalidIdPosts += 1;
      return response(JSON.stringify({ status: "OK", productArray: [{ sku: [100], quantity: 0 }] }));
    });
    await vm.runInContext(build([item]), invalidIdRuntime.context);
    assert.strictEqual(invalidIdPosts, 0, "an array SKU cannot authorize a cart mutation");
  }

  for (const flag of ["var canNotAddCart=true;", "var restrictedCountry=`true`;", "var canNotAddCart='1';"]) {
    let posts = 0;
    const runtime = generatedContext(async (url, options = {}) => {
      if (options.method === "POST") posts += 1;
      return response(detail(item, flag));
    });
    await vm.runInContext(calculator.buildWebikeCartScript([item]), runtime.context);
    assert.strictEqual(posts, 0, `blocked product flag: ${flag}`);
  }
}

async function testQuoteScript(wizard) {
  wizard.testRows = [{ ...item, partNumber: item.code }];
  vm.runInContext("state.inputRows = testRows", wizard);
  const script = vm.runInContext("buildQuoteScript()", wizard);
  for (const cost of [undefined, "", "unknown", -1, Infinity, [0], false, 0, "1,200"]) {
    const runtime = generatedContext(async (url) => String(url).includes("api_shipping")
      ? response(JSON.stringify({ response: { status: "OK", results: [{ service_code: "STD", cost }] } }))
      : response(detail()));
    if (cost === 0 || cost === "1,200") {
      await vm.runInContext(script, runtime.context);
      assert.strictEqual(runtime.results[0].measurement.singleShipment.shippingJpy, cost === 0 ? 0 : 1200);
    } else {
      await assert.rejects(vm.runInContext(script, runtime.context), /배송비 금액/);
      assert.strictEqual(runtime.results.length, 0);
    }
  }

  wizard.testRows = [{ ...item, partNumber: item.code, unitJpy: 15000 }];
  vm.runInContext("state.inputRows = testRows", wizard);
  const splitScript = vm.runInContext("buildQuoteScript()", wizard);
  const runtime = generatedContext(async (url) => String(url).includes("api_shipping")
    ? response(JSON.stringify({ response: { status: "OK", results: [{ service_code: "STD", cost: 1200 }] } }))
    : response(detail({ ...item, unitJpy: 15000 })));
  await vm.runInContext(splitScript, runtime.context);
  const result = runtime.results[0];
  assert.strictEqual(result.measurement.strategies.split_quantity.splitShipments.length, 2);
  assert.strictEqual(result.measurement.strategies.row_unit.splitShipments.length, 0);
  wizard.testResult = JSON.parse(JSON.stringify(result));
  const comparison = vm.runInContext("compareWizardStrategies(testResult.measurement, getSettings())", wizard);
  assert.deepStrictEqual(Array.from(comparison.strategies, (strategy) => strategy.code), ["single_order", "split_quantity", "row_unit"]);
  assert.ok(comparison.strategies[0].available && comparison.strategies[1].available);
  assert.strictEqual(comparison.strategies[2].available, false);
  assert.strictEqual(comparison.cheapestCode, "split_quantity");

  wizard.testRows = [
    { ...item, partNumber: item.code, quantity: 1, unitJpy: 15000 },
    { ...item, code: "TEST-002", partNumber: "TEST-002", productId: "101", productUrl: "https://www.japan-webike.kr/products/101.html", quantity: 1, unitJpy: 15000 },
  ];
  vm.runInContext("state.inputRows = testRows", wizard);
  const allStrategies = generatedContext(async (url) => String(url).includes("api_shipping")
    ? response(JSON.stringify({ response: { status: "OK", results: [{ service_code: "STD", cost: 1200 }] } }))
    : response(detail(String(url).includes("101.html") ? wizard.testRows[1] : wizard.testRows[0])));
  await vm.runInContext(vm.runInContext("buildQuoteScript()", wizard), allStrategies.context);
  const measured = allStrategies.results[0];
  assert.ok(quoteCore.validateQuoteResult(measured, { expectedInputRows: wizard.testRows, expectedSettings: settings }).valid);
  wizard.testResult = JSON.parse(JSON.stringify(measured));
  const allComparison = vm.runInContext("compareWizardStrategies(testResult.measurement, getSettings())", wizard);
  assert.ok(allComparison.strategies.every((strategy) => strategy.available), "all three real generated strategies are compared");
  assert.ok(allComparison.strategies[0].totals.taxKrw > 0);
  assert.strictEqual(allComparison.strategies[1].totals.taxKrw, 0);
  assert.strictEqual(allComparison.strategies[2].totals.taxKrw, 0);
}

async function main() {
  const wizard = await wizardRuntime();
  for (const invalidItem of [
    { productsId: "100", quantity: false }, { productsId: "100", quantity: true },
    { productsId: "100", quantity: [3] }, { productsId: [100], quantity: 1 },
  ]) {
    let requests = 0;
    const runtime = generatedContext(async () => { requests += 1; throw new Error("unexpected request"); });
    runtime.context.invalidItem = invalidItem;
    await assert.rejects(vm.runInContext(`(${cartScriptCore.standaloneApiExpression()}).add(invalidItem)`, runtime.context), /올바르지/);
    assert.strictEqual(requests, 0, "invalid item scalars must fail before any request");
  }
  wizard.document.querySelector("#maxGroups").value = "1.5";
  assert.ok(vm.runInContext("validateWizardSettings(getSettings()).length > 0", wizard));
  wizard.document.querySelector("#maxGroups").value = "8";
  for (const quantity of [0, -1, 1.5]) {
    assert.throws(() => calculator.buildWebikeCartScript([item, { ...item, quantity }]), /정수/);
  }
  for (const value of ["0", "-1", "0.5", "1.5", "NaN", "Infinity"]) {
    wizard.testText = `TEST-001,${value},Test,1000,`;
    assert.ok(vm.runInContext("parseInputRows(testText).errors.length > 0", wizard), value);
  }
  wizard.testText = "sku,qty,item_name,price,product_link\nTEST-001,2,Test,1000,https://www.japan-webike.kr/products/100.html";
  assert.strictEqual(vm.runInContext("parseInputRows(testText).errors.length", wizard), 0);
  assert.strictEqual(vm.runInContext("parseInputRows(testText).rows[0].partNumber", wizard), "TEST-001");
  assert.strictEqual(vm.runInContext("parseInputRows(testText).rows[0].quantity", wizard), 2);
  for (const testText of ["part_number\nTEST-001", "product_url\nhttps://www.japan-webike.kr/products/100.html"]) {
    wizard.testText = testText;
    assert.strictEqual(vm.runInContext("parseInputRows(testText).errors.length", wizard), 0);
    assert.strictEqual(vm.runInContext("parseInputRows(testText).rows.length", wizard), 1);
    assert.strictEqual(vm.runInContext("parseInputRows(testText).rows[0].quantity", wizard), 1);
    assert.strictEqual(vm.runInContext("parseInputRows(testText).rows[0].unitJpy", wizard), 0);
  }
  assert.strictEqual(vm.runInContext('parseInputRows("ABC").rows[0].partNumber', wizard), "ABC");
  assert.ok(vm.runInContext('parseInputRows("part_number,quantity\\n\\\"unclosed,2").errors.length > 0', wizard));
  await testCartScripts(wizard);
  await testQuoteScript(wizard);
  console.log("generated_scripts tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
