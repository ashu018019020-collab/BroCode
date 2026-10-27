import { useEffect, useState } from 'react';

/**
 * Is the device online right now?
 *
 * `navigator.onLine` alone is a snapshot and a liar (it reports true on networks with no real
 * route), but the browser's `online`/`offline` events are the honest primitive every browser
 * agrees on — they fire when connectivity changes, exactly when this matters. The hook seeds with
 * the snapshot and then follows the events; there is no polling loop (a timer cannot make the
 * truth arrive sooner, only burn battery).
 *
 * Used by the shell's offline banner and the interview room's offline notice. The account sync
 * has its own `online` listener in `AuthProvider` (it must trigger the resync itself), so this
 * hook deliberately REDS nothing — it is a read-only status for the view layer.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
