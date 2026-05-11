(function initWebikeCartGrouping(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WebikeCartGrouping = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createWebikeCartGrouping() {
  function makeAtoms(products, splitQuantity) {
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

  function twoGroupDp(atoms, limitJpy) {
    const total = atoms.reduce((sum, item) => sum + item.totalJpy, 0);
    const dp = new Map([[0, null]]);

    atoms.forEach((atom, index) => {
      const entries = [...dp.keys()];
      entries.forEach((sum) => {
        const next = sum + atom.totalJpy;
        if (next <= limitJpy && !dp.has(next)) {
          dp.set(next, { previous: sum, index });
        }
      });
    });

    let bestSum = null;
    dp.forEach((_, sum) => {
      const other = total - sum;
      if (other > limitJpy) return;
      if (bestSum === null || Math.abs(total / 2 - sum) < Math.abs(total / 2 - bestSum)) {
        bestSum = sum;
      }
    });

    if (bestSum === null) return null;

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
    return groups;
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
    const atoms = makeAtoms(products, settings.splitQuantity);
    const totalJpy = atoms.reduce((sum, item) => sum + item.totalJpy, 0);
    const oversize = atoms.filter((item) => item.totalJpy > settings.limitJpy);
    if (oversize.length) {
      return { totalJpy, groups: [], oversize, atoms };
    }

    const minimumGroups = Math.max(1, Math.ceil(totalJpy / settings.limitJpy));
    if (minimumGroups === 1) {
      return { totalJpy, groups: [atoms], oversize: [], atoms };
    }

    if (minimumGroups === 2) {
      const exactTwoGroups = twoGroupDp(atoms, settings.limitJpy);
      if (exactTwoGroups) {
        return { totalJpy, groups: exactTwoGroups, oversize: [], atoms };
      }
    }

    for (let count = minimumGroups; count <= settings.maxGroups; count += 1) {
      const groups = firstFitDecreasing(atoms, count, settings.limitJpy);
      if (groups) {
        return { totalJpy, groups, oversize: [], atoms };
      }
    }

    return { totalJpy, groups: [], oversize: [], atoms };
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
    makeAtoms,
    twoGroupDp,
    firstFitDecreasing,
    recommendGroups,
    aggregateGroup,
  };
});
