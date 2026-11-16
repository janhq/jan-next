param([string]$Script, [string]$Plan, [string]$Case)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$spec = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
$global:janNetworkRules = @()
$global:janNetworkCreated = 0
$global:janNetworkRemoved = 0
function Get-NetFirewallRule { param($PolicyStore) return $global:janNetworkRules }
function Get-NetFirewallApplicationFilter {
    param([Parameter(ValueFromPipeline = $true)]$InputObject)
    process { return [pscustomobject]@{ Program = $InputObject.Program } }
}
function New-NetFirewallRule {
    param($Name, $DisplayName, $Description, $Direction, $Program, $Action, $Profile, $Enabled, $PolicyStore)
    $global:janNetworkCreated++
    if ($Case -eq 'creation-failure') { throw 'inert creation failure' }
    $global:janNetworkRules = @([pscustomobject]@{ Name = $Name; Description = $Description; Direction = $Direction;
        Program = $Program; Action = $Action; Enabled = $Enabled; Profile = $Profile; PolicyStore = $PolicyStore })
    return $global:janNetworkRules
}
function Remove-NetFirewallRule {
    param([Parameter(ValueFromPipeline = $true)]$InputObject)
    process {
        $global:janNetworkRemoved++
        if ($Case -ne 'restore-failure') { $global:janNetworkRules = @() }
    }
}
function Read-Host {
    param($Prompt)
    if ($Case -in @('declined', 'restore-declined')) { return 'NO' }
    if ($Case -eq 'changed-during-confirmation') { [IO.File]::WriteAllText($spec.executable, 'changed during confirmation') }
    if ($Prompt -like 'Type RESTORE*') { return "RESTORE $($spec.runId)" }
    return "BLOCK $($spec.runId)"
}
if ($Case -in @('existing', 'foreign', 'restore', 'restore-failure', 'restore-declined', 'status')) {
    $global:janNetworkRules = @([pscustomobject]@{ Name = $spec.ruleName; Direction = 'Outbound'; Action = 'Block';
        Program = $spec.executable; Enabled = 'True'; Description = "jan-update-qualification:$($spec.runId):$($spec.sha512Hex)" })
    if ($Case -eq 'foreign') { $global:janNetworkRules[0].Program = 'C:\not-the-test-application.exe' }
}
$action = if ($Case -like 'restore*') { 'Restore' } elseif ($Case -eq 'status') { 'Status' } else { 'Block' }
$failure = $null
try { & $Script -Plan $Plan -Action $action } catch { $failure = $_.Exception.Message }
@{ failure = $failure; created = $global:janNetworkCreated; removed = $global:janNetworkRemoved;
    remaining = $global:janNetworkRules.Count } | ConvertTo-Json -Compress
