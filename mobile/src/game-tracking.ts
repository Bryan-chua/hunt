import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { ApiError, EventState, GameSession, getState, request, route } from './game-api';

const TASK = 'dgc-event-location-v2', INTENT = 'dgc-event-tracking-v2', STATUS = 'dgc-event-gps-status-v2';
type Intent = { session: GameSession; endAt?: number; offset?: number; epoch?: string };
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
export async function gpsStatus() { return await SecureStore.getItemAsync(STATUS) || 'Location sharing is off'; }
async function status(message: string) { await SecureStore.setItemAsync(STATUS, message, options); }
let nativeOperations: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const result = nativeOperations.then(action); nativeOperations = result.catch(() => {}); return result;
}
async function haltInternal(disarm = true) {
  if (disarm) await SecureStore.deleteItemAsync(INTENT);
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  await status('Location sharing stopped');
}
export function haltGps(disarm = true) { return serialize(() => haltInternal(disarm)); }
export async function permissions() {
  if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Location permission is required');
  if (!(await Location.requestBackgroundPermissionsAsync()).granted) throw new Error('Allow background/Always location in Settings before readying');
  if (!await Location.hasServicesEnabledAsync()) throw new Error('Enable location services');
}
export async function preflight() {
  const fg = await Location.getForegroundPermissionsAsync(), bg = await Location.getBackgroundPermissionsAsync();
  if (!fg.granted || !bg.granted) throw new Error('Location permission is missing');
  const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  if (fix.coords.accuracy === null || fix.coords.accuracy < 0) throw new Error('Waiting for a usable GPS fix');
  return fix.timestamp;
}
export function armGps(session: GameSession) {
  return serialize(() => SecureStore.setItemAsync(INTENT, JSON.stringify({ session }), options));
}
export async function isArmed() { return Boolean(await SecureStore.getItemAsync(INTENT)); }
export function syncGps(session: GameSession, state: EventState) { return serialize(async () => {
  const raw = await SecureStore.getItemAsync(INTENT);
  if (!raw) return;
  const intent: Intent = JSON.parse(raw);
  if (intent.session.id !== session.id || state.me.status !== 'active' || ['finished', 'canceled'].includes(state.phase)) { await haltInternal(); return; }
  if (state.phase === 'lobby' || state.phase === 'paused') { await haltInternal(false); return; }
  if (!state.trackingAllowed) { await haltInternal(); return; }
  await SecureStore.setItemAsync(INTENT, JSON.stringify({ session, endAt: state.endAt, offset: state.serverNow - Date.now(), epoch: state.trackingEpoch }), options);
  if (!await Location.hasStartedLocationUpdatesAsync(TASK)) {
    await Location.startLocationUpdatesAsync(TASK, { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 0,
      deferredUpdatesInterval: 10_000, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
      activityType: Location.ActivityType.Fitness,
      foregroundService: { notificationTitle: "Don't Get Caught", notificationBody: 'Location sharing is active for this round.', killServiceOnDestroy: true } });
  }
}); }
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  try {
    const raw = await SecureStore.getItemAsync(INTENT); if (!raw) return;
    const intent: Intent = JSON.parse(raw), s = intent.session;
    if (intent.endAt && Date.now() + (intent.offset || 0) >= intent.endAt) { await haltGps(); return; }
    if (error) { await status('GPS error: ' + error.message); return; }
    const state = await getState(s);
    if (!state.trackingAllowed) { await haltGps(state.phase !== 'paused'); return; }
    const fix = data?.locations?.filter(x => x.timestamp >= Date.now() - 30_000).sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!fix || fix.coords.accuracy === null || fix.coords.accuracy < 0) { await status('Waiting for fresh GPS'); return; }
    // A delayed pre-pause callback cannot be relabeled as a post-resume upload.
    if (intent.epoch !== state.trackingEpoch) { await status('Reopen the app after resume to restart GPS'); return; }
    if (!await SecureStore.getItemAsync(INTENT)) return;
    await request(s.base, route(s, 'locations'), s.token, { latitude: fix.coords.latitude, longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy, capturedAt: fix.timestamp, epoch: intent.epoch });
    await status(`GPS accepted at ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    if (e instanceof ApiError && [401, 404].includes(e.status)) await haltGps();
    await status(e instanceof Error ? e.message : 'GPS upload failed');
  }
});
