/**
 * Standardized toast system.
 *
 * A tiny module-level store (not React state) so *any* module — including
 * non-component ones such as the XP / progress engine — can push a toast
 * without threading a context through the tree.
 *
 *   toast('Lesson complete +10 XP', 'success');
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const ICON = { success: CheckCircle2, info: Info, warning: AlertTriangle, error: XCircle } as const;
const COLOR: Record<ToastKind, string> = {
  success: 'var(--green)',
  info: 'var(--cyan)',
  warning: 'var(--amber)',
  error: 'var(--red)',
};

let seq = 0;
let list: ToastItem[] = [];
const listeners = new Set<(t: ToastItem[]) => void>();

function emit() {
  for (const l of listeners) l(list);
}

export function dismissToast(id: number) {
  list = list.filter((t) => t.id !== id);
  emit();
}

export function toast(text: string, kind: ToastKind = 'info', ms = 3200): number {
  const item: ToastItem = { id: ++seq, kind, text };
  list = [...list, item].slice(-4);
  emit();
  if (ms > 0) window.setTimeout(() => dismissToast(item.id), ms);
  return item.id;
}

/** Host renderer — mount once inside the app shell. */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>(list);
  useEffect(() => {
    listeners.add(setItems);
    setItems(list);
    return () => { listeners.delete(setItems); };
  }, []);
  if (!items.length) return null;
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {items.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div key={t.id} className={`toast ${t.kind} pop-in`}>
            <Icon size={16} color={COLOR[t.kind]} />
            <span style={{ flex: 1 }}>{t.text}</span>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => dismissToast(t.id)} style={{ padding: 2 }}>
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
