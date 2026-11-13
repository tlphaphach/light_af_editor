$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = $PSScriptRoot
$PkgJson = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$Version = if ($PkgJson.version) { $PkgJson.version } else { "1.0.0" }

$ReleasesRoot = Join-Path $Root "releases"
$StageDir = Join-Path $ReleasesRoot "LightAFEditor"
$ZipPath = Join-Path $ReleasesRoot "LightAFEditor-v$Version-Portable.zip"

Write-Host "Building LightAFEditor v$Version Portable Package..." -ForegroundColor Cyan

# 1. Ensure LightAFEditor.exe is compiled
$Csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (Test-Path $Csc) {
    Write-Host "Compiling LightAFEditor.exe..."
    $IconFlag = "/win32icon:" + (Join-Path $Root "public\logo.ico")
    $OutFlag = "/out:" + (Join-Path $Root "LightAFEditor.exe")
    $SrcFile = Join-Path $Root "launcher.cs"
    & $Csc /nologo /target:winexe /optimize+ $IconFlag $OutFlag $SrcFile
    if ($LASTEXITCODE -ne 0) { throw "csc.exe compilation failed" }
}

# 2. Clean previous staging & zip
New-Item -ItemType Directory -Path $ReleasesRoot -Force | Out-Null
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

# 3. Copy core app files
$FilesToCopy = @(
    "LightAFEditor.exe",
    "server.js",
    "ffmpeg-helper.js",
    "package.json",
    "README.md",
    "USER_GUIDE.md",
    "CHANGELOG.md"
)
foreach ($f in $FilesToCopy) {
    $src = Join-Path $Root $f
    if (Test-Path $src) {
        Copy-Item $src -Destination $StageDir
    }
}

# 4. Copy public/ and node_modules/
Copy-Item (Join-Path $Root "public") -Destination (Join-Path $StageDir "public") -Recurse
if (-not (Test-Path (Join-Path $Root "node_modules\ffmpeg-static\ffmpeg.exe"))) {
    throw "node_modules\ffmpeg-static\ffmpeg.exe not found. Run 'npm install' first."
}
Copy-Item (Join-Path $Root "node_modules") -Destination (Join-Path $StageDir "node_modules") -Recurse

# 5. Bundle portable node.exe into bin/
$BinDir = Join-Path $StageDir "bin"
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
$LocalNode = Join-Path $Root "bin\node.exe"
if (Test-Path $LocalNode) {
    Copy-Item $LocalNode -Destination (Join-Path $BinDir "node.exe")
} else {
    $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $NodeCmd) {
        throw "Could not find node.exe on PATH or in bin\node.exe."
    }
    Copy-Item $NodeCmd.Source -Destination (Join-Path $BinDir "node.exe")
}

# 6. Create clean empty data/ and exports/ folders (no personal media)
foreach ($d in @("data\library", "data\thumbs", "data\projects", "exports")) {
    New-Item -ItemType Directory -Path (Join-Path $StageDir $d) -Force | Out-Null
}
Set-Content -Path (Join-Path $StageDir "data\library.json") -Value "[]" -Encoding UTF8

# 7. Package into zip
Write-Host "Compressing to $ZipPath..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($StageDir, $ZipPath, [System.IO.Compression.CompressionLevel]::Optimal, $true)
Remove-Item $StageDir -Recurse -Force

$SizeMB = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host "Done! Created $ZipPath ($SizeMB MB)" -ForegroundColor Green
