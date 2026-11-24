#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
sdk="${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT}"
jdk="${JAVA_HOME:?Set JAVA_HOME to a JDK}"
export JAVA_HOME="$jdk"
bt="$sdk/build-tools/${SCHOOL_BUILD_TOOLS:-35.0.0}"
platform="$sdk/platforms/${SCHOOL_ANDROID_PLATFORM:-android-36}/android.jar"
case "${2:-student}" in
  student) manifest="$root/android/AndroidManifest.xml"; default_apk=QumDorous-Student.apk ;;
  owner) manifest="$root/android/OwnerManifest.xml"; default_apk=QumDorous-Owner.apk ;;
  *) printf '%s\n' 'Choose student or owner as the second argument.' >&2; exit 2 ;;
esac
output="${1:-$root/dist/$default_apk}"
keystore="${SCHOOL_KEYSTORE:?Set SCHOOL_KEYSTORE}"
alias="${SCHOOL_KEY_ALIAS:-dafaa}"
: "${SCHOOL_KEY_PASSWORD:?Set SCHOOL_KEY_PASSWORD}"
export SCHOOL_KEY_PASSWORD
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/classes" "$temp/dex" "$temp/assets" "$(dirname "$output")"
"$bt/aapt2" compile --dir "$root/android/res" -o "$temp/resources.zip"
cp "$root"/android/offline/source.html "$root"/android/offline/source.js "$root"/android/room/* "$temp/assets/"
cp "$root"/android/assets/* "$temp/assets/"
font_dir="${SCHOOL_FONT_DIR:-$root/android/fonts}"
if [[ -f "$font_dir/thmanyahsans-Regular.woff2" && -f "$font_dir/thmanyahsans-Bold.woff2" ]]; then
  cp "$font_dir/thmanyahsans-Regular.woff2" "$temp/assets/thmanyahsans-Regular.woff2"
  cp "$font_dir/thmanyahsans-Bold.woff2" "$temp/assets/thmanyahsans-Bold.woff2"
else
  if [[ "${SCHOOL_REQUIRE_THMANYAH:-0}" == "1" ]]; then
    printf '%s\n' 'Both Thmanyah WOFF2 weights are required for this build.' >&2
    exit 1
  fi
  printf '%s\n' 'Thmanyah font assets not found: using Cairo fallback until both licensed WOFF2 files are supplied.' >&2
fi
node "$root/scripts/build-student-db.mjs" "$temp/assets/student.sqlite"
"$bt/aapt2" link -A "$temp/assets" -I "$platform" --manifest "$manifest" -o "$temp/base.apk" "$temp/resources.zip"
"$jdk/bin/javac" --release 8 -cp "$platform" -d "$temp/classes" "$root"/android/src/school/dafaa/*.java
"$jdk/bin/jar" cf "$temp/classes.jar" -C "$temp/classes" .
"$bt/d8" --min-api 23 --lib "$platform" --output "$temp/dex" "$temp/classes.jar"
(cd "$temp/dex" && "$bt/aapt" add "$temp/base.apk" classes.dex)
"$bt/zipalign" -f -p 4 "$temp/base.apk" "$temp/aligned.apk"
"$bt/apksigner" sign --ks "$keystore" --ks-key-alias "$alias" --ks-pass env:SCHOOL_KEY_PASSWORD --out "$output" "$temp/aligned.apk"
"$bt/apksigner" verify --verbose "$output"
