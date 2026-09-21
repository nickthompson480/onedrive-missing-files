const { test } = require("node:test");
const assert = require("node:assert/strict");
const { collect, csv } = require("../src/inventory.js");
const origin = "https://onedrive.live.com";
const base = "/personal/abc123/_api/v2.0/drive";
const folder = (id, name, childCount) => ({ id, name, folder: { childCount } });
const file = (id, name, size = 5) => ({ id, name, file: {}, size });
const run = (handler, extra = {}) =>
  collect({
    origin,
    base,
    request: async (url) => handler(new URL(url)),
    ...extra,
  });
const ok = (value, more = {}) => ({ status: 200, data: { value, ...more } });
test("traverses nested and empty folders, follows pages and sums files only", async () => {
  const r = await run(
    () => {
      throw Error("unused");
    },
    {
      request: async (url) => {
        const u = new URL(url);
        if (u.search === "?page=2") return ok([file("r", "root.txt", 3)]);
        if (u.pathname.endsWith("/root/children"))
          return ok([folder("a", "A", 2), folder("b", "Empty", 0)], {
            "@odata.nextLink": base + "/root/children?page=2",
          });
        if (u.pathname.endsWith("/a/children"))
          return ok([file("f", 'quote".txt'), file("g", "ユニコード.txt", 7)]);
        return ok([]);
      },
    },
  );
  assert.equal(r.status, "ordinary_tree_enumerated");
  assert.equal(r.items.length, 5);
  assert.equal(r.counts.folder, 2);
  assert.equal(r.fileBytes, 15);
  assert.equal(r.foldersScanned, 3);
  assert.equal(r.items.find((x) => x.id === "b").coverage, "scanned");
  assert.match(csv(r), /quote""\.txt/);
});
test("denied folder remains represented while siblings complete", async () => {
  const r = await run((u) =>
    u.pathname.endsWith("/root/children")
      ? ok([folder("a", "Denied", 1), folder("b", "Other", 0)])
      : u.pathname.includes("/a/")
        ? { status: 403 }
        : ok([]),
  );
  assert.equal(r.status, "partial");
  assert.equal(r.items[0].coverage, "incomplete");
  assert.equal(r.items[1].coverage, "scanned");
  assert.equal(r.issues[0].code, "http_403");
});
test("rejects external and cross-folder next links before requesting them", async () => {
  for (const next of [
    "https://evil.example/stolen",
    base + "/items/other/children",
  ]) {
    const r = await run(() => ok([], { "@odata.nextLink": next }));
    assert.equal(r.requests, 1);
    assert.equal(r.issues[0].code, "unsafe_next_link");
  }
});
test("pagination cycles and repeated IDs cannot hang or duplicate rows", async () => {
  const r = await run((u) =>
    ok([file("f", "File")], { "@odata.nextLink": u.href }),
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.issues[0].code, "pagination_loop");
  const d = await run(() => ok([file("f", "File"), file("f", "File")]));
  assert.equal(d.items.length, 1);
  assert.equal(d.status, "partial");
});
test("records count mismatch and never treats shortcuts as ordinary folders", async () => {
  const r = await run((u) =>
    u.pathname.endsWith("/root/children")
      ? ok([
          folder("a", "A", 2),
          { ...folder("s", "Link", 1), remoteItem: { id: "secret" } },
          { id: "p", name: "Book", package: {}, folder: {} },
          {
            id: "v",
            name: "Vault",
            specialFolder: { name: "vault" },
            folder: {},
          },
        ])
      : ok([file("f", "File")]),
  );
  assert.equal(r.items.length, 5);
  assert.equal(r.status, "partial");
  assert.equal(r.requests, 2);
  assert.ok(r.issues.some((x) => x.code === "child_count_mismatch"));
  assert.equal(JSON.stringify(r).includes("secret"), false);
});
test("budgets and cancellation produce partial results", async () => {
  const r = await run(() => ok([file("a", "A"), file("b", "B")]), {
    limits: { maxItems: 1 },
  });
  assert.equal(r.items.length, 1);
  assert.equal(r.issues[0].code, "item_limit");
  const c = new AbortController();
  c.abort();
  const stopped = await run(
    () => {
      throw Error("should not request");
    },
    { signal: c.signal },
  );
  assert.equal(stopped.issues[0].code, "cancelled");
  const bounded = await run(() => ok([folder("a", "A", 0)]), {
    limits: { maxRequests: 1 },
  });
  assert.equal(bounded.issues[0].code, "request_limit");
});
test("retries bounded throttling and does not leak server errors or unknown fields", async () => {
  let n = 0;
  const r = await run(() =>
    ++n === 1
      ? { status: 429, retryAfterMs: 0 }
      : ok([
          {
            ...file("a", "A"),
            access_token: "DO_NOT_EXPORT",
            "@microsoft.graph.downloadUrl": "DO_NOT_EXPORT",
          },
        ]),
  );
  assert.equal(r.requests, 2);
  assert.equal(r.status, "ordinary_tree_enumerated");
  assert.equal(JSON.stringify(r).includes("DO_NOT_EXPORT"), false);
  const failure = await run(() => {
    throw Error("DO_NOT_EXPORT");
  });
  assert.equal(failure.issues[0].code, "request_failed");
  assert.equal(JSON.stringify(failure).includes("DO_NOT_EXPORT"), false);
});
test("CSV neutralizes formula cells and preserves commas, newlines and quotes", () => {
  const out = csv({
    items: [
      { path: '/a,"b\nc', type: "file", id: "=formula", coverage: "listed" },
    ],
  });
  assert.ok(out.includes('"/a,""b\nc"'));
  assert.ok(out.includes('"\'=formula"'));
});
test("rejects malformed responses and invalid bases", async () => {
  const r = await run(() => ({ status: 200, data: { unexpected: [] } }));
  assert.equal(r.issues[0].code, "invalid_response");
  await assert.rejects(
    run(() => ok([]), { base: "https://evil.example/drive" }),
    /invalid_api_base/,
  );
});
const { collectDelta } = require("../src/inventory.js");
const delta = (pages, extra = {}) =>
  collectDelta({
    origin,
    base,
    request: async (u) => {
      const x = new URL(u);
      if (x.pathname.endsWith("/root"))
        return { status: 200, data: { id: "ROOT" } };
      return { status: 200, data: pages.shift() };
    },
    ...extra,
  });
const entry = (x, parentId = "ROOT") => ({
  ...x,
  parentReference: { id: parentId },
});
test("delta builds paths from out-of-order pages and applies updates/deletions", async () => {
  const r = await delta([
    {
      value: [entry(file("f", "old.txt"), "a"), entry(file("gone", "Gone"))],
      "@odata.nextLink": base + "/root/view.delta?page=2",
    },
    {
      value: [
        entry(folder("a", "A", 1)),
        entry(file("f", "New.txt"), "a"),
        { id: "gone", deleted: {} },
      ],
      "@odata.deltaLink": "not exported",
    },
  ]);
  assert.equal(r.status, "ordinary_tree_enumerated");
  assert.equal(r.terminalReached, true);
  assert.deepEqual(
    r.items.map((x) => x.path),
    ["/A", "/A/New.txt"],
  );
  assert.equal(r.items[0].coverage, "scanned");
  assert.equal(JSON.stringify(r).includes("not exported"), false);
});
test("delta retains missing parents, cycles and count discrepancies as errors", async () => {
  const r = await delta([
    {
      value: [
        entry(file("o", "Orphan"), "missing"),
        entry(folder("a", "A", 7), "b"),
        entry(folder("b", "B", 1), "a"),
      ],
      "@odata.deltaLink": "end",
    },
  ]);
  assert.equal(r.status, "partial");
  assert.ok(r.issues.some((x) => x.code === "missing_parent"));
  assert.ok(r.issues.some((x) => x.code === "parent_cycle"));
});
test("delta requires terminal marker, blocks external pages, and preserves partial data", async () => {
  const r = await delta([{ value: [entry(file("f", "File"))] }]);
  assert.equal(r.terminalReached, false);
  assert.equal(r.items.length, 1);
  const b = await delta([
    { value: [], "@odata.nextLink": "https://evil.example/" },
  ]);
  assert.equal(b.issues[0].code, "unsafe_next_link");
});
test("folder traversal accepts observed OData quoted pagination only for same folder", async () => {
  const r = await run((u) =>
    u.pathname.endsWith("/root/children")
      ? ok([folder("a", "A", 2)])
      : u.pathname.includes("items(")
        ? ok([file("two", "Two")])
        : ok([file("one", "One")], {
            "@odata.nextLink": base + "/items(%27a%27)/children?page=2",
          }),
  );
  assert.equal(r.status, "ordinary_tree_enumerated");
  assert.equal(r.items.length, 3);
});
test("delta resumes an interrupted page without losing entries or exporting continuation secrets", async () => {
  const page = {
    value: [entry(file("a", "A")), entry(file("b", "B"))],
    "@odata.deltaLink": "private-token",
  };
  const first = await delta([page], { limits: { maxItems: 1 } });
  assert.equal(first.items.length, 1);
  assert.ok(first.checkpoint);
  assert.equal(JSON.stringify(first).includes("private-token"), false);
  assert.equal(JSON.stringify(first).includes("checkpoint"), false);
  const second = await delta([], { resume: first.checkpoint });
  assert.equal(second.status, "ordinary_tree_enumerated");
  assert.equal(second.items.length, 2);
});
