<#
.SYNOPSIS
    ndx Gauntlet Test Runner Script

.DESCRIPTION
    Runs the ndx gauntlet test suite inside a Windows Docker container.
    Provides real-time output streaming, proper exit codes, and cleanup.

.PARAMETER NoBuild
    Skip building the Docker image (use existing)

.PARAMETER KeepContainer
    Don't remove container after tests complete

.PARAMETER Detach
    Run container in background (don't stream output)

.PARAMETER Verbose
    Enable verbose output

.EXAMPLE
    .\run-gauntlet.ps1
    Builds image and runs tests with output streaming

.EXAMPLE
    .\run-gauntlet.ps1 -NoBuild -Detach
    Skips build and runs tests in background

.NOTES
    Exit codes:
    0 - All tests passed
    1 - Tests failed
    2 - Docker command failed
    3 - Configuration error
#>

param(
    [switch]$NoBuild,
    [switch]$KeepContainer,
    [switch]$Detach,
    [switch]$Verbose,
    [switch]$Help
)

# Configuration
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ContainerName = $env:CONTAINER_NAME ?? "ndx-gauntlet-test"
$ImageTag = $env:IMAGE_TAG ?? "ndx-gauntlet:latest"
$Dockerfile = Join-Path $ScriptDir "Dockerfile.windows"

# Color codes (Windows 10+)
$esc = [char]0x1b
$ColorInfo = "$esc[34m"     # Blue
$ColorSuccess = "$esc[32m"  # Green
$ColorError = "$esc[31m"    # Red
$ColorWarn = "$esc[33m"     # Yellow
$ColorReset = "$esc[0m"

##############################################################################
# Utility Functions
##############################################################################

function Write-InfoMessage {
    param([string]$Message)
    Write-Host "${ColorInfo}[INFO]${ColorReset} $Message"
}

function Write-SuccessMessage {
    param([string]$Message)
    Write-Host "${ColorSuccess}[✓]${ColorReset} $Message"
}

function Write-ErrorMessage {
    param([string]$Message)
    Write-Error "${ColorError}[✗]${ColorReset} $Message"
}

function Write-WarnMessage {
    param([string]$Message)
    Write-Host "${ColorWarn}[!]${ColorReset} $Message"
}

function Write-VerboseMessage {
    param([string]$Message)
    if ($Verbose) {
        Write-Host "${ColorInfo}[DEBUG]${ColorReset} $Message"
    }
}

function Show-Help {
    Write-Host @"
ndx Gauntlet Test Runner

Usage:
    .\run-gauntlet.ps1 [OPTIONS]

Options:
    -NoBuild        Skip building the Docker image (use existing)
    -KeepContainer  Don't remove container after tests complete
    -Detach         Run container in background (don't stream output)
    -Verbose        Enable verbose output
    -Help           Show this help message

Environment Variables:
    CONTAINER_NAME  Override default container name (default: ndx-gauntlet-test)
    IMAGE_TAG       Override default image tag (default: ndx-gauntlet:latest)

Exit Codes:
    0 - All tests passed
    1 - Tests failed
    2 - Docker command failed
    3 - Configuration error
"@
}

##############################################################################
# Docker Validation
##############################################################################

function Test-DockerInstalled {
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-ErrorMessage "Docker is not installed or not in PATH"
        Write-InfoMessage "Install Docker Desktop from: https://www.docker.com/products/docker-desktop"
        return $false
    }
    Write-VerboseMessage "Docker found: $($dockerCmd.Version)"
    return $true
}

function Test-DockerRunning {
    try {
        $null = docker ps
        Write-VerboseMessage "Docker daemon is running"
        return $true
    }
    catch {
        Write-ErrorMessage "Docker daemon is not running"
        Write-InfoMessage "Start Docker Desktop and try again"
        return $false
    }
}

##############################################################################
# Container Operations
##############################################################################

function Build-DockerImage {
    Write-InfoMessage "Building Docker image: $ImageTag"
    Write-InfoMessage "Dockerfile: $Dockerfile"
    Write-InfoMessage "Context: $ProjectRoot"

    $buildCmd = @(
        "docker", "build"
        "-f", $Dockerfile
        "-t", $ImageTag
        $ProjectRoot
    )

    Write-VerboseMessage "Build command: $($buildCmd -join ' ')"

    & $buildCmd[0] ($buildCmd[1..($buildCmd.Length-1)]) 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        Write-ErrorMessage "Failed to build Docker image (exit code: $exitCode)"
        return $exitCode
    }

    Write-SuccessMessage "Docker image built successfully"
    return 0
}

function Invoke-GauntletTests {
    $testCommand = "pnpm test"

    Write-InfoMessage "Starting container: $ContainerName"
    Write-InfoMessage "Running command: $testCommand"
    Write-Host ""

    $dockerRunArgs = @(
        "-it",
        "--name", $ContainerName,
        "-e", "NODE_ENV=test"
    )

    if ($KeepContainer -eq $false) {
        $dockerRunArgs += "--rm"
    }

    if ($Detach) {
        $dockerRunArgs[0] = "-d"  # Replace -it with -d
        $dockerRunArgs = $dockerRunArgs -replace "-it", "-d"
    }

    $runCmd = @(
        "docker", "run"
    ) + $dockerRunArgs + @(
        $ImageTag,
        "powershell", "-Command", $testCommand
    )

    Write-VerboseMessage "Run command: $($runCmd -join ' ')"

    & $runCmd[0] ($runCmd[1..($runCmd.Length-1)]) 2>&1
    $exitCode = $LASTEXITCODE

    Write-Host ""

    if ($exitCode -ne 0) {
        Write-ErrorMessage "Tests failed with exit code $exitCode"
    }
    else {
        Write-SuccessMessage "Tests completed successfully"
    }

    return $exitCode
}

function Invoke-Cleanup {
    param([int]$TestExitCode)

    if ($Detach) {
        Write-InfoMessage "Container running in background: $ContainerName"
        Write-InfoMessage "View logs with: docker logs -f $ContainerName"
        return $TestExitCode
    }

    if ($KeepContainer) {
        Write-WarnMessage "Container preserved for inspection: $ContainerName"
        Write-InfoMessage "Remove with: docker rm $ContainerName"
        Write-InfoMessage "View logs with: docker logs $ContainerName"
        return $TestExitCode
    }

    Write-SuccessMessage "Cleaned up container: $ContainerName"
    return $TestExitCode
}

##############################################################################
# Main
##############################################################################

try {
    # Handle help
    if ($Help) {
        Show-Help
        exit 0
    }

    Write-InfoMessage "ndx Gauntlet Test Runner"
    Write-Host ""

    # Validate Docker
    if (-not (Test-DockerInstalled)) {
        exit 3
    }

    if (-not (Test-DockerRunning)) {
        exit 2
    }

    # Build image if needed
    if (-not $NoBuild) {
        $buildResult = Build-DockerImage
        if ($buildResult -ne 0) {
            exit $buildResult
        }
        Write-Host ""
    }
    else {
        Write-InfoMessage "Skipping image build (-NoBuild)"
        Write-Host ""
    }

    # Run tests
    $testExitCode = Invoke-GauntletTests

    # Cleanup and exit
    $finalExitCode = Invoke-Cleanup $testExitCode
    exit $finalExitCode
}
catch {
    Write-ErrorMessage "Unexpected error: $_"
    Write-ErrorMessage $_.ScriptStackTrace
    exit 2
}
