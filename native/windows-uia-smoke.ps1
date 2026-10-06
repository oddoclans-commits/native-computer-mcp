$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase

$requiredTypes = @(
  [System.Windows.Automation.AutomationElement],
  [System.Windows.Automation.InvokePattern],
  [System.Windows.Automation.ValuePattern],
  [System.Windows.Automation.TogglePattern],
  [System.Windows.Automation.SelectionItemPattern],
  [System.Windows.Automation.TreeWalker],
  [System.Windows.Point]
)

foreach ($type in $requiredTypes) {
  if ($null -eq $type) {
    throw "Required UI Automation type failed to load."
  }
  Write-Host "UIA OK: $($type.FullName)"
}

$controlWalker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
if ($null -eq $controlWalker) {
  throw "ControlViewWalker is unavailable."
}

Write-Host "Windows UI Automation assembly smoke test passed."
