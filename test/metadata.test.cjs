const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepareMetadata } = require("../src/metadata-tools.js");
const { sourceMetadata, collectDelta, csv } = require("../src/inventory.js");
const origin = "https://onedrive.live.com",
  base = "/personal/abc123/_api/v2.0/drive";
const row = {
  id: "one",
  parentId: "ROOT",
  name: "example.bin",
  path: "/example.bin",
  size: 3,
  type: "file",
};
const report = { terminalReached: true, issues: [], items: [row] };
const meta = {
  id: "one",
  name: "example.bin",
  size: 3,
  parentReference: { id: "ROOT" },
  createdDateTime: "2020-01-01T00:00:00Z",
  lastModifiedDateTime: "2020-01-02T00:00:00Z",
  fileSystemInfo: {
    createdDateTime: "2003-06-07T08:09:10Z",
    lastModifiedDateTime: "2001-02-03T04:05:06.1234567Z",
  },
  file: { hashes: { sha256Hash: "a".repeat(64), sha1Hash: "b".repeat(40) } },
};
const run = (data = meta, extra = {}) =>
  prepareMetadata({
    origin,
    base,
    report,
    request: async () => ({ status: 200, data }),
    ...extra,
  });
test("filesystem dates take precedence while absent facets fall back explicitly", () => {
  const x = sourceMetadata(meta);
  assert.equal(x.fileCreated, meta.fileSystemInfo.createdDateTime);
  assert.equal(x.fileModified, meta.fileSystemInfo.lastModifiedDateTime);
  assert.equal(x.createdSource, "fileSystemInfo");
  assert.equal(x.sha256, "a".repeat(64));
  const fallback = sourceMetadata({ ...meta, fileSystemInfo: undefined });
  assert.equal(fallback.fileCreated, meta.createdDateTime);
  assert.equal(fallback.modifiedSource, "driveItem");
});
test("repair export refreshes metadata and drops credentials, identities, URLs and raw fields", async () => {
  const r = await run({
    ...meta,
    "@content.downloadUrl": "SECRET_SENTINEL",
    createdBy: { email: "SECRET_SENTINEL" },
    extra: "SECRET_SENTINEL",
  });
  assert.equal(r.metadataRefresh.status, "complete");
  assert.equal(
    r.items[0].fileModified,
    meta.fileSystemInfo.lastModifiedDateTime,
  );
  assert.equal(r.items[0].repairError, null);
  assert.ok(!JSON.stringify(r).includes("SECRET_SENTINEL"));
  assert.equal(report.items[0].sha256, undefined);
});
test("changed file identity, missing cryptographic hashes and incomplete scans are rejected", async () => {
  for (const changed of [
    { name: "renamed" },
    { parentReference: { id: "OTHER" } },
    { size: 4 },
    { id: "OTHER" },
    { remoteItem: { id: "other" } },
  ]) {
    const r = await run({ ...meta, ...changed });
    assert.equal(r.items[0].repairError, "remote_changed_rescan");
  }
  const r = await run({
    ...meta,
    file: { hashes: { quickXorHash: "not-a-cryptographic-identity" } },
  });
  assert.equal(r.items[0].repairError, "cryptographic_hash_missing");
  await assert.rejects(
    run(meta, { report: { ...report, terminalReached: false } }),
    /finish_inventory_first/,
  );
  await assert.rejects(
    run(meta, { base: "https://example.com/" }),
    /invalid_api_base/,
  );
});
test("metadata budgets, cancellation, retries and source failures remain explicit", async () => {
  const c = new AbortController();
  c.abort();
  const r = await run(meta, { signal: c.signal });
  assert.equal(r.metadataRefresh.status, "partial");
  assert.equal(r.items[0].repairError, "cancelled");
  assert.equal(r.metadataRefresh.requests, 0);
  const rows = [row, { ...row, id: "two" }];
  const b = await run(meta, {
    report: { ...report, items: rows },
    maxRequests: 1,
  });
  assert.equal(b.items[1].repairError, "request_limit");
  let n = 0;
  const retry = await run(meta, {
    request: async () =>
      ++n === 1
        ? { status: 429, retryAfterMs: 0 }
        : { status: 200, data: meta },
  });
  assert.equal(retry.metadataRefresh.requests, 2);
  assert.equal(retry.metadataRefresh.status, "complete");
  const e = await run(meta, {
    request: async () => {
      throw Error("PRIVATE_REQUEST_URL");
    },
  });
  assert.equal(e.items[0].repairError, "metadata_request_failed");
  assert.ok(!JSON.stringify(e).includes("PRIVATE_REQUEST_URL"));
});
test("inventory and CSV retain filesystem dates, hashes and service dates separately", async () => {
  const r = await collectDelta({
    origin,
    base,
    request: async (url) =>
      url.includes("/root?")
        ? { status: 200, data: { id: "ROOT" } }
        : {
            status: 200,
            data: { value: [meta], "@odata.deltaLink": "private-continuation" },
          },
  });
  assert.equal(r.version, 3);
  assert.equal(r.items[0].created, meta.createdDateTime);
  assert.equal(r.items[0].fileCreated, meta.fileSystemInfo.createdDateTime);
  assert.equal(r.items[0].sha1, "b".repeat(40));
  assert.ok(csv(r).includes("fileCreated"));
  assert.ok(!JSON.stringify(r).includes("private-continuation"));
});
