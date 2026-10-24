import { useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useGame } from '../game-context';
import { Action, Card, clock, Field, Page, ui } from '../ui';
import { EventMap } from '../components/event-map';
import { Settings } from '../game-api';

export default function Event() {
  const g = useGame(), s = g.state;
  const [reason, setReason] = useState(''), [editing, setEditing] = useState(false);
  const [duration, setDuration] = useState(''), [head, setHead] = useState(''), [radius, setRadius] = useState('');
  const [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState('');
  const disabled = g.busy || !g.online || g.pending;
  const confirm = (title: string, message: string, action: () => void) => Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: action }]);
  if (!g.loaded) return <Page><Text>Restoring your event…</Text></Page>;
  if (!g.session) return <Page><Text style={ui.heading}>You’re no longer in an event.</Text>{!!g.error && <Text style={ui.error}>{g.error}</Text>}<Action title="Back to home" onPress={() => router.replace('/')} /></Page>;
  if (!s) return <Page><Text style={ui.heading}>Connecting to your event…</Text>{!!g.error && <Text accessibilityRole="alert" style={ui.error}>{g.error}</Text>}<Action title="Stop GPS and leave when connected" secondary onPress={() => g.leave()} /><Action title="Home" secondary onPress={() => router.replace('/')} /></Page>;
  const lobby = s.phase === 'lobby', terminal = ['finished', 'canceled'].includes(s.phase);
  const active = s.players.filter(p => p.role !== 'host' && p.status === 'active');
  const runners = active.filter(p => p.role === 'runner');
  return <Page><Text style={ui.kicker}>{s.me.admin ? 'ORGANIZER' : 'PLAYER'} · {s.phase.toUpperCase()}</Text><Text style={ui.title}>{s.name}</Text>
    <Text style={ui.body}>{s.me.name} · {s.me.role === 'host' ? 'Non-playing organizer' : s.me.role}{g.online ? ' · Connected' : ' · Disconnected — displayed data may be stale'}</Text>
    {!!g.error && <Text accessibilityRole="alert" style={ui.error}>{g.error}</Text>}
    {g.pending && <Card><Text style={ui.heading}>Waiting for server confirmation</Text><Text style={ui.body}>Location sharing has stopped on this phone. Your capture or withdrawal will retry when connected.</Text></Card>}
    {lobby && <>
      {s.code && <Card><Text style={ui.kicker}>PRIVATE EVENT CODE</Text><Text selectable style={ui.timer}>{s.code}</Text><Action title="Share invitation" secondary onPress={() => { void Share.share({ message: `Join ${s.name} in Don't Get Caught. Code: ${s.code}\nServer: ${g.session!.base}` }); }} /><Text style={ui.body}>{active.length}/50 playing · {active.filter(p => p.ready && p.connected).length} ready</Text>
        <Action title={s.locked ? 'Unlock lobby' : 'Lock lobby'} secondary disabled={disabled} onPress={() => g.act('admission', { locked: !s.locked })} /><Action title="Replace invitation code" secondary disabled={disabled} onPress={() => confirm('Replace code?', 'Previous invitations will stop working. Existing players remain.', () => g.act('admission', { rotate: true }))} /></Card>}
      <Card><Text style={ui.heading}>Round settings</Text><Text style={ui.body}>{s.settings.durationMinutes}-minute hunt · {s.settings.headStartMinutes}-minute head start · reveals every 3 minutes</Text><Text style={ui.body}>Boundary radius: {s.settings.boundary.radius}m</Text>
        {s.me.admin && <Action title="Edit settings" secondary disabled={disabled} onPress={() => { setEditing(!editing); setDuration(String(s.settings.durationMinutes)); setHead(String(s.settings.headStartMinutes)); setRadius(String(s.settings.boundary.radius)); setLatitude(String(s.settings.boundary.latitude)); setLongitude(String(s.settings.boundary.longitude)); }} />}
        {editing && s.me.admin && <><Field label="Hunt minutes" value={duration} set={setDuration} numeric /><Field label="Head start minutes" value={head} set={setHead} numeric /><Field label="Center latitude" value={latitude} set={setLatitude} numeric /><Field label="Center longitude" value={longitude} set={setLongitude} numeric /><Field label="Boundary radius (meters)" value={radius} set={setRadius} numeric /><Action title="Save and reset readiness" disabled={disabled} onPress={async () => { const next: Settings = { ...s.settings, durationMinutes: Number(duration), headStartMinutes: Number(head), boundary: { latitude: Number(latitude), longitude: Number(longitude), radius: Number(radius) } }; await g.act('configure', next); setEditing(false); }} /></>}
      </Card>
      <Card><Text style={ui.heading}>Before you’re ready</Text><Text style={ui.body}>Play on foot within the agreed safe area. Use the agreed in-person tag. Hunters see runner snapshots every 3 minutes. Non-playing organizers see live positions.</Text>
        {s.me.role !== 'host' ? <><Text style={ui.body}>Readying grants location-sharing consent for this round and checks GPS plus background permission. Keep this screen open through the start so GPS can begin.</Text><Action title={s.me.ready ? 'Ready — refresh GPS check' : 'Accept rules and get ready'} disabled={disabled} onPress={() => g.ready()} />{s.me.ready && <Action title="Not ready" secondary disabled={g.busy} onPress={() => g.stop()} />}</> : <Text style={ui.body}>You organize without sharing your own GPS. Choose a playing role below if you want to join the hunt.</Text>}
      </Card>
    </>}
    {!lobby && !terminal && <>
      <Card><View style={ui.row}><View style={{ flex: 1 }}><Text style={ui.kicker}>{s.phase === 'head-start' ? 'HEAD START' : 'HUNT REMAINING'}</Text><Text style={ui.timer}>{clock(s.phase === 'paused' ? s.paused!.remainingHunt : (s.phase === 'head-start' ? s.startAt! : s.endAt!) - g.now)}</Text></View><View><Text style={ui.kicker}>NEXT REVEAL</Text><Text style={ui.timer}>{clock(s.phase === 'paused' ? s.paused!.remainingReveal : (s.nextRevealAt || g.now) - g.now)}</Text></View></View><Text style={ui.body}>{runners.length} runners free · {s.players.filter(p => p.status === 'caught').length} caught</Text>{s.batch && <Text style={ui.body}>Reveal #{s.batch.number} · released {Math.max(0, Math.floor((g.now - s.batch.revealedAt) / 1000))}s ago</Text>}</Card>
      {s.phase === 'paused' && <Card><Text style={ui.heading}>Round paused — stop moving</Text><Text style={ui.body}>{s.paused?.reason}</Text><Text style={ui.body}>Open the app after the organizer resumes so background GPS can restart.</Text></Card>}
      {s.me.status === 'caught' ? <Card><Text style={ui.heading}>You’ve been caught.</Text><Text style={ui.body}>Location sharing has stopped. Wait for the round results.</Text></Card> : <Card><EventMap state={s} now={g.now} /></Card>}
      {s.me.role !== 'host' && s.me.status === 'active' && <Card><Text style={ui.body}>{g.gps}</Text><Action title="Enable / restart location sharing" disabled={disabled || s.phase === 'paused'} onPress={() => g.share()} /><Action title="Stop location sharing" secondary disabled={g.busy} onPress={() => g.stop()} />
        {s.ownBoundary === 'outside' && <Text style={ui.error}>Outside the play area — return to the boundary.</Text>}
        {s.ownBoundary === 'uncertain' && <Text style={ui.body}>GPS accuracy makes your boundary position uncertain.</Text>}
        {s.me.role === 'runner' && <Action title="I’ve been caught" disabled={g.busy || g.pending || s.phase !== 'hunt'} onPress={() => confirm('Confirm capture?', 'Confirm only after an agreed in-person tag. Your GPS will stop immediately; capture counts after the server acknowledges it.', () => g.capture())} />}
      </Card>}
    </>}
    {s.result && <Card><Text style={ui.kicker}>ROUND RESULTS</Text><Text style={ui.title}>{s.result.winner ? `${s.result.winner === 'hunters' ? 'Hunters' : 'Runners'} win` : 'Round canceled'}</Text><Text style={ui.body}>{s.result.reason}</Text>{s.result.players.map(p => <View key={p.id}><Text style={ui.label}>{p.name} · {p.role} · {p.status}</Text>{p.survivalMs !== null && <Text style={ui.body}>Survival time {clock(p.survivalMs)}</Text>}</View>)}</Card>}
    {!terminal && <Card><Text style={ui.heading}>{s.me.admin ? 'Player management' : 'Players'}</Text>
      {s.me.admin && <Field label="Reason for removal or capture correction" value={reason} set={setReason} />}
      {s.players.filter(p => !['removed', 'withdrawn'].includes(p.status)).map(p => { const diag = s.diagnostics?.find(x => x.id === p.id); return <View key={p.id} style={{ gap: 8 }}><View style={ui.divider} /><Text style={ui.label}>{p.name} · {p.role}{p.id === s.me.id ? ' (you)' : ''}</Text><Text style={ui.body}>{lobby ? p.role === 'host' ? 'Organizing' : p.ready ? 'Ready' : 'Not ready' : p.status} · {p.connected ? 'Connected' : 'Disconnected'}</Text>
        {diag && !lobby && <Text style={ui.body}>GPS: {diag.lastFixAt ? `${Math.max(0, Math.floor((g.now - diag.lastFixAt) / 1000))}s old · ±${Math.round(diag.accuracy || 0)}m` : 'No fresh fix'} · Boundary: {diag.boundaryStatus}</Text>}
        {s.me.admin && lobby && <View style={{ gap: 8 }}>
          <Action title="Assign hunter" secondary disabled={disabled} onPress={() => g.act('assign', { playerId: p.id, role: 'hunter' })} /><Action title="Assign runner" secondary disabled={disabled} onPress={() => g.act('assign', { playerId: p.id, role: 'runner' })} />
          {s.me.owner && <Action title="Make non-playing organizer" secondary disabled={disabled} onPress={() => confirm('Give organizer access?', 'This player will get event controls and the live organizer map, disclosed in the lobby rules.', () => g.act('assign', { playerId: p.id, role: 'host' }))} />}
        </View>}
        {s.me.admin && (s.phase === 'hunt' || s.paused?.phase === 'hunt') && p.role === 'runner' && ['active', 'caught'].includes(p.status) && <Action title={p.status === 'caught' ? 'Undo capture (consent required again)' : 'Record capture'} secondary disabled={disabled || !reason.trim()} onPress={() => g.act('correctCapture', { playerId: p.id, undo: p.status === 'caught', reason })} />}
        {s.me.admin && !p.owner && p.id !== s.me.id && <Action title="Remove player" secondary disabled={disabled || !reason.trim()} onPress={() => confirm('Remove this player?', 'Their access will be revoked. Removing the last member of a team cancels an active round.', () => g.act('remove', { playerId: p.id, reason }))} />}
      </View>; })}
    </Card>}
    {s.me.admin && !terminal && <Card><Text style={ui.heading}>Round controls</Text>
      {lobby ? <Action title="Start round" disabled={disabled || !active.length || active.some(p => !p.ready || !p.connected) || !active.some(p => p.role === 'hunter') || !runners.length} onPress={() => g.act('start')} /> : s.phase === 'paused' ? <Action title="Resume round" disabled={disabled} onPress={() => g.act('resume')} /> : <Action title="Pause round" disabled={disabled} onPress={() => g.act('pause', { reason: reason.trim() || 'Organizer paused the round' })} />}
      <Action title="End round early" secondary disabled={disabled} onPress={() => confirm('End this round?', 'This cancels the round and stops server location sharing.', () => g.act('end', { reason: reason.trim() || 'Ended early by organizer' }))} />
    </Card>}
    {s.me.admin && !!s.audit?.length && <Card><Text style={ui.heading}>Recent event activity</Text>{s.audit.slice(-8).reverse().map((entry, i) => <Text key={`${entry.at}-${i}`} style={ui.body}>{new Date(entry.at).toLocaleTimeString()} · {entry.action}{entry.detail ? ` · ${entry.detail}` : ''}</Text>)}</Card>}
    <Action title={terminal ? 'Leave event and return home' : 'Leave event'} secondary disabled={g.busy} onPress={() => confirm('Leave event?', s.me.owner && !terminal ? 'As owner, leaving will cancel this event. Your location sharing stops immediately.' : 'Location sharing stops immediately. Withdrawal retries automatically if offline.', async () => { await g.leave(); })} />
  </Page>;
}
