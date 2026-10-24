import { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { useGame } from '../game-context';
import { GameSession, request } from '../game-api';
import { Action, Card, Field, Page, ui } from '../ui';
export default function Home() {
  const game = useGame(); const [base, setBase] = useState('http://192.168.1.10:8787'), [code, setCode] = useState(''), [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function join() { setBusy(true); setError(''); try { const result = await request<Omit<GameSession, 'base'>>(base, '/games/join', undefined, { code: code.trim().toUpperCase(), name: name.trim() }); await game.save({ ...result, base }); router.push('/event'); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  return <Page><Text style={ui.kicker}>REAL-WORLD HIDE AND SEEK</Text><Text style={ui.title}>Three minutes.{ '\n' }Make them count.</Text><Text style={ui.body}>Host a private hunt. Assign your teams. Stay free until the clock runs out.</Text>
    {!game.loaded ? <Text>Restoring your event…</Text> : game.session ? <Card><Text style={ui.heading}>You have an event</Text><Action title="Return to event" onPress={() => router.push('/event')} /><Text style={ui.body}>Leave or finish your current event before joining another.</Text></Card> : <>
      <Action title="Host an event" onPress={() => router.push('/create')} /><Card><Text style={ui.heading}>Join your friends</Text><Field label="Server address" value={base} set={setBase} /><Field label="Six-character event code" value={code} set={setCode} /><Field label="Your display name" value={name} set={setName} /><Action title="Join lobby" disabled={busy || code.trim().length !== 6 || !name.trim()} onPress={join} /></Card>
    </>}{!!error && <Text accessibilityRole="alert" style={ui.error}>{error}</Text>}
    <Text style={ui.body}>GPS is shared only during active play. Hunters receive runner snapshots every 3 minutes; non-playing organizers see live positions.</Text>
    {!game.session && <Action title="Open original GPS diagnostics" secondary onPress={() => router.push('/diagnostics')} />}
  </Page>;
}
