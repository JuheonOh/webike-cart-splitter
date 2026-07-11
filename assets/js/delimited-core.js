(function initWebikeDelimitedCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WebikeDelimitedCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createWebikeDelimitedCore() {
  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function parseDelimitedLine(line, delimiter) {
    if (delimiter === "\t") return String(line).split("\t").map((cell) => cell.trim());

    const cells = [];
    let current = "";
    let quoted = false;
    const value = String(line ?? "");
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      const next = value[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function parseDelimitedRows(text) {
    const value = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!value) return [];
    const delimiter = value.includes("\t") ? "\t" : ",";
    return value.split("\n")
      .map((line) => parseDelimitedLine(line, delimiter))
      .filter((row) => row.some((cell) => cleanText(cell)));
  }

  function normalizeHeader(value) {
    return cleanText(value).toLowerCase().replace(/[\s_()\/-]/g, "");
  }

  function findColumn(headers, names, fallback = -1) {
    const index = headers.findIndex((header) => names.includes(header));
    return index >= 0 ? index : fallback;
  }

  return {
    cleanText,
    parseDelimitedLine,
    parseDelimitedRows,
    normalizeHeader,
    findColumn,
  };
});
