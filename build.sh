#!/bin/sh
# Builds arbalete-<version>.zip for addons.mozilla.org from Linux or macOS.
# The file list is read from build.ps1, so that both scripts always ship the same files.
#
#   sh build.sh          self-distributed build (keeps update_url: updates through GitHub)
#   sh build.sh listed   build for the listed AMO channel, without update_url (AMO refuses
#                        it there and updates listed versions itself)
set -e
cd "$(dirname "$0")"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
files=$(sed -n "s/^\$files = @(\(.*\))\r\{0,1\}$/\1/p" build.ps1 | tr ',' '\n' | sed "s/^ *'//; s/' *$//; s#\\\\#/#g")
name="arbalete-$version"
[ "$1" = listed ] && name="$name-listed"
rm -f arbalete-*.zip

stage=$(mktemp -d)
# shellcheck disable=SC2086
for f in $files; do
  mkdir -p "$stage/$(dirname "$f")"
  cp "$f" "$stage/$f"
done
if [ "$1" = listed ]; then
  sed -i.bak '/"update_url"/d' "$stage/manifest.json" && rm -f "$stage/manifest.json.bak"
fi
# shellcheck disable=SC2086
(cd "$stage" && zip -q -X "$OLDPWD/$name.zip" $files)
rm -rf "$stage"
echo "Zip ready: $name.zip"
