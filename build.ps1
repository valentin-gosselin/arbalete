# Builds arbalete-<version>.zip to upload to addons.mozilla.org.
# A real zip with "/" paths (Git Bash's tar produces an archive that AMO refuses).
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$zipPath = Join-Path $root "arbalete-$version.zip"
$files = @('manifest.json', 'userChrome.css','background.js', 'sidebar\sidebar.html', 'sidebar\sidebar.css', 'sidebar\sidebar.js', 'icons\arbalete.svg', 'icons\lucide.svg', 'icons\lucide-index.json', 'icons\LUCIDE-LICENSE.txt', 'icons\split.svg', 'split\split.html', 'split\split.css', 'split\split.js', 'split\frame.js', 'palette\palette.html', 'palette\palette.css', 'palette\palette.js', 'palette\overlay.js', '_locales\fr\messages.json', '_locales\en\messages.json')

Get-ChildItem $root -Filter 'arbalete-*.zip' | Remove-Item
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), $f.Replace('\', '/'))
  }
} finally {
  $zip.Dispose()
}
Write-Output "Zip ready: $zipPath"
