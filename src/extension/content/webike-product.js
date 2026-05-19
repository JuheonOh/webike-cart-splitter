  async function resolveProduct(item) {
    let resolvedProductUrl = item.resolvedProductUrl ? new URL(item.resolvedProductUrl, location.origin).href : "";
    if (!resolvedProductUrl) {
      if (!item.partNumber) throw reviewError("검색할 부품번호가 없습니다.");
      const searchData = await fetchJson(buildSearchApiUrl(item.partNumber));
      resolvedProductUrl = productUrlFromSearchData(searchData, item);
    }

    const html = await fetchText(resolvedProductUrl);
    const product = parseProductDetail(html, resolvedProductUrl, item);
    if (!product.productsId) throw reviewError("상품 ID 없음");
    if (product.usedProduct) throw reviewError("중고 상품은 후보에서 제외했습니다.");
    if (item.partNumber && product.partNumber && normalizePartNumber(product.partNumber) !== normalizePartNumber(item.partNumber)) {
      throw reviewError(`요청 ${item.partNumber}, 상세 ${product.partNumber} 부품번호가 다릅니다.`);
    }
    if (product.canNotAddCart || product.restrictedCountry) throw reviewError("품절/구매 불가로 추정");
    if (product.optionRequired) throw reviewError("옵션 선택이 필요한 상품입니다.");
    return product;
  }

  function productUrlFromSearchData(data, item) {
    if (data?.redirectUrl) return new URL(data.redirectUrl, location.origin).href;
    const expected = normalizePartNumber(item.partNumber);
    const candidates = collectStrings(data).flatMap(productCandidatesFromText);
    const unique = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
    if (!unique.length) throw reviewError("검색 결과 없음", []);

    const exact = unique.filter((candidate) => normalizePartNumber(candidate.name).includes(expected));
    if (exact.length === 1) return exact[0].url;
    if (unique.length === 1) return unique[0].url;
    throw reviewError("검색 결과 여러 개, 하나로 확정 불가", unique.slice(0, 8));
  }

  function parseProductDetail(html, resolvedProductUrl, item) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const productsId = firstValue(doc, ["#prod_id", "input[name='prod_id']", "[data-prdId]", "[data-prdid]"]) || jsVariable(html, "productsId") || (resolvedProductUrl.match(/\/products\/(\d+)\.html/i) || [])[1] || "";
    const partNumber = firstValue(doc, ["#product_id"]) || jsVariable(html, "productsModel") || item.partNumber || productsId;
    const name = jsVariable(html, "SYOUHIN_NAME") || doc.querySelector("h1")?.textContent || partNumber || productsId;
    return {
      lineNumber: item.lineNumber,
      rowId: item.rowId,
      partNumber: cleanText(partNumber),
      name: cleanText(name),
      productName: cleanText(name),
      resolvedProductUrl,
      productsId: cleanText(productsId),
      productId: cleanText(productsId),
      quantity: Math.max(1, Math.round(toNumber(item.quantity) || 1)),
      unitJpy: Math.round(toNumber(firstValue(doc, ["#priceYen", "input[name='priceYen']", "[data-priceRetail]"]) || jsVariable(html, "priceYen"))),
      searchUrl: item.searchUrl,
      canNotAddCart: ["1", "true", "yes", "y"].includes(cleanText(jsVariable(html, "canNotAddCart")).toLowerCase()),
      restrictedCountry: ["1", "true", "yes", "y"].includes(cleanText(jsVariable(html, "restrictedCountry")).toLowerCase()),
      optionRequired: Boolean(doc.querySelector(".option-select, [name='selectedOptions']")),
      usedProduct: isUsedProductUrl(resolvedProductUrl) && isUsedProductScope(doc),
    };
  }

  async function addToCart(item) {
    const response = await fetch(CART_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({
        products_id: item.productsId,
        cart_quantity: String(item.quantity),
      }),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!response.ok || responseLooksFailed(parsed, text)) {
      throw new Error(`${response.status} ${text.slice(0, 240)}`);
    }
  }

  function responseLooksFailed(parsed, text) {
    if (parsed && typeof parsed === "object") {
      const result = String(parsed.result || parsed.status || parsed.resultcode || "").toLowerCase();
      const message = String(parsed.message || parsed.errmsg || parsed.errsmsg || "").toLowerCase();
      return ["error", "failed", "fail", "ng"].includes(result) || message.includes("error") || message.includes("fail");
    }
    return /(?:error|failed|fail|오류|실패)/i.test(String(text || ""));
  }

  async function fetchText(url, fetchOptions) {
    const response = await fetch(url, fetchOptions || { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
  }

  async function fetchJson(url, fetchOptions) {
    const text = await fetchText(url, fetchOptions);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`JSON 응답을 파싱하지 못했습니다: ${url}`);
    }
  }

  function buildSearchApiUrl(partNumber) {
    const params = new URLSearchParams({
      search: "",
      "p.k": partNumber,
      "p.ref": "product-search-es",
      smp: "sp",
    });
    return `${SEARCH_ENDPOINT}?${params}`;
  }

  function buildSearchPageUrl(value) {
    const keyword = cleanText(value);
    const url = new URL(`/ps/${encodeURIComponent(keyword)}/`, location.origin);
    url.hash = `!search&p.k=${encodeURIComponent(keyword)}`;
    return url.href;
  }

  function jsVariable(html, name) {
    const pattern = new RegExp(`(?:var|let|const)\\s+${name}\\s*=\\s*([^;\\n]+)`, "i");
    const raw = cleanText((html.match(pattern) || [])[1] || "");
    return raw.replace(/^['"`]|['"`]$/g, "");
  }

  function firstValue(doc, selectors) {
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (!element) continue;
      const value = element.value || element.dataset.prdid || element.dataset.prdId || element.dataset.priceRetail || element.textContent;
      if (cleanText(value)) return cleanText(value);
    }
    return "";
  }

  function collectStrings(value, output = []) {
    if (typeof value === "string") {
      output.push(value);
      return output;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectStrings(item, output));
      return output;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach((item) => collectStrings(item, output));
    }
    return output;
  }

  function productUrlsFromText(text) {
    const urls = [];
    const pattern = /https?:\/\/www\.japan-webike\.kr\/products\/\d+\.html|\/products\/\d+\.html/g;
    for (const match of String(text || "").matchAll(pattern)) {
      urls.push(new URL(match[0], location.origin).href);
    }
    return urls;
  }

  function productCandidatesFromText(text) {
    const html = String(text || "");
    const htmlCandidates = productCandidatesFromHtml(html);
    if (htmlCandidates) return htmlCandidates;
    return productUrlsFromText(html)
      .filter((url) => !isUsedProductUrl(url))
      .map((url) => ({
        url,
        name: candidateName(html, url),
        displayName: candidateDisplayName(html, url),
      }));
  }

  function productCandidatesFromHtml(html) {
    if (!/<[a-z][\s\S]*>/i.test(html)) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const scopes = productCandidateScopes(doc);
    if (!scopes.length) return null;

    return scopes.flatMap((scope) => {
      if (isUsedProductScope(scope)) return [];
      return productUrlsFromScope(scope).map((url) => ({
        url,
        name: cleanText(scope.textContent) || url,
        displayName: candidateDisplayNameFromScope(scope, url),
      }));
    });
  }

  function productCandidateScopes(doc) {
    const productItems = [...doc.querySelectorAll(".product-item")];
    if (productItems.length) return productItems;
    return [...doc.querySelectorAll(".product")].filter((scope) => scope.querySelector("a[href*='/products/']"));
  }

  function productUrlsFromScope(scope) {
    const urls = [...scope.querySelectorAll("a[href*='/products/']")]
      .map((anchor) => {
        try {
          return new URL(anchor.getAttribute("href"), location.origin).href;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    return [...new Set(urls)];
  }

  function isUsedProductScope(scope) {
    return [...scope.querySelectorAll(".tag-state, .tag-used")].some((tag) => (
      tag.classList.contains("tag-used") || cleanText(tag.textContent).includes("중고")
    ));
  }

  function isUsedProductUrl(url) {
    return /\/products\/203\d{7}\.html/i.test(String(url || ""));
  }

  function candidateName(text, url) {
    return cleanText(String(text || "").replace(url, "")).slice(0, 120) || url;
  }

  function candidateDisplayName(text, url) {
    const html = String(text || "");
    const fromHtml = candidateDisplayNameFromHtml(html, url);
    if (fromHtml) return fromHtml;
    return cleanText(candidateName(html, url).replace(/<[^>]+>/g, " ")).slice(0, 120) || url;
  }

  function candidateDisplayNameFromHtml(html, url) {
    if (!/<[a-z][\s\S]*>/i.test(html)) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const target = [...doc.querySelectorAll("a[href]")].find((anchor) => hrefMatchesUrl(anchor, url));
    const scope = target?.closest(".product-item") || target?.closest(".product") || target?.parentElement || doc;
    if (isUsedProductScope(scope)) return "";
    return candidateDisplayNameFromScope(scope, url);
  }

  function candidateDisplayNameFromScope(scope, url) {
    const target = [...scope.querySelectorAll("a[href]")].find((anchor) => hrefMatchesUrl(anchor, url));
    return cleanText(
      scope.querySelector(".info-title")?.textContent ||
      target?.getAttribute("title") ||
      scope.querySelector("img[alt]")?.getAttribute("alt"),
    );
  }

  function hrefMatchesUrl(anchor, url) {
    try {
      return new URL(anchor.getAttribute("href"), location.origin).href === url;
    } catch {
      return false;
    }
  }

  function reviewError(message, candidates) {
    const error = new Error(message);
    error.candidates = candidates;
    return error;
  }
