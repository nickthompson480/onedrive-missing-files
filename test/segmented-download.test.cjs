const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  fetchFileDownload,
  populate,
  checkDisk,
} = require("../src/disk-tools.js");
const data = Uint8Array.from({ length: 30 }, (_, n) => n + 1);
const row = {
  id: "large",
  name: "large.bin",
  path: "/large.bin",
  type: "file",
  size: data.length,
  modified: "2026-01-01",
  parentId: "root",
};
function fixture(extra = {}) {
  let active = 0,
    peak = 0,
    requests = [],
    cancels = 0,
    reads = 0,
    dropped = false;
  const options = {
    row,
    base: "https://onedrive.live.com/api",
    origin: "https://onedrive.live.com",
    streams: 3,
    largeFileBytes: 1,
    retryBaseMs: 0,
    request: async (url, init) => {
      if (url.includes("/items/"))
        return {
          ok: true,
          json: async () => ({
            ...row,
            cTag: "v1",
            lastModifiedDateTime: row.modified,
            parentReference: { id: row.parentId },
            "@content.downloadUrl": "https://test.files.1drv.com/large",
          }),
        };
      const range = init.headers?.Range;
      requests.push(range);
      if (extra.reject && range && requests.length === extra.rejectAt)
        return new Response("", {
          status: extra.reject,
          headers: { "Retry-After": "0" },
        });
      if (extra.ignoreRange && range) return new Response(data);
      const match = range?.match(/^bytes=(\d+)-(\d*)$/);
      let start = match ? Number(match[1]) : 0,
        end = match && match[2] ? Number(match[2]) : data.length - 1;
      let ended = false;
      active++;
      peak = Math.max(peak, active);
      const finish = () => {
        if (!ended) {
          active--;
          ended = true;
        }
      };
      const body = new ReadableStream(
        {
          async pull(c) {
            await new Promise((r) => setTimeout(r, 3));
            if (ended) return;
            reads++;
            if (extra.drop && !dropped && start === 2) {
              dropped = true;
              finish();
              c.error(new TypeError("synthetic blip"));
              return;
            }
            if (extra.stall) return;
            if (start > end) {
              finish();
              c.close();
              return;
            }
            c.enqueue(data.slice(start, ++start));
          },
          cancel() {
            cancels++;
            finish();
          },
        },
        { highWaterMark: 0 },
      );
      return {
        ok: true,
        status: range ? 206 : 200,
        headers: new Headers(
          range
            ? { "Content-Range": `bytes ${match[1]}-${end}/${data.length}` }
            : {},
        ),
        body,
      };
    },
    ...extra.options,
  };
  return {
    options,
    status: () => ({ active, peak, requests, cancels, reads }),
  };
}
function sink({ failWrite = false } = {}) {
  let bytes = new Uint8Array(data.length),
    truncations = 0,
    writes = 0;
  return {
    async write(value) {
      writes++;
      if (failWrite) throw new DOMException("full", "QuotaExceededError");
      assert.equal(value.type, "write");
      bytes.set(value.data, value.position);
    },
    async truncate(size) {
      assert.equal(size, 0);
      bytes.fill(0);
      truncations++;
    },
    status: () => ({ bytes, truncations, writes }),
  };
}
for (const streams of [2, 3])
  test(`${streams} streams write disjoint ranges correctly without buffering full parts`, async () => {
    const f = fixture({ options: { streams } }),
      out = sink();
    const response = await fetchFileDownload(f.options);
    const progress = [];
    assert.equal(
      await response.transferTo(out, (n) => progress.push(n)),
      data.length,
    );
    assert.deepEqual(out.status().bytes, data);
    assert.equal(f.status().peak, streams);
    assert.equal(f.status().active, 0);
    assert.equal(out.status().writes, data.length);
    assert.equal(progress.at(-1), data.length);
    assert.equal(new Set(f.status().requests).size, streams);
  });
test("small files keep a single stream even when three are selected", async () => {
  const f = fixture({ options: { largeFileBytes: 100 } });
  const response = await fetchFileDownload(f.options);
  assert.equal(response.transferTo, undefined);
  assert.deepEqual(
    new Uint8Array(await new Response(response.body).arrayBuffer()),
    data,
  );
  assert.deepEqual(f.status().requests, [undefined]);
});
test("ignored initial range falls back to a normal stream before local writes", async () => {
  const f = fixture({ ignoreRange: true });
  const response = await fetchFileDownload(f.options);
  assert.equal(response.transferTo, undefined);
  assert.deepEqual(
    new Uint8Array(await new Response(response.body).arrayBuffer()),
    data,
  );
  assert.deepEqual(f.status().requests, ["bytes=0-9", undefined]);
});
test("429 cancels peer ranges and restarts only the uncommitted write with one stream", async () => {
  const f = fixture({ reject: 429, rejectAt: 2 }),
    out = sink();
  const response = await fetchFileDownload(f.options);
  assert.equal(await response.transferTo(out, () => {}), data.length);
  assert.deepEqual(out.status().bytes, data);
  assert.equal(out.status().truncations, 1);
  assert.equal(f.status().requests.at(-1), undefined);
  assert.equal(f.status().active, 0);
  assert.ok(f.status().cancels >= 1);
});
test("Stop aborts all stalled segment readers", async () => {
  const abort = new AbortController();
  const f = fixture({ stall: true, options: { signal: abort.signal } }),
    out = sink();
  const response = await fetchFileDownload(f.options);
  const task = response.transferTo(out, () => {});
  setTimeout(() => abort.abort(), 20);
  await assert.rejects(task, { name: "AbortError" });
  assert.equal(f.status().active, 0);
  assert.equal(out.status().truncations, 0);
});
test("disk failure stops peers and never triggers a network fallback", async () => {
  const f = fixture(),
    out = sink({ failWrite: true });
  const response = await fetchFileDownload(f.options);
  await assert.rejects(
    response.transferTo(out, () => {}),
    { name: "QuotaExceededError", operation: "write_local_file" },
  );
  assert.equal(f.status().active, 0);
  assert.equal(out.status().truncations, 0);
  assert.ok(f.status().requests.every(Boolean));
});
test("destination race cancels preopened segment without replacing the existing file", async () => {
  const f = fixture();
  let exists = false,
    cancelled;
  const root = {
    name: "target",
    getFileHandle: async () => {
      if (!exists) throw new DOMException("missing", "NotFoundError");
      return { getFile: async () => ({ size: row.size }) };
    },
    getDirectoryHandle: async () => root,
  };
  const plan = await checkDisk({
    report: { terminalReached: true, issues: [], items: [row] },
    root,
  });
  const result = await populate({
    plan,
    root,
    fetchFile: async () => {
      const response = await fetchFileDownload(f.options);
      exists = true;
      cancelled = response;
      return response;
    },
  });
  assert.equal(result.downloaded, 0);
  assert.equal(result.skipped, 1);
  assert.equal(f.status().active, 0);
  assert.ok(cancelled);
});

test("populate commits exact assembled bytes after every segment finishes", async () => {
  const f = fixture();
  const out = sink();
  let exists = false,
    committed = null,
    closes = 0;
  const handle = {
    getFile: async () => ({ size: committed?.length || 0 }),
    createWritable: async () => ({
      ...out,
      close: async () => {
        assert.equal(f.status().active, 0);
        committed = out.status().bytes.slice();
        closes++;
      },
      abort: async () => {
        throw Error("unexpected abort");
      },
    }),
  };
  const root = {
    name: "target",
    getDirectoryHandle: async () => root,
    getFileHandle: async (_, options) => {
      if (options?.create) exists = true;
      if (!exists) throw new DOMException("missing", "NotFoundError");
      return handle;
    },
  };
  const plan = await checkDisk({
    report: { terminalReached: true, issues: [], items: [row] },
    root,
  });
  const result = await populate({
    plan,
    root,
    fetchFile: () => fetchFileDownload(f.options),
  });
  assert.equal(result.downloaded, 1);
  assert.deepEqual(result.issues, []);
  assert.equal(closes, 1);
  assert.deepEqual(committed, data);
});

test("one interrupted segment resumes its own remaining bounded range", async () => {
  const f = fixture({ drop: true }),
    out = sink();
  const response = await fetchFileDownload(f.options);
  assert.equal(await response.transferTo(out, () => {}), data.length);
  assert.deepEqual(out.status().bytes, data);
  assert.ok(f.status().requests.includes("bytes=2-9"));
  assert.equal(out.status().truncations, 0);
  assert.equal(f.status().active, 0);
});
