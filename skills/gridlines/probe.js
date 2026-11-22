// Injected into a page. Measures the ink edges of every text run, icon and
// boxed control inside each container, groups them into rows, and draws the
// dominant edges as dashed guides. Red: lead line and label line (solid), box
// line (faint), icon-column centre (fainter). Blue: trailing line. Amber: the
// trailing column's centre line.
//
//   window.__gridlines({ draw: true, containers: 'css, selectors' })
//
// Returns one entry per container: its dominant lines, every row's edges and
// vertical-centre spread, and the outliers that miss a line by 2px or more.
window.__gridlines = function (opts = {}) {
  const draw = opts.draw !== false;
  const TOL = 1;
  document.querySelectorAll("[data-gridline]").forEach((n) => n.remove());

  const containerSelector =
    opts.containers ||
    [
      "aside",
      "nav",
      "header",
      "section",
      "article",
      '[role="dialog"]',
      '[role="menu"]',
      '[role="listbox"]',
      '[data-slot="dialog-content"]',
      '[data-slot="sheet-content"]',
      '[data-slot="popover-content"]',
      '[data-slot="dropdown-menu-content"]',
      '[data-slot="card"]',
    ].join(", ");

  const clear = (c) => !c || /rgba\(0, 0, 0, 0\)|transparent/.test(c);
  const shown = (el) => {
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0;
  };
  const skip = (el) =>
    el.closest('.sr-only, [data-gridline], canvas');

  // An <svg>'s box is its viewBox, and glyphs sit at different insets inside
  // it. The ink is the drawn shape's bounds plus half its stroke.
  const ink = (el) => {
    const r = el.getBoundingClientRect();
    if (el.tagName.toLowerCase() !== "svg") return r;
    try {
      const b = el.getBBox();
      const m = el.getScreenCTM();
      if (!m || !b.width || !b.height) return r;
      const stroked = el.querySelector("[stroke-width]") || el;
      const cs = getComputedStyle(stroked);
      const half = cs.stroke === "none" ? 0 : (parseFloat(cs.strokeWidth) || 0) / 2;
      const x0 = m.a * (b.x - half) + m.e;
      const x1 = m.a * (b.x + b.width + half) + m.e;
      const y0 = m.d * (b.y - half) + m.f;
      const y1 = m.d * (b.y + b.height + half) + m.f;
      return new DOMRect(x0, y0, x1 - x0, y1 - y0);
    } catch {
      return r;
    }
  };

  // A box is anything a reader sees as a shape: fill, full border or shadow.
  // Tabs and their indicator are text, not boxes, even when they carry a fill.
  const isBox = (el) => {
    if (el.matches('[role="tab"], [role="tablist"], [data-slot="tabs-indicator"]')) return false;
    if (/^(TR|TD|TH|TBODY|THEAD|TABLE)$/.test(el.tagName)) return false;
    const cs = getComputedStyle(el);
    const fill = !clear(cs.backgroundColor);
    const border = ["Left", "Right", "Top", "Bottom"].every(
      (s) => parseFloat(cs[`border${s}Width`]) > 0 && !clear(cs[`border${s}Color`]),
    );
    const shadow = cs.boxShadow && cs.boxShadow !== "none";
    return fill || border || shadow;
  };

  // Outermost small box between an element and its container.
  const boxOf = (el, container, cr) => {
    let box = null;
    for (let a = el; a && a !== container; a = a.parentElement) {
      const r = a.getBoundingClientRect();
      if (r.width < cr.width - 4 && r.height <= 64 && isBox(a)) box = a;
    }
    return box;
  };

  const nameOf = (el) =>
    el.getAttribute("aria-label") ||
    el.querySelector("h1, h2, h3, [role='heading']")?.textContent.trim().slice(0, 30) ||
    el.dataset.slot ||
    el.tagName.toLowerCase();

  const spacingTargets = new Map();
  if (opts.spacing !== undefined && !Array.isArray(opts.spacing))
    throw new TypeError("spacing must be an array of rules");
  for (const { selector, row, column } of opts.spacing || []) {
    const expected = Object.fromEntries(
      Object.entries({ row, column }).filter(([, px]) => px !== undefined),
    );
    const values = Object.values(expected);
    if (typeof selector !== "string" || !selector.trim() ||
        !values.length || values.some((px) => !Number.isFinite(px) || px < 0))
      throw new TypeError("Each spacing rule needs a selector and at least one non-negative gap in px");
    for (const container of document.querySelectorAll(selector)) {
      spacingTargets.set(container, { ...spacingTargets.get(container), ...expected });
    }
  }

  const measureSpacing = (container, expected) => {
    const items = [...container.children].flatMap((el, index) => {
      const r = el.getBoundingClientRect();
      const { position } = getComputedStyle(el);
      if (!r.width || !r.height || skip(el) || !shown(el) ||
          position === "absolute" || position === "fixed") return [];
      return [{ r, name: `${nameOf(el)} [${index + 1}]` }];
    });
    const gaps = [];
    for (const [axis, target] of Object.entries(expected)) {
      const [start, end, crossStart, crossEnd] = axis === "row"
        ? ["top", "bottom", "left", "right"]
        : ["left", "right", "top", "bottom"];
      const ordered = [...items].sort((a, b) => a.r[start] - b.r[start]);
      for (const { r: from, name } of ordered) {
        // A spanning item can have several neighbors, one per unobstructed part of its edge.
        let open = [[from[crossStart], from[crossEnd]]];
        for (const { r: to, name: neighbor } of ordered) {
          if (to[start] - from[start] <= TOL) continue;
          const first = to[crossStart], last = to[crossEnd];
          const overlap = open.find(([a, b]) => Math.min(b, last) - Math.max(a, first) > TOL);
          if (!overlap) continue;
          open = open.flatMap(([a, b]) => b <= first || a >= last
            ? [[a, b]]
            : [[a, first], [last, b]].filter(([l, r]) => r - l > TOL),
          );

          const px = +(to[start] - from[end]).toFixed(2);
          const miss = Math.abs(px - target) > TOL;
          gaps.push({ axis, px, expected: target, from: name, to: neighbor, miss });
          if (draw && miss) {
            const cross = (Math.min(overlap[1], last) + Math.max(overlap[0], first)) / 2;
            const mark = document.createElement("div");
            mark.dataset.gridline = "";
            mark.setAttribute("aria-hidden", "true");
            Object.assign(mark.style, {
              position: "fixed",
              [start]: `${Math.min(from[end], to[start])}px`,
              [crossStart]: `${cross}px`,
              [axis === "row" ? "height" : "width"]: `${Math.max(2, Math.abs(px))}px`,
              [axis === "row" ? "borderLeft" : "borderTop"]: "2px dashed #d946ef",
              zIndex: 2147483646,
              pointerEvents: "none",
            });
            document.body.appendChild(mark);
          }
          if (!open.length) break;
        }
      }
    }
    return { expected, gaps };
  };

  const containers = [...new Set(document.querySelectorAll(containerSelector))].filter((c) => {
    const r = c.getBoundingClientRect();
    return r.width > 120 && r.height > 24 && shown(c);
  });

  const out = [];
  for (const c of new Set([...containers, ...spacingTargets.keys()])) {
    const cr = c.getBoundingClientRect();
    if (!cr.width || !cr.height || !shown(c)) continue;
    const items = [];
    const seenBoxes = new Set();

    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const text = n.textContent.trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || skip(el) || !shown(el)) continue;
      const box = boxOf(el, c, cr);
      if (box) {
        if (!seenBoxes.has(box)) {
          seenBoxes.add(box);
          items.push({ r: box.getBoundingClientRect(), kind: "box", t: `[${text.slice(0, 18)}]` });
        }
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects())
        if (r.width > 1) items.push({ r, kind: "text", t: text.slice(0, 18) });
    }

    c.querySelectorAll("svg, img, input, [role='checkbox'], [role='switch']").forEach((el) => {
      if (skip(el) || !shown(el) || el.parentElement?.closest("svg")) return;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.width > 64 || r.height > 64) return;
      const box = boxOf(el.parentElement, c, cr);
      if (box) {
        if (!seenBoxes.has(box)) {
          seenBoxes.add(box);
          items.push({ r: box.getBoundingClientRect(), kind: "box", t: "[icon]" });
        }
        return;
      }
      items.push({ r: ink(el), kind: "icon", t: `<${el.tagName.toLowerCase()}>` });
    });

    const inside = items.filter(
      (i) =>
        i.r.height > 0 &&
        i.r.left >= cr.left - 1 &&
        i.r.right <= cr.right + 1 &&
        i.r.top >= cr.top - 1 &&
        i.r.bottom <= cr.bottom + 1,
    );

    const rows = [];
    for (const i of inside.sort((a, b) => a.r.top + a.r.bottom - (b.r.top + b.r.bottom))) {
      const cy = (i.r.top + i.r.bottom) / 2;
      let row = rows.find((r) => Math.abs(r.cy - cy) < 6);
      if (!row) rows.push((row = { cy, items: [] }));
      row.items.push(i);
    }

    const rowEdges = rows.map((row) => {
      const L = row.items.reduce((a, b) => (a.r.left <= b.r.left ? a : b));
      const R = row.items.reduce((a, b) => (a.r.right >= b.r.right ? a : b));
      const centres = row.items.map((i) => (i.r.top + i.r.bottom) / 2);
      const label = L.kind === "icon" ? row.items.filter((i) => i.kind === "text" && i.r.left > L.r.right).sort((a, b) => a.r.left - b.r.left)[0] : undefined;
      return {
        y: Math.round(row.cy - cr.top),
        left: Math.round(L.r.left - cr.left),
        leftKind: L.kind,
        lt: L.t,
        iconCentre: L.kind === "icon" ? Math.round((L.r.left + L.r.right) / 2 - cr.left) : undefined,
        label: label ? Math.round(label.r.left - cr.left) : undefined,
        labelText: label?.t,
        right: Math.round(cr.right - R.r.right),
        rightKind: R.kind,
        rt: R.t,
        trailCentre: Math.round(cr.right - (R.r.left + R.r.right) / 2),
        centreSpread: +(Math.max(...centres) - Math.min(...centres)).toFixed(1),
      };
    });

    const dominant = (key, filter = () => true) => {
      const h = {};
      rowEdges.filter((e) => e[key] !== undefined && filter(e)).forEach((e) => (h[e[key]] = (h[e[key]] || 0) + 1));
      return Object.entries(h)
        .sort((a, b) => b[1] - a[1])
        .map(([v, count]) => ({ px: +v, count }));
    };

    // Ragged-right text is not a trailing item. Only rows whose last item ends
    // in the trailing quarter of the container take part in the trailing line.
    const reachesTrailing = (e) => e.right < cr.width / 4;
    const near = (v, line) => line !== undefined && Math.abs(v - line) <= TOL;
    // Any single item has a centre, so a centre is only a line once two rows
    // sit on it. Otherwise a lone off-line item would excuse itself.
    const sharedCentre = (key, filter) => {
      const px = dominant(key, filter)[0]?.px;
      const rowsOnIt = rowEdges.filter((e) => (!filter || filter(e)) && near(e[key], px)).length;
      return rowsOnIt >= 2 ? px : undefined;
    };
    const lines = {
      lead: dominant("left", (e) => e.leftKind !== "box")[0]?.px,
      iconCentre: sharedCentre("iconCentre"),
      label: dominant("label")[0]?.px,
      box: dominant("left", (e) => e.leftKind === "box")[0]?.px,
      trailing: dominant("right", reachesTrailing)[0]?.px,
      trailCentre: sharedCentre("trailCentre", reachesTrailing),
    };

    const outliers = rowEdges.flatMap((e) => {
      const miss = [];
      const leadLine = e.leftKind === "box" ? lines.box : lines.lead;
      const onALine =
        [lines.lead, lines.box, lines.label].some((l) => near(e.left, l)) || near(e.iconCentre, lines.iconCentre);
      if (leadLine !== undefined && !onALine)
        miss.push({ y: e.y, edge: "leading", px: e.left, line: leadLine, item: e.lt });
      if (e.label !== undefined && !near(e.label, lines.label))
        miss.push({ y: e.y, edge: "label", px: e.label, line: lines.label, item: e.labelText });
      if (e.iconCentre !== undefined && lines.iconCentre !== undefined && !near(e.iconCentre, lines.iconCentre))
        miss.push({ y: e.y, edge: "icon-column", px: e.iconCentre, line: lines.iconCentre, item: e.lt });
      if (reachesTrailing(e) && !near(e.right, lines.trailing) && !near(e.trailCentre, lines.trailCentre))
        miss.push({ y: e.y, edge: "trailing", px: e.right, line: lines.trailing, item: e.rt });
      if (e.centreSpread > 1)
        miss.push({ y: e.y, edge: "vertical-centre", px: e.centreSpread, line: 0, item: `${e.lt} … ${e.rt}` });
      return miss;
    });

    const report = { container: nameOf(c), x: Math.round(cr.left), w: Math.round(cr.width), lines, outliers, rows: rowEdges };
    if (spacingTargets.has(c)) report.spacing = measureSpacing(c, spacingTargets.get(c));
    out.push(report);

    if (draw) {
      const guide = (x, colour) => {
        const d = document.createElement("div");
        d.dataset.gridline = "";
        Object.assign(d.style, {
          position: "fixed",
          left: `${x}px`,
          top: `${cr.top}px`,
          height: `${cr.height}px`,
          width: "0",
          borderLeft: `1px dashed ${colour}`,
          zIndex: 2147483646,
          pointerEvents: "none",
        });
        document.body.appendChild(d);
      };
      if (lines.lead !== undefined) guide(cr.left + lines.lead, "rgba(255,90,90,0.95)");
      if (lines.box !== undefined && lines.box !== lines.lead) guide(cr.left + lines.box, "rgba(255,90,90,0.5)");
      if (lines.iconCentre !== undefined) guide(cr.left + lines.iconCentre, "rgba(255,90,90,0.35)");
      if (lines.label !== undefined) guide(cr.left + lines.label, "rgba(255,90,90,0.95)");
      if (lines.trailing !== undefined) guide(cr.right - lines.trailing, "rgba(90,200,255,0.95)");
      if (lines.trailCentre !== undefined) guide(cr.right - lines.trailCentre, "rgba(255,190,60,0.6)");
    }
  }
  return out;
};
