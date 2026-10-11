$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$taskName = 'DJA Payroll Daily SQL Backup'
$action = New-ScheduledTaskAction -Execute $nodePath -Argument '--env-file=.env scripts/backup-database.mjs' -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At 12:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
try {
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "Installed '$taskName' for 12:00 AM daily, including when signed out."
} catch {
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "Installed '$taskName' for 12:00 AM daily while signed in."
}
Write-Host 'The computer and database server must be running.'
