"""Package only the public launcher payload with reproducible ZIP metadata."""

from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
FOLDER = ROOT / "dist" / "onedrive-missing-files"
ARCHIVE = FOLDER.with_suffix(".zip")
FILES = (
    "LICENSE",
    "README.md",
    "Start here.html",
    "onedrive-tool.js",
    "docs/behavior.md",
    "repair-dates.py",
    "docs/date-repair.md",
)

for name in FILES:
    if not (FOLDER / name).is_file():
        raise SystemExit("Run npm run build before packaging.")

with ZipFile(ARCHIVE, "w", compression=ZIP_DEFLATED) as archive:
    for name in FILES:
        info = ZipInfo("onedrive-missing-files/" + name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (FOLDER / name).read_bytes())

with ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None

checksum = sha256(ARCHIVE.read_bytes()).hexdigest()
(ROOT / "dist" / "SHA256SUMS.txt").write_text(checksum + "  " + ARCHIVE.name + "\n")
print(ARCHIVE.name + ": " + str(ARCHIVE.stat().st_size) + " bytes")
