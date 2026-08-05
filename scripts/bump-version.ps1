param([string]$Version)

if (-not $Version) {
  Write-Error 'Usage: scripts/bump-version.ps1 <version>' -Category InvalidArgument
  exit 1
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  Write-Error 'Version must be semver (e.g. 0.3.4)' -Category InvalidArgument
  exit 1
}

$root = "$PSScriptRoot\.."

function write-utf8-no-bom($path, $content) {
  [System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

function bump-json($path, $key) {
  $content = Get-Content $path -Raw -Encoding UTF8
  $content = $content -replace "`"$key`":\s*`"[^`"]+`"", "`"$key`": `"$Version`""
  write-utf8-no-bom $path $content
  Write-Output "  $($key): $Version"
}

Write-Output "Bumping to v${Version}:"

bump-json "$root\package.json" version
bump-json "$root\src-tauri\tauri.conf.json" version

$cargoPath = "$root\src-tauri\Cargo.toml"
$cargo = Get-Content $cargoPath -Raw -Encoding UTF8
$cargo = $cargo -replace '(?m)^version\s*=\s*"[^"]+"', "version = `"$Version`""
write-utf8-no-bom $cargoPath $cargo
Write-Output "  Cargo.toml: $Version"

$lockPath = "$root\src-tauri\Cargo.lock"
if (Test-Path $lockPath) {
  $lock = Get-Content $lockPath -Raw -Encoding UTF8
  $lock = $lock -replace '(?m)^name = "ariapanel"\r?\nversion = "[^"]+"', "name = ""ariapanel""`nversion = `"$Version`""
  write-utf8-no-bom $lockPath $lock
  Write-Output "  Cargo.lock: $Version"
}

Write-Output ''
Write-Output 'Done. Next: commit, tag, push:'
Write-Output "  git add package.json src-tauri/"
Write-Output "  git commit -m 'chore: bump version to ${Version}'"
Write-Output "  git tag v${Version}"
Write-Output "  git push origin master v${Version}"
