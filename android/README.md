# The Hi-Escorp Android app (A377)

A Trusted Web Activity: the app opens the live portal, `https://hi-escorp-portal-wufz.onrender.com/`, full screen in
the phone's own Chrome engine. Logins, photo uploads, PDF downloads and the scanner camera work as on the web, and
every push to Render is in the app at once — a new app file is only needed when this folder changes.

- Package `com.hiescorp.portal`, label "Hi-Escorp", the emblem as the icon, the full logo on the splash.
- No store and no fee (Neil, 27 Oct 2026): the signed file is sent to staff, who install it directly.
- Full screen needs the site to name the app: `dashboard/.well-known/assetlinks.json`, served by `app.py` at
  `/.well-known/assetlinks.json`, carries the SHA-256 fingerprint of the signing key. Without it the app still works,
  with a thin address bar at the top.

## Build

    android/build.sh

It needs the tools in `~/Developer/android-tools` and the key in `~/Documents/app/CRM/HiEscorp-App-Signing-Key/`.

## The signing key

`HiEscorp-App-Signing-Key/` (outside the repo) holds `hiescorp-portal.keystore` and `key.properties` (its password).
**Back both up somewhere safe.** A later version installs over the first only when it is signed with the same key;
lose the key and every phone must uninstall the app and install a new one, and assetlinks.json must name the new key.

## A new version

Raise `versionCode` (and `versionName`) in `app/build.gradle`, run `android/build.sh`, send the new file.
