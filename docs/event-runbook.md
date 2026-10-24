# First playable event runbook

Status: software implemented and locally checked, 24 October 2026. Device GPS behavior
is assumed to work for continued engineering; signed builds, physical UI trials and
real 20–50-player events are not yet validated.

## Milestones

| Step | Implemented | Verification |
|---|---|---|
| Hosting/lobby | Six-character codes, settings, roles, readiness, locking, code rotation, 50-player cap | Lobby unit tests; mobile lint/typecheck/bundles |
| Round controls | Server start, head start, hunt deadline, pause/resume, end and reconnect | Clock, pause and deadline tests |
| Player screens | Boundary/self-map, hunter snapshots with age/accuracy and role restrictions | Access/reveal tests; Android/iOS bundles |
| Captures/results | Runner confirmation, stable retry key, corrections, winners and survival times | Idempotency, correction, withdrawal and timeout tests |
| Organizer dashboard | Disclosed live overview, player diagnostics, boundary status, audit history, removals | Visibility, boundary, permission and revocation tests |
| Persistence | SQLite event storage, restart recovery, hashed credentials, location purge and metadata expiry | File-backed close/reopen and cleanup tests |

The 50-player integration rehearsal exercises the actual HTTP endpoints through the
full round. It is a correctness check with simulated clients, not a phone battery,
network load or venue coverage test.

## Start locally

1. Install Node.js 24+ and mobile dependencies (`npm.cmd ci` in `mobile/`).
2. Run `npm.cmd run verify` at the repository root.
3. Run `npm.cmd run server` from the repository root. Database: `data/events.sqlite`.
4. Install a native development build on each phone; follow `gps-test-guide.md`.
5. Start Metro in `mobile/` with `npx.cmd expo start --dev-client --lan`.
6. Use your computer's LAN IP in the app, such as `http://192.168.1.10:8787`.
7. Verify `/health` from both phone browsers. Use trusted private Wi-Fi for local HTTP.

The app is native iPhone/Android. No browser/web version is included. Android map
tiles need the configured Maps SDK key; without it, coordinate/age lists still work.

## Host and join

- Host chooses **Host an event**, sets their name, event name, duration, head start,
  arena center and radius. Defaults are 45 minutes, 3 minutes and 500m respectively.
  The initial sample coordinates are an example; deliberately set your actual arena.
- New host starts as a non-playing organizer. The private code appears only to staff
  in the lobby. Share copies both the code and the development server address.
- Friends join with the code and display name. Joining defaults to runner; the host
  assigns hunters and optionally appoints non-playing co-organizers.
- The owner can choose hunter/runner for themselves. Playing hosts keep controls
  but lose access to the live organizer map. At most five non-playing organizers.
- Up to 50 people play. Staff do not consume playing slots. Removed/withdrawn entries
  are retained for audit/results; there is a 100-member lifetime limit for one event.
- Players accept the location visibility rules and allow precise plus background
  permissions when readying. Lobby preflight obtains a local GPS fix and sends only
  its timestamp, not its coordinates. Ready checks refresh while the app stays open.
- Role/settings changes reset readiness. A disconnection over 45 seconds requires
  readying again. Host start requires hunter and runner teams, consent, recent
  connectivity and every included player's GPS preflight less than 30 seconds old.
- Settings/center edits, lobby lock/unlock and invitation rotation are lobby-only.

## Play a round

- Keep player apps open through start so location collection can activate. The
  head start and hunt timer are controlled by the server, not individual phones.
- First reveal occurs when head start ends. Later reveals occur every 180 seconds.
  A zero head start may produce an empty first batch before initial GPS arrives.
- Hunters see the latest batch of runner snapshots, plus their own location.
  Runners see themselves and the boundary. Neither role sees teammate locations.
- Non-playing organizers see current player samples with actual age and accuracy.
  GPS age and connection health are separate; boundary warnings account for accuracy.
- Samples must have arrived by the reveal cutoff and have been captured within
  its preceding 30 seconds. Late samples do not revise a batch. Missing data is
  explicit. No previous position is silently relabeled fresh.
- Pause freezes both timers and sharing. Resume preserves remaining time without
  an extra reveal. Pre-pause fixes are rejected; reopen each player's app after
  resume so native collection can restart. This requirement is visible in the app.
- Tapping **I've been caught** requires confirmation. Local sharing stops, the
  request key is saved and capture retries after reconnect. Server receipt before
  the deadline decides whether capture counts; it is not backdated to the tap.
- Captures are hunt-only. Last remaining runner captured -> hunters win. A runner
  still free at the deadline -> runners win. No new reveal occurs at the deadline.
- Organizers can record/correct a capture with an audit reason. Undo does not
  restart sharing automatically: the restored runner must consent again. Finished
  results cannot be reopened through corrections.
- Leaving stops GPS locally and retries withdrawal while offline. If the last
  active member of either playing team withdraws/is removed, the round is canceled.
  Owner departure cancels an unfinished event; a host phone disconnect alone does not.

## Recovery and data lifecycle

- Mobile credentials survive restarts in SecureStore. Keep the owner device's
  credentials: there is no account/email recovery workflow in this first version.
- Server credentials are hashed. Guessing/creation/join attempts are rate-limited.
  Knowing an event code grants lobby entry, not organizer permissions.
- SQLite writes are atomic, with secure deletion and DELETE journaling. Keep one
  server process and durable storage. Do not run multiple independent processes
  against this snapshot store; it does not implement cross-process coordination.
- Server restart restores the event phase, schedule and latest batch. If deadlines
  passed while offline, the server advances immediately; it does not emit a flood
  of historical reveals to reconnecting players.
- Finishing/canceling deletes player coordinates from active records. Abandoned
  events expire in 24 hours. Arena configuration, names, result and audit records
  expire 30 days after finish. A stopped server performs overdue cleanup on startup.
- Database files/backups require access control and consistent backup deletion.
  This implementation does not provide database-at-rest encryption or cloud backup.

## Device acceptance still to perform

Start with a 2–4-phone walkthrough of create/join, role changes, readiness, start,
both maps, capture confirmation, pause/resume and results. Then test 6–10 players,
20 players and 50 players at the intended venue. Include low-power mode, denied
permissions, approximate GPS, network changes, app switching and force-quit.

Check runner/hunter visibility on actual screens, background-start/stop indicators,
code sharing, keyboard layouts, short screens, and foreground reconnection after a
pause. Record battery and missing-fix rates using the original GPS guide's format.

## Work that needs outside setup

- Expo/Apple signing and device registration for iPhone development builds.
- Optional Google Maps Android SDK key and appropriate key restrictions.
- HTTPS hosting or private VPN connectivity for outdoor cellular access.
- Push notifications for reveal/pause/resume alerts and additional locked-phone UX.
- Physical UI, battery and venue tests. Neither assumed GPS success nor a bundle
  export establishes those results. These are release gates, not silently passed checks.

No paid resources were provisioned, cloud builds submitted or application published.
Five unresolved upstream Expo tooling audit findings remain documented in README.md.
