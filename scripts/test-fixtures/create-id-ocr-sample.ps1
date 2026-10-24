param([Parameter(Mandatory=$true)][string]$OutputPath)
Add-Type -AssemblyName System.Drawing
$taskBitmap=New-Object System.Drawing.Bitmap(1400,700)
$taskGraphics=[System.Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.Clear([System.Drawing.Color]::White)
$taskFont=New-Object System.Drawing.Font('Arial',36)
try {
  $taskGraphics.DrawString('SOCIAL SECURITY SYSTEM',$taskFont,[System.Drawing.Brushes]::Black,50,80)
  $taskGraphics.DrawString('SS NUMBER: 12-3456789-0',$taskFont,[System.Drawing.Brushes]::Black,50,210)
  $taskGraphics.DrawString('SYNTHETIC TEST - NOT A REAL ID',$taskFont,[System.Drawing.Brushes]::Black,50,400)
  $taskBitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png)
} finally { $taskGraphics.Dispose();$taskBitmap.Dispose();$taskFont.Dispose() }
