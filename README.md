# Don't Get Caught

## Handoff for the next laptop / Codex session

Last updated: **24 October 2026 (Asia/Singapore)**. Read this README first, then
[the event runbook](docs/event-runbook.md) and [the game specification](docs/game-spec.txt).
Read `mobile/AGENTS.md` before changing mobile code. This README is the current
implementation handoff; the wireframes are earlier design references, not the running app.

The user wants an iPhone/Android app for private organized events of **20–50 players**:
a host assigns hunters and runners, hunters receive all active runners' GPS snapshots
every **3 minutes**, and runners confirm agreed in-person tags. The user authorized
continuing from one agreed step to the next after completing checks, without repeated
confirmation. Continue within that scope, fix failing checks before proceeding, and
update this handoff with changes and blockers. Account access, signing, paid resources,
publication and physical-device actions have not been completed or provisioned.

**Where to resume:** do not rebuild the GPS spike or the six implemented milestones.
Restore dependencies, run the existing checks, then prepare/install native development
builds and walk through the full game on real phones. If device/account access is
unavailable, work on the remaining independent engineering tasks below and record
exactly what is still unverified. Do not turn the user's GPS assumption into a claim
that physical testing passed.

### Move the project safely

- Copy the **whole `dont get caught` folder**, including `server/`, `docs/`, root
  `package.json`, `README.md`, and `mobile/` with its source, assets, configuration,
  `AGENTS.md` and `package-lock.json`.
- At this handoff there is **no Git repository at the project root**. The starter
  created a repository only in `mobile/`, with modified and untracked implementation
  files. No handoff commit or remote push has been made. A clone/export of only the
  existing committed mobile repository will omit work and will not include the server
  or docs. Consolidating version control at the project root remains to be done;
  preserve the nested repository/history and working files before reorganizing it.
- You can omit `.npm-cache/`, `mobile/node_modules/`, `mobile/.expo/`, exported
  `mobile/dist-*/` bundles and generated `mobile/android/` / `mobile/ios/` folders.
  Dependencies and native projects can be regenerated. Keep the source assets.
- For a fresh test environment, no database needs to be copied. To preserve existing
  events, shut down the server cleanly first and copy the complete `data/` directory
  (or the configured `DATA_FILE` location). It is ignored by Git and may contain
  private player data. Never open one live database concurrently on both laptops.
- Reconfigure any local environment variables on the new machine. The source expects
  `PORT` (default `8787`), `DATA_FILE` (default `data/events.sqlite`) and optional
  `GOOGLE_MAPS_ANDROID_API_KEY` at native build time. Do not put real credentials in
  this README. No signing credentials or API keys were provisioned during this work.
- Replace the example `http://192.168.1.10:8787` in the app with the new laptop's LAN
  IP. Event settings also contain example Singapore coordinates; choose the real arena.
- PowerShell commands below use `.cmd` to avoid the earlier machine's blocked npm
  PowerShell scripts. On macOS/Linux use `npm` and `npx` without `.cmd`.

### Remaining work, in order

1. **Restore and verify on the new laptop.** Install Node.js 24+, run `npm.cmd ci`
   inside `mobile/`, then `npm.cmd run verify` at the root. Recheck Expo configuration
   with `npx.cmd expo-doctor` from `mobile/`. The recorded passes below are from the
   previous machine, not proof that the new machine is configured correctly.
2. **Build/install the actual app.** `mobile/eas.json` has a development profile,
   but no signed Android/iPhone binaries have been built. Use Android tooling locally
   or EAS; use a Mac/Xcode or EAS with Apple signing/device registration for iPhone.
   Configure the optional restricted Android Maps key and rebuild to enable tiles.
   Follow [the device setup guide](docs/gps-test-guide.md) and
   [the full-game walkthrough](docs/event-runbook.md).
3. **Run a small physical UI acceptance test.** Exercise create/join, role changes,
   readiness, consent/permission denial, synchronized start, both player maps,
   organizer visibility, captures, corrections, pause/resume and results on 2–4
   phones. Check offline capture/leave retries, app restarts and revoked access.
   The native UI and background task integration have not been exercised on phones.
4. **Implement and test notifications / locked-phone UX.** Reveal, start, pause,
   resume and end notifications are not implemented. Foreground state uses polling;
   there is no push pipeline. Currently players must keep the app open through start
   and reopen it after resume to restart GPS. Notification/background scheduling
   needs platform verification; a push message alone must not be treated as a
   guarantee that a suspended app can restart tracking. Preserve server timing and
   visibility rules when adding delivery channels.
5. **Prepare hosted access and release hardening.** No hosted HTTPS backend, cloud database,
   backend deployment configuration, CI pipeline or production release exists. The current
   SQLite implementation is durable but single-process. Choose hosting with durable
   storage or plan a deliberate Postgres migration if needed; it has not been done.
   Remove development HTTP exceptions before production, review retention/backups,
   and reassess the five last-recorded Expo tooling audit findings. Do not blindly
   run `npm audit fix --force`: its previous suggestion downgraded Expo to SDK 44.
6. **Validate real event scale.** Trial 6–10, then 20, then 50 players; measure GPS
   freshness, missing reveals, battery use, coverage and boundary accuracy. Lock-screen,
   low-power, force-quit and network-switch behavior are still unverified. The user
   asked to assume GPS success to continue implementation, but field evidence still
   needs recording before calling the app ready for an event or store release.

Account/email recovery, automated backup management and database-at-rest encryption
are absent. Public matchmaking, chat, teammate visibility, shrinking zones, power-ups,
rankings and route replays are intentionally outside this first version, rather than
unfinished promises to implement automatically. There is no supported web app, despite
the starter package retaining a `web` command. No app-store submission has been made.

## Current implementation

An iPhone/Android outdoor hunt game, now at the **first playable implementation** stage.
The six planned software milestones are implemented locally. Physical-phone GPS testing
is being treated as a working assumption at the user's request, not a verified result.
The specification and wireframes remain in `docs/`.

Implemented:

- Private event creation and six-character join codes; host role assignment and readiness checks.
- Up to 50 playing participants, with separate non-playing organizer access.
- Configurable hunt duration, head start and circular boundary; fixed three-minute reveals.
- Server-controlled start, pause/resume, end, and reconnect timing.
- Hunter snapshot maps, runner self-map, organizer live overview and GPS/boundary diagnostics.
- Runner-confirmed captures, offline capture/withdrawal retries, audited host corrections and results.
- Persistent SQLite events, hashed bearer credentials, location cleanup and result expiry.
- Original GPS spike retained under **Open original GPS diagnostics** on the home screen.

Start with [the event runbook](docs/event-runbook.md). Native UI/field trials, push
notifications, signed builds and hosted HTTPS deployment remain pending.

## Run the server

Requires Node.js 24 or later (built-in SQLite). There are no server npm dependencies.
From the repository root in PowerShell:

```powershell
npm.cmd test
npm.cmd run verify
npm.cmd run server
```

Server listens on port 8787. Use your computer's LAN IP on the phones, not `localhost`.
The service is a private development server without TLS. Use a trusted private network
for LAN testing. Do not expose it directly to the public internet. Outdoor cellular
tests require a reachable HTTPS endpoint or a private VPN; none is deployed here.
Events persist to `data/events.sqlite`, ignored by git. Keep this folder on durable
storage. `DATA_FILE` overrides the path and `PORT` overrides 8787. Run only one server
process against this database; this is not a horizontally scaled production service.

## Run the mobile client

```powershell
cd mobile
npm.cmd ci
npm.cmd run lint
npm.cmd run typecheck
npx.cmd expo start --dev-client --lan
```

You must first install a **native development build**, not Expo Go. See
[the two-phone guide](docs/gps-test-guide.md) for Android/iPhone builds and the test procedure.
Rebuild the native app after the navigation/native package changes in this milestone.
Windows cannot build iOS locally; use a Mac with Xcode or an EAS development build.
No cloud builds, Apple provisioning, Maps accounts or external deployments have been created.

## Validation and current limits

Last recorded validation on 24 October 2026: 30 server tests passed, including a complete 50-player
HTTP event rehearsal and SQLite close/reopen, cleanup and expiry tests. Mobile lint
and TypeScript passed; all 20 Expo Doctor checks passed. Android and iOS JavaScript bundles
exported successfully. Native configuration introspection confirmed background location
modes, manifest generation and the Router plugin. Signed binaries and physical UI
walkthroughs have not been run. A simulated API session is not a 50-phone field test.
These are previously observed results; the README handoff edit did not rerun the suite.

For repeatable checks, run `npm.cmd run verify` from the root. For bundle validation,
run these from `mobile/`:

```powershell
npx.cmd expo export --platform android --output-dir dist-android
npx.cmd expo export --platform ios --output-dir dist-ios
```

Bundle exports check JavaScript packaging, not native compilation, screen layout or
background behavior. Client queue/GPS integration still needs device-level acceptance.

## Code map for the next session

| Location | Purpose |
|---|---|
| `server/index.js` | HTTP API, admission rate limits, server startup, scheduled ticks and SQLite wiring |
| `server/game.js` | Full event engine: lobby, roles, readiness, timers, reveals, capture/results and access control |
| `server/store.js` | SQLite snapshot persistence; no external database library |
| `server/game.test.js`, `server/round.test.js` | Lobby, timing, capture, visibility and failure-case tests |
| `server/event-http.test.js` | Complete simulated 50-player event through HTTP endpoints |
| `server/persistence.test.js` | SQLite reopen/recovery and deletion/expiry tests |
| `server/engine.js`, `server/engine.test.js` | Original memory-only diagnostic spike; separate from the full engine |
| `mobile/index.ts` | Registers both background tasks before importing Expo Router |
| `mobile/src/app/` | Full app routes: home/join, create, event flow and standalone diagnostics |
| `mobile/src/game-context.tsx` | Session restoration, foreground polling, actions and persisted pending capture/leave retries |
| `mobile/src/game-tracking.ts` | Full-game background GPS, consent intent and serialized native start/stop operations |
| `mobile/src/game-api.ts` | Full-game request routes and response types |
| `mobile/src/components/event-map.tsx`, `mobile/src/ui.tsx` | Role-specific maps and shared native UI |
| `mobile/App.tsx`, `mobile/src/tracking.ts`, `mobile/src/api.ts` | Original diagnostic client, task and shared HTTP helper |
| `mobile/app.config.js`, `mobile/app.json`, `mobile/eas.json` | Dynamic native configuration, starter assets/settings and development build profile |
| `docs/game-spec.txt`, `docs/wireframes.html` | Product rules and original four-screen design reference |
| `docs/event-runbook.md`, `docs/gps-test-guide.md` | Current game walkthrough and retained diagnostic/device setup guide |

The full app uses `/games` endpoints. Original diagnostics use `/sessions`; do not
mistake the diagnostic 30-second warm-up/30-minute hunt for full-game defaults.
The current stack is Expo SDK 58, React Native 0.88, TypeScript, Node.js 24+ and SQLite.
The full game defaults to a 3-minute head start and a 45-minute hunt. Thresholds currently
implemented are 30 seconds for fresh fixes/preflight, 45 seconds for disconnection,
and 50m for low-accuracy labels. There are caps of 50 active playing participants,
five non-playing organizers, 100 lifetime members per event and 100 retained events.
Treat these defaults/limits as implementation choices to validate, not additional user
requirements. Read the specification and current engine before changing them.

## Data handling and operational limits

Game events use SQLite; legacy diagnostic sessions remain memory-only. Finishing or
canceling an event clears player GPS and revealed positions immediately. Abandoned
events expire after 24 hours. Results, arena settings and audit metadata expire 30 days
after finish. Cleanup runs while the server is running and on startup. Existing backups
must follow the same retention policy separately. Protect the database file: its active
locations are not encrypted at rest. Bearer tokens are stored as hashes on the server
and using SecureStore on phones. Player coordinates are not logged.

Active playing participants' native tasks request uploads approximately every 10 seconds,
subject to OS scheduling. Hunters' raw positions are visible only to non-playing staff;
they are never exposed to runners. A remote end is detected on the next successful task/state request.
When offline, collection may continue until a task callback observes the known deadline
or the player stops locally. The server rejects uploads after end immediately. Exact
instantaneous remote shutdown of an offline phone is not guaranteed. Keep the app open
through start and reopen it after resume: a stopped native task cannot reliably restart
on a locked phone without additional platform notification/background work. Capture and
leave stop local tracking first; their server acknowledgment may arrive later.

The last recorded dependency audit reported five high-severity findings in the Expo CLI
dependency chain (`node-forge`, `zod` and their parents). Compatible `npm audit fix`
did not resolve them. The suggested force fix downgrades Expo to SDK 44 and was not
applied. Reassess upstream fixes before release; do not expose the development server
or Metro to untrusted networks. No production release is claimed.

References used for native setup: [Expo Location](https://docs.expo.dev/versions/v58.0.0/sdk/location/),
[SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) and
[native maps](https://docs.expo.dev/versions/latest/sdk/map-view/).
