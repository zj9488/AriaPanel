# 获取 aria2c.exe (Windows x64) 到 src-tauri/resources/
# 优先使用系统已安装的 aria2c（如 scoop/winget 装的官方 1.37.0）；找不到再从官方 release 下载。
$ErrorActionPreference = 'Stop'
$dst = "$PSScriptRoot\..\src-tauri\resources"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$target = Join-Path $dst 'aria2c.exe'

# 1) 优先复制系统已装的 aria2c
$sys = (Get-Command aria2c -ErrorAction SilentlyContinue).Source
if ($sys) {
    # scoop 等会把 aria2c.exe 装成 shim（同名 .shim 指向真实二进制）；解析出真实路径再复制
    $shimCfg = [System.IO.Path]::ChangeExtension($sys, '.shim')
    if (Test-Path $shimCfg) {
        if ((Get-Content $shimCfg -Raw) -match '(?m)^\s*path\s*=\s*"([^"]+)"') {
            $sys = $matches[1]
        }
    }
    Copy-Item $sys $target -Force
    Write-Output "copied system aria2c: $sys -> $target"
} else {
    # 2) 从官方 release 下载
    $ver = '1.37.0'
    $url = "https://github.com/aria2/aria2/releases/download/release-$ver/aria2-$ver-win-64bit-build1.zip"
    $tmp = "$env:TEMP\aria2.zip"
    Invoke-WebRequest $url -OutFile $tmp
    Expand-Archive $tmp -DestinationPath "$env:TEMP\aria2-extract" -Force
    Copy-Item "$env:TEMP\aria2-extract\aria2-$ver-win-64bit-build1\aria2c.exe" $target -Force
    Remove-Item $tmp, "$env:TEMP\aria2-extract" -Recurse -Force
    Write-Output "downloaded aria2c $ver -> $target"
}
& $target --version
