param([Parameter(Mandatory = $true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$logDirectory = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$log = Join-Path $logDirectory 'agent.log'
# Task Scheduler prevents a second supervisor. Restart after a crash or missing
# configuration; the WebSocket client handles ordinary network reconnects.
while ($true) {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
        Move-Item -LiteralPath $log -Destination "$log.previous" -Force
    }
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) Starting print agent"
    try {
        $ErrorActionPreference = 'Continue'
        & $NodePath (Join-Path $PSScriptRoot 'index.js') *>> $log
    } catch {
        Add-Content -LiteralPath $log -Value 'Agent could not start. Check Node.js, dependencies and configuration.'
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    Start-Sleep -Seconds 15
}
