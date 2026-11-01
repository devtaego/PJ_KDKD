$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PyInstaller = Join-Path $Root ".venv-build\Scripts\pyinstaller.exe"
if (-not (Test-Path -LiteralPath $PyInstaller)) {
    throw "PyInstaller를 찾을 수 없습니다. 먼저 .venv-build에 PyInstaller를 설치하세요."
}

$Dist = Join-Path $Root "work\local-web-dist"
$Work = Join-Path $Root "work\local-web-build"
$Spec = Join-Path $Root "work\local-web-spec"
& $PyInstaller --clean --noconfirm --onefile --console --name "KI득KI득" `
    --paths (Join-Path $Root "web") `
    --add-data "$(Join-Path $Root 'web\static');web/static" `
    --add-data "$(Join-Path $Root 'fonts');fonts" `
    --distpath $Dist --workpath $Work --specpath $Spec `
    (Join-Path $Root "web\local_launcher.py")
if ($LASTEXITCODE -ne 0) { throw "Windows 로컬 웹판 빌드 실패" }

$Release = Join-Path $Root "release\windows\KI득KI득.exe"
Copy-Item -LiteralPath (Join-Path $Dist "KI득KI득.exe") -Destination $Release -Force
Write-Output "완료: $Release"
