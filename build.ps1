# Builds arbalete-<version>.zip to upload to addons.mozilla.org.
# A real zip with "/" paths (Git Bash's tar produces an archive that AMO refuses).
#   powershell -File build.ps1           self-distributed build (keeps update_url)
#   powershell -File build.ps1 -Listed   listed AMO channel, without update_url
param([switch]$Listed)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$suffix = if ($Listed) { '-listed' } else { '' }
$zipPath = Join-Path $root "arbalete-$version$suffix.zip"
$files = @('manifest.json', 'userChrome.css','background.js', 'sidebar\sidebar.html', 'sidebar\sidebar.css', 'sidebar\sidebar.js', 'icons\arbalete.svg', 'icons\lucide.svg', 'icons\lucide-index.json', 'icons\LUCIDE-LICENSE.txt', 'icons\split.svg', 'split\split.html', 'split\split.css', 'split\split.js', 'split\frame.js', 'palette\palette.html', 'palette\palette.css', 'palette\palette.js', 'palette\overlay.js', '_locales\fr\messages.json', '_locales\en\messages.json')

Get-ChildItem $root -Filter 'arbalete-*.zip' | Remove-Item
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    if ($Listed -and $f -eq 'manifest.json') {
      # Listed versions carry no update_url: AMO updates them itself.
      $text = (Get-Content (Join-Path $root $f) -Raw) -replace '(?m)^.*"update_url".*\r?\n', ''
      $entry = $zip.CreateEntry($f)
      $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding $false))
      $writer.Write($text)
      $writer.Dispose()
      continue
    }
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), $f.Replace('\', '/'))
  }
} finally {
  $zip.Dispose()
}
Write-Output "Zip ready: $zipPath"
