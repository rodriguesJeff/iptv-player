# IPTV Player

Personal Xtream Codes / XUI.one client. No analytics, no third-party SDKs, no external
fonts or CDNs: the only hosts it contacts are your IPTV server and, if you set one up, your own
sync server (see [Sync](#sync-between-devices-optional)).

```
www/          shared UI (HTML/CSS/JS) used by both apps and the web deploy
android/      Android phone + Android TV wrapper (WebView UI, ExoPlayer playback)
tizen/        Samsung Tizen TV wrapper (AVPlay playback)
deploy/web/   web deploy (Caddy: serves www/, proxies the IPTV server and /sync/*)
deploy/sync/  optional sync service for favorites and series progress (Node, no dependencies)
dev/          mock XUI server for testing, icon generator
```

Login: your provider's server URL (`http://host:port`), username and password. Live format
`m3u8` (default) or `ts`; switch to `ts` if live channels stutter.

Remote: arrows move, OK on a channel or movie plays it in the preview box, OK again goes
full screen, Back returns to the preview, Back again stops. In full-screen live TV, up/down
(or CH+/CH-) change channel. In movies, left/right seek, OK pauses.

Miniplayer: browsers with HTML5 Picture-in-Picture show a **Miniplayer** button during
full-screen HTML5 playback. Android devices with native PiP support expose the same action
and keep ExoPlayer alive while the app is minimized. Unsupported browsers, Android devices,
Tizen, and Android TV launchers use the existing preview/full-screen behavior.

## Favorites and "continue watching"

- **Favorites** (movies and series): the **Favoritos** tab lists them, with the filters
  *Continuar assistindo*, *Filmes* and *Séries*. Favorite cards show a ★.
  - TV / desktop: select a movie and press right to reach **☆ Favoritar** in the details panel;
    on a series page use **☆ Favoritar** next to the title.
  - Remote: the **red** button toggles the focused movie/series (and the open series).
  - Phone / mouse: press and hold (right click) a movie or series card.
- **Series progress** is saved automatically (every 15 s of playback, when you leave the player
  or the app, and at the end of an episode). The series page shows **▶ Continuar T2E3**, which
  opens the right season and resumes where you stopped; a finished episode (90 % or less than
  2 min left) moves the button to the next one, and to **Rever** after the last one. Episode
  cards show a progress bar or *✓ Assistido*.
- Data lives in the device's localStorage, per account (server + user). **Sair** keeps it.
  Clearing the app data removes it unless sync is on.

Web test: start `node dev/mock-server.js`, open the app in a browser, play the mock VOD, and
use **Miniplayer**. Android test: build/install the APK, play a VOD, enter full screen, use
**Miniplayer**, then return to the app; the stream must not reconnect during the transition.

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

## Sync between devices (optional)

`deploy/sync` keeps favorites and series progress in sync between the web, Android and Tizen
apps that use the same IPTV account.

- **Identity = your IPTV login.** `POST /sync/session` checks user/password on the IPTV server
  **the user typed** and answers a random token (valid `SESSION_TTL_HOURS`, default 24 h; the
  app renews it with the saved login). `IPTV_UPSTREAM` is used only when the server field is
  empty or is the web deploy's own address. Data is separated per server + user.
- **Web deploy:** automatic (same origin, `/sync/*` through Caddy).
  **Android / Tizen:** fill *Servidor de sincronização* on the login screen with your web
  address (`https://...`); empty = local only.
- Offline-first: if the service is down the app keeps working and uploads later.

Security notes:

- The password is sent once per session, in the JSON body over HTTPS (never in a URL), and is
  never stored or logged. Only a keyed hash of each token is stored; data files are named by an
  HMAC of server + user. Logs carry method, path, status and duration only.
- Servers typed by users are untrusted: only `http(s)`, only `GET /player_api.php`, no
  redirects, 8 s / 64 KB limits, and addresses that resolve to loopback, private, link-local,
  CGNAT, multicast or cloud-metadata ranges are refused (the connection is pinned to the checked
  IP). Only the `IPTV_UPSTREAM` host may be internal. `SYNC_ALLOWED_HOSTS` restricts which IPTV
  hosts may use sync.
- 10 failed logins per IP / 15 min → 429; 256 KB body limit; strict validation; no CORS headers;
  runs as non-root.

### Deploy on Dokploy

1. **Sync service:** new application from this repo, Dockerfile `deploy/sync/Dockerfile`,
   build context = repo root. **No public domain/port.** Mount a volume on `/data`.
   Environment (set only in the Dokploy panel, see `deploy/sync/.env.example`):
   - `SYNC_SECRET` = output of `openssl rand -base64 48` (required, ≥ 32 bytes)
   - `IPTV_UPSTREAM` = same value as the web service
   - `PUBLIC_ORIGIN` = your web address, e.g. `https://tv.example.com`
   - `TRUSTED_PROXY_HOPS=2` (Traefik + Caddy)
2. **Web service:** add `SYNC_UPSTREAM=http://<sync-service-name>:8790` (internal Docker
   network name) and redeploy so the new `Caddyfile` is used.
3. Rotating `SYNC_SECRET` logs everyone out and starts the synced data from scratch (devices
   upload their local copy again on the next sync).

Never commit real values: `.env` files are git-ignored; only `.env.example` placeholders live in
the repo.

## Testing without the real server

```bash
node dev/mock-server.js   # fake XUI on :8787, user/pass test/test
node --test deploy/sync/test/*.test.js   # sync service tests
```

Resume needs a video longer than the 10 s sample: `MOCK_MP4=/path/long.mp4 node dev/mock-server.js`.

Sync locally (web): run the service, then the mock proxying `/sync/*` to it:

```bash
SYNC_SECRET=$(openssl rand -base64 48) SYNC_ALLOW_PRIVATE=1 IPTV_UPSTREAM=http://localhost:8787 \
  PUBLIC_ORIGIN=http://localhost:8787 TRUSTED_PROXY_HOPS=1 SYNC_DATA_DIR=/tmp/iptv-sync \
  node deploy/sync/server.js
SYNC_UPSTREAM=http://127.0.0.1:8790 node dev/mock-server.js
```

Open `http://localhost:8787` in two browser profiles: favorites and progress follow. Android
emulator: sync server `http://10.0.2.2:8787` (plain http is accepted only for
`localhost`/`127.0.0.1`/`10.0.2.2`).

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
- Credentials are stored in plain text in app storage (localStorage) on the device, and so is
  the sync token.
- Most IPTV panels serve plain HTTP, so your ISP can see the traffic. Use a VPN on the device
  if that matters.
