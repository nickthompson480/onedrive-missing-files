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
  maxRetries: 0,
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

const consume = async (options) => [
  ...new Uint8Array(
    await new Response((await fetchDownload(options)).body).arrayBuffer(),
  ),
];
function retryFixture({
  failFirst = true,
  changed = false,
  range = "valid",
  tags = true,
  status = 206,
} = {}) {
  let downloads = 0,
    metadataCalls = 0;
  const ranges = [];
  return {
    ranges,
    counts: () => ({ downloads, metadataCalls }),
    options: options(null, {
      maxRetries: 2,
      retryBaseMs: 0,
      request: async (url, init) => {
        if (url.includes("/items/")) {
          metadataCalls++;
          return {
            ok: true,
            json: async () => ({
              ...metadata,
              ...(tags
                ? { cTag: changed && metadataCalls > 1 ? "v2" : "v1" }
                : {}),
            }),
          };
        }
        ranges.push(init.headers?.Range);
        downloads++;
        if (downloads === 1 && failFirst) {
          let chunk = 0;
          return {
            ok: true,
            status: 200,
            body: new ReadableStream(
              {
                pull(c) {
                  if (chunk++ === 0) c.enqueue(Uint8Array.from([1, 2, 3]));
                  else c.error(new TypeError("network disconnected"));
                },
              },
              { highWaterMark: 0 },
            ),
          };
        }
        return {
          ok: true,
          status,
          headers: new Headers(
            range === "hidden"
              ? {}
              : {
                  "Content-Range":
                    range === "valid" ? "bytes 3-7/8" : "bytes 0-4/8",
                },
          ),
          body: new Response(Uint8Array.from([4, 5, 6, 7, 8])).body,
        };
      },
    }),
  };
}
test("network interruption resumes from exact offset without duplicating bytes", async () => {
  const f = retryFixture();
  assert.deepEqual(await consume(f.options), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(f.ranges, [undefined, "bytes=3-"]);
  assert.equal(f.counts().metadataCalls, 3);
});
test("resume refuses changed source version before fetching more content", async () => {
  const f = retryFixture({ changed: true });
  await assert.rejects(consume(f.options), /remote_changed_rescan/);
  assert.equal(f.counts().downloads, 1);
});
test("resume refuses absent source version", async () => {
  const f = retryFixture({ tags: false });
  await assert.rejects(consume(f.options), /resume_version_unavailable/);
  assert.equal(f.counts().downloads, 1);
});
for (const config of [
  { status: 200 },
  { range: "wrong" },
  { range: "hidden" },
]) {
  test(
    "resume rejects unverified range " + JSON.stringify(config),
    async () => {
      const f = retryFixture(config);
      await assert.rejects(consume(f.options), /resume_range_unverified/);
      assert.equal(f.counts().downloads, 2);
    },
  );
}
test("429 honors Retry-After and refreshes metadata before retry", async () => {
  let calls = 0,
    downloads = 0,
    firstAt;
  const o = options(null, {
    maxRetries: 1,
    retryBaseMs: 0,
    request: async (url) => {
      if (url.includes("/items/")) {
        calls++;
        return { ok: true, json: async () => metadata };
      }
      if (downloads++ === 0) {
        firstAt = Date.now();
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "1" },
        });
      }
      assert.ok(Date.now() - firstAt >= 990);
      return new Response(new Uint8Array(8));
    },
  });
  assert.equal((await consume(o)).length, 8);
  assert.equal(calls, 2);
});
test("retry count is bounded and permanent metadata errors do not retry", async () => {
  for (const status of [503, 404, 401]) {
    let calls = 0;
    await assert.rejects(
      fetchDownload(
        options(null, {
          maxRetries: 2,
          retryBaseMs: 0,
          request: async () => {
            calls++;
            return new Response("", { status });
          },
        }),
      ),
      new RegExp("metadata_http_" + status),
    );
    assert.equal(calls, status === 503 ? 3 : 1);
  }
});
test("excessive server retry delay stops without retrying early", async () => {
  let calls = 0;
  await assert.rejects(
    fetchDownload(
      options(null, {
        maxRetries: 2,
        request: async () => {
          calls++;
          return new Response("", {
            status: 429,
            headers: { "Retry-After": "3600" },
          });
        },
      }),
    ),
    /retry_wait_exceeds_budget/,
  );
  assert.equal(calls, 1);
});
test("stop interrupts retry backoff promptly", async () => {
  const abort = new AbortController();
  let calls = 0;
  const run = fetchDownload(
    options(null, {
      signal: abort.signal,
      maxRetries: 2,
      retryBaseMs: 10000,
      setStep: (step) => {
        if (step === "retry_wait") setTimeout(() => abort.abort(), 10);
      },
      request: async () => {
        calls++;
        return new Response("", { status: 503 });
      },
    }),
  );
  await assert.rejects(run, { name: "AbortError" });
  assert.equal(calls, 1);
});

test("clean truncated response resumes instead of committing short bytes", async () => {
  const f = retryFixture();
  const delegate = f.options.request;
  let first = true;
  f.options.request = async (url, init) => {
    const response = await delegate(url, init);
    if (!url.includes("/items/") && first) {
      first = false;
      await response.body.cancel();
      response.body = new Response(Uint8Array.from([1, 2, 3])).body;
    }
    return response;
  };
  assert.deepEqual(await consume(f.options), [1, 2, 3, 4, 5, 6, 7, 8]);
});
test("version change during resumed transfer prevents successful completion", async () => {
  const f = retryFixture();
  const delegate = f.options.request;
  f.options.request = async (url, init) => {
    const response = await delegate(url, init);
    if (url.includes("/items/") && f.counts().metadataCalls === 3)
      response.json = async () => ({
        ...metadata,
        cTag: "changed-during-transfer",
      });
    return response;
  };
  await assert.rejects(consume(f.options), /remote_changed_rescan/);
});
test("stalled transfer resumes with a fresh idle timer", async () => {
  const f = retryFixture();
  const delegate = f.options.request;
  let first = true,
    cancelled = false;
  f.options.idleMs = 40;
  f.options.request = async (url, init) => {
    const response = await delegate(url, init);
    if (!url.includes("/items/") && first) {
      first = false;
      await response.body.cancel();
      response.body = new ReadableStream({
        start(c) {
          c.enqueue(Uint8Array.from([1, 2, 3]));
        },
        cancel() {
          cancelled = true;
        },
      });
    }
    return response;
  };
  assert.deepEqual(await consume(f.options), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(cancelled, true);
});
