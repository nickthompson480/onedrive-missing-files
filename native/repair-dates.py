#!/usr/bin/env python3
"""Offline, content-verified OneDrive timestamp restoration. Preview by default."""

import argparse
import calendar
import contextlib
import ctypes
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import unicodedata


class RepairError(Exception):
    pass


def date_ns(value):
    if not isinstance(value, str):
        raise RepairError("source_date_missing")
    match = re.fullmatch(
        r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})",
        value,
    )
    if not match:
        raise RepairError("invalid_source_date")
    try:
        value_dt = dt.datetime.fromisoformat(
            match[1] + match[3].replace("Z", "+00:00")
        ).astimezone(dt.timezone.utc)
        seconds = calendar.timegm(value_dt.timetuple())
    except ValueError as exc:
        raise RepairError("invalid_source_date") from exc
    return seconds * 1_000_000_000 + int((match[2] or "").ljust(9, "0"))


def path_parts(value):
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or value.startswith("//")
    ):
        raise RepairError("invalid_path")
    parts = value[1:].split("/")
    for part in parts:
        if (
            not part
            or part in (".", "..")
            or re.search(r'[<>:"\\|?*\x00-\x1f]', part)
            or part.endswith((".", " "))
            or len(part.encode("utf-16-le")) // 2 > 255
            or re.match(
                r"^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)", part, re.I
            )
        ):
            raise RepairError("unsafe_or_windows_incompatible_path")
    return parts


def key(value):
    return unicodedata.normalize("NFC", value).casefold()


def manifest_items(manifest):
    if (
        not isinstance(manifest, dict)
        or manifest.get("kind") != "onedrive-date-repair"
        or manifest.get("version") != 1
        or manifest.get("terminalReached") is not True
        or not isinstance(manifest.get("items"), list)
    ):
        raise RepairError("export_a_fresh_date_repair_manifest")
    items = manifest["items"]
    if len(items) > 1_000_000 or any(not isinstance(x, dict) for x in items):
        raise RepairError("invalid_manifest_items")
    counts = {}
    for row in items:
        value = row.get("path")
        if isinstance(value, str):
            counts[key(value)] = counts.get(key(value), 0) + 1
    return items, {p for p, n in counts.items() if n > 1}


if os.name == "nt":
    import msvcrt
    from ctypes import wintypes as wt

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)

    class FileTime(ctypes.Structure):
        _fields_ = [("low", wt.DWORD), ("high", wt.DWORD)]

    class FileInfo(ctypes.Structure):
        _fields_ = [
            ("attributes", wt.DWORD),
            ("created", FileTime),
            ("accessed", FileTime),
            ("modified", FileTime),
            ("volume", wt.DWORD),
            ("sizeHigh", wt.DWORD),
            ("sizeLow", wt.DWORD),
            ("links", wt.DWORD),
            ("indexHigh", wt.DWORD),
            ("indexLow", wt.DWORD),
        ]

    kernel.CreateFileW.argtypes = [
        wt.LPCWSTR,
        wt.DWORD,
        wt.DWORD,
        ctypes.c_void_p,
        wt.DWORD,
        wt.DWORD,
        wt.HANDLE,
    ]
    kernel.CreateFileW.restype = wt.HANDLE
    kernel.CloseHandle.argtypes = [wt.HANDLE]
    kernel.CloseHandle.restype = wt.BOOL
    kernel.GetFileInformationByHandle.argtypes = [wt.HANDLE, ctypes.POINTER(FileInfo)]
    kernel.GetFileInformationByHandle.restype = wt.BOOL
    kernel.GetFileTime.argtypes = [
        wt.HANDLE,
        ctypes.POINTER(FileTime),
        ctypes.POINTER(FileTime),
        ctypes.POINTER(FileTime),
    ]
    kernel.GetFileTime.restype = wt.BOOL
    kernel.SetFileTime.argtypes = [
        wt.HANDLE,
        ctypes.POINTER(FileTime),
        ctypes.POINTER(FileTime),
        ctypes.POINTER(FileTime),
    ]
    kernel.SetFileTime.restype = wt.BOOL

    def win_open(path, directory, apply):
        # Hold each ancestor without write/delete sharing; never traverse a reparse point.
        access = 0x80 if directory else 0x80000000  # attributes or GENERIC_READ
        if apply:
            access |= 0x100  # FILE_WRITE_ATTRIBUTES, never FILE_WRITE_DATA
        handle = kernel.CreateFileW(
            str(path), access, 1, None, 3, 0x00200000 | 0x02000000, None
        )
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        info = FileInfo()
        if not kernel.GetFileInformationByHandle(handle, ctypes.byref(info)):
            error = ctypes.get_last_error()
            kernel.CloseHandle(handle)
            raise ctypes.WinError(error)
        if info.attributes & 0x400 or bool(info.attributes & 0x10) != directory:
            kernel.CloseHandle(handle)
            raise RepairError("reparse_point_or_type_conflict")
        return handle

    def from_filetime(value):
        return (((value.high << 32) | value.low) - 116444736000000000) * 100

    def to_filetime(value):
        ticks = value // 100 + 116444736000000000
        if not 0 <= ticks < 2**64:
            raise RepairError("unsupported_date_range")
        return FileTime(ticks & 0xFFFFFFFF, ticks >> 32)


@contextlib.contextmanager
def open_target(root, parts, directory=False, apply=False):
    """Keep root and ancestors open, reject links/mounts, operate on the opened object."""
    root = Path(os.path.abspath(root))
    with contextlib.ExitStack() as stack:
        if os.name == "nt":
            if not root.drive or str(root).startswith("\\\\"):
                raise RepairError("use_a_local_drive_root")
            parent = Path(root.anchor)
            handle = win_open(parent, True, False)
            stack.callback(kernel.CloseHandle, handle)
            for component in root.parts[1:]:
                parent /= component
                handle = win_open(parent, True, False)
                stack.callback(kernel.CloseHandle, handle)
            root_info = FileInfo()
            if not kernel.GetFileInformationByHandle(handle, ctypes.byref(root_info)):
                raise ctypes.WinError(ctypes.get_last_error())
            for component in parts[:-1]:
                parent /= component
                handle = win_open(parent, True, False)
                stack.callback(kernel.CloseHandle, handle)
            handle = win_open(parent / parts[-1], directory, apply)
            final_info = FileInfo()
            if not kernel.GetFileInformationByHandle(handle, ctypes.byref(final_info)):
                error = ctypes.get_last_error()
                kernel.CloseHandle(handle)
                raise ctypes.WinError(error)
            if final_info.volume != root_info.volume:
                kernel.CloseHandle(handle)
                raise RepairError("mount_boundary")
            try:
                fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
            except BaseException:
                kernel.CloseHandle(handle)
                raise
            stack.callback(os.close, fd)
        else:
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            parent_fd = os.open(root.anchor, flags)
            stack.callback(os.close, parent_fd)
            for component in root.parts[1:]:
                parent_fd = os.open(component, flags, dir_fd=parent_fd)
                stack.callback(os.close, parent_fd)
            device = os.fstat(parent_fd).st_dev
            for component in parts[:-1]:
                parent_fd = os.open(component, flags, dir_fd=parent_fd)
                stack.callback(os.close, parent_fd)
                if os.fstat(parent_fd).st_dev != device:
                    raise RepairError("mount_boundary")
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if directory:
                flags |= os.O_DIRECTORY
            fd = os.open(parts[-1], flags, dir_fd=parent_fd)
            stack.callback(os.close, fd)
            if os.fstat(fd).st_dev != device:
                raise RepairError("mount_boundary")
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = os.fstat(fd)
        if not (
            stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
        ):
            raise RepairError("type_conflict")
        if not directory and info.st_nlink != 1:
            raise RepairError("hardlinked_file")
        yield fd


def times(fd):
    info = os.fstat(fd)
    created = getattr(info, "st_birthtime_ns", None)
    if created is None and hasattr(info, "st_birthtime"):
        created = round(info.st_birthtime * 1_000_000_000)
    if os.name == "nt":
        birth, access, modified = FileTime(), FileTime(), FileTime()
        if not kernel.GetFileTime(
            msvcrt.get_osfhandle(fd),
            ctypes.byref(birth),
            ctypes.byref(access),
            ctypes.byref(modified),
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        return {
            "createdNs": from_filetime(birth),
            "modifiedNs": from_filetime(modified),
        }
    return {"createdNs": created, "modifiedNs": info.st_mtime_ns}


def set_times(fd, created, modified):
    if os.name == "nt":
        birth = to_filetime(created) if created is not None else None
        write = to_filetime(modified)
        if not kernel.SetFileTime(
            msvcrt.get_osfhandle(fd),
            ctypes.byref(birth) if birth else None,
            None,
            ctypes.byref(write),
        ):
            raise ctypes.WinError(ctypes.get_last_error())
    elif sys.platform == "darwin":
        # utime can move APFS birth time backward when mtime is earlier. Set
        # both attributes together, preserving birth time in modified-only mode.
        if created is None:
            created = times(fd)["createdNs"]

        class AttrList(ctypes.Structure):
            _fields_ = [
                ("count", ctypes.c_ushort),
                ("reserved", ctypes.c_ushort),
                ("common", ctypes.c_uint32),
                ("volume", ctypes.c_uint32),
                ("directory", ctypes.c_uint32),
                ("file", ctypes.c_uint32),
                ("fork", ctypes.c_uint32),
            ]

        class Timespec(ctypes.Structure):
            _fields_ = [("seconds", ctypes.c_long), ("nanoseconds", ctypes.c_long)]

        class Values(ctypes.Structure):
            _fields_ = [("created", Timespec), ("modified", Timespec)]

        attrs = AttrList(5, 0, 0x200 | 0x400, 0, 0, 0, 0)
        values = Values(
            Timespec(*divmod(created, 10**9)), Timespec(*divmod(modified, 10**9))
        )
        libc = ctypes.CDLL(None, use_errno=True)
        libc.fsetattrlist.argtypes = [
            ctypes.c_int,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_size_t,
            ctypes.c_uint,
        ]
        libc.fsetattrlist.restype = ctypes.c_int
        if libc.fsetattrlist(
            fd, ctypes.byref(attrs), ctypes.byref(values), ctypes.sizeof(values), 0
        ):
            raise OSError(ctypes.get_errno(), "fsetattrlist_failed")
    else:
        if created is not None:
            raise RepairError("creation_time_unsupported_use_modified_only")
        os.utime(fd, ns=(os.fstat(fd).st_atime_ns, modified))


def close_enough(actual, desired):
    return actual is not None and abs(actual - desired) <= 1000


def signature(info):
    return (
        info.st_dev,
        info.st_ino,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
        info.st_nlink,
    )


def repair(
    manifest,
    root,
    emit,
    apply=False,
    modified_only=False,
    include_folders=False,
    max_bytes=100 * 1024**3,
    max_seconds=3600,
):
    items, collisions = manifest_items(manifest)
    if max_bytes <= 0 or max_seconds <= 0:
        raise RepairError("invalid_budget")
    started = time.monotonic()
    total_bytes = 0
    summary = {
        "mode": "apply" if apply else "preview",
        "ready": 0,
        "applied": 0,
        "unchanged": 0,
        "skipped": 0,
        "errors": 0,
        "bytesHashed": 0,
    }
    # Child metadata first, then directories deepest-first. Never create a path.
    ordered = sorted(
        items,
        key=lambda x: (x.get("type") == "folder", -str(x.get("path", "")).count("/")),
    )
    for row in ordered:
        kind = row.get("type")
        if kind not in ("file", "folder") or (kind == "folder" and not include_folders):
            continue
        event = {"path": row.get("path"), "type": kind}
        try:
            if time.monotonic() - started >= max_seconds:
                raise RepairError("time_budget")
            parts = path_parts(row.get("path"))
            if any(
                key("/" + "/".join(parts[:i])) in collisions
                for i in range(1, len(parts) + 1)
            ):
                raise RepairError("case_or_unicode_collision")
            if row.get("repairError") and not (
                modified_only and row["repairError"] == "source_dates_missing"
            ):
                raise RepairError("source_metadata_unavailable")
            created = None if modified_only else date_ns(row.get("fileCreated"))
            modified = date_ns(row.get("fileModified"))
            if created is not None and os.name != "nt" and sys.platform != "darwin":
                raise RepairError("creation_time_unsupported_use_modified_only")
            algorithm = None
            if kind == "file":
                for name, length in [("sha256", 64), ("sha1", 40)]:
                    value = row.get(name)
                    if value is not None:
                        if not isinstance(value, str) or not re.fullmatch(
                            "[a-fA-F0-9]{" + str(length) + "}", value
                        ):
                            raise RepairError("invalid_source_hash")
                        algorithm = name
                        expected = value.lower()
                        break
                if not algorithm:
                    raise RepairError("cryptographic_hash_missing")
                if type(row.get("size")) is not int or row["size"] < 0:
                    raise RepairError("invalid_source_size")
            with open_target(
                root, parts, directory=kind == "folder", apply=apply
            ) as fd:
                original = os.fstat(fd)
                if kind == "file":
                    if original.st_size != row["size"]:
                        raise RepairError("size_mismatch")
                    if total_bytes + original.st_size > max_bytes:
                        raise RepairError("byte_budget")
                    digest = hashlib.new(algorithm)
                    while True:
                        if time.monotonic() - started >= max_seconds:
                            raise RepairError("time_budget")
                        chunk = os.read(fd, 4 * 1024**2)
                        if not chunk:
                            break
                        total_bytes += len(chunk)
                        if total_bytes > max_bytes:
                            raise RepairError("byte_budget")
                        digest.update(chunk)
                    if digest.hexdigest() != expected:
                        raise RepairError("hash_mismatch")
                    event["verifiedHash"] = algorithm
                if signature(original) != signature(os.fstat(fd)):
                    raise RepairError("file_changed_during_check")
                before = times(fd)
                target = {
                    "createdNs": created
                    if created is not None
                    else before["createdNs"],
                    "modifiedNs": modified,
                }
                event.update(before=before, target=target)
                if close_enough(before["modifiedNs"], modified) and (
                    created is None or close_enough(before["createdNs"], created)
                ):
                    summary["unchanged"] += 1
                    emit(dict(event, status="unchanged"))
                    continue
                if not apply:
                    summary["ready"] += 1
                    emit(dict(event, status="ready"))
                    continue
                # emit must durably save the journal entry before changing metadata.
                emit(dict(event, status="prepared"))
                if signature(original) != signature(os.fstat(fd)):
                    raise RepairError("file_changed_before_apply")
                try:
                    set_times(fd, created, modified)
                    after = times(fd)
                    event["after"] = after
                    if not close_enough(after["modifiedNs"], modified) or (
                        target["createdNs"] is not None
                        and not close_enough(after["createdNs"], target["createdNs"])
                    ):
                        raise RepairError("timestamp_not_preserved_by_filesystem")
                except (OSError, RepairError):
                    event["after"] = times(fd)
                    event["mayHaveChangedMetadata"] = True
                    raise
                summary["applied"] += 1
                emit(dict(event, status="applied"))
        except (RepairError, OSError, ValueError) as exc:
            reason = (
                str(exc)
                if isinstance(exc, RepairError)
                else (
                    "missing"
                    if isinstance(exc, FileNotFoundError)
                    else "os_error_"
                    + str(
                        getattr(exc, "winerror", None)
                        or getattr(exc, "errno", None)
                        or type(exc).__name__
                    )
                )
            )
            summary["skipped"] += 1
            if event.get("mayHaveChangedMetadata"):
                summary["errors"] += 1
            emit(
                dict(
                    event,
                    status="error"
                    if event.get("mayHaveChangedMetadata")
                    else "skipped",
                    reason=reason,
                )
            )
            if reason in ("time_budget", "byte_budget"):
                summary["stopped"] = reason
                break
    summary["bytesHashed"] = total_bytes
    emit({"status": "summary", **summary})
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        required=True,
        type=Path,
        help="Fresh Export date repair JSON from the browser tool",
    )
    parser.add_argument(
        "--root",
        required=True,
        type=Path,
        help="Same local root selected in the browser",
    )
    parser.add_argument(
        "--report",
        required=True,
        type=Path,
        help="New JSONL report path, outside the target folder; never overwritten",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply dates after verifying file contents; default is preview",
    )
    parser.add_argument(
        "--modified-only",
        action="store_true",
        help="Leave creation dates alone (required on Linux)",
    )
    parser.add_argument(
        "--include-folders",
        action="store_true",
        help="Also set existing folder dates from inventory metadata, without content identity verification",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=100 * 1024**3,
        help="Hashing byte budget (default 100 GiB)",
    )
    parser.add_argument(
        "--max-seconds", type=int, default=3600, help="Time budget (default one hour)"
    )
    args = parser.parse_args(argv)
    try:
        if args.manifest.stat().st_size > 512 * 1024**2:
            raise RepairError("manifest_too_large")
        manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        manifest_items(manifest)
        if not args.root.is_dir():
            raise RepairError("root_is_not_directory")
        report_path = args.report.resolve()
        if report_path.is_relative_to(args.root.resolve()):
            raise RepairError("save_report_outside_target_folder")
        fd = os.open(args.report, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as output:

            def emit(event):
                output.write(json.dumps(event, ensure_ascii=True) + "\n")
                output.flush()
                if event.get("status") in ("prepared", "applied", "error", "summary"):
                    os.fsync(output.fileno())

            result = repair(
                manifest,
                args.root,
                emit,
                args.apply,
                args.modified_only,
                args.include_folders,
                args.max_bytes,
                args.max_seconds,
            )
        print(json.dumps(result))
        return (
            2 if result["skipped"] or result["errors"] or result.get("stopped") else 0
        )
    except (RepairError, OSError, ValueError) as exc:
        print(
            "Stopped: "
            + (str(exc) if isinstance(exc, RepairError) else type(exc).__name__),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
