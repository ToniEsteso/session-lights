# Install the latest Session Lights release on Windows.
# Usage: irm https://raw.githubusercontent.com/ToniEsteso/session-lights/main/scripts/install.ps1 | iex
# The script block keeps all settings and variables out of the caller's session.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $savedProtocol = [Net.ServicePointManager]::SecurityProtocol
    [Net.ServicePointManager]::SecurityProtocol = $savedProtocol -bor [Net.SecurityProtocolType]::Tls12

    $repo = 'ToniEsteso/session-lights'
    $work = Join-Path ([IO.Path]::GetTempPath()) ("session-lights-" + [Guid]::NewGuid().ToString('N'))

    try {
        if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { throw 'This script supports Windows only. See docs/installation.md.' }
        New-Item -ItemType Directory -Path $work | Out-Null

        Write-Host 'Finding the latest release...'
        try { $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" }
        catch { throw "Could not read the latest release. No release may be published yet, or GitHub may have reached its limit of 60 requests per hour for your address. $($_.Exception.Message)" }
        $tag = $release.tag_name
        if ($tag -notmatch '^v\d+\.\d+\.\d+$') { throw 'Could not find a published release.' }
        $base = "https://github.com/$repo/releases/download/$tag"

        # latest.yml gives the installer name and its SHA-512 hash in base64.
        try { $yml = (Invoke-WebRequest "$base/latest.yml" -UseBasicParsing).Content }
        catch { throw "Release $tag has no Windows build." }
        if ($yml -isnot [string]) { $yml = [Text.Encoding]::UTF8.GetString($yml) }
        $match = [regex]::Match($yml, '(?m)^\s*-\s*url:\s*(\S+-x64-Setup\.exe)\s*\r?\n\s*sha512:\s*(\S+)')
        if (-not $match.Success) { throw "Release $tag has no Windows installer." }
        $name = $match.Groups[1].Value
        $expected = $match.Groups[2].Value
        if ($name -notmatch '^[A-Za-z0-9._-]+$') { throw 'The release lists an unsafe file name.' }

        Write-Host "Downloading $name..."
        $installer = Join-Path $work $name
        Invoke-WebRequest "$base/$name" -OutFile $installer -UseBasicParsing
        $sha = [Security.Cryptography.SHA512]::Create()
        $stream = [IO.File]::OpenRead($installer)
        try { $actual = [Convert]::ToBase64String($sha.ComputeHash($stream)) }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($actual -cne $expected) { throw 'The download does not match its checksum. Nothing was installed.' }

        if (Get-Process -Name 'Session Lights' -ErrorAction SilentlyContinue) {
            throw 'Session Lights is running. Quit it from the tray menu and run this command again.'
        }
        Write-Host 'Installing Session Lights...'
        $process = Start-Process $installer -ArgumentList '/S', '--force-run' -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "The installer failed with exit code $($process.ExitCode)." }
        Write-Host "Installed Session Lights $tag."
    }
    catch {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
    finally {
        [Net.ServicePointManager]::SecurityProtocol = $savedProtocol
        Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
