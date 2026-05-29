# VoiceClaw Evolution — Python Environment Setup
# Creates a dedicated venv and installs all training dependencies.
# Run this once from the project root: .\scripts\setup-evolution-env.ps1

$ErrorActionPreference = "Stop"

$VenvPath = Join-Path $PSScriptRoot "evolution-venv"
$RequirementsPath = Join-Path $PSScriptRoot "requirements-evolution.txt"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " VoiceClaw Evolution Environment Setup"   -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Python
Write-Host "[1/4] Checking Python installation..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "       Found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "       ERROR: Python not found. Install Python 3.10+ first." -ForegroundColor Red
    exit 1
}

# 2. Check CUDA (nvidia-smi)
Write-Host "[2/4] Checking NVIDIA GPU..." -ForegroundColor Yellow
try {
    $nvidiaSmi = nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1
    Write-Host "       Found: $nvidiaSmi" -ForegroundColor Green
} catch {
    Write-Host "       WARNING: nvidia-smi not found. Training may fail without a CUDA GPU." -ForegroundColor DarkYellow
}

# 3. Create venv
Write-Host "[3/4] Creating virtual environment..." -ForegroundColor Yellow
if (Test-Path $VenvPath) {
    Write-Host "       Existing venv found at $VenvPath — reusing." -ForegroundColor DarkYellow
} else {
    python -m venv $VenvPath
    Write-Host "       Created venv at $VenvPath" -ForegroundColor Green
}

# 4. Install dependencies
Write-Host "[4/4] Installing dependencies (this may take several minutes)..." -ForegroundColor Yellow
$pipExe = Join-Path $VenvPath "Scripts\pip.exe"

# Upgrade pip first
& $pipExe install --upgrade pip --quiet

# Install requirements
& $pipExe install -r $RequirementsPath

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Dependency installation failed." -ForegroundColor Red
    Write-Host "Common fixes:" -ForegroundColor Yellow
    Write-Host "  - Ensure CUDA toolkit 12.1+ is installed"
    Write-Host "  - Try: pip install torch --index-url https://download.pytorch.org/whl/cu121"
    exit 1
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host " Setup Complete!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "The evolution pipeline will automatically use this venv."
Write-Host "Python: $(Join-Path $VenvPath 'Scripts\python.exe')"
Write-Host ""
Write-Host "To test manually:" -ForegroundColor Cyan
Write-Host "  & '$(Join-Path $VenvPath 'Scripts\python.exe')' scripts/train_model.py --help"
Write-Host ""
