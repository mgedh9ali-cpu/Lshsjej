#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
sdk="${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT}"
jdk="${JAVA_HOME:?Set JAVA_HOME to a JDK}"
export JAVA_HOME="$jdk"
bt="$sdk/build-tools/${SCHOOL_BUILD_TOOLS:-35.0.0}"
platform="$sdk/platforms/${SCHOOL_ANDROID_PLATFORM:-android-36}/android.jar"
output="${1:-$root/dist/Dafaa-0.2.0.apk}"
keystore="${SCHOOL_KEYSTORE:?Set SCHOOL_KEYSTORE}"
alias="${SCHOOL_KEY_ALIAS:-dafaa}"
: "${SCHOOL_KEY_PASSWORD:?Set SCHOOL_KEY_PASSWORD}"
export SCHOOL_KEY_PASSWORD
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/classes" "$temp/dex" "$(dirname "$output")"
"$bt/aapt2" compile --dir "$root/android/res" -o "$temp/resources.zip"
"$bt/aapt2" link -I "$platform" --manifest "$root/android/AndroidManifest.xml" -o "$temp/base.apk" "$temp/resources.zip"
"$jdk/bin/javac" --release 8 -cp "$platform" -d "$temp/classes" "$root/android/src/school/dafaa/MainActivity.java"
"$jdk/bin/jar" cf "$temp/classes.jar" -C "$temp/classes" .
"$bt/d8" --min-api 23 --lib "$platform" --output "$temp/dex" "$temp/classes.jar"
(cd "$temp/dex" && "$bt/aapt" add "$temp/base.apk" classes.dex)
"$bt/zipalign" -f -p 4 "$temp/base.apk" "$temp/aligned.apk"
"$bt/apksigner" sign --ks "$keystore" --ks-key-alias "$alias" --ks-pass env:SCHOOL_KEY_PASSWORD --out "$output" "$temp/aligned.apk"
"$bt/apksigner" verify --verbose "$output"
