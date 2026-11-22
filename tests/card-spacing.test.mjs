import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";

const require = createRequire(join(resolve(process.env.PW_DIR || process.cwd()), "noop.js"));
const { chromium } = require("playwright");
const gallery = new URL("../examples/card-gallery.html", import.meta.url);
const probe = readFileSync(new URL("../skills/gridlines/probe.js", import.meta.url), "utf8");
const rules = (gap) => [
  { selector: ".gallery", row: gap },
  { selector: ".cards", row: gap, column: gap },
];
const measure = (page, options) => page.evaluate((opts) => window.__gridlines(opts), options);
const gapsFrom = (reports, container) => reports.find((r) => r.container === container).spacing.gaps;

test("opt-in checks for rendered card gaps", async (t) => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(gallery.href);
  await page.addScriptTag({ content: probe });

  await t.test("keeps the default alignment report", async () => {
    const reports = await measure(page, { draw: false });
    assert.ok(reports.length);
    assert.ok(reports.every((r) => !("spacing" in r)));
  });

  await t.test("reports a margin added to the CSS gap", async () => {
    const reports = await measure(page, { spacing: rules(20) });
    assert.deepEqual(gapsFrom(reports, "Card gallery"), [
      { axis: "row", px: 32, expected: 20, from: "First group [1]", to: "Second group [2]", miss: true },
    ]);
    const first = gapsFrom(reports, "First group");
    assert.deepEqual(first.map((g) => [g.axis, g.px, g.miss]), [
      ["row", 20, false], ["row", 20, false], ["column", 20, false], ["column", 20, false],
    ]);
    assert.equal(await page.locator('[data-gridline][aria-hidden="true"]').count(), 1);
  });

  await t.test("accepts the expected mobile gap with no horizontal neighbors", async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    const reports = await measure(page, { draw: false, spacing: rules(10) });
    const gaps = reports.flatMap((r) => r.spacing?.gaps || []);
    assert.equal(gaps.length, 5);
    assert.ok(gaps.every((g) => g.axis === "row" && g.px === 10 && !g.miss));
    assert.equal(await page.locator("[data-gridline]").count(), 0);
  });

  await t.test("checks columns independently of rows", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const reports = await measure(page, { draw: false, spacing: [{ selector: ".cards", column: 18 }] });
    const first = gapsFrom(reports, "First group");
    assert.deepEqual(first.map((g) => [g.axis, g.px, g.expected, g.miss]), [
      ["column", 20, 18, true], ["column", 20, 18, true],
    ]);
  });

  await t.test("measures both neighbors under a spanning card", async () => {
    await page.setContent(`
      <div aria-label="Spanning" style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
        <div style="grid-column:span 2; height:40px">Top</div>
        <div style="height:40px" aria-label="Left">Left</div>
        <div style="height:40px; margin-top:8px" aria-label="Right">Right</div>
        <div style="position:absolute; height:40px">Overlay</div>
      </div>`);
    await page.addScriptTag({ content: probe });
    const reports = await measure(page, { draw: false, spacing: [{ selector: '[aria-label="Spanning"]', row: 12 }] });
    assert.deepEqual(gapsFrom(reports, "Spanning").map(({ to, px, miss }) => [to, px, miss]), [
      ["Left [2]", 12, false], ["Right [3]", 20, true],
    ]);
  });
});
