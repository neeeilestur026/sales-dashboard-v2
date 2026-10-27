#!/bin/bash
# A377 — build the signed Hi-Escorp app file. The tools live in ~/Developer/android-tools (Java 17, the Android SDK,
# Gradle 8.9); the signing key in ~/Documents/app/CRM/HiEscorp-App-Signing-Key (never in the repo).
# The finished file: android/app/build/outputs/apk/release/app-release.apk
set -e
T="${HX_ANDROID_TOOLS:-$HOME/Developer/android-tools}"
cd "$(dirname "$0")"
export JAVA_HOME="$T/jdk/Contents/Home" ANDROID_HOME="$T/sdk"
echo "sdk.dir=$T/sdk" > local.properties
"$T/gradle-8.9/bin/gradle" --no-daemon -q assembleRelease
"$T/sdk/build-tools/35.0.0/apksigner" verify --print-certs app/build/outputs/apk/release/app-release.apk | grep -i "SHA-256 digest"
ls -lh app/build/outputs/apk/release/app-release.apk
