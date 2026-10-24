# Two-phone GPS prototype test

This guide describes the retained diagnostic spike. In the current app, open it
using **Open original GPS diagnostics** on the home screen while outside an event.
For the complete game, use [the event runbook](event-runbook.md).

Use one iPhone and one Android phone; then swap their roles. All steps below are
manual tests still to be performed. Automated server tests do not prove phone behavior.

## 1. Build and install

The client is in `mobile/`. Use Node.js 24+ and run `npm.cmd ci` there.
Native permissions/configuration require a development build; Expo Go is insufficient.

Android local build (requires Android Studio/SDK and a connected device):

```powershell
cd mobile
npx.cmd expo run:android --device
```

For an iPhone, either run `npx expo run:ios --device` on a Mac with Xcode, or use EAS
from Windows. EAS setup requires your Expo login/project and Apple signing credentials.
These are account setup steps, not credentials to paste into chat:

```powershell
cd mobile
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest build:configure
npx.cmd eas-cli@latest device:create
npx.cmd eas-cli@latest build --profile development --platform ios
```

An EAS Android alternative is `npx.cmd eas-cli@latest build --profile development --platform android`.
Cloud builds may have account-specific costs. No cloud build has been submitted yet.
Install the development build using its resulting installation link, then run
`npx.cmd expo start --dev-client --lan` from `mobile/` and open it in the installed client.

Android map tiles need a Google Maps SDK for Android API key. It is optional for the
first GPS test: without a key, the Android client shows snapshot coordinates and ages
and does not mount a native map. iPhone uses Apple Maps.
To enable the Android map, configure the key in the build environment:

```powershell
$env:GOOGLE_MAPS_ANDROID_API_KEY = 'your-restricted-development-key'
npx.cmd expo run:android --device
```

For EAS configure the same environment variable in the EAS build environment. Restrict
the key to Maps SDK for Android, package `com.dontgetcaught.gpsspike` and the signing
certificate SHA-1 for that build. Rebuild after changing native configuration.
Do not commit the key. See [Expo map setup](https://docs.expo.dev/versions/latest/sdk/map-view/).

Development configuration permits HTTP LAN requests on both phones. Replace these
exceptions with production HTTPS transport settings before release.

## 2. Connect the devices

1. Start `npm.cmd run server` from the repository root.
2. Put the computer and phones on the same trusted Wi-Fi network. Keep the computer awake.
3. Find the computer's Wi-Fi IPv4 address with `ipconfig`. If necessary, allow Node
   on the Windows private-network firewall prompt; no firewall settings were changed here.
4. Open `http://YOUR-LAN-IP:8787/health` in each phone browser. Expect `{"ok":true}`.
   If it fails, resolve IP/firewall/client-isolation issues before testing the app.
5. On phone A, enter that server address and choose **Create test as host**.
6. Copy the session ID and runner invitation to phone B; enter a name and join.
   Invitation secrets differ by role; an ordinary hunter cannot promote themselves.
7. On phone A choose **Use this phone as hunter + host** before starting.
8. Start the 30-second warm-up from phone A.
9. On phone B tap **Consent and enable background GPS**, allow precise location and
   background/Always permission, and wait for **GPS upload accepted**.
10. The first snapshot is released when warm-up ends. Subsequent snapshots are released
    every three minutes. Permission prompts can outlast warm-up; a missing first pin is
    expected if no fresh sample has arrived. Restart a new test if needed.

No location is read before consent. A stopped runner may re-enable GPS during the
active test. There is no readiness enforcement in this diagnostic prototype.

## 3. Field procedure

Walk with the runner phone; keep the hunter screen open initially. Keep both phones
within Wi-Fi coverage for LAN tests. Moving onto mobile data will disconnect a LAN
server; use a configured private VPN/HTTPS server for a larger outdoor route.

| Test | Expected behavior | Record |
|---|---|---|
| Runner moves after a reveal | Hunter pin stays fixed until next batch | Batch numbers; pin movement |
| Runner screen locked for 10+ minutes | Fresh samples continue if OS permits | Missing batches; fix age |
| Runner switches apps for 10+ minutes | Background upload continues | Device/OS; fix age |
| Runner Wi-Fi off for one reveal | No fresh location in that batch | Batch; outage duration |
| Runner reconnects after reveal | Published batch remains unchanged | Before/after coordinates |
| Hunter switches apps and returns | Fetches current batch, no extra reveal | Batch and sample age |
| GPS precision reduced / permission revoked | Honest errors/accuracy, no invented fixes | Actual device behavior |
| Runner taps Stop GPS | Collection stops locally; future batches lack fresh samples | OS indicator; next reveal |
| Host ends test | Server clears GPS; connected runner stops on next callback/poll | Stop delay |
| End while runner offline | Server accepts no more GPS; local task observes deadline or local stop | Local stop delay |
| Runner leaves offline | Local tracking stops, credentials retained to retry leave | Retry acknowledgment |
| Force-quit runner app | Updates may stop; no claim of reliable tracking after kill | Vendor/OS behavior |
| Server restart | Sessions disappear; clients stop tracking/reset after 404 | Client state |
| Complete 30-minute hunt | No final reveal at deadline; server clears locations | Tracking indicator |

Repeat with iPhone/Android roles reversed. Run additional consecutive tests for
45–60 minutes of total observation and record starting/ending battery percentages.
Sampling interval is a target, not an OS delivery guarantee. App lock-screen behavior
requires real devices; a successful bundle or simulator run is insufficient.

## 4. Record results

Create one record per run (do not include names, invitation tokens or coordinates):

```text
Run date / duration:
Runner device / OS / app build:
Hunter device / OS / app build:
Network and battery-saver settings:
Battery start -> end:
Background interval tested:
Reveal batches observed / batches without fresh samples:
Sample ages and accuracy range:
Stop/end behavior and delay:
Permission / reconnect / force-quit findings:
Pass / issue / follow-up:
```

Advance to the full lobby/game flow only after we know which phone configurations
deliver usable snapshots and how much battery they consume. Boundaries, captures,
push notifications, pause/resume and the full 20–50-person field trial are later work.

Background behavior reference: [Expo Location documentation](https://docs.expo.dev/versions/v58.0.0/sdk/location/).
