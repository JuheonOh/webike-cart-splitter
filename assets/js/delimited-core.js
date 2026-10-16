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
      } else if (char === '"' && (quoted || !current.trim())) {
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
    let delimiter = ",";
    let quoted = false;
    let cellStart = true;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === '"' && (quoted || cellStart)) {
        if (quoted && value[index + 1] === '"') {
          index += 1;
          continue;
        }
        quoted = !quoted;
      }
      if (!quoted && char === "\t") {
        delimiter = "\t";
        break;
      }
      if (!quoted && char === "\n") break;
      if (!quoted && char === ",") cellStart = true;
      else if (char.trim()) cellStart = false;
    }
    const records = [];
    let record = "";
    quoted = false;
    cellStart = true;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === '"' && (quoted || cellStart)) {
        if (quoted && value[index + 1] === '"') {
          record += '""';
          index += 1;
          continue;
        }
        quoted = !quoted;
        cellStart = false;
      }
      if (!quoted && char === "\n") {
        records.push(record);
        record = "";
        cellStart = true;
      } else {
        record += char;
        if (!quoted && char === delimiter) cellStart = true;
        else if (char.trim()) cellStart = false;
      }
    }
    if (quoted) throw new Error("CSV/TSV의 따옴표가 닫히지 않았습니다.");
    records.push(record);
    return records
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
