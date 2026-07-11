(function initWebikeCartGrouping(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WebikeCartGrouping = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createWebikeCartGrouping() {
  const GROUPING_LIMITS = Object.freeze({
    maxProducts: 500,
    maxQuantityPerProduct: 1000,
    maxAtoms: 10000,
    maxGroups: 20,
    maxExactDpStates: 100000,
    maxExactDpTransitions: 2000000,
  });

  function totalProductJpy(products) {
    return products.reduce((sum, item) => sum + (Number(item?.totalJpy) || 0), 0);
  }

  function validateGroupingRequest(products, settings = {}) {
    if (!Array.isArray(products) || !products.length) {
      return { valid: false, reasonCode: "invalid_input", message: "계산할 상품이 없습니다.", atomCount: 0 };
    }
    if (products.length > GROUPING_LIMITS.maxProducts) {
      return {
        valid: false,
        reasonCode: "product_count_limit_exceeded",
        message: `상품은 최대 ${GROUPING_LIMITS.maxProducts}개까지 계산할 수 있습니다.`,
        atomCount: 0,
      };
    }

    let atomCount = 0;
    for (const [index, product] of products.entries()) {
      const quantity = Number(product?.quantity);
      const unitJpy = Number(product?.unitJpy);
      const totalJpy = Number(product?.totalJpy);
      if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitJpy) || unitJpy <= 0 ||
        !Number.isFinite(totalJpy) || totalJpy <= 0) {
        return {
          valid: false,
          reasonCode: "invalid_input",
          message: `${index + 1}번째 상품의 수량 또는 금액이 올바르지 않습니다.`,
          atomCount,
        };
      }
      if (quantity > GROUPING_LIMITS.maxQuantityPerProduct) {
        return {
          valid: false,
          reasonCode: "quantity_limit_exceeded",
          message: `상품별 수량은 최대 ${GROUPING_LIMITS.maxQuantityPerProduct}개까지 계산할 수 있습니다.`,
          atomCount,
        };
      }
      atomCount += settings.splitQuantity ? quantity : 1;
      if (atomCount > GROUPING_LIMITS.maxAtoms) {
        return {
          valid: false,
          reasonCode: "atom_count_limit_exceeded",
          message: `수량 분할 계산 단위는 최대 ${GROUPING_LIMITS.maxAtoms}개까지 만들 수 있습니다.`,
          atomCount,
        };
      }
    }

    const limitJpy = Number(settings.limitJpy);
    const maxGroups = Number(settings.maxGroups);
    if (!Number.isFinite(limitJpy) || limitJpy <= 0 || !Number.isInteger(maxGroups) || maxGroups < 1) {
      return { valid: false, reasonCode: "invalid_input", message: "면세 한도 또는 최대 주문 수가 올바르지 않습니다.", atomCount };
    }
    if (maxGroups > GROUPING_LIMITS.maxGroups) {
      return {
        valid: false,
        reasonCode: "max_groups_limit_exceeded",
        message: `최대 주문 수는 ${GROUPING_LIMITS.maxGroups}개 이하로 입력해 주세요.`,
        atomCount,
      };
    }
    return { valid: true, reasonCode: "", message: "", atomCount };
  }

  function makeAtoms(products, splitQuantity) {
    const atomCount = products.reduce((sum, product) => sum + (splitQuantity ? Number(product.quantity) : 1), 0);
    if (atomCount > GROUPING_LIMITS.maxAtoms) {
      throw new RangeError(`수량 분할 계산 단위는 최대 ${GROUPING_LIMITS.maxAtoms}개까지 만들 수 있습니다.`);
    }
    const atoms = [];
    products.forEach((product) => {
      if (splitQuantity) {
        for (let count = 0; count < product.quantity; count += 1) {
          atoms.push({
            productIndex: product.index,
            code: product.code,
            productUrl: product.productUrl || "",
            name: product.name,
            quantity: 1,
            unitJpy: product.unitJpy,
            totalJpy: product.unitJpy,
          });
        }
        return;
      }

      atoms.push({
        productIndex: product.index,
        code: product.code,
        productUrl: product.productUrl || "",
        name: product.name,
        quantity: product.quantity,
        unitJpy: product.unitJpy,
        totalJpy: product.totalJpy,
      });
    });
    return atoms;
  }

  function twoGroupDpResult(atoms, limitJpy, options = {}) {
    const total = atoms.reduce((sum, item) => sum + item.totalJpy, 0);
    const dp = new Map([[0, null]]);
    const requestedStates = Number(options?.maxStates);
    const requestedTransitions = Number(options?.maxTransitions);
    const maxStates = Number.isFinite(requestedStates) && requestedStates > 0
      ? Math.min(Math.floor(requestedStates), GROUPING_LIMITS.maxExactDpStates)
      : GROUPING_LIMITS.maxExactDpStates;
    const maxTransitions = Number.isFinite(requestedTransitions) && requestedTransitions > 0
      ? Math.min(Math.floor(requestedTransitions), GROUPING_LIMITS.maxExactDpTransitions)
      : GROUPING_LIMITS.maxExactDpTransitions;
    let transitions = 0;

    for (const [index, atom] of atoms.entries()) {
      const entries = [...dp.keys()];
      for (const sum of entries) {
        if (transitions >= maxTransitions) {
          return { groups: null, budgetExceeded: true, stateCount: dp.size, transitions };
        }
        transitions += 1;
        const next = sum + atom.totalJpy;
        if (next <= limitJpy && !dp.has(next)) {
          if (dp.size >= maxStates) {
            return { groups: null, budgetExceeded: true, stateCount: dp.size, transitions };
          }
          dp.set(next, { previous: sum, index });
        }
      }
    }

    let bestSum = null;
    dp.forEach((_, sum) => {
      const other = total - sum;
      if (other > limitJpy) return;
      if (bestSum === null || Math.abs(total / 2 - sum) < Math.abs(total / 2 - bestSum)) {
        bestSum = sum;
      }
    });

    if (bestSum === null) return { groups: null, budgetExceeded: false, stateCount: dp.size, transitions };

    const selected = new Set();
    let cursor = bestSum;
    while (cursor > 0) {
      const node = dp.get(cursor);
      selected.add(node.index);
      cursor = node.previous;
    }

    const groups = [[], []];
    atoms.forEach((atom, index) => {
      groups[selected.has(index) ? 0 : 1].push(atom);
    });
    return { groups, budgetExceeded: false, stateCount: dp.size, transitions };
  }

  function twoGroupDp(atoms, limitJpy, options = {}) {
    return twoGroupDpResult(atoms, limitJpy, options).groups;
  }

  function firstFitDecreasing(atoms, groupCount, limitJpy) {
    const groups = Array.from({ length: groupCount }, () => []);
    const sums = Array(groupCount).fill(0);
    const sorted = [...atoms].sort((a, b) => b.totalJpy - a.totalJpy);

    for (const atom of sorted) {
      let target = -1;
      let lowestSum = Infinity;
      for (let index = 0; index < groupCount; index += 1) {
        if (sums[index] + atom.totalJpy <= limitJpy && sums[index] < lowestSum) {
          target = index;
          lowestSum = sums[index];
        }
      }
      if (target === -1) return null;
      groups[target].push(atom);
      sums[target] += atom.totalJpy;
    }

    return groups.filter((group) => group.length > 0);
  }

  function recommendGroups(products, settings) {
    const validation = validateGroupingRequest(products, settings);
    const totalJpy = totalProductJpy(Array.isArray(products) ? products : []);
    if (!validation.valid) {
      return {
        totalJpy,
        groups: [],
        oversize: [],
        atoms: [],
        reasonCode: validation.reasonCode,
        message: validation.message,
        warnings: [],
      };
    }
    const atoms = makeAtoms(products, settings.splitQuantity);
    const atomTotalJpy = atoms.reduce((sum, item) => sum + item.totalJpy, 0);
    const oversize = atoms.filter((item) => item.totalJpy > settings.limitJpy);
    if (oversize.length) {
      return { totalJpy: atomTotalJpy, groups: [], oversize, atoms, reasonCode: "atom_over_limit", message: "단일 계산 단위가 면세 한도를 초과했습니다.", warnings: [] };
    }

    const minimumGroups = Math.max(1, Math.ceil(atomTotalJpy / settings.limitJpy));
    if (minimumGroups === 1) {
      return { totalJpy: atomTotalJpy, groups: [atoms], oversize: [], atoms, reasonCode: "single_group", message: "", warnings: [] };
    }
    if (minimumGroups > settings.maxGroups) {
      return { totalJpy: atomTotalJpy, groups: [], oversize: [], atoms, reasonCode: "max_groups_too_small", message: "현재 최대 주문 수로는 면세 한도 이하 그룹을 만들 수 없습니다.", warnings: [] };
    }

    const warnings = [];
    if (minimumGroups === 2) {
      const exactResult = twoGroupDpResult(atoms, settings.limitJpy, settings.exactSearchOptions);
      if (exactResult.groups) {
        return { totalJpy: atomTotalJpy, groups: exactResult.groups, oversize: [], atoms, reasonCode: "grouped", message: "", warnings };
      }
      if (exactResult.budgetExceeded) warnings.push("exact_search_budget_exceeded");
    }

    for (let count = minimumGroups; count <= settings.maxGroups; count += 1) {
      const groups = firstFitDecreasing(atoms, count, settings.limitJpy);
      if (groups) {
        return { totalJpy: atomTotalJpy, groups, oversize: [], atoms, reasonCode: "grouped", message: "", warnings };
      }
    }

    return { totalJpy: atomTotalJpy, groups: [], oversize: [], atoms, reasonCode: "grouping_not_found", message: "지정한 최대 주문 수 안에서 그룹을 찾지 못했습니다.", warnings };
  }

  function aggregateGroup(group) {
    const map = new Map();
    group.forEach((atom) => {
      const key = `${atom.productIndex}:${atom.code}`;
      const current = map.get(key) || {
        code: atom.code,
        productUrl: atom.productUrl || "",
        name: atom.name,
        quantity: 0,
        unitJpy: atom.unitJpy,
        subtotalJpy: 0,
      };
      if (!current.productUrl && atom.productUrl) current.productUrl = atom.productUrl;
      current.quantity += atom.quantity;
      current.subtotalJpy += atom.totalJpy;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.subtotalJpy - a.subtotalJpy);
  }

  return {
    GROUPING_LIMITS,
    validateGroupingRequest,
    makeAtoms,
    twoGroupDp,
    twoGroupDpResult,
    firstFitDecreasing,
    recommendGroups,
    aggregateGroup,
  };
});
