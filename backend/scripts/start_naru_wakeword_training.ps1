param(
    [string]$TrainingRoot = "D:\NaviWakeWord"
)

# Native tools can print non-fatal warnings to stderr. Each command below checks
# its own exit code so those warnings are preserved in the log without aborting.
$ErrorActionPreference = "Continue"
$backend = Split-Path -Parent $PSScriptRoot
$project = Split-Path -Parent $backend
$logDirectory = Join-Path $TrainingRoot "logs"
$statusFile = Join-Path $TrainingRoot "status.json"
$logFile = Join-Path $logDirectory "naruya-training.log"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Write-TrainingLog([string]$Message) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    $line | Tee-Object -FilePath $logFile -Append
}

function Save-Status([string]$Phase, [string]$State, [string]$Message) {
    @{ phase = $Phase; state = $State; message = $Message; updated_at = (Get-Date).ToUniversalTime().ToString("o") } |
        ConvertTo-Json | Set-Content -Encoding utf8 $statusFile
}

function Write-Utf8Message([string]$EncodedText, [ConsoleColor]$Color) {
    $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EncodedText))
    Write-Host $text -ForegroundColor $Color
}

try {
    Write-Utf8Message "64KY66Oo7JW8IOybqOydtO2BrOybjOuTnCDtlZnsirXsnYQg7Iuc7J6R7ZWp64uI64ukLg==" Cyan
    Write-Utf8Message "7ZWZ7Iq17J20IOuBneuCmOqxsOuCmCDsmKTrpZjqsIAg64KY64+EIOydtCDssL3snYAg7Jyg7KeA65Cp64uI64ukLg==" DarkGray
    Save-Status "bootstrap" "running" "Starting Korean Edge TTS corpus generation."
    Write-TrainingLog "[1/3] Starting Korean Edge TTS corpus generation"
    & (Join-Path $backend ".venv\Scripts\python.exe") (Join-Path $PSScriptRoot "generate_naruya_corpus.py") --root $TrainingRoot 2>&1 |
        Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "Corpus generation failed. Exit code: $LASTEXITCODE" }

    Save-Status "environment" "running" "Preparing the dedicated OpenWakeWord Python 3.10 environment."
    Write-TrainingLog "[2/3] Preparing the OpenWakeWord training environment"
    $environment = Join-Path $TrainingRoot "env"
    if (-not (Test-Path $environment)) {
        & conda create -y -p $environment python=3.10 pip 2>&1 | Tee-Object -FilePath $logFile -Append
        if ($LASTEXITCODE -ne 0) { throw "Conda environment creation failed. Exit code: $LASTEXITCODE" }
    }
    & conda run -p $environment python -m pip install --upgrade pip 2>&1 | Tee-Object -FilePath $logFile -Append
    & conda run -p $environment python -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu 2>&1 | Tee-Object -FilePath $logFile -Append
    & conda run -p $environment python -m pip install -e (Join-Path $TrainingRoot "openWakeWord") torchinfo torchmetrics speechbrain==0.5.14 audiomentations==0.33.0 torch-audiomentations==0.11.0 acoustics==0.2.6 mutagen==1.47.0 pyyaml onnx==1.14.0 pronouncing 2>&1 | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "Training dependency installation failed. Exit code: $LASTEXITCODE" }
    Copy-Item -Recurse -Force (Join-Path $PSScriptRoot "piper_stub") (Join-Path $TrainingRoot "piper_stub")
    & conda run -p $environment python -c "import openwakeword.utils; openwakeword.utils.download_models()" 2>&1 | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "OpenWakeWord feature model download failed. Exit code: $LASTEXITCODE" }
    & (Join-Path $backend ".venv\Scripts\python.exe") (Join-Path $PSScriptRoot "patch_openwakeword_windows.py") --source (Join-Path $TrainingRoot "openWakeWord") 2>&1 |
        Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "OpenWakeWord Windows compatibility patch failed. Exit code: $LASTEXITCODE" }

    Save-Status "training" "running" "Starting feature extraction and ONNX training."
    Write-TrainingLog "[3/3] Starting feature extraction and ONNX training"
    # tqdm draws Unicode progress bars on stderr. They corrupt in the Windows
    # console pipeline, so keep warnings/errors but omit only progress updates.
    & conda run -p $environment python (Join-Path $TrainingRoot "openWakeWord\openwakeword\train.py") --training_config (Join-Path $PSScriptRoot "naruya_training.yml") --augment_clips --train_model 2>&1 |
        ForEach-Object {
            $line = [string]$_
            if ($line -notmatch '^(Training:|Computing features:|Trimming empty rows:|,\s*[0-9]|[0-9]+it/s\]$)') {
                $line | Tee-Object -FilePath $logFile -Append
            }
        }
    if ($LASTEXITCODE -ne 0) { throw "ONNX training failed. Exit code: $LASTEXITCODE" }

    $model = Join-Path $TrainingRoot "output-v2\naruya.onnx"
    if (-not (Test-Path $model)) { throw "Training finished but the ONNX model was not found: $model" }
    Copy-Item -Force $model (Join-Path $backend "models\naruya.onnx")
    Save-Status "complete" "prototype_ready" "A prototype ONNX model was generated. Validate false accepts and misses before enabling it."
    Write-TrainingLog "Complete: $model"
} catch {
    Save-Status "failed" "failed" $_.Exception.Message
    Write-TrainingLog "Failed: $($_.Exception.Message)"
    exit 1
}
