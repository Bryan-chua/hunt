import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ApiError, EventState, GameSession, getState, request, route } from './game-api';
import { armGps, gpsStatus, haltGps, isArmed, permissions, preflight, syncGps } from './game-tracking';
import { stopTracking as stopDiagnosticTracking } from './tracking';

const KEY = 'dgc-event-session-v2', PENDING = 'dgc-event-pending-v2';
type Pending = { id: string; action: 'capture' | 'leave'; key?: string };
type Model = { session: GameSession | null; state: EventState | null; loaded: boolean; online: boolean; busy: boolean; error: string; gps: string; now: number; pending: boolean;
  save: (s: GameSession) => Promise<void>; act: (name: string, body?: object) => Promise<void>; ready: () => Promise<void>; share: () => Promise<void>;
  capture: () => Promise<void>; leave: () => Promise<void>; stop: () => Promise<void>; forget: () => Promise<void> };
const Context = createContext<Model | null>(null);
export function GameProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GameSession | null>(null), [state, setState] = useState<EventState | null>(null);
  const [loaded, setLoaded] = useState(false), [online, setOnline] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [gps, setGps] = useState('Location sharing is off'), [now, setNow] = useState(() => Date.now()), [pending, setPending] = useState(false);
  const offset = useRef(0), flight = useRef(false), lastReady = useRef(0), revision = useRef(0);
  const forget = useCallback(async () => { revision.current++; await haltGps(); await SecureStore.deleteItemAsync(KEY); await SecureStore.deleteItemAsync(PENDING); setSession(null); setState(null); setPending(false); setOnline(false); }, []);
  const save = async (s: GameSession) => { await haltGps(); await stopDiagnosticTracking(); revision.current++; await SecureStore.setItemAsync(KEY, JSON.stringify(s)); await SecureStore.deleteItemAsync(PENDING); setState(null); setSession(s); };
  useEffect(() => { SecureStore.getItemAsync(KEY).then(async v => { if (v) { await stopDiagnosticTracking(); setSession(JSON.parse(v)); } }).catch(e => setError(String(e))).finally(() => setLoaded(true)); }, []);
  const refresh = useCallback(async () => {
    if (!session || flight.current || AppState.currentState !== 'active') return;
    flight.current = true; const current = revision.current;
    try {
      const raw = await SecureStore.getItemAsync(PENDING); const op: Pending | null = raw ? JSON.parse(raw) : null;
      if (op && op.id === session.id) {
        setPending(true);
        try {
          await request(session.base, route(session, op.action), session.token, op.action === 'capture' ? { key: op.key } : {});
          if (op.action === 'leave') { await forget(); return; }
          await SecureStore.deleteItemAsync(PENDING); setPending(false);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409) throw e;
          const latest = await getState(session);
          if (['finished', 'canceled'].includes(latest.phase) || latest.me.status === 'caught') { await SecureStore.deleteItemAsync(PENDING); setPending(false); }
          else { setState(latest); setError('Capture pending; retry after the hunt resumes.'); return; }
        }
      }
      const next = await getState(session);
      if (current !== revision.current) return;
      setState(next); setOnline(true); setError(''); offset.current = next.serverNow - Date.now();
      if (next.phase === 'lobby' && next.me.readyConfirmed && await isArmed() && Date.now() - lastReady.current > 15_000) {
        lastReady.current = Date.now();
        try { await request(session.base, route(session, 'ready'), session.token, { ready: true, consent: true, permissions: true, capturedAt: await preflight() }); }
        catch (e) {
          if (e instanceof ApiError && e.status === 409) { /* host started during GPS preflight; next poll synchronizes */ }
          else { await haltGps(); await request(session.base, route(session, 'ready'), session.token, { ready: false }); throw e; }
        }
      }
      try {
        if (await SecureStore.getItemAsync(PENDING)) await haltGps();
        else await syncGps(session, next);
        setGps(await gpsStatus());
      } catch (e) { await haltGps(); setGps(e instanceof Error ? e.message : 'GPS unavailable; enable location sharing again'); }
    } catch (e) {
      if (current !== revision.current) return;
      setOnline(false); setError(e instanceof Error ? e.message : 'Connection lost');
      if (e instanceof ApiError && [401, 404].includes(e.status)) await forget();
    } finally { flight.current = false; }
  }, [session, forget]);
  useEffect(() => {
    const initial = setTimeout(() => { void refresh(); }, 0);
    const timer = setInterval(refresh, 3000), clock = setInterval(() => setNow(Date.now() + offset.current), 1000);
    const listener = AppState.addEventListener('change', s => { if (s === 'active') void refresh(); });
    return () => { clearTimeout(initial); clearInterval(timer); clearInterval(clock); listener.remove(); };
  }, [refresh]);
  async function work(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); } }
  const act = (name: string, body = {}) => work(async () => { if (!session) return; const next = await request<EventState>(session.base, route(session, name), session.token, body); setState(next); await refresh(); });
  const ready = () => work(async () => {
    if (!session) return;
    await permissions(); const capturedAt = await preflight();
    await request(session.base, route(session, 'ready'), session.token, { ready: true, consent: true, permissions: true, capturedAt });
    await armGps(session); lastReady.current = Date.now(); await refresh();
  });
  const share = () => work(async () => { if (!session) return; await permissions(); const next = await request<EventState>(session.base, route(session, 'consent'), session.token, { consent: true }); await armGps(session); await syncGps(session, next); await refresh(); });
  const stop = () => work(async () => { await haltGps(); setGps(await gpsStatus()); if (session && state?.phase === 'lobby') await request(session.base, route(session, 'ready'), session.token, { ready: false }); else if (session && state && ['head-start', 'hunt', 'paused'].includes(state.phase)) await request(session.base, route(session, 'consent'), session.token, { consent: false }); await refresh(); });
  const queue = (action: 'capture' | 'leave') => work(async () => { if (!session) return; const old = await SecureStore.getItemAsync(PENDING); const existing: Pending | null = old ? JSON.parse(old) : null;
    const key = existing?.action === action ? existing.key : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await SecureStore.setItemAsync(PENDING, JSON.stringify({ id: session.id, action, key })); await haltGps(); setPending(true); await refresh(); });
  return <Context.Provider value={{ session, state, loaded, online, busy, error, gps, now, pending, save, act, ready, share, stop, capture: () => queue('capture'), leave: () => queue('leave'), forget }}>{children}</Context.Provider>;
}
export function useGame() { const value = useContext(Context); if (!value) throw new Error('GameProvider missing'); return value; }
