# GrokPC Windows installer (PowerShell 5.1+).
# Run from an elevated ("Run as Administrator") PowerShell:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\windows\install.ps1
#
# Private repo: `irm <raw url> | iex` will NOT work. Download the ZIP while
# logged into GitHub, extract it, then run this script from the extracted folder.
#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$Distro = "Ubuntu-24.04"
$TaskAutostart = "GrokPC Autostart"
$TaskKeepalive = "GrokPC Keepalive"
$TaskResume = "GrokPC Install Resume"
$StateDir = Join-Path $env:LOCALAPPDATA "GrokPC"
$StateFile = Join-Path $StateDir "install-state.json"
$LogFile = Join-Path $StateDir "install.log"

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Write-Log {
    param([string]$Message, [string]$Color = "Gray")
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogFile -Value $line
    Write-Host $Message -ForegroundColor $Color
}

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal $id
    if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Yeh script Administrator PowerShell se chalao (right-click -> Run as administrator)."
    }
}

function Get-RepoRoot {
    if (-not $PSScriptRoot) { throw "Is script ko file se chalao, paste karke nahi." }
    $root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    $setup = Join-Path $root "backend\setup_server.sh"
    if (-not (Test-Path $setup)) {
        throw "backend\setup_server.sh nahi mila. Poora GitHub ZIP extract karke windows\install.ps1 yahin se chalao. Path: $root"
    }
    return $root
}

function Read-State {
    if (Test-Path $StateFile) {
        try { return Get-Content $StateFile -Raw | ConvertFrom-Json } catch { return $null }
    }
    return $null
}

function Write-State {
    param([hashtable]$Data)
    ($Data | ConvertTo-Json) | Set-Content -Path $StateFile -Encoding UTF8
}

function Get-WslNames {
    $old = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = New-Object System.Text.UnicodeEncoding $false, $false
        $names = @(wsl.exe -l -q 2>$null | ForEach-Object { ($_ -replace "`0", "").Trim() } | Where-Object { $_ })
    } finally {
        [Console]::OutputEncoding = $old
    }
    return @($names)
}

function Test-RebootPending {
    $paths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
        "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\PendingFileRenameOperations"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $true }
    }
    try {
        $cbs = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager" -Name PendingFileRenameOperations -ErrorAction SilentlyContinue
        if ($cbs -and $cbs.PendingFileRenameOperations) { return $true }
    } catch {}
    return $false
}

function Register-ResumeTask {
    param([string]$ScriptPath)
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName $TaskResume -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Write-Log "Reboot ke baad install resume hoga (task: $TaskResume)." "Yellow"
}

function Unregister-ResumeTask {
    Unregister-ScheduledTask -TaskName $TaskResume -Confirm:$false -ErrorAction SilentlyContinue
}

function Request-Reboot {
    param([string]$ScriptPath, [string]$RepoRoot)
    Write-State @{ phase = "after-reboot"; repo = $RepoRoot; script = $ScriptPath }
    Register-ResumeTask -ScriptPath $ScriptPath
    Write-Log "" "White"
    Write-Log "Windows ko WSL ke liye REBOOT chahiye. 20 second me restart hoga." "Yellow"
    Write-Log "Login ke baad yeh script khud continue karegi. Laptop charge pe rakho." "Yellow"
    Write-Log "Agar auto-resume na ho, Admin PowerShell me dubara yahi command chalao:" "Yellow"
    Write-Log "  Set-ExecutionPolicy -Scope Process Bypass; `"$ScriptPath`"" "Cyan"
    shutdown.exe /r /t 20 /c "GrokPC: WSL enable karne ke liye reboot. Login ke baad setup continue hoga."
    exit 0
}

function Set-WslConfig {
    $path = Join-Path $env:USERPROFILE ".wslconfig"
    $wanted = @{
        "memory" = "8GB"
        "swap" = "4GB"
        "localhostForwarding" = "true"
        "vmIdleTimeout" = "-1"
    }
    $lines = @()
    if (Test-Path $path) {
        $lines = @(Get-Content $path)
    }
    $out = New-Object System.Collections.Generic.List[string]
    $inWsl2 = $false
    $seenWsl2 = $false
    $written = @{}
    foreach ($line in $lines) {
        if ($line -match '^\s*\[wsl2\]\s*$') {
            $inWsl2 = $true
            $seenWsl2 = $true
            $out.Add($line) | Out-Null
            continue
        }
        if ($line -match '^\s*\[') {
            if ($inWsl2) {
                foreach ($k in $wanted.Keys) {
                    if (-not $written.ContainsKey($k)) {
                        $out.Add("$k=$($wanted[$k])") | Out-Null
                        $written[$k] = $true
                    }
                }
            }
            $inWsl2 = $false
            $out.Add($line) | Out-Null
            continue
        }
        if ($inWsl2 -and $line -match '^\s*([A-Za-z][A-Za-z0-9]*)\s*=') {
            $key = $Matches[1]
            if ($wanted.ContainsKey($key)) {
                $out.Add("$key=$($wanted[$key])") | Out-Null
                $written[$key] = $true
                continue
            }
        }
        $out.Add($line) | Out-Null
    }
    if (-not $seenWsl2) {
        if ($out.Count -gt 0 -and $out[$out.Count - 1] -ne "") { $out.Add("") | Out-Null }
        $out.Add("[wsl2]") | Out-Null
        $inWsl2 = $true
    }
    if ($inWsl2 -or $seenWsl2) {
        foreach ($k in $wanted.Keys) {
            if (-not $written.ContainsKey($k)) {
                $out.Add("$k=$($wanted[$k])") | Out-Null
            }
        }
    }
    $out | Set-Content -Path $path -Encoding ASCII
    Write-Log "Wrote $path (memory=8GB, swap=4GB, vmIdleTimeout=-1)." "Green"
}

function Enable-WslFeatures {
    Write-Log "Enabling WSL and VirtualMachinePlatform..." "Cyan"
    $changed = $false
    foreach ($name in @("Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform")) {
        $feat = Get-WindowsOptionalFeature -Online -FeatureName $name -ErrorAction SilentlyContinue
        if ($feat -and $feat.State -ne "Enabled") {
            Write-Log "Enabling feature $name"
            Enable-WindowsOptionalFeature -Online -FeatureName $name -NoRestart -All | Out-Null
            $changed = $true
        }
    }
    try {
        & wsl.exe --set-default-version 2 | Out-Null
    } catch {}
    try {
        & wsl.exe --update | Out-Null
    } catch {}
    return $changed
}

function Install-Ubuntu {
    $names = Get-WslNames
    if ($names -contains $Distro) {
        Write-Log "$Distro already installed." "Green"
        return
    }
    Write-Log "Installing $Distro (this can take several minutes)..." "Cyan"
    $ok = $false
    & wsl.exe --install -d $Distro --no-launch
    if ($LASTEXITCODE -eq 0) { $ok = $true }
    if (-not $ok) {
        Write-Log "Retrying with --web-download (Store se nahi mila)..." "Yellow"
        & wsl.exe --install -d $Distro --no-launch --web-download
        if ($LASTEXITCODE -eq 0) { $ok = $true }
    }
    if (-not $ok) {
        throw "Ubuntu-24.04 install fail ho gaya. Microsoft Store se 'Ubuntu 24.04' install karke yeh script dubara chalao. Exit=$LASTEXITCODE"
    }
    Start-Sleep -Seconds 3
    $names = Get-WslNames
    if ($names -notcontains $Distro) {
        throw "$Distro list me nahi aaya. Reboot karke script dubara chalao."
    }
    Write-Log "$Distro installed." "Green"
}

function Invoke-WslBash {
    param([string]$Command)
    & wsl.exe -d $Distro -u root -- bash -lc $Command
    if ($LASTEXITCODE -ne 0) {
        throw "WSL command failed (exit $LASTEXITCODE): $Command"
    }
}

function Initialize-Distro {
    Write-Log "Creating linux user 'ubuntu' and enabling systemd..." "Cyan"
    $script = @'
set -euo pipefail
if ! id ubuntu >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G sudo ubuntu
  echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu
  chmod 440 /etc/sudoers.d/ubuntu
fi
cat > /etc/wsl.conf <<EOF
[boot]
systemd=true
[user]
default=ubuntu
[network]
generateResolvConf=true
EOF
'@
    $tmpWin = Join-Path $StateDir "init-distro.sh"
    Set-Content -Path $tmpWin -Value $script -Encoding ASCII
    $wslTmp = (& wsl.exe -d $Distro -u root -- wslpath -a $tmpWin).Trim()
    Invoke-WslBash "bash '$wslTmp'"
    try { & wsl.exe --set-default $Distro | Out-Null } catch {}
    Write-Log "Restarting WSL so systemd comes up..."
    & wsl.exe --shutdown
    Start-Sleep -Seconds 5
    $running = ""
    for ($i = 0; $i -lt 30; $i++) {
        $running = ((& wsl.exe -d $Distro -u root -- bash -lc "systemctl is-system-running || true") | Out-String).Trim()
        if ($running -match "running|degraded") { break }
        Start-Sleep -Seconds 2
    }
    Write-Log "systemd status: $running"
    if ($running -notmatch "running|degraded") {
        Write-Log "WARNING: systemd abhi ready nahi hai. Setup phir bhi try karega (start_stack fallback)." "Yellow"
    }
}

function Install-GrokpcInWsl {
    param([string]$RepoRoot)
    Write-Log "Copying repo into WSL and running setup_server.sh (10-20 min lag sakta hai)..." "Cyan"
    $wslRepo = ((& wsl.exe -d $Distro -u root -- wslpath -a $RepoRoot) | Out-String).Trim()
    if (-not $wslRepo) { throw "wslpath failed for $RepoRoot" }
    Invoke-WslBash "mkdir -p /opt/grokpc && rsync -a --delete --exclude .git --exclude frontend/node_modules --exclude frontend/dist --exclude backend/.venv '$wslRepo/' /opt/grokpc/"
    Invoke-WslBash "bash /opt/grokpc/backend/setup_server.sh"
}

function Register-Autostart {
    param([string]$RepoRoot)
    $starter = Join-Path $StateDir "start-grokpc.ps1"
    $src = Join-Path $RepoRoot "windows\start-grokpc.ps1"
    Copy-Item -Force $src $starter
    $arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$starter`""
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType Interactive
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

    $logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    Register-ScheduledTask -TaskName $TaskAutostart -Action $action -Trigger $logon -Principal $principal -Settings $settings -Force | Out-Null

    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
    Register-ScheduledTask -TaskName $TaskKeepalive -Action $action -Trigger $repeat -Principal $principal -Settings $settings -Force | Out-Null
    Write-Log "Task Scheduler: '$TaskAutostart' (logon) + '$TaskKeepalive' (every 10 min)." "Green"
}

function Set-PluggedInNoSleep {
    Write-Log "Plugged-in sleep/hibernate band kar raha hoon (battery settings nahi chhedunga)." "Cyan"
    & powercfg /change standby-timeout-ac 0
    & powercfg /change hibernate-timeout-ac 0
    & powercfg /change disk-timeout-ac 0
    Write-Log "Power: plugged-in sleep = never. Monitor timeout same rehne diya." "Green"
    Write-Log "Settings -> System -> Power me bhi 'When plugged in, never sleep' check kar lena." "Yellow"
}

function Show-Finish {
    Write-Log "" "White"
    Write-Log "========================================================" "Green"
    Write-Log "GrokPC Windows setup complete." "Green"
    Write-Log "========================================================" "Green"
    & wsl.exe -d $Distro -u root -- bash /app/agent/show_urls.sh
    Write-Log "" "White"
    Write-Log "Ab yeh karo:" "Cyan"
    Write-Log "  1. DeepSeek key:  wsl -d Ubuntu-24.04 -u root -- nano /app/agent/.env"
    Write-Log "     (DEEPSEEK_API_KEY=... save, then: wsl -d Ubuntu-24.04 -u root -- systemctl restart grokpc-agent)"
    Write-Log "  2. Phone/PC pe app kholo: https://grokpc-agent.simple-sooraj.workers.dev"
    Write-Log "     Settings me Backend URL (trycloudflare) + AGENT_TOKEN paste karo."
    Write-Log "     noVNC URL bhi paste kar sakte ho (tunnel_vnc + /vnc.html)."
    Write-Log "  3. Laptop CHARGE pe rakho, lid band mat karo / sleep mat hone do."
    Write-Log "  4. Tunnel URL reboot ke baad badal sakti hai. Dekhne ke liye:"
    Write-Log "       powershell $StateDir\start-grokpc.ps1" "Cyan"
    Write-Log "     ya:  wsl -d Ubuntu-24.04 -u root -- bash /app/agent/show_urls.sh"
    Write-Log "Log: $LogFile"
}

# --- main ---
Assert-Admin
$RepoRoot = Get-RepoRoot
$ScriptPath = $MyInvocation.MyCommand.Path
if (-not $ScriptPath) { $ScriptPath = Join-Path $PSScriptRoot "install.ps1" }

Write-Host ""
Write-Host "=== GrokPC Windows / WSL installer ===" -ForegroundColor Green
Write-Host "Repo: $RepoRoot"
Write-Host "Log:  $LogFile"
Write-Host ""

$state = Read-State
Write-State @{ phase = "running"; repo = $RepoRoot; script = $ScriptPath }

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Write-Log "wsl.exe nahi mila. WSL features enable karta hoon." "Yellow"
    $null = Enable-WslFeatures
    Request-Reboot -ScriptPath $ScriptPath -RepoRoot $RepoRoot
}

$changed = $false
try { $changed = Enable-WslFeatures } catch { Write-Log "Feature enable warning: $_" "Yellow" }

if ($changed -or (Test-RebootPending)) {
    $names = @()
    try { $names = Get-WslNames } catch { $names = @() }
    if ($names -notcontains $Distro) {
        Request-Reboot -ScriptPath $ScriptPath -RepoRoot $RepoRoot
    }
}

Set-WslConfig
Install-Ubuntu
Initialize-Distro
Install-GrokpcInWsl -RepoRoot $RepoRoot
Register-Autostart -RepoRoot $RepoRoot
Set-PluggedInNoSleep
Unregister-ResumeTask
Write-State @{ phase = "done"; repo = $RepoRoot; script = $ScriptPath; finished = (Get-Date).ToString("o") }
Show-Finish
