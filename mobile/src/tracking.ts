import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { ApiError, GameState, path, request, Session } from './api';

const TASK = 'dgc-runner-gps-v1', CONFIG = 'dgc-tracking-v1', STATUS = 'dgc-gps-status-v1';
type Config = { session: Session; endAt: number; clockOffset: number };
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
export async function stopTracking() {
  await SecureStore.deleteItemAsync(CONFIG);
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  await status('Tracking stopped on this phone');
}
async function status(message: string) { await SecureStore.setItemAsync(STATUS, JSON.stringify({ message, at: Date.now() }), options); }
export async function trackingStatus(): Promise<{ message: string; at: number } | null> {
  const value = await SecureStore.getItemAsync(STATUS); return value ? JSON.parse(value) : null;
}
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  try {
    const raw = await SecureStore.getItemAsync(CONFIG);
    if (!raw) return;
    const config: Config = JSON.parse(raw), s = config.session;
    if (Date.now() + config.clockOffset >= config.endAt) { await stopTracking(); await status('Test finished; tracking stopped'); return; }
    if (error) { await status('GPS error: ' + error.message); return; }
    const state = await request<GameState>(s.base, path(s, 'state'), s.token);
    if (!['head-start', 'hunt'].includes(state.phase)) { await stopTracking(); await status('Test inactive; tracking stopped'); return; }
    const location = data?.locations?.filter(x => x.timestamp >= Date.now() - 30_000).sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!location || location.coords.accuracy === null || location.coords.accuracy < 0) { await status('Waiting for a fresh GPS fix'); return; }
    if (!await SecureStore.getItemAsync(CONFIG)) return;
    await request(s.base, path(s, 'locations'), s.token, { latitude: location.coords.latitude, longitude: location.coords.longitude,
      accuracy: location.coords.accuracy, capturedAt: location.timestamp });
    await status('GPS upload accepted');
  } catch (error) {
    if (error instanceof ApiError && [401, 404, 409].includes(error.status)) await stopTracking();
    await status(error instanceof Error ? error.message : 'GPS upload failed');
  }
});
export async function startTracking(session: Session, state: GameState) {
  if (session.role !== 'runner' || !state.endAt || !['head-start', 'hunt'].includes(state.phase)) throw new Error('Start the test before enabling runner tracking');
  if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Precise location permission is required');
  if (!(await Location.requestBackgroundPermissionsAsync()).granted) throw new Error('Background location permission is required. Enable it in phone settings.');
  if (!await Location.hasServicesEnabledAsync()) throw new Error('Turn on location services');
  const current = await request<GameState>(session.base, path(session, 'state'), session.token);
  if (!current.endAt || !['head-start', 'hunt'].includes(current.phase)) throw new Error('Test is no longer active');
  await SecureStore.setItemAsync(CONFIG, JSON.stringify({ session, endAt: current.endAt, clockOffset: current.serverNow - Date.now() }), options);
  try {
    await Location.startLocationUpdatesAsync(TASK, { accuracy: Location.Accuracy.High, timeInterval: 10_000,
      distanceInterval: 0, deferredUpdatesInterval: 10_000, pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true, activityType: Location.ActivityType.Fitness,
      foregroundService: { notificationTitle: "Don't Get Caught", notificationBody: 'Runner location sharing is active for this test.', killServiceOnDestroy: true } });
    await status('Tracking enabled; waiting for GPS upload');
  } catch (error) { await stopTracking(); throw error; }
}
