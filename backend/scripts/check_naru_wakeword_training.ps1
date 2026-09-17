param(
    [string]$TrainingRoot = "D:\NaviWakeWord"
)

$statusFile = Join-Path $TrainingRoot "status.json"
$logFile = Join-Path $TrainingRoot "logs\naruya-training.log"

function Write-Utf8Message([string]$EncodedText, [ConsoleColor]$Color) {
    $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EncodedText))
    Write-Host $text -ForegroundColor $Color
}

if (Test-Path $statusFile) {
    Write-Utf8Message "7ZiE7J6sIO2VmeyKtSDsg4Htg5w=" Cyan
    Get-Content $statusFile -Raw | ConvertFrom-Json | Format-List
} else {
    Write-Utf8Message "7JWE7KeBIO2VmeyKtSDsg4Htg5wg7YyM7J287J20IOyXhuyKteuLiOuLpC4g7ZWZ7Iq1IOyLnOyekSBDTUTrpbwg66i87KCAIOyLpO2Wie2VmOyEuOyalC4=" Yellow
}
if (Test-Path $logFile) {
    Write-Host ''
    Write-Utf8Message "7LWc6re8IOuhnOq3uCA0MOykhA==" Cyan
    # Keep the command window readable; the full raw log remains available on D:.
    $allLogLines = @(Get-Content $logFile)
    $runStarts = @(
        for ($index = 0; $index -lt $allLogLines.Count; $index += 1) {
            if ($allLogLines[$index] -match '^\[\d{4}-\d{2}-\d{2} .*\] \[1/3\]') { $index }
        }
    )
    $latestRunLines = if ($runStarts.Count -gt 0) {
        $allLogLines[$runStarts[-1]..($allLogLines.Count - 1)]
    } else {
        $allLogLines
    }
    $latestRunLines |
        Where-Object {
            $_ -match '^\[\d{4}-\d{2}-\d{2} .*\] ' -or
            $_ -match '^(Complete:|Failed:|ERROR|WARNING|Traceback|RuntimeError|ModuleNotFoundError|Applied OpenWakeWord)' -or
            $_ -match 'Exit code:'
        } |
        Select-Object -Last 40
    Write-Host "`nFull log: $logFile" -ForegroundColor DarkGray
}
