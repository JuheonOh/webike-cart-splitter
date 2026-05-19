  function parseInputRows(text) {
    const rawRows = parseDelimitedRows(text);
    const errors = [];
    if (!rawRows.length) return { rows: [], errors: ["상품 목록을 입력해 주세요."] };

    const headers = rawRows[0].map(normalizeHeader);
    const hasHeader = headers.some((header) => (
      ["partnumber", "partno", "품번", "상품번호", "부품번호", "파츠번호"].includes(header)
    ));
    const columns = {
      partNumber: findColumn(headers, ["partnumber", "partno", "품번", "상품번호", "부품번호", "파츠번호", "sku", "code"], hasHeader ? -1 : 0),
      quantity: findColumn(headers, ["quantity", "qty", "수량", "count"], hasHeader ? -1 : 1),
      name: findColumn(headers, ["name", "productname", "상품명", "제품명", "부품명", "파츠명", "파트명"], hasHeader ? -1 : 2),
    };

    const rows = [];
    rawRows.slice(hasHeader ? 1 : 0).forEach((row, index) => {
      const lineNumber = index + (hasHeader ? 2 : 1);
      const partNumber = columns.partNumber >= 0 ? cleanText(row[columns.partNumber]) : "";
      if (!partNumber) {
        errors.push(`${lineNumber}행: 부품번호가 없습니다.`);
        return;
      }
      let quantityCell = columns.quantity >= 0 ? row[columns.quantity] : "";
      let inputName = columns.name >= 0 ? cleanText(row[columns.name]) : "";
      if (!hasHeader && columns.quantity >= 0 && columns.name >= 0 && !isNumericCell(quantityCell) && isNumericCell(row[columns.name])) {
        inputName = cleanText(quantityCell);
        quantityCell = row[columns.name];
      } else if (!inputName && columns.quantity >= 0 && !isNumericCell(quantityCell)) {
        inputName = cleanText(quantityCell);
      }
      const quantity = quantityFromCell(quantityCell);
      rows.push({
        rowId: String(lineNumber),
        lineNumber,
        partNumber,
        resolvedProductUrl: "",
        quantity,
        name: inputName,
        inputName,
        searchUrl: buildSearchPageUrl(partNumber),
      });
    });

    return { rows: mergeDuplicateRows(rows, errors), errors };
  }

  function mergeDuplicateRows(rows, errors) {
    const merged = [];
    const seen = new Map();
    const warned = new Set();
    rows.forEach((row) => {
      const key = duplicateRowKey(row);
      if (!key || !seen.has(key)) {
        if (key) seen.set(key, row);
        merged.push(row);
        return;
      }

      const target = seen.get(key);
      target.quantity = Math.max(1, toNumber(target.quantity)) + Math.max(1, toNumber(row.quantity));
      target.inputName = target.inputName || row.inputName;
      target.name = target.name || row.name;

      if (!warned.has(key)) {
        const label = target.partNumber || `${target.lineNumber}행`;
        errors.push(`${label} 중복 부품은 수량을 합산했습니다.`);
        warned.add(key);
      }
    });
    return merged;
  }

  function duplicateRowKey(row) {
    const partNumber = normalizePartNumber(row.partNumber);
    return partNumber || "";
  }

  function parseDelimitedRows(text) {
    const value = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!value) return [];
    const delimiter = value.includes("\t") ? "\t" : ",";
    return value.split("\n")
      .map((line) => parseDelimitedLine(line, delimiter))
      .filter((row) => row.some((cell) => cleanText(cell)));
  }

  function parseDelimitedLine(line, delimiter) {
    if (delimiter === "\t") return line.split("\t").map((cell) => cleanText(cell));
    const cells = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cells.push(cleanText(current));
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(cleanText(current));
    return cells;
  }

  function normalizeHeader(value) {
    return cleanText(value).toLowerCase().replace(/[\s_()[\]/-]/g, "");
  }

  function findColumn(headers, names, fallback) {
    const index = headers.findIndex((header) => names.includes(header));
    return index >= 0 ? index : fallback;
  }

  function quantityFromCell(value) {
    return Math.max(1, Math.round(toNumber(value) || 1));
  }

  function isNumericCell(value) {
    const text = cleanText(value).replace(/,/g, "");
    return text !== "" && /^-?\d+(?:\.\d+)?$/.test(text);
  }
