$secureKey = Read-Host "DISCOVER_KEY" -AsSecureString
$ptr = [IntPtr]::Zero
$key = $null
try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)

    $headers = @{ 'x-discover-key' = $key }
    $base = 'https://nungari.netlify.app/.netlify/functions/discover'

    # --- start the run (a dry run reports without writing anything) ---
    try {
        $started = Invoke-RestMethod -Uri "$base`?dryRun=1" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 60
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            Write-Host "FAILED $([int]$resp.StatusCode): $($reader.ReadToEnd())" -ForegroundColor Red
            return
        }
        throw
    }

    Write-Host "run $($started.runId) started at $($started.startedAt) - polling every 5s (max 8 minutes)`n" -ForegroundColor Cyan

    # --- poll until the run reports done or failed ---
    $deadline = (Get-Date).AddMinutes(8)
    $report = $null
    $seen = ''
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        try {
            $report = Invoke-RestMethod -Uri "$base`?status=1" -Headers $headers -TimeoutSec 30
        } catch {
            Write-Host "  ... status check failed, retrying" -ForegroundColor DarkGray
            continue
        }
        if ($report.status -eq 'done' -or $report.status -eq 'failed') { break }

        # the sources that have finished so far
        if ($report.sources) {
            $done = @($report.sources | Where-Object { $_.status -ne 'running' })
            if ($done.Count -gt 0) {
                $line = ($done | ForEach-Object { "$($_.id)=$($_.status)" }) -join ', '
                if ($line -ne $seen) {
                    $seen = $line
                    Write-Host "  ... finished so far: $line" -ForegroundColor DarkGray
                }
            }
        }
        Write-Host "  ... $($report.status)" -ForegroundColor DarkGray
    }

    if (-not $report) {
        Write-Host "NO REPORT - the status endpoint did not answer. Try again in a moment." -ForegroundColor Red
        return
    }
    if ($report.status -eq 'running') {
        Write-Host "TIMED OUT - the run is still going. Check again with:`n  Invoke-RestMethod '$base`?status=1' -Headers @{ 'x-admin-key' = `$key }" -ForegroundColor Yellow
        return
    }
    if ($report.status -eq 'failed') {
        Write-Host "RUN FAILED" -ForegroundColor Red
        Write-Host "state: $($report.status)"
        Write-Host "error: $($report.error)"
        return
    }

    # --- print the report ---
    Write-Host "`nrun $($report.runId)  |  $($report.startedAt) -> $($report.finishedAt)  |  $($report.durationMs)ms  |  dryRun $($report.dryRun)  |  pending $($report.pendingCount)  |  approvedUntouched $($report.approvedUntouched)" -ForegroundColor Cyan
    Write-Host "model: $($report.model)  |  window $($report.window.from) -> $($report.window.to)" -ForegroundColor DarkGray
    Write-Host "cap $($report.maxEvents)  |  candidates found $($report.candidatesFound)  |  kept $($report.kept)  |  dropped by the cap $($report.droppedByCap)  |  dropped as irrelevant $($report.droppedIrrelevant)  |  timed out sources $($report.timedOut)" -ForegroundColor DarkGray

    if (-not $report.sources -or $report.sources.Count -eq 0) {
        Write-Host "`nNO SOURCES WERE READ" -ForegroundColor Red
        Write-Host "state: $($report.status)"
        Write-Host "error: $($report.error)"
        return
    }

    Write-Host "`nSOURCES ($($report.sources.Count))" -ForegroundColor Cyan
    $report.sources | Select-Object id, status, method, found, dropped, error | Format-Table -AutoSize

    $found = ($report.sources | Measure-Object -Property found -Sum).Sum
    Write-Host "found $found across the sources, $($report.accepted.Count) kept, $($report.skipped.Count) skipped" -ForegroundColor DarkGray

    if ($report.accepted) {
        Write-Host "`nWOULD BE ADDED ($($report.accepted.Count))" -ForegroundColor Green
        $report.accepted | Select-Object title, date, city, venue, sourceUrl | Format-Table -AutoSize
    }
    if ($report.skipped) {
        Write-Host "`nSKIPPED ($($report.skipped.Count))" -ForegroundColor Yellow
        $report.skipped | Select-Object title, city, source, reason | Format-Table -AutoSize
    }
}
finally {
    if ($key) { $key = $null }
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $secureKey = $null
}
