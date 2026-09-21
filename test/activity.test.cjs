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

test("diagnostics explain different causes, sanitize fields and distinguish recovery destination", () => {
  const { category } = require("../src/activity-ui.js");
  assert.equal(category("empty_local_file"), "Empty local files");
  assert.equal(category("existing_size_mismatch"), "Different local files");
  assert.match(advice("browser_restricted_file_type"), /Chrome\/Edge rejected/);
  assert.match(advice("empty_local_file"), /origin is unknown/);
  assert.match(
    advice("NotFoundError", "open_write_stream"),
    /not a OneDrive HTTP 404/,
  );
  assert.match(advice("TypeError", "request_download"), /network transfer/);
  assert.match(
    advice("NotFoundError", "create_local_folder"),
    /No individual folder selection is required/,
  );
  assert.match(advice("cancelled", undefined, "ZIP export"), /Completed ZIPs/);
  const rows = collectIssues({
    result: {
      folder: "Recovery",
      issues: [
        {
          path: "/a",
          code: "NotFoundError",
          operation: "open_write_stream",
          message: "secret",
          url: "signed-link",
          bytes: 0,
        },
      ],
    },
  });
  assert.equal(rows[0].operation, "open_write_stream");
  assert.equal(rows[0].folder, "Recovery");
  assert.doesNotMatch(JSON.stringify(rows), /secret|signed-link|message/);
});
