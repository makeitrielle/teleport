$ErrorActionPreference = 'Stop'
$taskName = 'TELE-PORT Print Agent'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
# Also stop a supervisor left behind after a task was removed manually.
$runner = Join-Path $PSScriptRoot 'RUN-PRINT-AGENT.ps1'
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'powershell.exe' -and $_.CommandLine -and $_.CommandLine.Contains($runner)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Output 'Removed TELE-PORT print agent startup on this computer.'
