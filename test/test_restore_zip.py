import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location(
    "restore", Path(__file__).resolve().parents[1] / "native/restore-zip.py"
)
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


def archive(name="Docs/sample.lnk", content=b"abc", **overrides):
    meta = dict(
        kind="onedrive-single-file",
        version=1,
        path="/" + name,
        size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        fileCreated="2020-01-01T00:00:00Z",
        fileModified="2021-01-01T00:00:00Z",
    )
    meta.update(overrides)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as z:
        z.writestr(name, content)
        z.comment = json.dumps(meta).encode()
    return stream.getvalue()


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "root"
        self.root.mkdir()
        self.zip = self.base / "onedrive-file-test.zip"
        self.zip.write_bytes(archive())

    def test_preview_apply_readback_cleanup_dates(self):
        result = restore.restore(self.zip, self.root)
        self.assertEqual(result["status"], "would_restore")
        self.assertFalse((self.root / "Docs").exists())
        result = restore.restore(self.zip, self.root, True, True)
        self.assertTrue(result["zipDeleted"])
        target = self.root / "Docs/sample.lnk"
        self.assertEqual(target.read_bytes(), b"abc")
        self.assertEqual(round(target.stat().st_mtime), 1609459200)
        if os.name == "nt" or restore.sys.platform == "darwin":
            with restore.repair.open_target(self.root, ["Docs", "sample.lnk"]) as fd:
                self.assertTrue(
                    restore.repair.close_enough(
                        restore.repair.times(fd)["createdNs"],
                        restore.repair.date_ns("2020-01-01T00:00:00Z"),
                    )
                )
        self.assertFalse(self.zip.exists())

    def test_identical_file_preserved_and_zip_cleanup_allowed(self):
        restore.restore(self.zip, self.root, True)
        target = self.root / "Docs/sample.lnk"
        before = target.stat().st_mtime_ns
        result = restore.restore(self.zip, self.root, True, True)
        self.assertEqual(result["status"], "already_identical")
        self.assertEqual(target.stat().st_mtime_ns, before)

    def test_conflicts_keep_zip_and_original(self):
        (self.root / "Docs").mkdir()
        target = self.root / "Docs/sample.lnk"
        for content in (b"", b"keep"):
            target.write_bytes(content)
            with self.assertRaises(restore.Error):
                restore.restore(self.zip, self.root, True, True)
            self.assertEqual(target.read_bytes(), content)
            self.assertTrue(self.zip.exists())

    def test_bad_paths_hashes_and_extra_entries_rejected_before_writes(self):
        for name in (
            "../bad.lnk",
            "/bad.lnk",
            "Docs/CON.lnk",
            "Docs/a:bad.lnk",
            "Docs/a\\bad.lnk",
        ):
            with self.assertRaises(restore.Error):
                restore.read_archive(archive(name))
        with self.assertRaises(restore.Error):
            restore.read_archive(archive(sha256="0" * 64))
        stream = io.BytesIO(archive())
        with zipfile.ZipFile(stream, "a") as z:
            z.writestr("extra.ini", b"extra")
        self.zip.write_bytes(stream.getvalue())
        with self.assertRaises(restore.Error):
            restore.restore(self.zip, self.root, True, True)
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertTrue(self.zip.exists())

    def test_symlinks_are_not_followed(self):
        if os.name == "nt":
            self.skipTest("Windows junction covered separately")
        outside = self.base / "outside"
        outside.mkdir()
        (self.root / "Docs").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            restore.restore(self.zip, self.root, True, True)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertTrue(self.zip.exists())

    def test_partial_destination_and_zip_retained_on_write_failure(self):
        from unittest.mock import patch

        with patch.object(restore.os, "write", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                restore.restore(self.zip, self.root, True, True)
        self.assertTrue(self.zip.exists())
        self.assertEqual((self.root / "Docs/sample.lnk").stat().st_size, 0)

    @unittest.skipUnless(os.name == "nt", "Windows junction only")
    def test_windows_junction_rejected(self):
        import subprocess

        outside = self.base / "outside"
        outside.mkdir()
        junction = self.root / "Docs"
        subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(junction), str(outside)],
            check=True,
            capture_output=True,
        )
        self.addCleanup(lambda: os.rmdir(junction) if junction.exists() else None)
        with self.assertRaises(restore.Error):
            restore.restore(self.zip, self.root, True, True)
        self.assertFalse((outside / "sample.lnk").exists())
        self.assertTrue(self.zip.exists())
