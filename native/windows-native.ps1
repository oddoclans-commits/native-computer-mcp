param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadBase64
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NativeComputer {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)]
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public static void SendUnicode(char character, bool keyUp) {
        INPUT input = new INPUT();
        input.type = 1;
        input.U.ki.wVk = 0;
        input.U.ki.wScan = character;
        input.U.ki.dwFlags = 0x0004 | (keyUp ? 0x0002u : 0u);
        input.U.ki.time = 0;
        input.U.ki.dwExtraInfo = UIntPtr.Zero;
        SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
    }

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP   = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP   = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@

$raw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))
$request = $raw | ConvertFrom-Json

function Get-WindowRecord([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return $null }

  $sb = New-Object System.Text.StringBuilder 1024
  [NativeComputer]::GetWindowText($handle, $sb, $sb.Capacity) | Out-Null

  $rect = New-Object NativeComputer+RECT
  if (-not [NativeComputer]::GetWindowRect($handle, [ref]$rect)) { return $null }

  $pid = 0
  [NativeComputer]::GetWindowThreadProcessId($handle, [ref]$pid) | Out-Null
  $appName = $null
  try { $appName = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch {}

  return [pscustomobject]@{
    id = $handle.ToInt64().ToString()
    title = $sb.ToString()
    appName = $appName
    bounds = [pscustomobject]@{
      x = $rect.Left
      y = $rect.Top
      width = $rect.Right - $rect.Left
      height = $rect.Bottom - $rect.Top
    }
    focused = $true
  }
}

function Get-Displays() {
  return @(
    [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
      [pscustomobject]@{
        id = $_.DeviceName
        bounds = [pscustomobject]@{
          x = $_.Bounds.X
          y = $_.Bounds.Y
          width = $_.Bounds.Width
          height = $_.Bounds.Height
        }
      }
    }
  )
}

function Get-Screenshot() {
  $rect = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap $rect.Width, $rect.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      return [pscustomobject]@{
        mimeType = "image/png"
        data = [Convert]::ToBase64String($stream.ToArray())
        width = $bitmap.Width
        height = $bitmap.Height
      }
    } finally {
      $stream.Dispose()
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}


function Get-UiaTargetId($element) {
  $runtimeId = $element.GetRuntimeId()
  return "uia:" + (($runtimeId | ForEach-Object { $_.ToString() }) -join ".")
}

function Convert-Rectangle($rect) {
  if ($null -eq $rect) { return $null }
  if ([double]::IsInfinity($rect.X) -or [double]::IsInfinity($rect.Y)) { return $null }
  return [pscustomobject]@{
    x = [int]$rect.X
    y = [int]$rect.Y
    width = [int]$rect.Width
    height = [int]$rect.Height
  }
}

function Get-UiaPatternNames($element) {
  $names = @()
  $patterns = @(
    @{ name = "InvokePattern"; pattern = [System.Windows.Automation.InvokePattern]::Pattern },
    @{ name = "ValuePattern"; pattern = [System.Windows.Automation.ValuePattern]::Pattern },
    @{ name = "TogglePattern"; pattern = [System.Windows.Automation.TogglePattern]::Pattern },
    @{ name = "SelectionItemPattern"; pattern = [System.Windows.Automation.SelectionItemPattern]::Pattern },
    @{ name = "ExpandCollapsePattern"; pattern = [System.Windows.Automation.ExpandCollapsePattern]::Pattern },
    @{ name = "ScrollItemPattern"; pattern = [System.Windows.Automation.ScrollItemPattern]::Pattern }
  )

  foreach ($item in $patterns) {
    try {
      $patternObject = $null
      if ($element.TryGetCurrentPattern($item.pattern, [ref]$patternObject)) {
        $names += $item.name
      }
    } catch {}
  }

  return @($names)
}

function Get-UiaValue($element) {
  try {
    $patternObject = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$patternObject)) {
      return $patternObject.Current.Value
    }
  } catch {}
  return $null
}

function Get-UiaNode($element, [int]$depth = 0, [int]$maxDepth = 8) {
  if ($null -eq $element) { return $null }
  if ($script:UiaNodeCount -ge 500) { return $null }
  $script:UiaNodeCount++

  try {
    $current = $element.Current
    $role = $current.ControlType.ProgrammaticName
    $role = ($role -split "\.")[-1]
    $name = $current.Name
    $automationId = $current.AutomationId
    $className = $current.ClassName
    $value = Get-UiaValue $element
    $bounds = Convert-Rectangle $current.BoundingRectangle
    $patterns = Get-UiaPatternNames $element

    $node = [ordered]@{
      id = Get-UiaTargetId $element
      role = $role
    }

    if ($name) { $node.name = $name }
    if ($value) { $node.value = $value }
    if ($automationId) { $node.automationId = $automationId }
    if ($className) { $node.className = $className }
    if ($patterns.Count -gt 0) { $node.patterns = $patterns }
    if ($bounds) { $node.bounds = $bounds }
    $node.enabled = [bool]$current.IsEnabled
    $node.focused = [bool]$current.HasKeyboardFocus

    if ($depth -lt $maxDepth) {
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $child = $walker.GetFirstChild($element)
      $children = New-Object System.Collections.Generic.List[object]
      $count = 0

      while ($null -ne $child -and $count -lt 250) {
        $childNode = Get-UiaNode $child ($depth + 1) $maxDepth
        if ($null -ne $childNode) {
          [void]$children.Add($childNode)
          $count++
        }

        try {
          $child = $walker.GetNextSibling($child)
        } catch {
          $child = $null
        }
      }

      if ($children.Count -gt 0) { $node.children = $children.ToArray() }
    }

    return [pscustomobject]$node
  } catch {
    return $null
  }
}

function Get-UiaTree() {
  try {
    $foreground = [NativeComputer]::GetForegroundWindow()
    if ($foreground -eq [IntPtr]::Zero) { return @() }

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($foreground)
    if ($null -eq $root) { return @() }

    $node = Get-UiaNode $root
    if ($null -eq $node) { return @() }

    return @($node)
  } catch {
    return @()
  }
}

function Resolve-UiaTarget([string]$targetId) {
  if ([string]::IsNullOrWhiteSpace($targetId) -or -not $targetId.StartsWith("uia:")) {
    throw "Invalid UI Automation target id."
  }

  [int[]]$values = @(
    $targetId.Substring(4).Split(".") |
      ForEach-Object { [int]$_ }
  )

  if ($values.Count -eq 0) { throw "Empty UI Automation runtime id." }

  $element = [System.Windows.Automation.AutomationElement]::FromRuntimeId($values)
  if ($null -eq $element) { throw "UI Automation target is no longer available." }

  return $element
}

function Get-UiaClickablePoint($element) {
  try {
    $point = New-Object System.Windows.Point
    if ($element.TryGetClickablePoint([ref]$point)) {
      return $point
    }
  } catch {}
  return $null
}

function Invoke-UiaPrimary($element) {
  try {
    $invoke = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
      $invoke.Invoke()
      return
    }
  } catch {}

  try {
    $select = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$select)) {
      $select.Select()
      return
    }
  } catch {}

  try {
    $toggle = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$toggle)) {
      $toggle.Toggle()
      return
    }
  } catch {}

  $point = Get-UiaClickablePoint $element
  if ($null -eq $point) { throw "UI Automation target has no supported invoke pattern or clickable point." }
  Click-At ([int]$point.X) ([int]$point.Y) "left"
}

function Invoke-UiaSecondary($element) {
  $point = Get-UiaClickablePoint $element
  if ($null -eq $point) { throw "UI Automation target has no clickable point for secondary action." }
  Click-At ([int]$point.X) ([int]$point.Y) "right"
}

function Set-UiaValue($element, [string]$value) {
  $patternObject = $null
  if (-not $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$patternObject)) {
    throw "UI Automation target does not expose ValuePattern."
  }

  $patternObject.SetValue($value)
}

function Get-Windows() {
  return @(
    Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {
      $record = Get-WindowRecord $_.MainWindowHandle
      if ($record) { $record.focused = ($_.MainWindowHandle -eq [NativeComputer]::GetForegroundWindow().ToInt64()) }
      $record
    }
  )
}

function Convert-Key([string]$key) {
  $map = @{
    "enter"=0x0D; "return"=0x0D; "esc"=0x1B; "escape"=0x1B; "tab"=0x09;
    "backspace"=0x08; "delete"=0x2E; "insert"=0x2D; "home"=0x24; "end"=0x23;
    "pageup"=0x21; "pagedown"=0x22; "up"=0x26; "down"=0x28; "left"=0x25; "right"=0x27;
    "space"=0x20; "shift"=0x10; "ctrl"=0x11; "alt"=0x12; "win"=0x5B;
    "capslock"=0x14; "f1"=0x70; "f2"=0x71; "f3"=0x72; "f4"=0x73; "f5"=0x74;
    "f6"=0x75; "f7"=0x76; "f8"=0x77; "f9"=0x78; "f10"=0x79; "f11"=0x7A; "f12"=0x7B
  }

  $normalized = $key.ToLowerInvariant()
  if ($map.ContainsKey($normalized)) { return $map[$normalized] }
  if ($normalized.Length -eq 1) {
    $code = [int][char]$normalized.ToUpperInvariant()
    if ($code -ge 0x41 -and $code -le 0x5A) { return $code }
    if ($code -ge 0x30 -and $code -le 0x39) { return $code }
  }

  throw "Unsupported key: $key"
}

function Press-Key([int]$vk, [bool]$up) {
  $flags = if ($up) { [NativeComputer]::KEYEVENTF_KEYUP } else { 0 }
  [NativeComputer]::keybd_event([byte]$vk, [byte]0, $flags, [UIntPtr]::Zero)
}

function Type-Text([string]$text) {
  foreach ($char in $text.ToCharArray()) {
    [NativeComputer]::SendUnicode([char]$char, $false)
    [NativeComputer]::SendUnicode([char]$char, $true)
  }
}

function Click-At([int]$x, [int]$y, [string]$button) {
  [NativeComputer]::SetCursorPos($x, $y) | Out-Null
  $down = @{left=0x0002; middle=0x0020; right=0x0008}[$button]
  $up   = @{left=0x0004; middle=0x0040; right=0x0010}[$button]
  if (-not $down) { throw "Unsupported mouse button: $button" }
  [NativeComputer]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
  [NativeComputer]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
}

function Invoke-Action($payload) {
  switch ($payload.type) {
    "click" {
      $button = "left"
      if ($null -ne $payload.button -and $payload.button) { $button = [string]$payload.button }

      if ($null -ne $payload.targetId -and $payload.targetId) {
        $element = Resolve-UiaTarget ([string]$payload.targetId)

        if ($button -eq "left") {
          Invoke-UiaPrimary $element
        } elseif ($button -eq "right") {
          Invoke-UiaSecondary $element
        } else {
          $point = Get-UiaClickablePoint $element
          if ($null -eq $point) { throw "UI Automation target has no clickable point for middle click." }
          Click-At ([int]$point.X) ([int]$point.Y) "middle"
        }
      } else {
        if ($null -eq $payload.point) { throw "Coordinate click requires point." }
        Click-At ([int]$payload.point.x) ([int]$payload.point.y) $button
      }
    }
    "type" {
      Type-Text $payload.text
    }
    "key" {
      $held = @()
      $modifiers = @()
      if ($null -ne $payload.modifiers) { $modifiers = @($payload.modifiers) }
      foreach ($modifier in $modifiers) {
        $vk = Convert-Key $modifier
        Press-Key $vk $false
        $held += $vk
      }
      try {
        $vk = Convert-Key $payload.key
        Press-Key $vk $false
        Press-Key $vk $true
      } finally {
        for ($i = $held.Count - 1; $i -ge 0; $i--) {
          Press-Key $held[$i] $true
        }
      }
    }
    "scroll" {
      $amount = 0
      if ($null -ne $payload.deltaY) { $amount = [int]$payload.deltaY }
      if ($amount -ne 0) {
        [NativeComputer]::mouse_event([NativeComputer]::MOUSEEVENTF_WHEEL, 0, 0, $amount, [UIntPtr]::Zero)
      }
    }
    "drag" {
      [NativeComputer]::SetCursorPos([int]$payload.from.x, [int]$payload.from.y) | Out-Null
      [NativeComputer]::mouse_event([NativeComputer]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
      try {
        $duration = 250
        if ($null -ne $payload.durationMs) { $duration = [int]$payload.durationMs }
        Start-Sleep -Milliseconds $duration
        [NativeComputer]::SetCursorPos([int]$payload.to.x, [int]$payload.to.y) | Out-Null
      } finally {
        [NativeComputer]::mouse_event([NativeComputer]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
      }
    }
    "activate_window" {
      $handle = [IntPtr]([int64]$payload.windowId)
      if (-not [NativeComputer]::SetForegroundWindow($handle)) {
        throw "Could not activate window $($payload.windowId)"
      }
    }
    "set_value" {
      $element = Resolve-UiaTarget ([string]$payload.targetId)
      Set-UiaValue $element ([string]$payload.value)
    }
    "secondary_action" {
      $element = Resolve-UiaTarget ([string]$payload.targetId)
      Invoke-UiaSecondary $element
    }
    default { throw "Unsupported action type: $($payload.type)" }
  }
}

try {
  switch ($request.command) {
    "observe" {
      $active = Get-WindowRecord ([NativeComputer]::GetForegroundWindow())
      $script:UiaNodeCount = 0
      $observation = [pscustomobject]@{
        activeWindow = $active
        displays = @(Get-Displays)
        windows = @(Get-Windows)
        accessibility = @(Get-UiaTree)
        screenshot = Get-Screenshot
        capabilities = @(
          "native_input",
          "active_window",
          "window_discovery",
          "display_discovery",
          "screenshot",
          "ui_automation",
          "semantic_targets",
          "semantic_actions"
        )
      }

      [pscustomobject]@{
        ok = $true
        observation = $observation
      } | ConvertTo-Json -Depth 16 -Compress
    }
    "act" {
      Invoke-Action $request.payload
      [pscustomobject]@{ ok = $true } | ConvertTo-Json -Compress
    }
    default {
      throw "Unsupported command: $($request.command)"
    }
  }
} catch {
  [pscustomobject]@{
    ok = $false
    message = $_.Exception.Message
  } | ConvertTo-Json -Compress
  exit 1
}
