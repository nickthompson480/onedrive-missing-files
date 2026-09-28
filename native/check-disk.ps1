# Read-only comparison of a saved browser disk report with native file metadata.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Report,
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Output,
    [switch]$FollowDirectoryLinks
)
$ErrorActionPreference = 'Stop'

function Test-RelativePath([string]$Path) {
    if (-not $Path.StartsWith('/') -or $Path.StartsWith('//')) { return $false }
    foreach ($part in $Path.Substring(1).Split('/')) {
        if (-not $part -or $part -eq '.' -or $part -eq '..' -or
            $part.Length -gt 255 -or $part -match '[<>:"\\|?*\x00-\x1f]' -or
            $part -match '[. ]$' -or $part -match '^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)') { return $false }
    }
    return $true
}

try {
    $rootItem = Get-Item -LiteralPath $Root -Force
    if (-not $rootItem.PSIsContainer) { throw 'invalid_root' }
    if ((Get-Item -LiteralPath $Report).Length -gt 64MB) { throw 'report_too_large' }
    $inputReport = Get-Content -LiteralPath $Report -Raw -Encoding UTF8 | ConvertFrom-Json
    $plan = $inputReport.plan
    if ($plan.status -ne 'checked' -or -not ($plan.items -is [array]) -or
        $plan.items.Count -gt 100000 -or $plan.folder -cne $rootItem.Name) { throw 'invalid_report_or_root' }
    $outPath = [IO.Path]::GetFullPath($Output)
    $rootPath = $rootItem.FullName.TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ($outPath.Equals($rootPath, [StringComparison]::OrdinalIgnoreCase) -or
        $outPath.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'output_must_be_outside_root' }
    $ids = @{}
    $files = @($plan.items | Where-Object { $_.type -eq 'file' })
    foreach ($row in $files) {
        if (-not ($row.id -is [string]) -or -not $row.id -or $ids.ContainsKey($row.id) -or
            -not ($row.path -is [string])) { throw 'invalid_report' }
        $ids[$row.id] = $true
    }
    $parents = @{}
    $items = @(foreach ($row in $files) {
        $item = [ordered]@{
            id = $row.id; path = $row.path; type = 'file'; size = $row.size
            name = $row.name; parentId = $row.parentId; modified = $row.modified
            status = 'conflict'
        }
        if ($row.modified -is [datetime]) { $item.modified = $row.modified.ToUniversalTime().ToString('o') }
        try {
            if (-not (Test-RelativePath $row.path)) { throw 'invalid_relative_path' }
            $segments = $row.path.Substring(1).Split('/')
            $parent = $rootPath
            $linked = $false
            # Check each named parent, never recursively enumerate link targets.
            for ($i = -1; $i -lt $segments.Length - 1; $i++) {
                if ($i -ge 0) { $parent = Join-Path $parent $segments[$i] }
                if (-not $parents.ContainsKey($parent)) {
                    $dir = Get-Item -LiteralPath $parent -Force
                    if (-not $dir.PSIsContainer) { throw 'parent_is_not_directory' }
                    $parents[$parent] = [bool]$dir.LinkType
                }
                if ($parents[$parent]) {
                    if (-not $FollowDirectoryLinks) { throw 'directory_link_not_followed' }
                    $linked = $true
                }
            }
            $local = Get-Item -LiteralPath (Join-Path $rootPath $row.path.Substring(1)) -Force
            if ($local.PSIsContainer -or $local.LinkType) { throw 'not_regular_file' }
            $item.localSize = $local.Length
            $item.status = if ($local.Length -eq $row.size) { 'present' } else { 'existing_size_mismatch' }
            $item.throughDirectoryLink = $linked
        } catch {
            if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { $item.status = 'missing' }
            else { $item.reason = 'native_access_error' }
        }
        [pscustomobject]$item
    })
    $result = [ordered]@{
        kind = 'onedrive_native_disk_check'; version = 1; status = 'finished'
        folder = $rootItem.Name; checked = [DateTime]::UtcNow.ToString('o')
        inventoryStarted = $plan.inventoryStarted
        followedDirectoryLinks = [bool]$FollowDirectoryLinks
        items = $items
    }
    $json = $result | ConvertTo-Json -Depth 12
    # Exclusive creation: never replace a report or any existing local file.
    $stream = [IO.File]::Open($outPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $data = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
        $stream.Write($data, 0, $data.Length)
    } finally { $stream.Dispose() }
    $items | Group-Object status | Select-Object Name, Count | Format-Table
    Write-Output 'Native check saved. File contents were not read or changed. Equal size is not content verification.'
} catch {
    # Do not print source filenames, absolute paths or arbitrary exception text.
    Write-Error 'Native check stopped. Check the input report, matching root, access permissions and a new output path outside the root.'
    exit 1
}
