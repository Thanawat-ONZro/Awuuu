$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$appPath = Join-Path $PSScriptRoot '../target/debug/awuuu.exe'
$reportPath = Join-Path $env:LOCALAPPDATA 'Awuuu/clipboard-check.json'
function Read-ListenerState {
    $previous = if (Test-Path -LiteralPath $reportPath) { (Get-Item -LiteralPath $reportPath).LastWriteTimeUtc } else { [datetime]::MinValue }
    Start-Process -FilePath $appPath -ArgumentList '--dev-clipboard-status' -WindowStyle Hidden -Wait
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ((Test-Path -LiteralPath $reportPath) -and (Get-Item -LiteralPath $reportPath).LastWriteTimeUtc -gt $previous) {
            return Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'Clipboard diagnostic did not update.'
}
$before = Read-ListenerState
if (-not $before.ready -or -not $before.recording) { throw 'Live clipboard listener is not ready and enabled.' }
# Preserve the clipboard in memory only. Abort before writing if any format cannot be backed up.
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
$backup = New-Object System.Windows.Forms.DataObject
if ($null -ne $original) {
    foreach ($format in $original.GetFormats($false)) {
        $data = $original.GetData($format, $false)
        if ($null -eq $data) { throw 'Could not preserve an original clipboard format.' }
        $backup.SetData($format, $false, $data)
    }
}
$bitmap = New-Object System.Drawing.Bitmap 32, 32
try {
    [System.Windows.Forms.Clipboard]::SetText('Awuuu clipboard live test ' + [guid]::NewGuid().ToString())
    Start-Sleep -Milliseconds 800
    $textState = Read-ListenerState
    if ($textState.textItems -le $before.textItems) { throw 'External text copy did not reach live history.' }
    $bitmap.SetPixel(0, 0, [System.Drawing.Color]::Coral)
    [System.Windows.Forms.Clipboard]::SetImage($bitmap)
    Start-Sleep -Milliseconds 800
    $imageState = Read-ListenerState
    if ($imageState.imageItems -le $textState.imageItems) { throw 'External image copy did not reach live history.' }
    [pscustomobject]@{ Ready=$imageState.ready; AutomaticCapture=$imageState.recording; TextCaptured=$true; ImageCaptured=$true } | ConvertTo-Json
} finally {
    [System.Windows.Forms.Clipboard]::SetDataObject($backup, $true)
    $bitmap.Dispose()
}
