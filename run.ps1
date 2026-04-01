Param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CliArgs = @("--version")
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    exit 1
}

function Step($msg) {
    Write-Host "[STEP] $msg" -ForegroundColor Cyan
}

Step "Checking Node.js and npm"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js is not installed or not in PATH. Install Node.js 18+ (recommended 20 LTS), then reopen terminal."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "npm is not available in PATH. Reinstall Node.js LTS and reopen terminal."
}

$nodeVersion = node -v
$npmVersion = npm -v
Write-Host "Node: $nodeVersion"
Write-Host "npm : $npmVersion"

Step "Installing dependencies"
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }

Step "Building project"
npm run build
if ($LASTEXITCODE -ne 0) { Fail "npm run build failed" }

if (-not (Test-Path "dist/cli.js")) {
    Fail "Build completed but dist/cli.js not found"
}

Step "Running CLI"
node dist/cli.js @CliArgs
if ($LASTEXITCODE -ne 0) { Fail "CLI execution failed" }

Write-Host "[DONE] Completed successfully" -ForegroundColor Green
