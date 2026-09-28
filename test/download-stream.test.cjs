const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fetchDownload } = require("../src/disk-tools.js");
const row = {
  id: "file",
  name: "large.bin",
  size: 8,
  modified: "2026-01-01",
  parentId: "root",
};
const metadata = {
  ...row,
  lastModifiedDateTime: row.modified,
  parentReference: { id: row.parentId },
  "@content.downloadUrl": "https://test.files.1drv.com/file",
};
const options = (body, extra = {}) => ({
  row,
  base: "https://onedrive.live.com/api",
  origin: "https://onedrive.live.com",
  idleMs: 200,
  request: async (url) =>
    url.includes("/items/")
      ? { ok: true, json: async () => metadata }
      : { ok: true, body },
  ...extra,
});

test("progressing download can exceed its idle timeout", async () => {
  let sent = 0;
  const source = new ReadableStream({
    async pull(c) {
      await new Promise((r) => setTimeout(r, 50));
      if (sent++ < 8) c.enqueue(new Uint8Array([sent]));
      else c.close();
    },
  });
  const result = await fetchDownload(options(source));
  assert.equal((await new Response(result.body).arrayBuffer()).byteLength, 8);
});

test("stalled stream times out and cancels its underlying reader", async () => {
  let cancelled = false;
  const source = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const result = await fetchDownload(options(source, { idleMs: 40 }));
  await assert.rejects(new Response(result.body).arrayBuffer(), {
    name: "TimeoutError",
  });
  assert.equal(cancelled, true);
});

test("external abort cancels a stalled content stream", async () => {
  const abort = new AbortController();
  let cancelled = false;
  const result = await fetchDownload(
    options(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { signal: abort.signal },
    ),
  );
  const read = new Response(result.body).arrayBuffer();
  abort.abort();
  await assert.rejects(read, { name: "AbortError" });
  assert.equal(cancelled, true);
});

test("consumer cancellation stops idle timer and underlying stream", async () => {
  let cancelled = false;
  const result = await fetchDownload(
    options(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { idleMs: 40 },
    ),
  );
  await result.body.cancel();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(cancelled, true);
});

test("stalled metadata request receives idle abort", async () => {
  await assert.rejects(
    fetchDownload(
      options(null, {
        idleMs: 40,
        request: async (_, { signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          ),
      }),
    ),
    { name: "TimeoutError" },
  );
});

test("metadata identity mismatch fails before content download", async () => {
  let calls = 0;
  await assert.rejects(
    fetchDownload(
      options(null, {
        request: async () => {
          calls++;
          return { ok: true, json: async () => ({ ...metadata, size: 9 }) };
        },
      }),
    ),
    /remote_changed_rescan/,
  );
  assert.equal(calls, 1);
});
