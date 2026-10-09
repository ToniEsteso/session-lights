#!/usr/bin/env bash
# Install the latest Session Lights release on macOS.
# Usage: curl -fsSL https://raw.githubusercontent.com/ToniEsteso/session-lights/main/scripts/install.sh | bash
# All code is inside main, so a cut-off download cannot run a partial command.

main() {
  set -euo pipefail

  local repo='ToniEsteso/session-lights'
  local app='Session Lights'

  fail() { echo "Error: $*" >&2; exit 1; }

  [ "$(uname -s)" = 'Darwin' ] || fail 'This script supports macOS only. See docs/installation.md.'
  local tool
  for tool in curl hdiutil openssl awk ditto; do
    command -v "$tool" >/dev/null || fail "$tool is required."
  done

  local dest="/Applications/$app.app"
  local work stage=''
  work="$(mktemp -d)"
  local mount="$work/mount"
  cleanup() {
    hdiutil detach "$mount" -quiet </dev/null 2>/dev/null || true
    # Put the old app back if the swap stopped half way.
    if [ -n "$stage" ] && [ ! -d "$dest" ] && [ -d "$stage/previous.app" ]; then
      mv "$stage/previous.app" "$dest" 2>/dev/null || true
    fi
    rm -rf "$work" "$stage" 2>/dev/null || true
  }
  trap cleanup EXIT

  echo 'Finding the latest release...'
  local api tag
  api="$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest")" ||
    fail 'Could not read the latest release. No release may be published yet, or GitHub may have reached its limit of 60 requests per hour for your address.'
  tag="$(printf '%s\n' "$api" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Could not find a published release.'
  local base="https://github.com/$repo/releases/download/$tag"

  # latest-mac.yml lists each file with its SHA-512 hash in base64.
  curl -fsSL "$base/latest-mac.yml" -o "$work/latest-mac.yml" ||
    fail "Release $tag has no macOS build."
  local entry dmg expected
  entry="$(awk '
    $1 == "-" && $2 == "url:" { url = $3 }
    $1 == "sha512:" && url ~ /\.dmg$/ { print url, $2; exit }
  ' "$work/latest-mac.yml")"
  [ -n "$entry" ] || fail "Release $tag has no macOS disk image."
  dmg="${entry% *}"
  expected="${entry##* }"
  [[ "$dmg" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'The release lists an unsafe file name.'

  echo "Downloading $dmg..."
  curl -fL --progress-bar "$base/$dmg" -o "$work/$dmg" || fail 'The download failed.'
  local actual
  actual="$(openssl dgst -sha512 -binary "$work/$dmg" | openssl base64 -A)"
  [ "$actual" = "$expected" ] || fail 'The download does not match its checksum. Nothing was installed.'

  mkdir "$mount"
  hdiutil attach "$work/$dmg" -nobrowse -readonly -quiet -mountpoint "$mount" </dev/null
  [ -d "$mount/$app.app" ] || fail "The disk image has no $app.app."

  if pgrep -x "$app" >/dev/null; then
    echo "Closing $app..."
    osascript -e "tell application \"$app\" to quit" </dev/null >/dev/null 2>&1 || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      pgrep -x "$app" >/dev/null || break
      sleep 1
    done
    ! pgrep -x "$app" >/dev/null || fail "$app is still running. Quit it and run this command again."
  fi

  # Copy first, then swap, so a failed copy keeps the old app.
  stage="$(mktemp -d "/Applications/.session-lights.XXXXXX" 2>/dev/null)" ||
    fail 'Cannot write to /Applications. Run this command from an administrator account.'
  ditto "$mount/$app.app" "$stage/$app.app" || fail 'Could not copy the app to /Applications.'
  if [ -d "$dest" ]; then
    mv "$dest" "$stage/previous.app" || fail "Could not replace the old $app."
  fi
  mv "$stage/$app.app" "$dest" || fail "Could not move the new $app into place. The old app is restored."
  open "$dest" </dev/null
  echo "Installed $app $tag in /Applications."
  cleanup
  trap - EXIT
}

main "$@"
