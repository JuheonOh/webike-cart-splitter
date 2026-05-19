const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const parserSource = fs.readFileSync(path.join(projectRoot, "src", "extension", "content", "input-parser.js"), "utf8");

const sandbox = {
  module: { exports: {} },
};

vm.runInNewContext(`
  function cleanText(value) {
    return String(value == null ? "" : value).replace(/\\s+/g, " ").trim();
  }

  function toNumber(value) {
    return Number(String(value == null ? "" : value).replace(/,/g, "").trim()) || 0;
  }

  function normalizePartNumber(value) {
    return cleanText(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  function buildSearchPageUrl(value) {
    const keyword = cleanText(value);
    return \`https://www.japan-webike.kr/ps/\${encodeURIComponent(keyword)}/#!search&p.k=\${encodeURIComponent(keyword)}\`;
  }

  ${parserSource}

  module.exports = {
    parseInputRows,
    quantityFromCell,
    isNumericCell,
  };
`, sandbox);

const { parseInputRows, quantityFromCell, isNumericCell } = sandbox.module.exports;

{
  const result = parseInputRows([
    "부품번호,수량,상품명",
    "13225ML0405,2,앞바퀴베어링",
    "13011MV4305,,",
  ].join("\n"));

  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.rows.length, 2);
  assert.strictEqual(result.rows[0].partNumber, "13225ML0405");
  assert.strictEqual(result.rows[0].quantity, 2);
  assert.strictEqual(result.rows[0].inputName, "앞바퀴베어링");
  assert.strictEqual(result.rows[0].resolvedProductUrl, "");
  assert.strictEqual(result.rows[0].searchUrl, "https://www.japan-webike.kr/ps/13225ML0405/#!search&p.k=13225ML0405");
  assert.strictEqual(result.rows[1].quantity, 1);
}

{
  const result = parseInputRows([
    "품번,수량,부품명",
    "91302MB0013,1,O-Ring",
    "91311MCE900,1,",
  ].join("\n"));

  assert.strictEqual(result.rows[0].partNumber, "91302MB0013");
  assert.strictEqual(result.rows[0].inputName, "O-Ring");
  assert.strictEqual(result.rows[1].partNumber, "91311MCE900");
}

{
  const result = parseInputRows([
    "34901KY2702\tValve，Headlight 34901KY2702\t1",
    "35121MBW601\tKey, Blank 35121MBW601\t2",
  ].join("\n"));

  assert.strictEqual(result.errors.length, 0);
  assert.deepStrictEqual([...result.rows.map((row) => row.partNumber)], ["34901KY2702", "35121MBW601"]);
  assert.deepStrictEqual([...result.rows.map((row) => row.quantity)], [1, 2]);
  assert.deepStrictEqual([...result.rows.map((row) => row.inputName)], ["Valve，Headlight 34901KY2702", "Key, Blank 35121MBW601"]);
}

{
  const result = parseInputRows([
    "부품번호,수량,상품명",
    "13011MV4305,1,",
    "13011-MV4-305,2,중복",
    ",1,부품번호없음",
  ].join("\n"));

  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].partNumber, "13011MV4305");
  assert.strictEqual(result.rows[0].quantity, 3);
  assert(result.errors.includes("13011MV4305 중복 부품은 수량을 합산했습니다."));
  assert(result.errors.includes("4행: 부품번호가 없습니다."));
}

assert.strictEqual(quantityFromCell(""), 1);
assert.strictEqual(quantityFromCell("2.4"), 2);
assert.strictEqual(isNumericCell("1,200"), true);
assert.strictEqual(isNumericCell("파일럿스크류"), false);

console.log("extension input parser tests passed");
