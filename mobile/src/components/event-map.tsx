import { Platform, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Circle, Marker } from 'react-native-maps';
import { EventState, Pin } from '../game-api';
import { ui } from '../ui';
export function EventMap({ state, now }: { state: EventState; now: number }) {
  const pins: Pin[] = state.live || state.batch?.runners || [];
  const b = state.settings.boundary;
  const allowed = Platform.OS === 'ios' || Constants.expoConfig?.extra?.androidMapsEnabled;
  const age = (timestamp: number) => Math.max(0, Math.floor((now - timestamp) / 1000));
  const active = ['head-start', 'hunt', 'paused'].includes(state.phase) && state.me.status === 'active';
  if (!active) return null;
  return <View style={{ gap: 12 }}>
    {allowed ? <MapView style={{ height: 340, borderRadius: 16 }} initialRegion={{ latitude: b.latitude, longitude: b.longitude, latitudeDelta: Math.max(.004, b.radius / 20000), longitudeDelta: Math.max(.004, b.radius / 20000) }}>
      <Circle center={b} radius={b.radius} strokeColor="#316e4e" fillColor="#316e4e11" />
      {state.self && <Marker coordinate={state.self} title="You" pinColor="#2769a0" />}
      {pins.filter(p => p.sample).map(p => <Marker key={p.id} coordinate={p.sample!} title={p.name} description={`${age(p.sample!.capturedAt)}s old · ±${Math.round(p.sample!.accuracy)}m`} />)}
      {pins.filter(p => p.sample).map(p => <Circle key={p.id} center={p.sample!} radius={p.sample!.accuracy} strokeColor="#a9552b" fillColor="#a9552b22" />)}
    </MapView> : <Text style={ui.body}>Android map tiles are disabled until a Maps key is configured. Positions and accuracy are listed below.</Text>}
    <Text style={ui.body}>{state.phase === 'paused' ? 'Map frozen during pause.' : state.me.role === 'host' ? 'Organizer overview. Check sample ages before treating positions as current.' : state.me.role === 'hunter' ? 'Runner positions are snapshots. Pins stay fixed until the next reveal.' : 'Your own position and the play boundary. Hunters are hidden.'}</Text>
    {state.self && <Text style={ui.body}>Your fix: {age(state.self.capturedAt)}s old · ±{Math.round(state.self.accuracy)}m</Text>}
    {pins.map(p => <View key={p.id} style={{ gap: 4 }}><Text style={ui.label}>{p.name}{p.role ? ` · ${p.role}` : ''}</Text><Text style={ui.body}>{p.sample ? `${age(p.sample.capturedAt)}s old · ±${Math.round(p.sample.accuracy)}m${p.sample.accuracy > 50 ? ' · Low accuracy' : ''}` : 'No fresh location'}</Text>{p.sample && <Text selectable style={ui.body}>{p.sample.latitude.toFixed(6)}, {p.sample.longitude.toFixed(6)}</Text>}</View>)}
  </View>;
}
