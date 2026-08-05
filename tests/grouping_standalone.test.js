const assert = require("assert");

const grouping = require("../assets/js/calculator-grouping.js");

function makeProducts() {
  return [
    { index: 0, code: "A", name: "A", quantity: 2, unitJpy: 7000, totalJpy: 14000 },
    { index: 1, code: "B", name: "B", quantity: 1, unitJpy: 9000, totalJpy: 9000 },
    { index: 2, code: "C", name: "C", quantity: 1, unitJpy: 5000, totalJpy: 5000 },
  ];
}

const standalone = new Function(`return ${grouping.standaloneApiExpression()};`)();
const scenarios = [
  { limitJpy: 15000, maxGroups: 4, splitQuantity: true },
  { limitJpy: 15000, maxGroups: 4, splitQuantity: false },
  { limitJpy: 8000, maxGroups: 4, splitQuantity: true },
  {
    limitJpy: 15000,
    maxGroups: 4,
    splitQuantity: true,
    exactSearchOptions: { maxStates: 1, maxTransitions: 1 },
  },
];

for (const settings of scenarios) {
  assert.deepStrictEqual(
    standalone.recommendGroups(makeProducts(), settings),
    grouping.recommendGroups(makeProducts(), settings),
  );
}

assert.deepStrictEqual(standalone.GROUPING_LIMITS, grouping.GROUPING_LIMITS);
assert.strictEqual(typeof standalone.standaloneApiExpression, "function");

console.log("grouping standalone tests passed");
