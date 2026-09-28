const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const script = path.resolve(__dirname, "../native/check-disk.ps1");
const shells = process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"];
for (const shell of shells) {
  const available = !spawnSync(shell, [
    "-NoProfile",
    "-Command",
    "$PSVersionTable.PSVersion.Major",
  ]).error;

  test(
    `native checker (${shell}) handles links, missing files, mismatches and invalid paths without changing originals`,
    { skip: !available },
    async () => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), "onedrive-native-"));
      try {
        const root = path.join(temp, "original"),
          target = path.join(temp, "target");
        fs.mkdirSync(root);
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, "same"), "abc");
        fs.writeFileSync(path.join(target, "different"), "");
        fs.symlinkSync(
          target,
          path.join(root, "linked"),
          process.platform === "win32" ? "junction" : "dir",
        );
        fs.mkdirSync(path.join(root, "directory-not-file"));
        const rows = [
          "/linked/same",
          "/linked/different",
          "/linked/missing",
          "/absent/file",
          "/../escape",
          "/directory-not-file",
        ].map((p, i) => ({
          id: String(i),
          path: p,
          name: p.split("/").at(-1),
          size: 3,
          type: "file",
          modified: "2026-01-01T00:00:00.123Z",
          parentId: "parent",
        }));
        const report = path.join(temp, "report.json");
        fs.writeFileSync(
          report,
          JSON.stringify({
            plan: {
              status: "checked",
              folder: "original",
              inventoryStarted: "2026",
              items: rows,
            },
          }),
        );
        function run(name, follow = false, extra = []) {
          return spawnSync(
            shell,
            [
              "-NoProfile",
              "-File",
              script,
              "-Report",
              report,
              "-Root",
              root,
              "-Output",
              path.join(temp, name),
              ...(follow ? ["-FollowDirectoryLinks"] : []),
              ...extra,
            ],
            { encoding: "utf8" },
          );
        }
        let result = run("blocked.json");
        assert.equal(result.status, 0, result.stderr);
        const blocked = JSON.parse(
          fs.readFileSync(path.join(temp, "blocked.json")),
        );
        assert.equal(blocked.items[0].status, "conflict");
        result = run("checked.json", true);
        assert.equal(result.status, 0, result.stderr);
        const audit = JSON.parse(
          fs.readFileSync(path.join(temp, "checked.json")),
        );
        assert.deepEqual(
          audit.items.map((x) => x.status),
          [
            "present",
            "existing_size_mismatch",
            "missing",
            "missing",
            "conflict",
            "conflict",
          ],
        );
        assert.equal(audit.items[0].throughDirectoryLink, true);
        assert.equal(audit.items[1].localSize, 0);
        assert.equal(fs.readFileSync(path.join(target, "same"), "utf8"), "abc");
        assert.equal(fs.statSync(path.join(target, "different")).size, 0);
        assert.equal(fs.existsSync(path.join(root, "absent")), false);
        assert.equal(fs.existsSync(path.join(temp, "escape")), false);
        const saved = fs.readFileSync(path.join(temp, "checked.json"), "utf8");
        assert.notEqual(run("checked.json", true).status, 0);
        assert.equal(
          fs.readFileSync(path.join(temp, "checked.json"), "utf8"),
          saved,
        );
        assert.notEqual(run("original/unsafe.json", true).status, 0);
        assert.equal(fs.existsSync(path.join(root, "unsafe.json")), false);
        const { applyNativeAudit, checkDisk } = require("../src/disk-tools.js");
        const inventory = {
          started: "current",
          terminalReached: true,
          issues: [],
          items: rows,
        };
        const browserRoot = {
          name: "original",
          getDirectoryHandle: async () => {
            throw Object.assign(new Error(), { name: "NotFoundError" });
          },
          getFileHandle: async () => {
            throw Object.assign(new Error(), { name: "NotFoundError" });
          },
        };
        const plan = await checkDisk({ report: inventory, root: browserRoot });
        const imported = applyNativeAudit({ audit, report: inventory, plan });
        assert.equal(imported.items[0].status, "present");
        assert.equal(imported.items[1].status, "existing_size_mismatch");
        assert.equal(audit.items.length, rows.length);
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    },
  );
}
