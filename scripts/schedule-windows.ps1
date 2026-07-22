# Registers a Windows Task Scheduler job that scrapes Reddit for Jimothy
# twice a day (08:00 and 20:00) and ingests the results.
#
# Run once, from the project root, in PowerShell:
#     powershell -ExecutionPolicy Bypass -File scripts\schedule-windows.ps1
#
# Remove it later with:
#     Unregister-ScheduledTask -TaskName "JimothyTracker Ingest" -Confirm:$false

$ErrorActionPreference = "Stop"

# Resolve the project root (parent of this script's folder).
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source

$action = New-ScheduledTaskAction `
    -Execute $node `
    -Argument "--env-file-if-exists=.env scripts\ingest.js reddit" `
    -WorkingDirectory $projectRoot

# Two triggers a day. Adjust the times if you like.
$triggers = @(
    New-ScheduledTaskTrigger -Daily -At 8:00AM
    New-ScheduledTaskTrigger -Daily -At 8:00PM
)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
    -TaskName "JimothyTracker Ingest" `
    -Description "Scrapes Seattle subreddits for Jimothy sightings twice daily." `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Force

Write-Host ""
Write-Host "Scheduled 'JimothyTracker Ingest' to run at 8:00 AM and 8:00 PM daily."
Write-Host "Test it now with:  Start-ScheduledTask -TaskName 'JimothyTracker Ingest'"
