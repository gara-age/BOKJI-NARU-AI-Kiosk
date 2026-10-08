param(
    [string]$TrainingRoot = "D:\NaviWakeWord"
)

# Native Python libraries write non-fatal warnings to stderr. Keep them in the
# log and use each process exit code below to decide whether training failed.
$ErrorActionPreference = "Continue"
$backend = Split-Path -Parent $PSScriptRoot
$python = Join-Path $backend ".venv-py310\Scripts\python.exe"
$environment = Join-Path $TrainingRoot "env"
$outputRoot = Join-Path $TrainingRoot "output-v3"
$modelName = "naruya_v3"
$modelDirectory = Join-Path $outputRoot $modelName
$logDirectory = Join-Path $TrainingRoot "logs"
$logFile = Join-Path $logDirectory "$modelName-training.log"
$statusFile = Join-Path $TrainingRoot "$modelName-status.json"

New-Item -ItemType Directory -Force -Path $logDirectory, $modelDirectory | Out-Null

function Write-Log([string]$Message) {
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" | Tee-Object -FilePath $logFile -Append
}

function Save-Status([string]$Phase, [string]$State, [string]$Message) {
    @{ phase = $Phase; state = $State; message = $Message; updated_at = (Get-Date).ToUniversalTime().ToString('o'); model = $modelName } |
        ConvertTo-Json | Set-Content -Encoding utf8 $statusFile
}

try {
    if (-not (Test-Path $python)) { throw "Missing Navi Python environment: $python" }
    if (-not (Test-Path $environment)) { throw "Missing existing OpenWakeWord training environment: $environment" }

    Save-Status "corpus" "running" "Generating 2,500 training clips and 500 validation clips for the candidate."
    Write-Log "[1/3] Generating candidate corpus"
    & $python (Join-Path $PSScriptRoot "generate_naruya_corpus.py") --root $TrainingRoot --model-name $modelName --output-dir $modelDirectory --status-path $statusFile --train-count 2500 --validation-count 500 2>&1 |
        Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "Corpus generation failed. Exit code: $LASTEXITCODE" }

    Save-Status "training" "running" "Training candidate ONNX model."
    Write-Log "[2/3] Extracting features and training candidate"
    & conda run -p $environment python (Join-Path $TrainingRoot "openWakeWord\openwakeword\train.py") --training_config (Join-Path $PSScriptRoot "naruya_v3_training.yml") --augment_clips --train_model 2>&1 |
        ForEach-Object {
            $line = [string]$_
            if ($line -notmatch '^(Training:|Computing features:|Trimming empty rows:|,\s*[0-9]|[0-9]+it/s\]$)') {
                $line | Tee-Object -FilePath $logFile -Append
            }
        }
    if ($LASTEXITCODE -ne 0) { throw "ONNX training failed. Exit code: $LASTEXITCODE" }

    $candidate = Join-Path $outputRoot "$modelName.onnx"
    if (-not (Test-Path $candidate)) { throw "Candidate ONNX model was not found: $candidate" }
    Copy-Item -Force $candidate (Join-Path $backend "models\$modelName.onnx")
    Save-Status "complete" "candidate_ready" "Candidate model is ready for comparison. The active naruya.onnx was not changed."
    Write-Log "[3/3] Complete: $candidate"
} catch {
    Save-Status "failed" "failed" $_.Exception.Message
    Write-Log "Failed: $($_.Exception.Message)"
    exit 1
}
