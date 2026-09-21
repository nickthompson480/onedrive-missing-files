const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
test("portable launcher copies the complete source, with no external script dependencies", () => {
  execFileSync(process.execPath, [path.join(root, "scripts/build.cjs")]);
  const folder = path.join(root, "dist/onedrive-missing-files");
  const code = fs.readFileSync(path.join(folder, "onedrive-tool.js"), "utf8");
  const html = fs.readFileSync(path.join(folder, "Start here.html"), "utf8");
  const textarea = html
    .match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1]
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  assert.equal(textarea, code);
  assert.ok(code.includes("samplePlan"));
  assert.ok(code.includes("Export date repair JSON"));
  assert.ok(html.includes("Test 3 small files"));
  assert.doesNotMatch(html, /<script[^>]+src\s*=/i);
  for (const file of [
    "README.md",
    "LICENSE",
    "docs/behavior.md",
    "repair-dates.py",
    "docs/date-repair.md",
  ])
    assert.ok(fs.statSync(path.join(folder, file)).size > 0);
  execFileSync(process.execPath, [
    "--check",
    path.join(folder, "onedrive-tool.js"),
  ]);
});
