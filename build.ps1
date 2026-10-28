# Construit arbalete-<version>.zip à envoyer sur addons.mozilla.org.
# Vrai zip avec des chemins en « / » (le tar de Git Bash produit une archive que AMO refuse).
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$zipPath = Join-Path $root "arbalete-$version.zip"
$files = @('manifest.json', 'userChrome.css','background.js', 'sidebar\sidebar.html', 'sidebar\sidebar.css', 'sidebar\sidebar.js', 'icons\arbalete.svg', 'icons\lucide.svg', 'icons\lucide-index.json', 'icons\LUCIDE-LICENSE.txt', 'icons\split.svg', 'split\split.html', 'split\split.css', 'split\split.js', 'split\frame.js', '_locales\fr\messages.json', '_locales\en\messages.json')

Get-ChildItem $root -Filter 'arbalete-*.zip' | Remove-Item
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), $f.Replace('\', '/'))
  }
} finally {
  $zip.Dispose()
}
Write-Output "Zip pret : $zipPath"
