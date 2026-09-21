# OneDrive Missing Files

List your **OneDrive Personal** files and folders, compare them with a local folder, and download the files that are missing.

Runs inside your signed-in OneDrive tab in desktop **Chrome or Edge**. No app registration, separate login, extension, or installed OneDrive client is required. The downloaded tool has no runtime dependencies.

## Get started

1. [Download the latest release](https://github.com/nickthompson480/onedrive-missing-files/releases/latest) and unzip it.
2. Open **Start here.html** and click **Copy tool**.
3. Open [OneDrive → My files](https://onedrive.live.com/my) and sign in.
4. Open that tab's developer Console: **Ctrl+Shift+J** on Windows or **Command+Option+J** on Mac. Paste the tool and press **Ctrl+Enter**.
5. Close developer tools and click **Scan OneDrive**.
6. Click **Choose local folder**, select the folder corresponding to the top of **My files**, and approve browser access.
7. Click **Check disk**, then **Test 3 small files** for an initial check, or **Download missing** to copy all missing ordinary files within the run limits.

If Chrome blocks pasting, review the source provided in the launcher and follow Chrome's manual instructions. Keep the OneDrive tab open while scanning or downloading. Refreshing the page removes the tool.

## Restore original dates (new and existing downloads)

Browser downloads initially receive current local timestamps. Version 1.1 adds
**Export date repair JSON** and a local Python helper that restores OneDrive's
creation and modification dates after downloading. It also repairs older copies
without downloading file contents again.

The helper previews by default, verifies file hashes, and changes only metadata
when run with `--apply`. Windows and macOS support both dates; Linux supports
modification-only repair. Python 3.11 or newer is required for this optional step.
See [date repair instructions](docs/date-repair.md) for the complete workflow.

## How files are matched

A OneDrive item at `/Documents/Report.pdf` is checked at `<selected-folder>/Documents/Report.pdf`. Matching uses the full relative path, not just the filename.

- **Existing files are skipped**, including files with a different size.
- Missing folders are created as needed. A full run also creates empty folders.
- Local-only files stay in place.
- Windows-incompatible names, path conflicts, and access errors are reported.
- **Test 3 small files** selects up to three missing, nonempty files no larger than 1 MiB each. It creates only the parents needed for that sample. Run **Check disk** again afterward to see the full remaining set.
- **Save disk report** exports the comparison and the last download result. Inventory exports are available as JSON, CSV, and a plain file list.

A matching file size is not proof of matching content. This is an existence-based copier, not a verified backup or two-way sync.

## Coverage and limits

**Personal Vault, OneNote/package contents, shortcut targets, shared-with-me content outside My files, recycle bin, and version history are not covered.** The supported account type is OneDrive Personal; work/school accounts are not validated.

Keep the destination folder idle during downloads. The browser cannot atomically create a file only if no other application has created it at the same moment. The tool rechecks paths, but cannot guarantee protection against an external writer racing it. Interrupted writes may leave a new empty file; that file is reported and never automatically replaced or deleted.

A complete inventory is required before checking or copying. Time-limited scans can be resumed while the tab remains open. Download runs have file-count, byte, and time limits. Stop or limit events produce explicit partial results. See [behavior and limits](docs/behavior.md) for details.

## Privacy

Microsoft requests read your OneDrive metadata and selected file contents using the existing tab session. Local file checks and writes use the browser's folder permission. **There is no upload, remote edit, remote delete, local delete, or content-overwrite mode.** The optional local helper changes creation/modification timestamps after content verification.

The tool has no analytics or third-party backend. Credentials and temporary download URLs are not included in exports. Reports do contain your file paths and metadata; keep them private and do not attach them to public issues.

## Compatibility and validation

| Environment                      | Status                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| Chrome on macOS                  | Live inventory, local comparison, downloads, and repeat checks exercised |
| Chrome/Edge on Windows           | Intended support; native browser acceptance still required               |
| Firefox, Safari, mobile browsers | Not supported                                                            |

The synthetic test suite exercises pagination, continuation, incomplete inventories, filename conflicts, existing-file preservation, interrupted downloads, and budgets. Platform CI tests the JavaScript and packaging; it does not sign in to a real Microsoft account.

The tool uses an undocumented OneDrive website interface, which Microsoft can change. It is an independent project and is not affiliated with or endorsed by Microsoft.

## Development from a source checkout

Use Node.js 22 or newer:

```sh
npm ci
npm test
python3 -m unittest discover -s test -p "test_*.py"
npm run format:check
npm run build
```

Open `dist/onedrive-missing-files/Start here.html` for the built launcher. The `src/` scripts run in the OneDrive page; `test/` uses synthetic data and simulated browser file handles. Prettier is a development-only dependency.

To produce the downloadable ZIP and checksum file, run `python3 scripts/package.py` after building. The packager includes only the launcher, combined script, README, guides, timestamp helper, and license.

Please include a browser version and an error code when reporting a bug. Do not include account identifiers, signed URLs, access tokens, or private filenames.

## License

[MIT](LICENSE).
