import { useState, type ReactNode } from 'react';

export function ProgressRing({ pct, size = 54, label }: { pct: number; size?: number; label?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="ring" title={label ?? `${pct}%`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#rg)" strokeWidth="5" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#4f7cff" />
          </linearGradient>
        </defs>
      </svg>
      <span className="val">{pct}%</span>
    </div>
  );
}

export function Bar({ pct }: { pct: number }) {
  return <div className="bar"><div style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
}

export function SectionHeader({ no, title, level, minutes, pct }: { no: string; title: string; level: string; minutes: number; pct: number }) {
  return (
    <div className="card glow fadeup" style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div>
        <div className="chip" style={{ marginBottom: 6 }}>SECTION {no}</div>
        <h1>{title}</h1>
        <div className="row small muted">
          <span className="chip">{level}</span>
          <span>⏱ ~{minutes} min</span>
          <span>Mastery {pct}%</span>
        </div>
      </div>
      <ProgressRing pct={pct} size={72} />
    </div>
  );
}

/** Interactive vertical architecture diagram. */
export function ArchitectureDiagram({ nodes, note }: { nodes: string[]; note?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      <div className="arch">
        {nodes.map((n, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <button
              className={`node ${open === i ? 'open' : ''}`}
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
            >
              {n}
            </button>
            {open === i && note && <div className="small muted" style={{ textAlign: 'center', maxWidth: 420 }}>{note}</div>}
            {i < nodes.length - 1 && <div className="arrow">↓</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Chip({ kind, children }: { kind?: string; children: ReactNode }) {
  return <span className={`chip ${kind ?? ''}`}>{children}</span>;
}
