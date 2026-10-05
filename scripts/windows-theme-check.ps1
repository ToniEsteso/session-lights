param([ValidateSet('Read','Light','Dark','Restore')][string]$Theme, [string]$Original = '')
$themePath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
if ($Theme -eq 'Read') {
  $value = Get-ItemPropertyValue -LiteralPath $themePath -Name AppsUseLightTheme -ErrorAction SilentlyContinue
  if ($null -eq $value) { Write-Output 'missing' } else { Write-Output $value }
  exit 0
}
if ($Theme -eq 'Restore' -and $Original -eq 'missing') {
  Remove-ItemProperty -LiteralPath $themePath -Name AppsUseLightTheme -ErrorAction SilentlyContinue
} else {
  $value = if ($Theme -eq 'Light') { 1 } elseif ($Theme -eq 'Dark') { 0 } else { [int]$Original }
  if (!(Test-Path -LiteralPath $themePath)) { New-Item -Path $themePath -Force | Out-Null }
  Set-ItemProperty -LiteralPath $themePath -Name AppsUseLightTheme -Value $value -Type DWord
}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ThemeBroadcast {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);
}
"@
$result = [IntPtr]::Zero
[ThemeBroadcast]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [IntPtr]::Zero, 'ImmersiveColorSet', 2, 5000, [ref]$result) | Out-Null
