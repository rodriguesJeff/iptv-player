# IPTV Player

Personal Xtream Codes / XUI.one client. No analytics, no third-party SDKs, no external
fonts or CDNs: the only host it contacts is your IPTV server.

```
www/        shared UI (HTML/CSS/JS) used by both apps
android/    Android phone + Android TV wrapper (WebView UI, ExoPlayer playback)
tizen/      Samsung Tizen TV wrapper (AVPlay playback)
dev/        mock XUI server for testing, icon generator
```

Login: your provider's server URL (`http://host:port`), username and password. Live format
`m3u8` (default) or `ts`; switch to `ts` if live channels stutter.

Remote: arrows move, OK on a channel or movie plays it in the preview box, OK again goes
full screen, Back returns to the preview, Back again stops. In full-screen live TV, up/down
(or CH+/CH-) change channel. In movies, left/right seek, OK pauses.

## Android

Needs JDK 17+ (`JAVA_HOME`) and the Android SDK.

```bash
cd android && ./gradlew assembleRelease     # or assembleDebug
# APK: android/app/build/outputs/apk/release/app-release.apk
adb install -r <apk>                         # or copy the APK to the phone/TV box and open it
```

On Android TV / Fire Stick: enable "Unknown sources" for the file manager or Downloader app,
or use `adb connect <ip>` then `adb install`.

## Samsung Tizen TV

One-time setup:

1. Install **Tizen Studio** (CLI is enough). In Package Manager install
   *Samsung TV Extensions* and *Samsung Certificate Extension*. Add
   `~/tizen-studio/tools` and `~/tizen-studio/tools/ide/bin` to `PATH`.
2. TV: open **Apps**, type `1 2 3 4 5` on the remote → Developer mode **On** →
   Host PC IP = this computer's IP → **unplug the TV for 60 s** (a remote restart is not
   enough; until a cold boot the debug port 26101 stays closed).
3. `sdb connect <TV_IP>` and `sdb capability` (note the DUID).
4. Tizen Studio → Certificate Manager → new **Samsung** certificate profile named `iptv`
   (log in with a Samsung account, privilege *Public*, add the TV's DUID).

Build and install:

```bash
./tizen/build.sh <TV_IP>        # packages build/IPTVPlayer.wgt, installs and launches it
```

Use `TIZEN_PROFILE=<name>` if your certificate profile is not called `iptv`.

## Testing without the real server

```bash
node dev/mock-server.js   # fake XUI on :8787, user/pass test/test
```

Android emulator: server `http://10.0.2.2:8787`. Desktop browser: open
`http://localhost:8787` with server `http://localhost:8787`.

### Tizen Studio troubleshooting (macOS)

- Installer or package manager says "JDK not found": install a Java 8 JDK (e.g. Zulu 8 for
  Apple Silicon). If `~/.package-manager/jdk` exists but is empty, delete it and copy
  `~/tizen-studio/jdk` there.
- Package manager "Cannot connect the repository server": it may have picked a dead mirror.
  Set `Repository: http://download.tizen.org/sdk/tizenstudio` in
  `~/tizen-studio/.info/repository.info`.
- Install fails with "Invalid certificate chain": the profile has no Samsung *distributor*
  certificate (`distributor.p12`). Recreate the profile and create a new distributor
  certificate with the TV's DUID.

## Known issues

- **Tizen preview box shows no video** (tested on a 2022 The Frame, Tizen 6.5): the stream
  plays and full screen works, but nothing is visible inside the preview box. Probably
  `avplay.setDisplayRect` with a small rect; still under investigation. Works on Android.

## Notes

- Many accounts allow a single connection (`max_connections: 1`). The players release the
  stream as soon as you leave them, and zapping waits 0.5 s before connecting.
- Credentials are stored in plain text in app storage (localStorage) on the device.
- Most IPTV panels serve plain HTTP, so your ISP can see the traffic. Use a VPN on the device
  if that matters.
