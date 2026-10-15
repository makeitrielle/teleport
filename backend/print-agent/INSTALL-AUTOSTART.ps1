param([string]$NodePath)
$ErrorActionPreference = 'Stop'
if (-not $NodePath) {
    $bundledNode = Join-Path $PSScriptRoot '../node.exe'
    if (Test-Path -LiteralPath $bundledNode) { $NodePath = (Resolve-Path -LiteralPath $bundledNode).Path }
    else { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installer in PowerShell as Administrator.'
}
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node.js was not found.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '../node_modules/ws'))) {
    throw 'Install backend dependencies first: npm.cmd --prefix backend ci'
}
$runner = Join-Path $PSScriptRoot 'RUN-PRINT-AGENT.ps1'
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -NodePath "{1}"' -f $runner, $NodePath
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT20S'
# SYSTEM can run before anyone signs in. Use a machine-installed USB printer.
$account = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskName = 'TELE-PORT Print Agent'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $account -Settings $settings -Description 'Starts the kiosk receipt printer agent at Windows boot and restarts it after failure.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Installed and started: TELE-PORT Print Agent. Log: backend/print-agent/logs/agent.log'
