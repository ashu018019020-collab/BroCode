/**
 * The OFFLINE CONTRACT — which parts of BroCode keep working without a network, and which wait.
 *
 * The platform already handles disconnection (the service worker caches the bundled lessons,
 * banks and runtimes; the store writes to this device; the sync resums on the `online` event).
 * What was missing is the CONTRACT SAID OUT LOUD: one tested module that owns the copy telling a
 * learner what to expect while offline, so no surface invents its own claim — the same rule the
 * marketing surfaces already follow (every number and promise comes from a registry a test can
 * read).
 *
 * Rules for the copy below, held by `offline-resilience.test.mjs`:
 *  - a "works offline" claim may name only the offline mechanisms that really exist (the service
 *    worker's cache, the bundled Pyodide/sql.js runtimes, the device store, the `online` resync);
 *  - an ONLINE-ONLY note must say what the learner gets IN THE MEANTIME — a fallback name, never
 *    a shrug — and may never promise a cloud service offline;
 *  - "saved" is said only about the device store, which is where the truth is.
 */

export interface OfflineCapability {
  id: string;
  label: string;
  /** One learner-facing sentence. Tested: it must name its own mechanism. */
  note: string;
}

/** The surfaces that genuinely keep working with no connection. */
export const OFFLINE_CAPABLE: OfflineCapability[] = [
  {
    id: 'lessons',
    label: 'Lessons, Question Bank & past papers',
    note: 'Read from your device cache after the first visit; your progress saves on this device as you go.',
  },
  {
    id: 'code',
    label: 'Python, SQL & notebook labs',
    note: 'The Python and SQL runtimes ship inside the app — editing and running code never needs a network.',
  },
  {
    id: 'interview',
    label: 'Interview round & history',
    note: 'Your answers, transcripts, the unfinished sitting and past round summaries are kept on this device.',
  },
  {
    id: 'sync',
    label: 'Account progress sync',
    note: 'Anything done offline syncs automatically the moment the connection returns.',
  },
];

/** The surfaces that need the network — each with the fallback the learner gets meanwhile. */
export const NETWORK_ONLY: OfflineCapability[] = [
  {
    id: 'ai-marking',
    label: 'AI interview marking',
    note: 'Scores come from the built-in rubric until the AI evaluator is reachable again — retry keeps working.',
  },
  {
    id: 'cloud-voice',
    label: 'Google Cloud voice',
    note: 'The interview keeps speaking with your browser’s built-in voice instead.',
  },
  {
    id: 'account',
    label: 'Sign-in & account sync',
    note: 'You stay signed in; new sign-ins and fresh account sync wait for the network.',
  },
  {
    id: 'notebook-manifest',
    label: 'Notebook library (first visit)',
    note: 'The list may appear empty until the app has fetched it once — the notebooks themselves still run from cache.',
  },
];

/**
 * The banner copy, one consumer: the shell banner in `App.tsx`. Returned as data rather than JSX
 * so the accessibility contract (a live region) is chosen by the consumer, not hidden here.
 */
export function offlineBannerCopy(): {
  title: string;
  capable: OfflineCapability[];
  waiting: OfflineCapability[];
  footnote: string;
} {
  return {
    title: 'You are offline — your work stays yours',
    capable: OFFLINE_CAPABLE,
    waiting: NETWORK_ONLY,
    footnote:
      'Nothing was lost when the connection dropped: every edit and answer is already on this device.',
  };
}

/** The one line the Interview Room shows while the network is down. */
export function offlineRoomNote(): string {
  return 'Offline — AI marking is on the built-in rubric for now, and every answer in this round is saved on this device, including an unsent transcript.';
}

/** Is this code one of the recoverable network failures `apiJson` reports? Pure, reused in tests. */
export function isNetworkCode(code: string | null | undefined): boolean {
  return code === 'network' || code === 'timeout' || code === 'api-unreachable';
}
