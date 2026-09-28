# Native Windows disk check

Windows junctions can point from a backup folder to files elsewhere on the PC.
In an attended Windows Chrome test, the browser reported these paths missing
and failed to create the already-existing junction directory. Windows could
read the files through the same paths. Repeated browser downloads do not fix
this destination problem.

The included `check-disk.ps1` checks native file metadata without reading file
contents, writing to the original tree, changing junctions, or contacting
Microsoft. It uses Windows PowerShell 5.1 or PowerShell 7; no Python is needed.
Its only output is a new report, created without overwriting any existing file.

1. Finish **Scan OneDrive**, choose the original local folder, **Check disk**,
   then **Save disk report**.
2. In PowerShell, run the included helper with the saved report, that same local
   root, and a new output filename outside the root:

   ```powershell
   .\check-disk.ps1 -Report "$env:USERPROFILE\Downloads\onedrive-disk-report.json" -Root "D:\OneDrive-copy" -Output "$env:USERPROFILE\Downloads\native-check.json" -FollowDirectoryLinks
   ```

   Substitute your actual paths. `-FollowDirectoryLinks` explicitly allows
   read-only metadata checks through directory junctions/symlinks, possibly
   outside the selected root. Omit it to report these paths as conflicts.
   File symlinks and non-file destinations remain conflicts. Do not disable
   system protections if script execution is blocked; review the local script
   and your organization's normal execution policy.

3. In the browser, keep the original folder selected and import the output with
   **Import native disk check**. If the page was refreshed, paste the updated
   tool, scan, select the original folder and check disk first. The import must
   match every current source file's identity, full path, size and modification
   date, and the original folder's name. A changed inventory requires a new
   report/check. Folder names alone cannot identify a physical root: select
   the exact original folder yourself.
4. **Test 3 recovery files** chooses a separate ordinary folder and downloads
   up to three small missing files there. **Copy missing elsewhere** fills that
   same recovery folder on subsequent runs. Select it again when prompted.
5. **Copy size mismatches elsewhere** separately copies OneDrive versions of
   differing or empty local files for review. Existing recovery files are
   preserved too. A destination check runs before every recovery, so completed
   copies are skipped on later runs. Keep the original report imported; do not
   replace it with a full scan of the empty recovery folder.

Original and recovery trees must not overlap. Use an ordinary folder with no
junctions, preferably outside a synced tree. The tool cannot certify that a
browser-selected path has no native aliases, so do not choose a junction target
as the recovery folder. Source requests remain GET-only; imported URLs and
credentials are never used. Imported metadata selects current inventory rows;
source identity is checked again before each download.

Runs default to one download at a time and 5 GiB/10,000-file/one-hour bounds.
Choose Large recovery explicitly for 100 GiB / 12 hours (still 10,000 files).
Only a request or stream with no progress for five minutes times out; large
files may continue while receiving data.
Repeat the relevant recovery button for another batch. Review any timeout or
empty-file conflict before continuing. Save disk reports for results and keep
all reports private. Browser-restricted file types still need the separate ZIP
workflow; unresolved native errors are not treated as missing.

This is an existence and size comparison, not a hash check or a verified backup.
A junction is a reference to another location, not an independent backup copy.
Files with matching sizes can still differ; cloud placeholders may need separate
availability/content verification. Source dates still use the date-repair
workflow. Nothing in this process deletes, repoints or replaces junctions.
