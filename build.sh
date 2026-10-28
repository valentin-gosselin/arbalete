#!/bin/sh
# Builds arbalete-<version>.zip for addons.mozilla.org from Linux or macOS.
# The file list is read from build.ps1, so that both scripts always ship the same files.
set -e
cd "$(dirname "$0")"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
files=$(sed -n "s/^\$files = @(\(.*\))\r\{0,1\}$/\1/p" build.ps1 | tr ',' '\n' | sed "s/^ *'//; s/' *$//; s#\\\\#/#g")
rm -f arbalete-*.zip
# shellcheck disable=SC2086
zip -q -X "arbalete-$version.zip" $files
echo "Zip ready: arbalete-$version.zip"
