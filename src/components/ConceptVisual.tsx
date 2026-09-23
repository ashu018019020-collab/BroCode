import type { Concept, Section } from '../types';

/**
 * Section-flavoured illustration drawn from the concept's OWN example code.
 * Nothing is invented: the rows come from the assignments/literals the learner
 * is already looking at, and unmapped sections fall back to the concept map.
 */
export type VisualKind = 'values' | 'index' | 'iterate' | 'keys' | 'map';

const BY_SECTION: Record<number, VisualKind> = {
  1: 'values', 2: 'values', 3: 'values',
  4: 'index', 5: 'index', 8: 'index', 9: 'index', 10: 'index', 11: 'index',
  7: 'iterate',
  12: 'keys',
};

export function visualFor(sid: string): VisualKind {
  const n = parseInt(sid.replace(/\D/g, ''), 10);
  return BY_SECTION[n] ?? 'map';
}

/** Long/malformed example lines must not blow up the layout. */
const clip = (v: string, n = 44) => (v.length > n ? v.slice(0, n - 1) + '…' : v);

function inferType(raw: string): string {
  const v = raw.trim();
  if (/^f?["']/.test(v)) return 'str';
  if (/^(True|False)$/.test(v)) return 'bool';
  if (/^None$/.test(v)) return 'NoneType';
  if (/^-?\d+$/.test(v)) return 'int';
  if (/^-?\d*\.\d+$/.test(v)) return 'float';
  if (/^\[/.test(v)) return 'list';
  if (/^\{/.test(v)) return 'dict';
  if (/^\(/.test(v)) return 'tuple';
  return 'value';
}

/** `name = value` lines from the concept's example — the memory picture for Variables. */
function assignments(code: string) {
  const rows: { name: string; type: string; raw: string }[] = [];
  for (const line of code.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*([^=].*?)\s*(#.*)?$/);
    if (m) rows.push({ name: m[1], type: inferType(m[2]), raw: m[2].trim() });
    if (rows.length === 6) break;
  }
  return rows;
}

/** First string or list literal → character / element index boxes. */
function indexable(code: string): { label: string; items: string[] } | null {
  const s = code.match(/=\s*f?(["'])(.*?)\1/);
  if (s && s[2].length) return { label: s[2], items: [...s[2]].slice(0, 10) };
  const l = code.match(/=\s*\[([^\]]*)\]/);
  if (l) {
    const items = l[1].split(',').map((x) => x.trim()).filter(Boolean);
    if (items.length) return { label: `[${l[1].trim()}]`, items: items.slice(0, 8) };
  }
  return null;
}

/** `range(N)` or a literal list → the loop's iteration timeline. */
function iterations(code: string): string[] {
  const r = code.match(/range\(\s*(\d+)\s*\)/);
  if (r) return Array.from({ length: Math.min(parseInt(r[1], 10), 6) }, (_, i) => `${i + 1}`);
  const l = code.match(/\[([^\]]*)\]/);
  if (l) {
    const items = l[1].split(',').map((x) => x.trim()).filter(Boolean);
    if (items.length) return items.slice(0, 6);
  }
  return [];
}

/** `{key: value}` literal → key → value rows for Dictionaries. */
function pairs(code: string): { k: string; v: string }[] {
  const d = code.match(/\{([^}]*)\}/);
  if (!d) return [];
  return d[1]
    .split(',')
    .map((p) => p.split(':'))
    .filter((p) => p.length >= 2)
    .slice(0, 6)
    .map((p) => ({ k: p[0].trim().replace(/^["']|["']$/g, ''), v: p.slice(1).join(':').trim() }));
}

export function ConceptVisual({ kind, concept, section, activeIndex }: { kind: VisualKind; concept: Concept; section: Section; activeIndex: number }) {
  const code = concept.code ?? '';

  if (kind === 'values') {
    const rows = assignments(code);
    if (rows.length) {
      return (
        <div className="cvisual">
          {rows.map((r, i) => (
            <div key={i} className="cvisrow">
              <span className="cvname">{r.name}</span>
              <span className="cvarrow">→</span>
              <span className="cvval">{clip(r.raw)}</span>
              <span className="cvtype">{r.type}</span>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 4 }}>Har naam memory me apni value hold karta hai — type Python khud detect karta hai.</div>
        </div>
      );
    }
  }

  if (kind === 'index') {
    const x = indexable(code);
    if (x) {
      return (
        <div className="cvisual">
          <div className="small muted">index →</div>
          <div className="cvboxes">
            {x.items.map((ch, i) => (
              <span key={i} className="cvbox"><b>{i}</b><span>{ch === ' ' ? '␣' : ch}</span></span>
            ))}
          </div>
          <div className="small muted">Pehla element index 0 par hai — yahi sabse common counting mistake hai.</div>
        </div>
      );
    }
  }

  if (kind === 'iterate') {
    const steps = iterations(code);
    if (steps.length) {
      return (
        <div className="cvisual">
          {steps.map((s, i) => (
            <div key={i} className="cvisrow">
              <span className="cvtype">iteration {i + 1}</span>
              <span className="cvarrow">→</span>
              <span className="cvval">{s}</span>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 4 }}>Loop har iteration me ek-ek item uthata hai.</div>
        </div>
      );
    }
  }

  if (kind === 'keys') {
    const ps = pairs(code);
    if (ps.length) {
      return (
        <div className="cvisual">
          {ps.map((p, i) => (
            <div key={i} className="cvisrow">
              <span className="cvname">{p.k}</span>
              <span className="cvarrow">→</span>
              <span className="cvval">{clip(p.v)}</span>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 4 }}>Key se value turant milti hai — isliye dictionary lookup fast hota hai.</div>
        </div>
      );
    }
  }

  // Fallback: this section's real concept map with the current concept marked.
  return (
    <div className="cvisual">
      <div className="cvflow">
        {section.learn.concepts.map((c2, i) => (
          <span key={i} className={`cvnode ${i === activeIndex ? 'active' : ''}`}>{i + 1}. {c2.title}</span>
        ))}
      </div>
    </div>
  );
}
