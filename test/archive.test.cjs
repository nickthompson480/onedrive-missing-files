const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  makeArchive,
  candidates,
  saveArchive,
} = require("../src/archive-tools.js");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
  rmSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const row = { id: "1", type: "file", path: "/Docs/é shortcut.lnk", size: 3 };
const metadata = {
  sha256: createHash("sha256").update("abc").digest("hex"),
  fileCreated: "2020-01-01T00:00:00Z",
  fileModified: "2020-02-01T00:00:00Z",
  secret: "private-token",
  url: "private-url",
};
const response = (text) => ({
  metadata,
  body: new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  }),
});
test("single-file ZIP interoperates with Python, preserves Unicode path and has no credential fields", async () => {
  const blob = await makeArchive(row, response("abc"));
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "onedrive-zip-")));
  try {
    const file = join(dir, "onedrive-file-test.zip");
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    const output = execFileSync(
      process.platform === "win32" ? "python" : "python3",
      [
        "-c",
        'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); assert len(z.infolist())==1; assert z.read(z.infolist()[0])==b"abc"; m=json.loads(z.comment); assert z.infolist()[0].filename==m["path"][1:]; print(z.comment.decode())',
        file,
      ],
      { encoding: "utf8" },
    );
    const m = JSON.parse(output);
    assert.equal(m.path, row.path);
    assert.equal(m.sha256, metadata.sha256);
    assert.doesNotMatch(output, /private-token|private-url|secret/);
    const destination = join(dir, "restored");
    mkdirSync(destination);
    const restored = JSON.parse(
      execFileSync(
        process.platform === "win32" ? "python" : "python3",
        [
          join(__dirname, "../native/restore-zip.py"),
          dir,
          "--root",
          destination,
          "--apply",
          "--delete-zip",
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(restored.status, "restored");
    assert.equal(restored.zipDeleted, true);
    assert.equal(
      readFileSync(join(destination, "Docs/é shortcut.lnk"), "utf8"),
      "abc",
    );
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("archive selection uses restricted conflicts only and bounds bytes and duplicate paths", () => {
  const report = {
    started: "s",
    terminalReached: true,
    issues: [],
    items: [row, { ...row, id: "2", path: "/normal.txt" }],
  };
  const plan = {
    status: "checked",
    inventoryStarted: "s",
    items: [{ ...row, reason: "browser_restricted_file_type" }],
  };
  assert.equal(candidates(report, plan).length, 1);
  assert.throws(
    () => candidates({ ...report, items: [{ ...row, size: 99 }] }, plan),
    /check_disk_again/,
  );
  assert.throws(
    () => candidates(report, { ...plan, inventoryStarted: "other" }),
    /check_disk_first/,
  );
});
test("archive refuses wrong source hash, wrong size and cancelled streams", async () => {
  await assert.rejects(
    makeArchive(row, response("bad")),
    /source_hash_mismatch/,
  );
  await assert.rejects(
    makeArchive(row, response("abcd")),
    /download_size_mismatch/,
  );
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    makeArchive(row, response("abc"), c.signal),
    /cancelled/,
  );
});
test("ZIP saving preserves existing files and verifies committed bytes", async () => {
  let writes = 0,
    data = new Blob([]);
  const file = {
    getFile: async () => data,
    createWritable: async () => ({
      write: async (blob) => {
        writes++;
        data = blob;
      },
      close: async () => {},
      abort: async () => {},
    }),
  };
  await assert.rejects(
    saveArchive(
      { getFileHandle: async () => file },
      "archive.zip",
      new Blob(["abc"]),
    ),
    /existing_zip_preserved/,
  );
  assert.equal(writes, 0);
  const root = {
    getFileHandle: async (name, options) => {
      if (!options?.create)
        throw Object.assign(new Error(), { name: "NotFoundError" });
      return file;
    },
  };
  await saveArchive(root, "archive.zip", new Blob(["abc"]));
  assert.equal(writes, 1);
});
