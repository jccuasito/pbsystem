param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapTransform,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]

$taskAwaitMethod=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Wait-OcrOperation($Operation,[Type]$ResultType) {
  $task=$taskAwaitMethod.MakeGenericMethod($ResultType).Invoke($null,@($Operation))
  $task.GetAwaiter().GetResult()
}
function Wait-OcrAction($Operation) {
  $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and !$_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
  $task=$method.Invoke($null,@($Operation)); [void]$task.GetAwaiter().GetResult()
}
function Read-OcrStream($Stream,$Engine) {
  $decoder=Wait-OcrOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($Stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  if ([double]$decoder.PixelWidth * $decoder.PixelHeight -gt 80000000) { throw 'Image dimensions are too large for scan reading.' }
  $limit=[Math]::Min(2500,[Windows.Media.Ocr.OcrEngine]::MaxImageDimension)
  $scale=[Math]::Min(1,$limit/[Math]::Max($decoder.PixelWidth,$decoder.PixelHeight))
  $transform=New-Object Windows.Graphics.Imaging.BitmapTransform
  $transform.ScaledWidth=[uint32][Math]::Max(1,[Math]::Floor($decoder.PixelWidth*$scale))
  $transform.ScaledHeight=[uint32][Math]::Max(1,[Math]::Floor($decoder.PixelHeight*$scale))
  $bitmap=Wait-OcrOperation ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,$transform,[Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation,[Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  try {
    $result=Wait-OcrOperation ($Engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
  } finally { $bitmap.Dispose() }
}

$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language('en-US')))
if(!$engine){throw 'English Windows OCR is not installed.'}
$file=Wait-OcrOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync([System.IO.Path]::GetFullPath($ImagePath))) ([Windows.Storage.StorageFile])
$texts=@()
if([System.IO.Path]::GetExtension($ImagePath) -ieq '.pdf') {
  $null=[Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]
  $null=[Windows.Data.Pdf.PdfPageRenderOptions,Windows.Data.Pdf,ContentType=WindowsRuntime]
  $pdf=Wait-OcrOperation ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  for($taskPage=0;$taskPage -lt [Math]::Min(2,$pdf.PageCount);$taskPage++) {
    $page=$pdf.GetPage($taskPage)
    $stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    try {
      $options=New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $options.DestinationWidth=2000
      Wait-OcrAction ($page.RenderToStreamAsync($stream,$options))
      $stream.Seek(0)
      $texts+=Read-OcrStream $stream $engine
    } finally { $stream.Dispose(); $page.Dispose() }
  }
} else {
  $stream=Wait-OcrOperation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try { $texts+=Read-OcrStream $stream $engine } finally { $stream.Dispose() }
}
@{text=($texts -join "`n");pages=$texts.Count;engine='Windows OCR'} | ConvertTo-Json -Compress
