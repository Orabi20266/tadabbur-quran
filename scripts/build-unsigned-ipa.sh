#!/usr/bin/env bash
# Builds an unsigned device IPA for sideloading services such as appdb.to.
# Requires the full Xcode, not just Command Line Tools.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${TMPDIR:-/tmp}/tadabbur-ios-ipa"
IPA="$ROOT/dist/tadabbur-ios-unsigned.ipa"

# CocoaPods on this machine lives in the user gem bin and needs logger on Ruby 2.6.
export PATH="$HOME/.gem/ruby/2.6.0/bin:$PATH"
export RUBYOPT="${RUBYOPT:+$RUBYOPT }-rlogger"

cd "$ROOT"
npm run build
npx cap sync ios

mkdir -p "$TMP"
rm -rf "$TMP/tadabbur.xcarchive" "$TMP/payload" "$IPA"
mkdir -p "$TMP/payload/Payload"

(
  cd ios/App
  if command -v pod >/dev/null 2>&1; then
    pod install --no-repo-update || pod install
  fi
)

xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$TMP/tadabbur.xcarchive" \
  -derivedDataPath "$TMP/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  clean archive

APP="$TMP/tadabbur.xcarchive/Products/Applications/App.app"
if [ ! -d "$APP" ]; then
  echo "Archive did not contain App.app" >&2
  exit 1
fi

cp -R "$APP" "$TMP/payload/Payload/App.app"
(
  cd "$TMP/payload"
  zip -qry "$IPA" Payload
)

echo "IPA: $IPA"
