const { test } = require("node:test");
const assert = require("node:assert/strict");
const { collectIssues, bytes, advice } = require("../src/activity-ui.js");
test("issues combine all sources with only display fields", () => {
  const rows = collectIssues({
    inventory: {
      issues: [{ path: "/a", code: "duplicate_path", secret: "hidden" }],
    },
    plan: {
      items: [
        { path: "/b", status: "existing_size_mismatch", localSize: 4, size: 5 },
        { path: "/ok", status: "present" },
      ],
    },
    result: { issues: [{ path: "/c", code: "cancelled" }] },
    metadata: {
      items: [
        { path: "/d", repairError: "source_dates_missing" },
        { path: "/ok", repairError: null },
      ],
    },
  });
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((x) => x.source),
    ["Inventory", "Disk", "Download", "Date repair"],
  );
  assert.equal(rows[1].localSize, 4);
  assert.doesNotMatch(JSON.stringify(rows), /hidden|secret/);
  assert.match(advice(rows[1].code), /preserved/);
  assert.equal(bytes(1024), "1.0 KiB");
  assert.equal(bytes(undefined), "Unknown size");
});
