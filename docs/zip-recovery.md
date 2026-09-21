# One original file per ZIP

After scanning OneDrive and checking disk, choose **Download restricted ZIPs**
in Files & dates. Pick a separate local folder for the ZIPs. The tool collects
only files reported as browser-restricted (`.lnk`, `.ini`, `.url`, `.scf`).

Each ZIP contains **exactly one original file**, under its original relative
folder path. No manifest file is added. A small ZIP comment holds its size,
SHA-256 and dates. The tool verifies the content against OneDrive's hash before
packing and verifies the saved ZIP. It creates the ZIP locally from existing
OneDrive GET downloads; it does not call an undocumented Microsoft ZIP service.
Limits: 1,000 files, 16 MiB per file, 64 MiB total source bytes, 15 minutes per
export, five minutes per request. Only one ZIP is processed at a time. Stop keeps
completed ZIPs. A failed ZIP may remain incomplete and is never reported verified.

The browser cannot expand restricted filenames into place. Use the included
Python 3.11+ helper on Windows (Mac/Linux are also supported). Keep
`restore-zip.py` beside `repair-dates.py`, which provides shared path/date checks.
It does not execute shortcuts, visit URL targets, install anything or use the
network. A shortcut may still refer to a location that existed only on its old PC.

## Preview, restore, clean up

Create or choose a destination matching the top of My files. For example, a ZIP
entry `Documents/example.lnk` maps to `C:\Recovery\Documents\example.lnk`.
The destination root must already exist. From the extracted tool folder:

```powershell
py -3 restore-zip.py "C:\ZIPs" --root "C:\Recovery"
```

Preview validates each archive and checks destinations without creating files.
Apply and delete each successfully verified ZIP:

```powershell
py -3 restore-zip.py "C:\ZIPs" --root "C:\Recovery" --apply --delete-zip
```

Substitute your own folders. On Mac/Linux use `python3` instead of `py -3`.
The helper selects only `onedrive-file-*.zip` in the ZIP folder. It restores
missing files, preserves existing differing files, and verifies SHA-256 by
reopening the destination. Existing identical files count as verified and are
left unchanged. New files receive source modification dates, and creation dates
on Windows/macOS when supplied. Linux restores modification dates only.

**A failed or conflicting file keeps its ZIP.** Incomplete native writes can
leave a partial destination; it is not automatically overwritten on retry.
Without `--delete-zip`, every ZIP remains. Cleanup never deletes source OneDrive
items or destination files. Review the per-ZIP results printed by the helper.

Keep both folders idle. Links, junctions, reparse points and special files are
rejected. A OneDrive placeholder can therefore be rejected by the helper; use a
plain recovery folder outside OneDrive in that case. Ordinary ZIP tools can also
extract these standard ZIPs, but do not perform the helper's source-metadata checks
or conditional cleanup. The embedded hash detects corruption; it is not a digital
signature proving who supplied an archive.

[Microsoft's ZIP download instructions](https://support.microsoft.com/en-us/onedrive/download-files-and-folders-from-onedrive-or-sharepoint)
confirm that the OneDrive website supports ZIP downloads for multiple selections.
This tool's per-file packaging avoids selecting many scattered files manually.
