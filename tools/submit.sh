#!/bin/sh
# Submits the current version to the listed channel of addons.mozilla.org.
#
#   sh tools/submit.sh
#
# 1. builds the listed package (sh build.sh listed) and runs Mozilla's validator on it;
# 2. sends it with web-ext, along with the release notes of amo/versions/<version>.json
#    and the notes to reviewers of amo/LISTING.md;
# 3. does not wait for approval: AMO signs and publishes the version on its own.
# The AMO API key (https://addons.mozilla.org/developers/addon/api/key/) is read from
# ~/.config/claude-secrets/amo.env (AMO_JWT_ISSUER, AMO_JWT_SECRET), or from $AMO_ENV.
set -e
cd "$(dirname "$0")/.."

env=${AMO_ENV:-$HOME/.config/claude-secrets/amo.env}
[ -f "$env" ] || { echo "No AMO API key: create $env (AMO_JWT_ISSUER, AMO_JWT_SECRET)."; exit 1; }
. "$env"
[ -n "$AMO_JWT_ISSUER" ] && [ -n "$AMO_JWT_SECRET" ] || { echo "AMO_JWT_ISSUER or AMO_JWT_SECRET missing in $env."; exit 1; }

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
notes="amo/versions/$version.json"
[ -f "$notes" ] || { echo "Write the release notes of $version in $notes first."; exit 1; }

sh build.sh listed
zip="arbalete-$version-listed.zip"
npx --yes addons-linter "$zip"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/src"
unzip -q "$zip" -d "$tmp/src"

# The notes to reviewers are the text block under "## Notes to reviewers".
awk '/^## Notes to reviewers/ { on = 1; next } on && /^```text/ { body = 1; next } body && /^```/ { exit } body' \
  amo/LISTING.md > "$tmp/approval.txt"
NOTES=$notes APPROVAL="$tmp/approval.txt" OUT="$tmp/metadata.json" node -e '
const fs = require("fs");
const version = JSON.parse(fs.readFileSync(process.env.NOTES, "utf8"));
version.approval_notes = fs.readFileSync(process.env.APPROVAL, "utf8").trim();
fs.writeFileSync(process.env.OUT, JSON.stringify({ version }));
'

WEB_EXT_API_KEY=$AMO_JWT_ISSUER WEB_EXT_API_SECRET=$AMO_JWT_SECRET npx --yes web-ext sign \
  --no-config-discovery --channel listed --approval-timeout 0 \
  --source-dir "$tmp/src" --artifacts-dir "$tmp/artifacts" --amo-metadata "$tmp/metadata.json"
echo "Submitted $version to the listed channel of addons.mozilla.org."
