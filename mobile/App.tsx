import './src/tracking';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Button, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import MapView, { Circle, Marker } from 'react-native-maps';
import { ApiError, GameState, path, request, Session } from './src/api';
import { startTracking, stopTracking, trackingStatus } from './src/tracking';

const KEY = 'dgc-session-v1';
const remaining = (target: number | null | undefined, now: number) => { const s = Math.max(0, Math.ceil(((target || now) - now) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export default function App() {
  const [session, setSession] = useState<Session | null>(null), [state, setState] = useState<GameState | null>(null);
  const [base, setBase] = useState('http://192.168.1.10:8787'), [id, setId] = useState(''), [invite, setInvite] = useState(''), [name, setName] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false), [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now()), [gps, setGps] = useState<{ message: string; at: number } | null>(null);
  const offset = useRef(0);
  useEffect(() => { SecureStore.getItemAsync(KEY).then(v => { if (v) setSession(JSON.parse(v)); }).catch(e => setError(String(e))).finally(() => setLoaded(true)); }, []);
  useEffect(() => {
    if (!session) return;
    let active = true, polling = false;
    async function refresh() {
      if (polling || AppState.currentState !== 'active') return; polling = true;
      try {
        const result = await request<GameState>(session!.base, path(session!, 'state'), session!.token);
        if (!active) return;
        offset.current = result.serverNow - Date.now(); setState(result); setConnected(true); setError('');
        if (result.phase === 'ended') await stopTracking();
        setGps(await trackingStatus());
      } catch (e) {
        if (!active) return;
        setConnected(false); setError(e instanceof Error ? e.message : 'Connection lost');
        if (e instanceof ApiError && [401, 404].includes(e.status)) { await stopTracking(); await SecureStore.deleteItemAsync(KEY); setState(null); setSession(null); }
      } finally { polling = false; }
    }
    void refresh(); const poll = setInterval(refresh, 3000), clock = setInterval(() => setNow(Date.now() + offset.current), 1000);
    const listener = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); });
    return () => { active = false; clearInterval(poll); clearInterval(clock); listener.remove(); };
  }, [session]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); } }
  async function save(s: Session) { await SecureStore.setItemAsync(KEY, JSON.stringify(s)); setState(null); setConnected(false); setSession(s); }
  function validBase() { const url = new URL(base); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS server address'); return base.replace(/\/$/, ''); }
  async function create() { const baseUrl = validBase(); const h = await request<Omit<Session, 'base' | 'role'>>(baseUrl, '/sessions', undefined, {}); await save({ ...h, base: baseUrl, role: 'host' }); }
  async function join() { const baseUrl = validBase(); const p = await request<Pick<Session, 'id' | 'token' | 'role'>>(baseUrl, `/sessions/${id.trim().toUpperCase()}/join`, undefined, { invite: invite.trim(), name: name.trim() }); await save({ ...p, base: baseUrl }); }
  async function leave() {
    if (!session) return;
    await stopTracking();
    await request(session.base, path(session, 'leave'), session.token, {});
    await SecureStore.deleteItemAsync(KEY); setSession(null); setState(null);
  }
  const samples = state?.batch?.runners.filter(r => r.sample) || [];
  const initial = samples[0]?.sample;
  return <View style={styles.root}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.kicker}>GPS TECHNICAL PROTOTYPE</Text><Text style={styles.title}>Don't Get Caught</Text>
    <Text style={styles.note}>Private device test · 30-second warm-up · 30-minute hunt · 3-minute reveals</Text>
    {!loaded ? <Text>Restoring session…</Text> : !session ? <View style={styles.panel}>
      <Text>Server address (your computer's LAN IP or HTTPS URL)</Text><TextInput accessibilityLabel="Server address" style={styles.input} value={base} onChangeText={setBase} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Button title="Create test as host" disabled={busy} onPress={() => run(create)} />
      <Text style={styles.heading}>Or join a test</Text>
      <TextInput accessibilityLabel="Session ID" placeholder="Session ID" style={styles.input} value={id} onChangeText={setId} autoCapitalize="characters" />
      <TextInput accessibilityLabel="Role invitation" placeholder="Runner or hunter invitation" style={styles.input} value={invite} onChangeText={setInvite} autoCapitalize="none" autoCorrect={false} />
      <TextInput accessibilityLabel="Display name" placeholder="Your name" style={styles.input} value={name} onChangeText={setName} maxLength={40} />
      <Button title="Join test" disabled={busy || !id || !invite || !name.trim()} onPress={() => run(join)} />
    </View> : <>
      <Text selectable style={styles.heading}>Session {session.id} · {session.role}</Text>
      <Text>{connected ? 'Connected' : 'Disconnected — displayed data may be stale'} · {state?.phase || 'Loading'}</Text>
      {session.runnerInvite && <View style={styles.panel}><Text>Share these only with your test participants.</Text><Text selectable>Runner invitation: {session.runnerInvite}</Text><Text selectable>Hunter invitation: {session.hunterInvite}</Text></View>}
      {state && <View style={styles.panel}><Text>Players: {state.players.length}</Text><Text>Hunt remaining: {state.phase === 'hunt' ? remaining(state.endAt, now) : '—'}</Text><Text>Next reveal: {remaining(state.nextRevealAt, now)}</Text><Text>Latest batch: {state.batch?.number || 'None'}</Text></View>}
      {session.role === 'host' && state?.phase === 'lobby' && <Button title="Use this phone as hunter + host" disabled={busy} onPress={() => run(async () => { const p = await request<Pick<Session, 'id' | 'token' | 'role'>>(session.base, path(session, 'join'), undefined, { invite: session.hunterInvite, name: 'Host hunter' }); await save({ ...session, ...p, hostToken: session.token }); })} />}
      {(session.role === 'host' || session.hostToken) && <View style={styles.panel}>
        <Button title="Start 30-second GPS warm-up" disabled={busy || !connected || state?.phase !== 'lobby'} onPress={() => run(async () => { const s = await request<GameState>(session.base, path(session, 'start'), session.hostToken || session.token, {}); setState(s); })} />
        <Button title="End test and clear locations" disabled={busy || !connected || state?.phase === 'ended'} onPress={() => Alert.alert('End test?', 'This stops location acceptance and deletes server GPS data.', [{ text: 'Cancel' }, { text: 'End', onPress: () => run(async () => { await request(session.base, path(session, 'end'), session.hostToken || session.token, {}); setState(null); }) }])} />
      </View>}
      {session.role === 'runner' && <View style={styles.panel}>
        <Text>Your GPS is sent to this test server during active play. Hunters receive only a snapshot every 3 minutes. This spike has no live organizer map.</Text>
        <Button title="Consent and enable background GPS" disabled={busy || !connected || !state || !['head-start', 'hunt'].includes(state.phase)} onPress={() => run(async () => { await startTracking(session, state!); setGps(await trackingStatus()); })} />
        <Button title="Stop GPS now" disabled={busy} onPress={() => run(async () => { await stopTracking(); setGps({ message: 'Tracking stopped on this phone', at: Date.now() }); })} />
        <Text>{gps?.message || 'Tracking has not been enabled'}</Text>{gps && <Text>Last status: {Math.max(0, Math.floor((Date.now() - gps.at) / 1000))}s ago</Text>}
      </View>}
      {session.role === 'hunter' && <>
        {initial && state?.phase === 'hunt' && (Platform.OS === 'ios' || Constants.expoConfig?.extra?.androidMapsEnabled) && <MapView key={state.batch?.number} style={styles.map} initialRegion={{ latitude: initial.latitude, longitude: initial.longitude, latitudeDelta: .015, longitudeDelta: .015 }}>
          {samples.map(r => <Marker key={r.id} coordinate={r.sample!} title={r.name} description={`GPS sample ${Math.max(0, Math.floor((now - r.sample!.capturedAt) / 1000))}s ago · ±${Math.round(r.sample!.accuracy)}m`} />)}
          {samples.map(r => <Circle key={r.id} center={r.sample!} radius={r.sample!.accuracy} strokeColor="#1c635a" fillColor="#1c635a22" />)}
        </MapView>}
        <Text style={styles.note}>Pins stay fixed between reveals. No fresh GPS means no pin for that batch.</Text>
        {Platform.OS === 'android' && !Constants.expoConfig?.extra?.androidMapsEnabled && <Text>Map disabled until an Android Maps key is configured. Snapshot coordinates and ages remain available below.</Text>}
        {state?.batch?.runners.map(r => <View style={styles.row} key={r.id}><Text style={styles.heading}>{r.name}</Text><Text>{r.sample ? `Sample ${Math.max(0, Math.floor((now - r.sample.capturedAt) / 1000))}s ago · ±${Math.round(r.sample.accuracy)}m${r.sample.accuracy > 50 ? ' · Low accuracy' : ''}` : 'No fresh location'}</Text>{r.sample && <Text>{r.sample.latitude.toFixed(6)}, {r.sample.longitude.toFixed(6)}</Text>}</View>)}
      </>}
      <View style={styles.panel}><Button title="Leave test (stops GPS immediately)" disabled={busy} onPress={() => run(leave)} /></View>
    </>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Text style={styles.note}>Development build required. Force-quitting or phone restrictions may stop updates. {Platform.OS === 'android' ? 'Android maps require a Google Maps SDK key in your build.' : ''}</Text>
  </ScrollView></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#f2f5f3' }, content: { padding: 22, paddingTop: 62, paddingBottom: 48, gap: 14 }, title: { fontSize: 30, fontWeight: '700', color: '#173b33' }, kicker: { fontSize: 12, letterSpacing: 2, color: '#49675e' }, note: { color: '#4c605a', lineHeight: 21 }, heading: { fontSize: 17, fontWeight: '600' }, panel: { padding: 16, backgroundColor: '#fff', borderRadius: 12, gap: 14 }, input: { borderWidth: 1, borderColor: '#aabdb4', padding: 12, borderRadius: 8, fontSize: 16 }, map: { height: 330, borderRadius: 12 }, row: { padding: 12, backgroundColor: '#fff', gap: 6 }, error: { color: '#9f1b25', padding: 12, backgroundColor: '#ffe9e9' } });
