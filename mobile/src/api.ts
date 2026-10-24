export type Session = { base: string; id: string; token: string; role: 'host' | 'runner' | 'hunter'; hostToken?: string; runnerInvite?: string; hunterInvite?: string };
export type Sample = { latitude: number; longitude: number; accuracy: number; capturedAt: number; receivedAt: number };
export type GameState = { phase: 'lobby' | 'head-start' | 'hunt' | 'ended'; serverNow: number; startAt: number | null; endAt: number | null; nextRevealAt: number | null; players: { id: string; name: string; role: string }[]; batch?: { number: number; revealedAt: number; runners: { id: string; name: string; sample: Sample | null }[] } };
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function request<T>(base: string, path: string, token?: string, body?: object): Promise<T> {
  const response = await fetch(base.replace(/\/$/, '') + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(response.status, result.error || 'Request failed');
  return result;
}
export const path = (s: Session, action: string) => `/sessions/${s.id}/${action}`;
