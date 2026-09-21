#!/usr/bin/env python3
"""Restore one original file per tool-generated ZIP. Preview unless --apply."""

import argparse
import contextlib
import ctypes
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import zipfile

spec = importlib.util.spec_from_file_location(
    "repair_dates", Path(__file__).with_name("repair-dates.py")
)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)
Error = repair.RepairError
LIMIT = 16 * 1024**2


def read_archive(data):
    if len(data) > LIMIT + 65536:
        raise Error("archive_size_limit")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if len(z.infolist()) != 1 or len(z.comment) > 16384:
            raise Error("expected_single_file_zip")
        item = z.infolist()[0]
        meta = json.loads(z.comment)
        if (
            not isinstance(meta, dict)
            or meta.get("kind") != "onedrive-single-file"
            or meta.get("version") != 1
        ):
            raise Error("not_a_tool_generated_zip")
        parts = repair.path_parts(meta.get("path"))
        if (
            item.filename != "/".join(parts)
            or item.orig_filename != item.filename
            or item.is_dir()
        ):
            raise Error("archive_path_mismatch")
        if not re.search(r"\.(lnk|ini|url|scf)$", parts[-1], re.I):
            raise Error("not_a_restricted_file")
        mode = item.external_attr >> 16
        if (
            stat.S_IFMT(mode) not in (0, stat.S_IFREG)
            or item.flag_bits & 1
            or item.compress_type != zipfile.ZIP_STORED
        ):
            raise Error("unsupported_archive_entry")
        if (
            type(meta.get("size")) is not int
            or not 0 <= meta["size"] <= LIMIT
            or item.file_size != meta["size"]
            or item.compress_size != item.file_size
        ):
            raise Error("archive_size_mismatch")
        if not isinstance(meta.get("sha256"), str) or not re.fullmatch(
            r"[a-f0-9]{64}", meta["sha256"]
        ):
            raise Error("invalid_hash")
        content = z.read(item)
        if hashlib.sha256(content).hexdigest() != meta["sha256"]:
            raise Error("archive_hash_mismatch")
        for key in ("fileCreated", "fileModified"):
            if meta.get(key) is not None:
                repair.date_ns(meta[key])
        return parts, meta, content


@contextlib.contextmanager
def parent_handle(root, parts, create=False):
    """Pin Windows ancestors; use relative no-follow opens on POSIX."""
    root = Path(os.path.abspath(root))
    with contextlib.ExitStack() as stack:
        if os.name == "nt":
            if not root.drive or str(root).startswith("\\\\"):
                raise Error("use_a_local_drive")
            parent = Path(root.anchor)
            for component in (None, *root.parts[1:]):
                if component is not None:
                    parent /= component
                handle = repair.win_open(parent, True, False)
                stack.callback(repair.kernel.CloseHandle, handle)
            for component in parts[:-1]:
                parent /= component
                if create:
                    try:
                        parent.mkdir()
                    except FileExistsError:
                        pass
                handle = repair.win_open(parent, True, False)
                stack.callback(repair.kernel.CloseHandle, handle)
            yield parent
        else:
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            fd = os.open(root.anchor, flags)
            stack.callback(os.close, fd)
            for component in root.parts[1:]:
                fd = os.open(component, flags, dir_fd=fd)
                stack.callback(os.close, fd)
            device = os.fstat(fd).st_dev
            for component in parts[:-1]:
                if create:
                    try:
                        os.mkdir(component, mode=0o700, dir_fd=fd)
                    except FileExistsError:
                        pass
                fd = os.open(component, flags, dir_fd=fd)
                stack.callback(os.close, fd)
                if os.fstat(fd).st_dev != device:
                    raise Error("mount_boundary")
            yield fd


@contextlib.contextmanager
def target_file(parent, name, create=False):
    if os.name == "nt":
        # CREATE_NEW never overwrites. OPEN_REPARSE_POINT rejects link targets.
        handle = repair.kernel.CreateFileW(
            str(parent / name),
            0xC0000000 if create else 0x80000000,
            1,
            None,
            1 if create else 3,
            0x00200000,
            None,
        )
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            info = repair.FileInfo()
            if not repair.kernel.GetFileInformationByHandle(handle, ctypes.byref(info)):
                raise ctypes.WinError(ctypes.get_last_error())
            if info.attributes & (0x400 | 0x10) or info.links != 1:
                raise Error("link_or_type_conflict")
            fd = repair.msvcrt.open_osfhandle(
                handle, os.O_BINARY | (os.O_RDWR if create else os.O_RDONLY)
            )
        except BaseException:
            repair.kernel.CloseHandle(handle)
            raise
    else:
        flags = (
            os.O_NOFOLLOW
            | os.O_NONBLOCK
            | (os.O_RDWR | os.O_CREAT | os.O_EXCL if create else os.O_RDONLY)
        )
        fd = os.open(name, flags, 0o600, dir_fd=parent)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise Error("link_or_type_conflict")
        yield fd
    finally:
        os.close(fd)


def digest_file(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    hasher = hashlib.sha256()
    total = 0
    while data := os.read(fd, 1024**2):
        total += len(data)
        if total > LIMIT:
            raise Error("existing_file_size_limit")
        hasher.update(data)
    return hasher.hexdigest()


def restore(path, root, apply=False, delete_zip=False):
    path, root = Path(os.path.abspath(path)), Path(os.path.abspath(root))
    # Validate and snapshot the exact supplied ZIP, never execute its contents.
    with repair.open_target(path.parent, [path.name]) as source:
        original = os.fstat(source)
        if original.st_size > LIMIT + 65536:
            raise Error("archive_size_limit")
        data = bytearray()
        while chunk := os.read(source, 1024**2):
            data.extend(chunk)
            if len(data) > LIMIT + 65536:
                raise Error("archive_size_limit")
        if repair.signature(original) != repair.signature(os.fstat(source)):
            raise Error("archive_changed")
        parts, meta, content = read_archive(data)
        try:
            with (
                parent_handle(root, parts) as parent,
                target_file(parent, parts[-1]) as fd,
            ):
                if (
                    os.fstat(fd).st_size != meta["size"]
                    or digest_file(fd) != meta["sha256"]
                ):
                    raise Error("existing_different_file_preserved")
                outcome = "already_identical"
        except FileNotFoundError:
            outcome = "would_restore"
            if apply:
                with (
                    parent_handle(root, parts, create=True) as parent,
                    target_file(parent, parts[-1], create=True) as fd,
                ):
                    view = memoryview(content)
                    while view:
                        written = os.write(fd, view)
                        if written <= 0:
                            raise Error("short_write")
                        view = view[written:]
                    os.fsync(fd)
                    if digest_file(fd) != meta["sha256"]:
                        raise Error("restored_hash_mismatch")
                    if meta.get("fileModified"):
                        created = (
                            repair.date_ns(meta["fileCreated"])
                            if meta.get("fileCreated")
                            and (os.name == "nt" or sys.platform == "darwin")
                            else None
                        )
                        modified = repair.date_ns(meta["fileModified"])
                        repair.set_times(fd, created, modified)
                        after = repair.times(fd)
                        if not repair.close_enough(after["modifiedNs"], modified) or (
                            created is not None
                            and not repair.close_enough(after["createdNs"], created)
                        ):
                            raise Error("date_readback_failed")
                    outcome = "restored"
        # Verify by reopening the final path, including files already present.
        if apply:
            with (
                parent_handle(root, parts) as parent,
                target_file(parent, parts[-1]) as fd,
            ):
                if digest_file(fd) != meta["sha256"]:
                    raise Error("final_readback_failed")
    deleted = False
    if apply and delete_zip:
        if repair.signature(path.lstat()) != repair.signature(original):
            raise Error("archive_changed_keep_zip")
        # Cleanup is limited to the explicit input archive after successful readback.
        path.unlink()
        deleted = True
    return {"path": meta["path"], "status": outcome, "zipDeleted": deleted}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "zip_folder", type=Path, help="Folder containing onedrive-file-*.zip"
    )
    parser.add_argument(
        "--root",
        required=True,
        type=Path,
        help="Existing destination matching the top of My files",
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--delete-zip",
        action="store_true",
        help="Delete each ZIP only after verified restoration",
    )
    args = parser.parse_args()
    if args.delete_zip and not args.apply:
        parser.error("--delete-zip requires --apply")
    files = sorted(args.zip_folder.glob("onedrive-file-*.zip"))
    if not files or len(files) > 1000:
        parser.error("Expected 1–1000 onedrive-file-*.zip files")
    if sum(path.stat().st_size for path in files) > 96 * 1024**2:
        parser.error("ZIP batch exceeds 96 MiB")
    failed = 0
    started = time.monotonic()
    for path in files:
        try:
            if time.monotonic() - started > 900:
                raise Error("time_budget_keep_remaining_zips")
            print(
                json.dumps(
                    {
                        "zip": path.name,
                        **restore(path, args.root, args.apply, args.delete_zip),
                    }
                )
            )
        except (
            OSError,
            ValueError,
            Error,
            zipfile.BadZipFile,
            KeyError,
            TypeError,
        ) as exc:
            failed += 1
            print(
                json.dumps(
                    {
                        "zip": path.name,
                        "status": "kept_zip",
                        "error": str(exc)
                        if isinstance(exc, Error)
                        else type(exc).__name__,
                    }
                )
            )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
