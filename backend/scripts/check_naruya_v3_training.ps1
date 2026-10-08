param(
    [string]$TrainingRoot = "D:\NaviWakeWord"
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$modelName = "naruya_v3"
$statusFile = Join-Path $TrainingRoot "$modelName-status.json"
$legacyCorpusStatusFile = Join-Path $TrainingRoot "status.json"
$logFile = Join-Path $TrainingRoot "logs\$modelName-training.log"

Write-Host "Naru wake-word candidate training status" -ForegroundColor Cyan
Write-Host "Model: $modelName"
Write-Host "Active model remains: backend\\models\\naruya.onnx"
Write-Host ""

if (Test-Path $statusFile) {
    Get-Content -Raw -Encoding utf8 $statusFile
} else {
    Write-Host "No candidate status yet. Start start_naruya_v3_training.cmd first." -ForegroundColor Yellow
}

# Runs started before the candidate status-path update report corpus progress here.
if (Test-Path $legacyCorpusStatusFile) {
    $legacyStatus = Get-Content -Raw -Encoding utf8 $legacyCorpusStatusFile | ConvertFrom-Json
    if ($legacyStatus.model -eq $modelName -and $legacyStatus.phase -eq "corpus") {
        Write-Host ""
        Write-Host "Live corpus progress" -ForegroundColor Cyan
        $legacyStatus | ConvertTo-Json
    }
}

Write-Host ""
Write-Host "Recent log (last 40 lines)" -ForegroundColor Cyan
if (Test-Path $logFile) {
    Get-Content -Tail 40 -Encoding utf8 $logFile
} else {
    Write-Host "No log file yet." -ForegroundColor Yellow
}
