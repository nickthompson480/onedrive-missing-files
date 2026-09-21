const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parts,
  checkDisk,
  populate,
  samplePlan,
} = require("../src/disk-tools.js");
const error = (n) => Object.assign(Error(n), { name: n });
class Directory {
  constructor(name = "target") {
    this.name = name;
    this.entries = new Map();
    this.creates = 0;
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.entries.has(name)) {
      if (!create) throw error("NotFoundError");
      this.entries.set(name, new Directory(name));
      this.creates++;
    }
    const x = this.entries.get(name);
    if (!(x instanceof Directory)) throw error("TypeMismatchError");
    return x;
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.entries.has(name)) {
      if (!create) throw error("NotFoundError");
      this.entries.set(name, new File(name));
      this.creates++;
    }
    const x = this.entries.get(name);
    if (!(x instanceof File)) throw error("TypeMismatchError");
    return x;
  }
}
class File {
  constructor(name, data = "") {
    this.name = name;
    this.data = new TextEncoder().encode(data);
    this.writes = 0;
  }
  async getFile() {
    return { size: this.data.length };
  }
  async createWritable() {
    let chunks = [];
    this.writes++;
    return {
      write: async (b) => chunks.push(b),
      close: async () => {
        this.data = Buffer.concat(chunks);
      },
      abort: async () => {
        chunks = [];
      },
    };
  }
}
const row = (id, path, type = "file", size = 3) => ({
  id,
  path,
  type,
  size,
  name: path.split("/").at(-1),
  parentId: "ROOT",
  modified: "2026-01-01",
});
const report = (items) => ({
  started: "2026",
  terminalReached: true,
  issues: [],
  items,
});
const response = (text) => ({
  body: new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  }),
});
test("Windows names, traversal, ADS and reserved names are rejected", () => {
  for (const p of [
    "/../x",
    "//server/a",
    "/CON.txt",
    "/COM¹.txt",
    "/a:b",
    "/a\\b",
    "/x.",
    "/x ",
    "/a//b",
  ])
    assert.throws(() => parts(p));
  assert.deepEqual(parts("/A/normal.txt"), ["A", "normal.txt"]);
});
test("disk check is read-only and preserves existing size conflicts", async () => {
  const root = new Directory();
  const a = new File("A", "other");
  root.entries.set("A", a);
  const p = await checkDisk({
    report: report([row("a", "/A"), row("b", "/Missing")]),
    root,
  });
  assert.equal(p.items[0].status, "existing_size_mismatch");
  assert.equal(p.items[1].status, "missing");
  assert.equal(root.creates, 0);
  assert.equal(a.writes, 0);
});
test("case collisions block both paths and descendants", async () => {
  const p = await checkDisk({
    report: report([
      row("a", "/Dir", "folder"),
      row("b", "/dir", "folder"),
      row("c", "/Dir/file"),
    ]),
    root: new Directory(),
  });
  assert.ok(p.items.every((x) => x.status === "conflict"));
});
test("successful copy creates parents and skips already present paths", async () => {
  const root = new Directory(),
    old = new File("old", "old");
  root.entries.set("old", old);
  const p = await checkDisk({
    report: report([
      row("a", "/New", "folder", 0),
      row("b", "/New/file"),
      row("c", "/old"),
    ]),
    root,
  });
  const result = await populate({
    plan: p,
    root,
    fetchFile: async () => response("abc"),
  });
  assert.equal(result.downloaded, 1);
  assert.equal(result.bytes, 3);
  assert.equal(old.writes, 0);
  const recheck = await checkDisk({
    report: report([row("b", "/New/file"), row("c", "/old")]),
    root,
  });
  assert.ok(recheck.items.every((x) => x.status === "present"));
});
test("files appearing after check or during network request are not overwritten", async () => {
  for (const during of [false, true]) {
    const root = new Directory();
    const p = await checkDisk({ report: report([row("a", "/A")]), root });
    const file = new File("A", "keep");
    if (!during) root.entries.set("A", file);
    const r = await populate({
      plan: p,
      root,
      fetchFile: async () => {
        root.entries.set("A", file);
        return response("abc");
      },
    });
    assert.equal(file.writes, 0);
    assert.equal(r.downloaded, 0);
    assert.equal(r.skipped, 1);
  }
});
test("truncated downloads abort and remain explicit failures", async () => {
  const root = new Directory();
  const p = await checkDisk({ report: report([row("a", "/A")]), root });
  const r = await populate({
    plan: p,
    root,
    fetchFile: async () => response("a"),
  });
  assert.equal(r.status, "partial");
  assert.equal(r.issues[0].code, "download_size_mismatch");
  assert.equal((await root.entries.get("A").getFile()).size, 0);
});
test("budgets, cancellation and incomplete inventory stop safely", async () => {
  const root = new Directory();
  const p = await checkDisk({ report: report([row("a", "/A")]), root });
  const r = await populate({
    plan: p,
    root,
    maxBytes: 2,
    fetchFile: async () => {
      throw Error("must not fetch");
    },
  });
  assert.equal(r.issues[0].code, "download_budget");
  assert.equal(root.creates, 0);
  const c = new AbortController();
  c.abort();
  const cancelled = await populate({
    plan: p,
    root,
    signal: c.signal,
    fetchFile: async () => response("abc"),
  });
  assert.equal(cancelled.issues[0].code, "cancelled");
  await assert.rejects(
    checkDisk({ report: { items: [], terminalReached: false }, root }),
    /finish_inventory_first/,
  );
});
test("directory/file conflicts and denied reads never become missing", async () => {
  const root = new Directory();
  root.entries.set("A", new Directory("A"));
  root.entries.set("Denied", {
    getFile: async () => {
      throw error("NotAllowedError");
    },
  });
  const r = await checkDisk({
    report: report([row("a", "/A"), row("d", "/Denied")]),
    root,
  });
  assert.ok(r.items.every((x) => x.status === "conflict"));
  assert.equal(root.creates, 0);
});

test("sample downloads select at most three small missing files without changing the full plan", () => {
  const items = [
    row("dir", "/Dir", "folder", 0),
    row("big", "/Big", "file", 2 * 1024 ** 2),
    row("old", "/Old", "file", 20000),
    ...Array.from({ length: 5 }, (_, i) =>
      row(String(i), "/File" + i, "file", 20000 + i),
    ),
  ].map((x) => ({ ...x, status: x.id === "old" ? "present" : "missing" }));
  const plan = {
    status: "checked",
    items,
    missingBytes: 9999999,
    counts: { missing: 7 },
  };
  const sample = samplePlan(plan);
  assert.equal(sample.items.length, 3);
  assert.ok(
    sample.items.every(
      (x) => x.type === "file" && x.size < 1024 ** 2 && x.status === "missing",
    ),
  );
  assert.equal(sample.scope, "small_file_test");
  assert.equal(plan.items.length, 8);
  assert.equal(plan.missingBytes, 9999999);
});
test("permission-denied file reads remain conflicts", async () => {
  const root = new Directory();
  const denied = new File("Denied");
  denied.getFile = async () => {
    throw error("NotAllowedError");
  };
  root.entries.set("Denied", denied);
  const plan = await checkDisk({ report: report([row("d", "/Denied")]), root });
  assert.equal(plan.items[0].status, "conflict");
  assert.equal(plan.items[0].reason, "NotAllowedError");
  assert.equal(root.creates, 0);
});

test("browser controls bound sample downloads and prevent closing during writes", async () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const path = require("node:path");
  const nodes = [];
  const element = (tag) => {
    const node = {
      tag,
      textContent: "",
      disabled: false,
      style: {},
      dataset: {},
      children: [],
      append(child) {
        this.children.push(child);
      },
      setAttribute() {},
    };
    nodes.push(node);
    return node;
  };
  const scan = element("button");
  scan.textContent = "Scan OneDrive";
  const close = element("button");
  close.textContent = "Close";
  const section = element("section");
  section.querySelector = () => null;
  section.querySelectorAll = () => nodes.filter((x) => x.tag === "button");
  const host = { style: {}, shadowRoot: { querySelector: () => section } };
  const root = new Directory();
  const entries = Array.from({ length: 5 }, (_, i) =>
    row(String(i), "/File" + i, "file", 20000),
  );
  const browser = {
    showDirectoryPicker: async () => root,
    __oneDriveInventoryReport: report(entries),
  };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const context = vm.createContext({
    window: browser,
    document: { getElementById: () => host, createElement: element },
    showDirectoryPicker: browser.showDirectoryPicker,
    performance: {
      getEntriesByType: () => [
        {
          name: "https://onedrive.live.com/personal/abc123/_api/v2.0/drive/root",
        },
      ],
    },
    location: { origin: "https://onedrive.live.com" },
    URL,
    Blob,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    console: { log() {} },
    fetch: async (url) => {
      if (url.includes("/items/")) {
        await gate;
        const item = entries.find((x) => url.endsWith("/" + x.id));
        return {
          ok: true,
          json: async () => ({
            id: item.id,
            name: item.name,
            size: item.size,
            lastModifiedDateTime: item.modified,
            parentReference: { id: item.parentId },
            "@content.downloadUrl": "https://onedrive.live.com/download/sample",
          }),
        };
      }
      return { ok: true, ...response("x".repeat(20000)) };
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/disk-tools.js"), "utf8"),
    context,
  );
  const button = (name) =>
    nodes.find((x) => x.tag === "button" && x.textContent === name);
  await button("Choose local folder").onclick();
  await button("Check disk").onclick();
  const setting = nodes.find((x) => x.tag === "select");
  assert.equal(setting.value, "3");
  assert.equal(setting.children.length, 5);
  const run = button("Test 3 small files").onclick();
  assert.equal(setting.disabled, true);
  assert.equal(close.disabled, true);
  assert.equal(scan.disabled, true);
  release();
  await run;
  assert.equal(browser.__oneDriveDownloadResult.downloaded, 3);
  assert.equal(browser.__oneDriveDownloadResult.concurrency, 3);
  assert.equal(setting.disabled, false);
  assert.equal(browser.__oneDriveDownloadResult.scope, "small_file_test");
  assert.equal(browser.__oneDriveDiskPlan.items.length, 5);
  assert.equal(close.disabled, false);
  assert.equal(scan.disabled, false);
  await button("Check disk").onclick();
  assert.equal(
    browser.__oneDriveDiskPlan.items.filter((x) => x.status === "missing")
      .length,
    2,
  );
});

test("activity reports transfer bytes, final commit, skips and failures without download URLs", async () => {
  const root = new Directory();
  const plan = await checkDisk({
    report: report([row("a", "/A"), row("b", "/B"), row("c", "/C")]),
    root,
  });
  root.entries.set("B", new File("B", "keep"));
  const events = [];
  const result = await populate({
    plan,
    root,
    activity: (x) => events.push(x),
    fetchFile: async (x) => {
      if (x.id === "c")
        throw Object.assign(new Error("private URL"), {
          code: "metadata_http_503",
        });
      return response("abc");
    },
  });
  assert.equal(result.downloaded, 1);
  assert.ok(
    events.some(
      (x) => x.stage === "Downloading" && x.bytes === 3 && x.total === 3,
    ),
  );
  assert.ok(events.some((x) => x.stage === "Saving file"));
  assert.ok(events.some((x) => x.stage === "Downloaded" && x.completed === 1));
  assert.ok(events.some((x) => x.stage === "Skipped" && x.path === "/B"));
  assert.ok(
    events.some((x) => x.stage === "Issue" && x.code === "metadata_http_503"),
  );
  assert.doesNotMatch(JSON.stringify(events), /private URL/);
  assert.equal(root.entries.get("B").writes, 0);
});

test(
  "parallel workers overlap at the selected limit and copy every file once",
  { timeout: 3000 },
  async () => {
    for (const concurrency of [1, 3, 5]) {
      const root = new Directory();
      const plan = await checkDisk({
        report: report(
          Array.from({ length: 8 }, (_, i) =>
            row(String(i), "/Shared/File" + i),
          ),
        ),
        root,
      });
      let active = 0,
        peak = 0;
      const ids = [];
      const result = await populate({
        plan,
        root,
        concurrency,
        maxFiles: 8,
        maxBytes: 24,
        fetchFile: async (item) => {
          ids.push(item.id);
          active++;
          peak = Math.max(peak, active);
          return {
            body: new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode("abc"));
                setTimeout(() => {
                  active--;
                  c.close();
                }, 10);
              },
            }),
          };
        },
      });
      assert.equal(peak, concurrency);
      assert.equal(result.downloaded, 8);
      assert.equal(result.bytes, 24);
      assert.equal(new Set(ids).size, 8);
      const dir = root.entries.get("Shared");
      assert.equal(dir.entries.size, 8);
      for (const f of dir.entries.values()) {
        assert.equal(f.writes, 1);
        assert.equal(f.data.length, 3);
      }
    }
  },
);

test("parallel downloads reserve one shared file and byte budget", async () => {
  for (const limits of [{ maxBytes: 6 }, { maxFiles: 2 }]) {
    const root = new Directory();
    const plan = await checkDisk({
      report: report(
        Array.from({ length: 8 }, (_, i) => row(String(i), "/F" + i)),
      ),
      root,
    });
    let fetched = 0;
    const result = await populate({
      plan,
      root,
      concurrency: 5,
      ...limits,
      fetchFile: async () => {
        fetched++;
        await new Promise((r) => setTimeout(r, 5));
        return response("abc");
      },
    });
    assert.equal(fetched, 2);
    assert.equal(result.downloaded, 2);
    assert.equal(result.bytes, 6);
    assert.equal(result.status, "partial");
    assert.ok(result.issues.some((x) => x.code === "download_budget"));
  }
});

test(
  "Stop cancels all in-flight readers without starting queued files",
  { timeout: 2000 },
  async () => {
    const root = new Directory();
    const controller = new AbortController();
    const plan = await checkDisk({
      report: report(
        Array.from({ length: 8 }, (_, i) => row(String(i), "/F" + i)),
      ),
      root,
    });
    let started = 0,
      cancelled = 0;
    const result = await populate({
      plan,
      root,
      concurrency: 3,
      signal: controller.signal,
      fetchFile: async () => {
        started++;
        if (started === 3) setTimeout(() => controller.abort(), 10);
        return {
          body: new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([1]));
            },
            cancel() {
              cancelled++;
            },
          }),
        };
      },
    });
    assert.equal(started, 3);
    assert.equal(cancelled, 3);
    assert.equal(result.downloaded, 0);
    assert.equal(result.issues.length, 3);
    assert.ok(result.issues.every((x) => x.code === "cancelled"));
    for (const f of root.entries.values()) assert.equal(f.data.length, 0);
  },
);

test(
  "global deadline interrupts stalled parallel readers",
  { timeout: 2000 },
  async () => {
    const root = new Directory();
    const plan = await checkDisk({
      report: report([row("a", "/A"), row("b", "/B")]),
      root,
    });
    const result = await populate({
      plan,
      root,
      concurrency: 3,
      maxMs: 20,
      fetchFile: async () => ({ body: new ReadableStream({}) }),
    });
    assert.equal(result.downloaded, 0);
    assert.equal(result.issues.length, 2);
    assert.ok(result.issues.every((x) => x.code === "time_limit"));
  },
);

test("invalid concurrency and duplicate destinations fail before writes", async () => {
  const root = new Directory();
  const plan = await checkDisk({ report: report([row("a", "/A")]), root });
  for (const concurrency of [0, 6, 1.5])
    await assert.rejects(
      populate({ plan, root, concurrency }),
      /invalid_concurrency/,
    );
  await assert.rejects(
    populate({
      plan: { ...plan, items: [...plan.items, ...plan.items] },
      root,
      concurrency: 5,
    }),
    /duplicate_download_path/,
  );
  assert.equal(root.creates, 0);
});

test("one file failure does not prevent independent parallel copies", async () => {
  const root = new Directory();
  const plan = await checkDisk({
    report: report(
      Array.from({ length: 6 }, (_, i) => row(String(i), "/F" + i)),
    ),
    root,
  });
  const result = await populate({
    plan,
    root,
    concurrency: 3,
    fetchFile: async (item) => {
      if (item.id === "1")
        throw Object.assign(Error("unavailable"), {
          code: "download_http_404",
        });
      return response("abc");
    },
  });
  assert.equal(result.downloaded, 5);
  assert.equal(result.issues.length, 1);
  assert.equal(result.status, "partial");
});

test(
  "storage denial stops the queue and cancels peer streams",
  { timeout: 2000 },
  async () => {
    const root = new Directory();
    const plan = await checkDisk({
      report: report(
        Array.from({ length: 8 }, (_, i) => row(String(i), "/F" + i)),
      ),
      root,
    });
    let requests = 0,
      cancelled = 0;
    const original = root.getFileHandle.bind(root);
    root.getFileHandle = async (name, options) => {
      const f = await original(name, options);
      if (name === "F0")
        f.createWritable = async () => {
          await new Promise((r) => setTimeout(r, 10));
          throw error("NotAllowedError");
        };
      return f;
    };
    const result = await populate({
      plan,
      root,
      concurrency: 3,
      fetchFile: async () => {
        requests++;
        return {
          body: new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
        };
      },
    });
    assert.equal(requests, 3);
    assert.equal(cancelled, 3);
    assert.equal(result.downloaded, 0);
    assert.ok(result.issues.some((x) => x.code === "NotAllowedError"));
    assert.equal(result.issues.length, 3);
  },
);
