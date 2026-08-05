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

function bump-json($path, $key) {
  $content = Get-Content $path -Raw -Encoding UTF8
  $content = $content -replace "`"$key`":\s*`"[^`"]+`"", "`"$key`": `"$Version`""
  Set-Content $path -Value $content -Encoding UTF8 -NoNewline
  Write-Output "  $($key): $Version"
}

Write-Output "Bumping to v${Version}:"

bump-json "$root\package.json" version
bump-json "$root\src-tauri\tauri.conf.json" version

$cargoPath = "$root\src-tauri\Cargo.toml"
$cargo = Get-Content $cargoPath -Raw -Encoding UTF8
$cargo = $cargo -replace '^version\s*=\s*"[^"]+"', "version = `"$Version`""
Set-Content $cargoPath -Value $cargo -Encoding UTF8 -NoNewline
Write-Output "  Cargo.toml: $Version"

Write-Output ''
Write-Output 'Done. Next: commit, tag, push:'
Write-Output "  git add package.json src-tauri/"
Write-Output "  git commit -m 'chore: bump version to ${Version}'"
Write-Output "  git tag v${Version}"
Write-Output "  git push origin master v${Version}"
