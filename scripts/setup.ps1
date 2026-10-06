param([switch]$CheckOnly, [switch]$Run, [string[]]$AppArgs)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$minimumNode = [version]($package.engines.node -replace '^>=', '')
$requiredPnpm = $package.packageManager -replace '^pnpm@', ''

function Find-Tool($Name, $Candidates, $Accept, $Fix) {
    $failures = @()
    foreach ($candidate in ($Candidates | Where-Object { $_ } | Select-Object -Unique)) {
        try {
            $output = & $candidate --version 2>&1
            $code = $LASTEXITCODE
            $version = ($output | Out-String).Trim()
            if ($code -eq 0 -and (& $Accept $version)) {
                Write-Host "$Name $version ($candidate)"
                return $candidate
            }
            $failures += "$candidate returned '$version' (exit $code)"
        }
        catch {
            $failures += "$candidate could not run: $($_.Exception.Message)"
        }
    }
    if ($failures.Count -eq 0) { $failures += 'No executable was found.' }
    throw "$Name preflight failed. $Fix`n$($failures -join "`n")"
}

try {
    if ($CheckOnly -and $Run) { throw 'Use either -CheckOnly or -Run.' }
    if ($AppArgs -and -not $Run) { throw 'App arguments require -Run.' }
    $nodeCandidates = @(Get-Command node.exe -All -ErrorAction SilentlyContinue | ForEach-Object Source)
    if ($env:NVM_SYMLINK) { $nodeCandidates += Join-Path $env:NVM_SYMLINK 'node.exe' }
    $node = Find-Tool 'Node' $nodeCandidates {
        param($Value)
        $Value -match '^v\d+\.\d+\.\d+$' -and [version]$Value.Substring(1) -ge $minimumNode
    } "Install Node $minimumNode or newer, then put its directory on PATH. Check access to the listed executable."

    # Apply the selected runtime only to setup and its child processes.
    $env:PATH = "$(Split-Path $node -Parent);$env:PATH"
    $pnpmCandidates = @(Get-Command pnpm.cmd -All -ErrorAction SilentlyContinue | ForEach-Object Source)
    if ($env:NVM_SYMLINK) { $pnpmCandidates += Join-Path $env:NVM_SYMLINK 'pnpm.cmd' }
    $pnpm = Find-Tool 'pnpm' $pnpmCandidates {
        param($Value)
        $Value -eq $requiredPnpm
    } "Install pnpm $requiredPnpm for the selected Node runtime, then put its directory on PATH. Do not use a different pnpm version."
    $env:PATH = "$(Split-Path $node -Parent);$(Split-Path $pnpm -Parent);$env:PATH"

    $gitCandidates = @(Get-Command git.exe -All -ErrorAction SilentlyContinue | ForEach-Object Source)
    $null = Find-Tool 'Git' $gitCandidates {
        param($Value)
        $Value -match '^git version '
    } 'Install Git and put its executable directory on PATH.'

    Write-Host 'Toolchain preflight passed.'
    if (-not $CheckOnly) {
        Push-Location $root
        try {
            if ($Run) { & $pnpm start @AppArgs }
            else { & $pnpm install --frozen-lockfile }
            if ($LASTEXITCODE -ne 0) {
                throw "Project command failed (exit $LASTEXITCODE). Check the output above."
            }
        }
        finally { Pop-Location }
        if (-not $Run) { Write-Host 'Dependency setup completed.' }
    }
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
