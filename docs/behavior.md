# OneDrive inventory and missing-file copier

Runs inside a signed-in **OneDrive Personal** tab in desktop Chrome or Edge,
on Windows or macOS. It uses the existing Microsoft session; there is no
separate account, installation, or app registration.

## Start

Open the portable package's **Start here.html** and follow its steps. It has a
Copy tool button and the full reviewable source. In the OneDrive developer
Console, paste the tool and press **Ctrl+Enter** (both platforms), then close
developer tools. Chrome may require the user to manually enable pasting.

To build the portable package from source:

```sh
npm run build
```

The output is `dist/onedrive-missing-files/`. You may instead concatenate
`inventory.js` and `disk-tools.js` and paste the result. Refreshing OneDrive
removes the tool; paste it again for a later run. Keep the tab open while working.

## Workflow

1. **Scan OneDrive** enumerates the whole ordinary My files hierarchy, regardless
   of which folder is open in the webpage. Export JSON, CSV or a plain file list.
2. **Choose local folder** opens the browser's folder picker. Select the folder
   corresponding to the top of My files and approve browser access.
3. **Check disk** compares full relative paths and reports missing files,
   existing files, size differences, name conflicts and unsupported items.
   This step makes no disk changes and does not upload local file metadata.
4. **Test 3 small files** copies up to three missing nonempty files, each at most
   1 MiB, plus their parent folders. Run Check disk again afterward.
5. **Download missing** creates missing folders and downloads missing ordinary
   files into the selected tree. Existing files are skipped, including files
   whose sizes differ. Local-only files remain untouched. Recheck to resume.
6. **Save disk report** retains comparison details and download outcomes locally.

For example, `/Documents/Report.pdf` maps to
`<your-selected-folder>/Documents/Report.pdf`. A file with the same name elsewhere
is not considered present. Matching sizes do not prove identical contents.

## Coverage and failure behavior

- Bulk delta pagination runs to Microsoft's terminal marker, resolves paths by
  parent IDs, applies latest records/deletion markers and reconciles reported
  folder child counts. Deleted records affect only the inventory, never disk.
- The tested recursive collector remains available in the source library. It
  supports slash and observed OData quoted-item pagination forms.
- Missing parents, path collisions, unexpected pages, incomplete traversal,
  access errors and budgets are explicit. Disk operations require terminal
  enumeration without unresolved structural errors.
- Personal Vault is **not covered**. The API can omit its visible tile entirely.
  Shared-with-me content outside My files, remote shortcut targets, recycle
  bin, versions and OneNote/package internals are also not covered. Returned
  shortcut/package entries are retained but never downloaded as ordinary files.
- Windows-invalid names, reserved names, case/Unicode collisions, file-versus-
  folder conflicts and unreadable paths are reported, not silently renamed.
  Native Windows long-path behavior still requires a Windows acceptance test.
- Remote name, parent, size and modification time are rechecked before download.
  Only first-party HTTPS download hosts are accepted. Temporary download links
  stay in memory and are not exported; file data is streamed to disk.
- Downloaded byte counts and resulting file sizes are checked. This is not a
  cryptographic content check or a complete verified backup.
- Keep the target folder idle. Existing paths are rechecked before creation;
  the browser API does not offer an atomic create-if-absent operation against
  unrelated applications racing to create the same name. An interrupted write
  may leave a newly created empty placeholder. It is reported as a size mismatch
  on the next check and is never automatically deleted or overwritten.
- Closing/reloading the page loses unsaved reports. **Stop downloads** stops at
  the current file. Completed files are preserved and skipped on a later check.
- Inventory bounds: 1,000,000 items, 10,000 requests, 15 minutes, 30 seconds per
  request. Download bounds: 10,000 files, 5 GiB, one hour, five minutes per file.
  Hitting a bound produces a partial report, never a completion claim.
  **Resume scan** continues after a time/request interruption while the tab stays
  open. A hard item limit requires adjusting the collector limit; it cannot be
  bypassed by repeatedly resuming. Continuation links stay in memory and are not
  included in exports.
- CSV includes item metadata and folder coverage. JSON/text also retain scan
  limitations and issues. Treat all exports and disk reports as private.

## Implementation boundary

The adapter uses the observed same-origin
`/personal/<account>/_api/v2.0/drive` website interface with existing cookies.
This interface is undocumented and may change; this is not an unattended OAuth
client. OneDrive source requests are GET-only. File downloads are read-only
HTTPS requests. All writes go to the user-selected local folder or local exports.
No upload, remote update, remote delete, local delete or overwrite mode exists.

The [Microsoft Graph download guidance](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)
describes browser downloads through temporary download URLs. Chrome documents
[File System Access support](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
on desktop Windows and macOS. Runtime support is checked before enabling disk
controls; native Windows behavior is not claimed proven by Mac tests.

## Validation

```sh
node --check src/inventory.js
node --check src/disk-tools.js
node --test test/*.test.cjs
```

Tests use synthetic data and fake File System Access handles. Private live
exports belong in ignored local/private locations and must not be committed.
