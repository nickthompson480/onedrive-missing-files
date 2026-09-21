# Restore creation and modification dates

Version 1.1 adds an **offline metadata repair tool** for both new and existing downloads. You do not need to download file contents again.

Browser file handles cannot set the native creation or modification date. Downloads therefore initially receive current local dates. After copying, the included Python helper restores the source dates. It uses native timestamp APIs on Windows and macOS; it does not rewrite file contents or connect to Microsoft.

## 1. Export fresh repair metadata

1. Use the v1.1 browser tool. If an older tool is still open, save any reports, refresh OneDrive, and install the new script from **Start here.html**.
2. Complete **Scan OneDrive**. Download missing files if needed; already-downloaded files can remain where they are.
3. Click **Export date repair JSON**. The tool refreshes each file's metadata using your existing OneDrive session and downloads `onedrive-date-repair.json`.

Refreshing metadata can take several minutes on a large drive. Partial exports identify skipped or unrefreshed files; the helper skips those entries. Re-export after interrupted metadata collection. The old inventory CSV/JSON alone is not a repair manifest.

OneDrive's `fileSystemInfo` dates are preferred. If a filesystem date is absent, the service-level date is used, and the manifest identifies that fallback. These dates can differ: the service creation time can reflect the upload date rather than the original file creation date. A modified date earlier than the creation date is valid and is preserved. [Microsoft's timestamp documentation](https://learn.microsoft.com/en-us/graph/api/resources/filesysteminfo?view=graph-rest-1.0).

## 2. Preview locally

Install Python **3.11 or newer** if it is not already available. No Python packages or administrator permissions are required. Open a terminal in the extracted release folder.

On Windows, change the example manifest and destination paths, then run:

```powershell
py -3 repair-dates.py --manifest "C:\Downloads\onedrive-date-repair.json" --root "D:\OneDriveCopy" --report "dates-preview.jsonl"
```

On macOS:

```sh
python3 repair-dates.py --manifest "/path/to/onedrive-date-repair.json" --root "/path/to/OneDriveCopy" --report "dates-preview.jsonl"
```

Use the **same local root** selected in the browser. For example, `/Documents/Report.pdf` maps to `<root>/Documents/Report.pdf`.

Preview verifies file contents and records proposed changes. It does not explicitly set timestamps; as with other file reads, the OS may update last-access metadata. Keep the target idle and stop browser downloads before repair. Store the report **outside** the target root.

## 3. Apply the verified dates

Review the preview report. Re-run with `--apply` and a new report filename:

```powershell
py -3 repair-dates.py --manifest "C:\Downloads\onedrive-date-repair.json" --root "D:\OneDriveCopy" --report "dates-applied.jsonl" --apply
```

Use `python3` instead of `py -3` on macOS. Each file is verified again before the dates are set; a previous preview is never treated as permission to skip current verification.

The report records a durable `prepared` entry with old and intended dates before each change, followed by `applied` with the observed dates. Times are stored as Unix-epoch nanoseconds, so timezone presentation does not change their meaning. Each new report uses exclusive creation and never replaces an existing report.

Verification allows one microsecond for OS timestamp representation. If the OS rejects a timestamp or cannot preserve it within that tolerance, the report records an error and whether metadata may have changed. Timestamp operations are not a transactional batch and there is no automatic undo command; retain the report. File bytes are never rewritten. OS metadata-change time (`ctime` on Unix) necessarily changes when attributes change; it is not the creation date and is not restored.

## What is eligible

- A file must exist at the full relative path, have the expected size, and match the refreshed **SHA-256** hash, or **SHA-1** when SHA-256 is unavailable.
- Size alone and QuickXor are not accepted as proof of matching content. Files without a supported hash are skipped.
- Missing files, changed files, invalid dates, unavailable metadata, conflicting paths, symlinks, Windows reparse points/junctions, hardlinks, and paths crossing a mount boundary are skipped.
- Windows targets must be on a local drive, not a UNC/network path. Use the real local folder path, not a symlink or junction.
- By default, only regular files are repaired. Use `--include-folders` to opt into existing folder dates. Folder identity is based on path/type, not a content hash; those dates come from the inventory snapshot. Folders are handled deepest-first after files, and no folder is created.
- `--modified-only` leaves creation dates alone. Linux supports only this mode; it does not pretend that Unix `ctime` is a creation timestamp.
- The default hashing limit is **100 GiB** and the time limit is **one hour**. Adjust `--max-bytes` and `--max-seconds` explicitly for a larger run. A stopped run reports its limit; run again with an appropriate budget to finish.

The terminal prints counts, not filenames. The JSONL report and manifest contain private paths and hashes; keep them local. Exit code `0` means all selected entries completed or already matched, `2` means skips/errors or a limit, and `1` means the run could not start or the report could not be written.

## Technical basis

- Browser [File System Access](https://fs.spec.whatwg.org/#api-filesystemwritablefilestream) exposes content writes, not native date setters.
- Windows uses [SetFileTime](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfiletime) on the same opened handle used for verification.
- macOS uses the descriptor-based `fsetattrlist` variant of [setattrlist](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setattrlist.2.html) for creation/modification together. This avoids the birth-time adjustment that can occur when setting only an earlier modification time.
- Linux modification-only repair uses descriptor-based `utime`.

Open handles and checks reduce path races, but this tool is not a sandbox against an adversarial local process. Keep the directory idle. Different filesystems have different date ranges and precision; unsupported behavior is reported rather than silently claimed successful.
