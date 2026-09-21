"""Native filesystem tests use disposable synthetic files, never account data."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "repair_dates", Path(__file__).resolve().parents[1] / "native" / "repair-dates.py"
)
repair = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repair)


class RepairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.root = self.base / "destination"
        self.root.mkdir()
        self.file = self.root / "example.bin"
        self.data = b"synthetic content\n"
        self.file.write_bytes(self.data)
        self.row = {
            "path": "/example.bin",
            "type": "file",
            "size": len(self.data),
            "fileCreated": "2003-06-07T08:09:10Z",
            "fileModified": "2001-02-03T04:05:06.1234567Z",
            "sha256": hashlib.sha256(self.data).hexdigest(),
        }
        self.events = []
        self.modified_only = sys.platform not in ("darwin", "win32")

    def run_repair(self, rows=None, **kwargs):
        manifest = {
            "kind": "onedrive-date-repair",
            "version": 1,
            "terminalReached": True,
            "items": rows or [self.row],
        }
        return repair.repair(
            manifest,
            self.root,
            self.events.append,
            modified_only=self.modified_only,
            **kwargs,
        )

    def test_native_preview_apply_verify_and_idempotence(self):
        before = self.file.stat()
        preview = self.run_repair()
        self.assertEqual(preview["ready"], 1)
        self.assertEqual(before.st_mtime_ns, self.file.stat().st_mtime_ns)
        applied = self.run_repair(apply=True)
        self.assertEqual(applied["applied"], 1, self.events)
        self.assertEqual(self.file.read_bytes(), self.data)
        with repair.open_target(self.root, ["example.bin"]) as fd:
            actual = repair.times(fd)
        self.assertTrue(
            repair.close_enough(
                actual["modifiedNs"], repair.date_ns(self.row["fileModified"])
            )
        )
        if not self.modified_only:
            self.assertTrue(
                repair.close_enough(
                    actual["createdNs"], repair.date_ns(self.row["fileCreated"])
                )
            )
        self.assertEqual(self.run_repair(apply=True)["unchanged"], 1)
        statuses = [x["status"] for x in self.events]
        self.assertLess(statuses.index("prepared"), statuses.index("applied"))

    def test_sha1_supported_without_sha256(self):
        self.row.pop("sha256")
        self.row["sha1"] = hashlib.sha1(self.data).hexdigest()
        self.assertEqual(self.run_repair(apply=True)["applied"], 1)

    def test_same_size_wrong_content_never_changes_dates(self):
        self.file.write_bytes(b"X" * len(self.data))
        before = self.file.stat().st_mtime_ns
        self.assertEqual(self.run_repair(apply=True)["skipped"], 1)
        self.assertEqual(self.events[-2]["reason"], "hash_mismatch")
        self.assertEqual(self.file.stat().st_mtime_ns, before)

    def test_no_hash_no_dates_missing_and_changed_metadata_are_skipped(self):
        for update, remove in [
            ({}, "sha256"),
            ({"fileModified": None}, None),
            ({"repairError": "remote_changed_rescan"}, None),
            ({"path": "/absent.bin"}, None),
            ({"size": len(self.data) + 1}, None),
        ]:
            with self.subTest(update=update, remove=remove):
                row = dict(self.row, **update)
                if remove:
                    row.pop(remove)
                self.assertEqual(self.run_repair([row], apply=True)["skipped"], 1)

    def test_paths_and_duplicate_parent_names_block_changes(self):
        for value in [
            "/../elsewhere",
            "//server/file",
            "/a:b",
            "/CON.txt",
            "/x\\file",
            "/foo./x",
        ]:
            with self.subTest(value=value):
                self.assertEqual(
                    self.run_repair([dict(self.row, path=value)], apply=True)[
                        "skipped"
                    ],
                    1,
                )
        rows = [dict(self.row), dict(self.row, path="/EXAMPLE.BIN")]
        self.assertEqual(self.run_repair(rows, apply=True)["skipped"], 2)
        (self.root / "Folder").mkdir()
        (self.root / "Folder" / "example.bin").write_bytes(self.data)
        rows = [
            dict(self.row, path="/Folder/example.bin"),
            {"path": "/Folder", "type": "folder"},
            {"path": "/folder", "type": "folder"},
        ]
        self.assertEqual(self.run_repair(rows, apply=True)["skipped"], 1)

    def test_hardlinks_are_not_modified(self):
        try:
            os.link(self.file, self.root / "alias")
        except OSError:
            self.skipTest("hardlinks unavailable")
        self.assertEqual(self.run_repair(apply=True)["skipped"], 1)
        self.assertEqual(self.events[-2]["reason"], "hardlinked_file")

    def test_symlink_leaf_and_parent_are_not_followed(self):
        outside = self.base / "outside"
        outside.mkdir()
        target = outside / "example.bin"
        target.write_bytes(self.data)
        before = target.stat().st_mtime_ns
        try:
            (self.root / "link").symlink_to(outside, target_is_directory=True)
            (self.root / "leaf").symlink_to(target)
        except OSError:
            self.skipTest("symlink permission unavailable")
        rows = [dict(self.row, path="/link/example.bin"), dict(self.row, path="/leaf")]
        self.assertEqual(self.run_repair(rows, apply=True)["skipped"], 2)
        self.assertEqual(target.stat().st_mtime_ns, before)

    @unittest.skipUnless(os.name == "nt", "Windows junction test")
    def test_windows_junction_is_rejected(self):
        outside = self.base / "outside"
        outside.mkdir()
        target = outside / "example.bin"
        target.write_bytes(self.data)
        link = self.root / "junction"
        subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(outside)],
            check=True,
            capture_output=True,
        )
        try:
            result = self.run_repair(
                [dict(self.row, path="/junction/example.bin")], apply=True
            )
            self.assertEqual(result["skipped"], 1)
            self.assertEqual(
                self.events[-2]["reason"], "reparse_point_or_type_conflict"
            )
        finally:
            os.rmdir(link)

    def test_byte_budget_and_journal_failure_prevent_writes(self):
        before = self.file.stat().st_mtime_ns
        self.assertEqual(
            self.run_repair(apply=True, max_bytes=1)["stopped"], "byte_budget"
        )
        self.assertEqual(self.file.stat().st_mtime_ns, before)

        def failed_journal(event):
            raise OSError("synthetic journal unavailable")

        manifest = {
            "kind": "onedrive-date-repair",
            "version": 1,
            "terminalReached": True,
            "items": [self.row],
        }
        with self.assertRaises(OSError):
            repair.repair(
                manifest,
                self.root,
                failed_journal,
                apply=True,
                modified_only=self.modified_only,
            )
        self.assertEqual(self.file.stat().st_mtime_ns, before)

    def test_folders_opt_in_and_modified_only_preserves_birth(self):
        folder = self.root / "Folder"
        folder.mkdir()
        row = dict(self.row, path="/Folder", type="folder")
        self.assertEqual(self.run_repair([row], apply=True)["applied"], 0)
        result = self.run_repair([row], apply=True, include_folders=True)
        self.assertEqual(result["applied"], 1, self.events)
        with repair.open_target(self.root, ["example.bin"]) as fd:
            before = repair.times(fd)
        manifest = {
            "kind": "onedrive-date-repair",
            "version": 1,
            "terminalReached": True,
            "items": [self.row],
        }
        result = repair.repair(
            manifest, self.root, self.events.append, apply=True, modified_only=True
        )
        self.assertEqual(result["applied"], 1)
        with repair.open_target(self.root, ["example.bin"]) as fd:
            after = repair.times(fd)
        self.assertEqual(before["createdNs"], after["createdNs"])

    def test_cli_report_never_overwrites_and_rejects_report_inside_root(self):
        manifest = self.base / "manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "kind": "onedrive-date-repair",
                    "version": 1,
                    "terminalReached": True,
                    "items": [self.row],
                }
            )
        )
        args = [
            "--manifest",
            str(manifest),
            "--root",
            str(self.root),
            "--report",
            str(self.base / "preview.jsonl"),
        ]
        if self.modified_only:
            args += ["--modified-only"]
        self.assertEqual(repair.main(args), 0)
        self.assertEqual(repair.main(args), 1)
        args[5] = str(self.root / "report.jsonl")
        self.assertEqual(repair.main(args), 1)
        self.assertFalse((self.root / "report.jsonl").exists())

    def test_dates_offsets_and_precision(self):
        self.assertEqual(
            repair.date_ns("2001-02-03T04:05:06.1234567Z"),
            repair.date_ns("2001-02-02T21:05:06.123456700-07:00"),
        )
        for value in [
            None,
            "today",
            "2001-02-03",
            "2001-02-03T04:05:06",
            "2001-02-30T00:00:00Z",
        ]:
            with self.assertRaises(repair.RepairError):
                repair.date_ns(value)

    def test_old_or_incomplete_manifest_rejected(self):
        for manifest in [
            {},
            {
                "kind": "onedrive-date-repair",
                "version": 1,
                "terminalReached": False,
                "items": [],
            },
        ]:
            with self.assertRaises(repair.RepairError):
                repair.manifest_items(manifest)


if __name__ == "__main__":
    unittest.main()
