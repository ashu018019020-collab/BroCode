/**
 * Supabase Realtime for the account surfaces — presence and broadcasts, instead of polling.
 *
 * Two facts reach the owner dashboard the moment they happen:
 *   · PRESENCE — every signed-in session tracks itself on ONE shared channel, so "Online" lights up
 *     when a learner's tab opens and goes dark the instant it closes or drops its socket. The
 *     realtime server heartbeats the connection itself, so a dead laptop times out on its own.
 *   · BROADCAST — a sign-in anywhere sends one small message on the same channel; the dashboard
 *     answers with a single refetch instead of asking every 15 seconds whether something changed.
 *
 * The socket is reference-counted: the first holder (AuthProvider announcing a session, the
 * dashboard watching) creates and subscribes the channel, the last one out removes it. All
 * handlers are bound ONCE at creation because supabase-js re-joins the channel when a presence
 * callback is added later — watchers therefore fan out through the listener sets below, never
 * through `channel.on`. Nothing here touches the network until a function is called, so tests
 * load the pure helpers without a client or an environment.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from './client';

export const LIVE_CHANNEL = 'brocode-live';
export const SIGN_IN_EVENT = 'sign-in';

export type LiveStatus = 'idle' | 'connecting' | 'subscribed' | 'error';

/** Who this browser tab is, as announced to the channel. */
export interface LiveProfile {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface LiveHandlers {
  /** Fires on every presence sync: the set of account ids currently connected. */
  onPresence?: (ids: ReadonlySet<string>) => void;
  onStatus?: (status: LiveStatus) => void;
  /** Fires once per sign-in broadcast received from ANY session. */
  onEvent?: () => void;
}

/**
 * The ids a presence state says are connected — every entry's tracked `id`, flattened across
 * presence keys (a key is one member connection; one account on two devices is two entries).
 * A malformed state degrades to an empty set, never to a crash: this data crosses a network.
 */
export function presenceIds(state: unknown): Set<string> {
  const ids = new Set<string>();
  if (!state || typeof state !== 'object') return ids;
  for (const entries of Object.values(state as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const id = (entry as { id?: unknown }).id;
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return ids;
}

/**
 * One online rule: live presence wins while it exists, the roster snapshot is the fallback when
 * the channel is not connected (first paint, a dropped socket, no realtime service). The switch
 * is the whole design — `null` means "nothing is live right now", not "nobody is online".
 */
export function onlineOf(
  accountId: string,
  snapshotOnline: boolean,
  liveIds: ReadonlySet<string> | null,
): boolean {
  return liveIds === null ? snapshotOnline : liveIds.has(accountId);
}

let channel: RealtimeChannel | null = null;
let client: ReturnType<typeof getSupabaseClient> | null = null;
let holders = 0;
let status: LiveStatus = 'idle';
/** The profile this tab announced, re-asserted after every (re)join — presence resets server-side. */
let tracked: LiveProfile | null = null;
let latestIds = new Set<string>();
let syncedOnce = false;

const presenceListeners = new Set<(ids: ReadonlySet<string>) => void>();
const statusListeners = new Set<(status: LiveStatus) => void>();
const eventListeners = new Set<() => void>();

function notifyPresence(): void {
  for (const listener of [...presenceListeners]) listener(latestIds);
}

function notifyStatus(): void {
  for (const listener of [...statusListeners]) listener(status);
}

function announceTrack(target: RealtimeChannel, profile: LiveProfile): void {
  // A track pushed before the join completes is buffered by supabase-js and flushed on join;
  // re-asserting on SUBSCRIBED covers that flush AND every reconnect that reset the state.
  void target.track({ ...profile }).catch((error: unknown) => {
    console.error('Could not announce presence on the live channel.', error);
  });
}

/** Take one reference to the shared channel; creating + subscribing it on first use. */
function acquire(): (() => void) | null {
  if (channel) {
    holders += 1;
    return release;
  }
  let supabase: ReturnType<typeof getSupabaseClient>;
  try {
    supabase = getSupabaseClient();
  } catch {
    return null; // No realtime without configured keys: a silent fallback, never a crash.
  }
  const target = supabase.channel(LIVE_CHANNEL);
  channel = target;
  client = supabase;
  holders = 1;
  status = 'connecting';
  latestIds = new Set();
  syncedOnce = false;

  target
    .on('presence', { event: 'sync' }, () => {
      if (channel !== target) return;
      latestIds = presenceIds(target.presenceState());
      syncedOnce = true;
      notifyPresence();
    })
    .on('broadcast', { event: SIGN_IN_EVENT }, () => {
      if (channel !== target) return;
      for (const listener of [...eventListeners]) listener();
    })
    .subscribe((raw) => {
      if (channel !== target) return; // a teardown's late callback must not resurrect the state
      status = raw === 'SUBSCRIBED' ? 'subscribed' : 'error';
      notifyStatus();
      if (status === 'subscribed' && tracked) announceTrack(target, tracked);
    });
  return release;
}

function release(): void {
  holders -= 1;
  if (holders > 0) return;
  const target = channel;
  const supabase = client;
  channel = null;
  client = null;
  tracked = null;
  latestIds = new Set();
  syncedOnce = false;
  status = 'idle';
  if (target && supabase) void supabase.removeChannel(target);
}

/**
 * Announce this signed-in session on the channel. The returned function untracks it (when other
 * watchers still hold the socket) and drops this tab's reference. Repeated announcements of the
 * same account are one presence entry per connection; a second device is a second entry.
 */
export function announcePresence(profile: LiveProfile): () => void {
  const drop = acquire();
  if (!drop || !channel) return () => {};
  const target = channel;
  tracked = profile;
  if (status === 'subscribed') announceTrack(target, profile);
  return () => {
    if (tracked?.id === profile.id) {
      tracked = null;
      // The last holder is closing the socket anyway — the server drops presence with it.
      if (channel === target && holders > 1) {
        void target.untrack().catch(() => { /* already gone */ });
      }
    }
    drop();
  };
}

/**
 * Watch the channel: presence syncs, connection status, and sign-in broadcasts. Subscribers get
 * the current status immediately; presence is only reported once the channel has really synced,
 * so a fresh watcher never flashes "everybody offline" while the first sync is still in flight.
 */
export function watchLive(handlers: LiveHandlers): () => void {
  if (handlers.onPresence) presenceListeners.add(handlers.onPresence);
  if (handlers.onStatus) statusListeners.add(handlers.onStatus);
  if (handlers.onEvent) eventListeners.add(handlers.onEvent);
  const drop = acquire();
  handlers.onStatus?.(status);
  if (handlers.onPresence && syncedOnce) handlers.onPresence(latestIds);
  return () => {
    if (handlers.onPresence) presenceListeners.delete(handlers.onPresence);
    if (handlers.onStatus) statusListeners.delete(handlers.onStatus);
    if (handlers.onEvent) eventListeners.delete(handlers.onEvent);
    drop?.();
  };
}

/**
 * Tell the channel a session just signed in. supabase-js delivers this either over the joined
 * socket or — while the join is still in flight — through the realtime HTTP endpoint, so the
 * message lands either way; a failure is logged and left to the dashboard's fallback refresh.
 */
export async function broadcastSignIn(): Promise<void> {
  const drop = acquire();
  if (!drop || !channel) return;
  try {
    // `send` answers 'ok' | 'timed out' | 'error' — over the joined socket or the HTTP endpoint,
    // whichever path it had to take.
    const delivery = await channel.send({
      type: 'broadcast',
      event: SIGN_IN_EVENT,
      payload: { at: Date.now() },
    });
    if (delivery !== 'ok') console.error(`The sign-in broadcast could not be delivered (${delivery}).`);
  } catch (error) {
    console.error('The sign-in broadcast could not be delivered.', error);
  } finally {
    drop();
  }
}
