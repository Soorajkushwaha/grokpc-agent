# Start the GrokPC Windows desktop helper if it is not already listening.
# Used by the per-user logon scheduled task. No admin required.
$ErrorActionPreference = "Stop"
$StateDir = Join-Path $env:LOCALAPPDATA "GrokPC"
$VenvPy = Join-Path $StateDir "helper-venv\Scripts\python.exe"
$Helper = Join-Path $StateDir "desktop_helper\helper.py"
$EnvFile = Join-Path $StateDir "helper.env"
$LogFile = Join-Path $StateDir "helper.log"
$Port = 8765

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Test-Port {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", $Port)
        $c.Close()
        return $true
    } catch { return $false }
}

if (Test-Port) { exit 0 }
if (-not (Test-Path $VenvPy)) {
    Add-Content $LogFile ("[{0}] python venv missing — run install-helper.ps1" -f (Get-Date -Format o))
    exit 1
}
if (-not (Test-Path $Helper)) {
    Add-Content $LogFile ("[{0}] helper.py missing" -f (Get-Date -Format o))
    exit 1
}

$env:GROKPC_HELPER_ENV = $EnvFile
# Detached start; stdout into the log.
$p = Start-Process -FilePath $VenvPy -ArgumentList "`"$Helper`"" -WorkingDirectory (Split-Path $Helper) -RedirectStandardOutput $LogFile -RedirectStandardError $LogFile -WindowStyle Hidden -PassThru
Add-Content $LogFile ("[{0}] started pid {1}" -f (Get-Date -Format o), $p.Id)
exit 0
