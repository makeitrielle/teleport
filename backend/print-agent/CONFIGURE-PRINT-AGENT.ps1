$ErrorActionPreference = 'Stop'
$config = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $config) { throw 'Configuration already exists. Edit .env to change it.' }
$printers = @(Get-Printer | Where-Object { $_.PortName -notmatch 'PORTPROMPT|nul:|SHRFAX|OneNote' })
if ($printers.Count -eq 0) { throw 'No physical printer is installed. Connect the printer and install its Windows driver first.' }
$printers | Select-Object Name, PrinterStatus, PortName | Format-Table
$name = Read-Host 'Enter the exact thermal printer name shown above'
if (-not ($printers | Where-Object { $_.Name -ceq $name })) { throw 'Printer name does not match an installed printer.' }
$url = Read-Host 'Backend WebSocket URL [Enter for wss://teleport-3qfa.onrender.com/api/printer/agent]'
if (-not $url) { $url = 'wss://teleport-3qfa.onrender.com/api/printer/agent' }
$uri = [Uri]$url
if ($uri.Scheme -ne 'wss' -or $uri.AbsolutePath -ne '/api/printer/agent' -or $uri.UserInfo) { throw 'Use the backend wss:// address ending in /api/printer/agent.' }
$secure = Read-Host 'Paste the AGENT_SECRET configured in the backend environment (hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($secret.Length -lt 32) { throw 'Use the same secret as the backend, at least 32 characters.' }
    $values = [ordered]@{ WS_URL = $url; AGENT_SECRET = $secret; PRINTER_NAME = $name; CUT_AFTER_PRINT = 'false' }
    $lines = foreach ($entry in $values.GetEnumerator()) {
        if ($entry.Value -match '[\r\n]') { throw 'Configuration values must be one line.' }
        '{0}={1}' -f $entry.Key, (ConvertTo-Json -InputObject $entry.Value -Compress)
    }
    [IO.File]::WriteAllLines($config, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secret = $null
}
Write-Output 'Configuration saved. The boot agent will retry automatically within 15 seconds.'
