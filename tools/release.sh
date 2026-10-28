#!/bin/sh
# Publishes a signed Arbalète build for automatic updates of self-distributed installs.
#
#   sh tools/release.sh ~/Downloads/arbalete-0.11.0.xpi
#
# 1. checks that the .xpi is signed by Mozilla and reads its version;
# 2. creates the GitHub release v<version> with the .xpi attached (gh CLI);
# 3. adds the version to updates.json (link + sha256), commits and pushes it.
# Firefox reads updates.json through the update_url of manifest.json and installs the
# new version by itself. Listed AMO versions carry no update_url: AMO updates them.
set -e
cd "$(dirname "$0")/.."

REPO=valentin-gosselin/arbalete
ID=arbalete@gosselin.pro
xpi=$1
[ -f "$xpi" ] || { echo "Usage: sh tools/release.sh <signed .xpi from addons.mozilla.org>"; exit 1; }
unzip -l "$xpi" | grep -Eq 'META-INF/(cose\.sig|mozilla\.rsa)' || { echo "Not signed: download the signed .xpi from addons.mozilla.org."; exit 1; }

manifest=$(unzip -p "$xpi" manifest.json)
version=$(printf '%s' "$manifest" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')
min=$(printf '%s' "$manifest" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).browser_specific_settings.gecko.strict_min_version||""))')
[ -n "$version" ] || { echo "No version in the .xpi manifest."; exit 1; }

if command -v sha256sum >/dev/null; then hash=$(sha256sum "$xpi" | cut -d' ' -f1); else hash=$(shasum -a 256 "$xpi" | cut -d' ' -f1); fi
name="arbalete-$version.xpi"
link="https://github.com/$REPO/releases/download/v$version/$name"

# The release points at the pushed main branch: the source of that version must be there.
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Push main first: the release must point at the code of $version."
  exit 1
fi

tmp=$(mktemp -d)
cp "$xpi" "$tmp/$name"
gh release create "v$version" "$tmp/$name" --repo "$REPO" --target main --title "Arbalète $version" \
  --notes "Signed by Mozilla. Self-distributed installs update automatically through updates.json."
rm -rf "$tmp"

VERSION=$version LINK=$link HASH=$hash MIN=$min ID=$ID node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync("updates.json", "utf8"));
const entry = { version: process.env.VERSION, update_link: process.env.LINK, update_hash: "sha256:" + process.env.HASH };
if (process.env.MIN) entry.browser_specific_settings = { gecko: { strict_min_version: process.env.MIN } };
const list = data.addons[process.env.ID].updates.filter((u) => u.version !== entry.version);
list.push(entry);
data.addons[process.env.ID].updates = list;
fs.writeFileSync("updates.json", JSON.stringify(data, null, 2) + "\n");
'

git add updates.json
git commit -q -m "Automatic update to $version"
git push -q origin main
echo "Released $version: $link"
