# Start GrokPC services inside WSL and print the current tunnel URL + token.
# Safe to run any time (also used by Task Scheduler at logon).
$ErrorActionPreference = "Stop"
$Distro = "Ubuntu-24.04"

function Test-WslDistro {
    $old = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = New-Object System.Text.UnicodeEncoding $false, $false
        $names = @(wsl.exe -l -q 2>$null | ForEach-Object { ($_ -replace "`0", "").Trim() } | Where-Object { $_ })
    } finally {
        [Console]::OutputEncoding = $old
    }
    return $names
}

$names = Test-WslDistro
if ($names -notcontains $Distro) {
    Write-Host "Ubuntu-24.04 nahi mila. Pehle windows\install.ps1 (Admin) chalao." -ForegroundColor Red
    exit 1
}

Write-Host "Starting GrokPC in $Distro ..."
& wsl.exe -d $Distro -u root -- bash -lc "systemctl is-system-running --wait || true; systemctl start grokpc-desktop grokpc-agent grokpc-tunnel grokpc-tunnel-vnc; sleep 8; bash /app/agent/show_urls.sh"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
