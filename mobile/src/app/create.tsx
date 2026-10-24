import { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useGame } from '../game-context';
import { GameSession, request } from '../game-api';
import { Action, Card, Field, Page, ui } from '../ui';
export default function Create() {
  const game = useGame(), [base, setBase] = useState('http://192.168.1.10:8787'), [name, setName] = useState('Saturday Chase'), [host, setHost] = useState('Organizer');
  const [duration, setDuration] = useState('45'), [head, setHead] = useState('3'), [latitude, setLatitude] = useState('1.3521'), [longitude, setLongitude] = useState('103.8198'), [radius, setRadius] = useState('500');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function run(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not create event'); } finally { setBusy(false); } }
  return <Page><Text style={ui.title}>Set the arena.</Text><Text style={ui.body}>Start as a non-playing organizer. You can choose a playing role in the lobby.</Text>
    <Card><Field label="Server address" value={base} set={setBase} /><Field label="Event name" value={name} set={setName} /><Field label="Your name" value={host} set={setHost} /><Field label="Hunt duration (1–180 minutes)" value={duration} set={setDuration} numeric /><Field label="Head start (0–15 minutes)" value={head} set={setHead} numeric /><Text style={ui.body}>Reveals are fixed at every 3 minutes.</Text></Card>
    <Card><Text style={ui.heading}>Circular play boundary</Text><Text style={ui.body}>Choose a safe play area. Coordinates below are examples; place the arena before starting.</Text><Field label="Center latitude" value={latitude} set={setLatitude} numeric /><Field label="Center longitude" value={longitude} set={setLongitude} numeric /><Field label="Radius (100–5000 meters)" value={radius} set={setRadius} numeric />
      <Action title="Use my current position as center" secondary disabled={busy} onPress={() => run(async () => { if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Location permission is needed to set the center'); const fix = await Location.getCurrentPositionAsync({}); setLatitude(String(fix.coords.latitude)); setLongitude(String(fix.coords.longitude)); })} /></Card>
    {!!error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
    <Action title="Create private lobby" disabled={busy || !!game.session} onPress={() => run(async () => { const result = await request<Omit<GameSession, 'base'>>(base, '/games', undefined, { name, hostName: host, durationMinutes: Number(duration), headStartMinutes: Number(head), boundary: { latitude: Number(latitude), longitude: Number(longitude), radius: Number(radius) } }); await game.save({ ...result, base }); router.replace('/event'); })} />
  </Page>;
}
