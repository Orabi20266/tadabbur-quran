#!/usr/bin/env bash
# Build the production PWA and wrap it in a double-clickable macOS app on the
# Desktop. The bundle serves its own copy of dist/ on a fixed localhost port so
# the app keeps its own localStorage and microphone permission.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$HOME/Desktop/تدبّر.app"
PORT=47821

cd "$APP_DIR"
npm run build

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Render the existing SVG icon at 1024px, then build a .icns.
qlmanage -t -s 1024 -o "$WORK" public/icon.svg >/dev/null 2>&1
SOURCE_ICON="$WORK/icon.svg.png"
mkdir -p "$WORK/AppIcon.iconset"
for size in 16 32 64 128 256 512 1024; do
  case "$size" in
    16) name="icon_16x16.png" ;;
    32) name="icon_32x32.png" ;;
    64) name="icon_32x32@2x.png" ;;
    128) name="icon_128x128.png" ;;
    256) name="icon_256x256.png" ;;
    512) name="icon_512x512.png" ;;
    1024) name="icon_512x512@2x.png" ;;
  esac
  sips -z "$size" "$size" "$SOURCE_ICON" --out "$WORK/AppIcon.iconset/$name" >/dev/null
done
# Standard @2x companions for the smaller sizes.
cp "$WORK/AppIcon.iconset/icon_32x32.png" "$WORK/AppIcon.iconset/icon_16x16@2x.png"
cp "$WORK/AppIcon.iconset/icon_256x256.png" "$WORK/AppIcon.iconset/icon_128x128@2x.png"
iconutil -c icns "$WORK/AppIcon.iconset" -o "$WORK/AppIcon.icns"

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources/app"
cp -R "$APP_DIR/dist/." "$BUNDLE/Contents/Resources/app/"
cp "$WORK/AppIcon.icns" "$BUNDLE/Contents/Resources/AppIcon.icns"

cat > "$BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>تدبّر</string>
  <key>CFBundleDisplayName</key>
  <string>تدبّر</string>
  <key>CFBundleIdentifier</key>
  <string>app.tadabbur.desktop</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>Tadabbur</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>يستخدم تدبّر الميكروفون لتتبّع الكلمات التي تتلوها من الذاكرة.</string>
</dict>
</plist>
PLIST

cat > "$BUNDLE/Contents/MacOS/Tadabbur" <<'LAUNCHER'
#!/bin/bash
set -u

RESOURCES="$(cd "$(dirname "$0")/../Resources" && pwd)"
WEB_ROOT="$RESOURCES/app"
PORT=47821
URL="http://127.0.0.1:$PORT/"
PROFILE="$HOME/Library/Application Support/Tadabbur/ChromeProfile"

open_app() {
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args \
      --app="$URL" \
      --user-data-dir="$PROFILE" \
      --no-first-run \
      --no-default-browser-check >/dev/null 2>&1
  else
    open "$URL"
  fi
}

# A second double-click should only raise the app, not start another server.
if /usr/sbin/lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  open_app
  exit 0
fi

/usr/bin/python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WEB_ROOT" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM

for _ in $(seq 1 50); do
  if /usr/bin/curl -fsS "$URL" >/dev/null 2>&1; then break; fi
  /bin/sleep 0.1
done

open_app
wait "$SERVER_PID"
LAUNCHER

chmod +x "$BUNDLE/Contents/MacOS/Tadabbur"
xattr -cr "$BUNDLE" 2>/dev/null || true

echo "Created: $BUNDLE"
echo "Open it from the Desktop. Mic permission is asked by Chrome on first use."
