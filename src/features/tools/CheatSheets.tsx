import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookMarked, Copy, Printer, Search, ArrowRight } from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import { TRACK_DEFS } from '../../app/App';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { toast } from '../../components/ui/Toast';

/** Authored quick-reference. Every row is plain Python semantics, nothing typed by hand is guesswork. */
const SYNTAX: { group: string; rows: [string, string][] }[] = [
  {
    group: 'Types & literals', rows: [
      ['int / float', 'x = 10      y = 3.5'],
      ['str', 'name = "Ashu"'],
      ['bool', 'ok = True'],
      ['list (mutable)', 'nums = [1, 2, 3]'],
      ['tuple (immutable)', 'point = (3, 4)'],
      ['set (unique)', 'tags = {"a", "b"}'],
      ['dict (key→value)', 'user = {"name": "Ashu", "age": 21}'],
      ['None', 'result = None'],
    ],
  },
  {
    group: 'Control flow', rows: [
      ['if / elif / else', 'if x > 0:\n    print("positive")\nelif x == 0:\n    print("zero")\nelse:\n    print("negative")'],
      ['for over range', 'for i in range(3): print(i)'],
      ['for over items', 'for fruit in ["a", "b"]: print(fruit)'],
      ['while', 'n = 3\nwhile n > 0:\n    n -= 1'],
      ['comprehension', 'squares = [i * i for i in range(5)]'],
      ['guard / early exit', 'if not items:\n    return None'],
    ],
  },
  {
    group: 'Functions', rows: [
      ['define', 'def add(a, b=0):\n    return a + b'],
      ['*args / **kwargs', 'def f(*args, **kw): pass'],
      ['lambda', 'double = lambda x: x * 2'],
      ['type hints', 'def greet(name: str) -> str: return f"Hi {name}"'],
      ['docstring', 'def f():\n    """One-line summary."""'],
    ],
  },
  {
    group: 'Errors & files', rows: [
      ['try / except', 'try:\n    n = int(s)\nexcept ValueError:\n    n = 0'],
      ['finally', 'try:\n    work()\nfinally:\n    cleanup()'],
      ['read a file safely', 'with open("data.txt", encoding="utf-8") as f:\n    text = f.read()'],
      ['write a file', 'with open("out.txt", "w", encoding="utf-8") as f:\n    f.write("hi")'],
      ['raise your own', 'raise ValueError("age must be positive")'],
    ],
  },
  {
    group: 'Classes & modules', rows: [
      ['class', 'class Dog:\n    def __init__(self, name):\n        self.name = name'],
      ['inheritance', 'class Puppy(Dog):\n    pass'],
      ['dataclass', '@dataclass\nclass Point:\n    x: int\n    y: int'],
      ['import', 'from math import sqrt'],
      ['dunder repr', 'def __repr__(self):\n    return f"Dog({self.name!r})"'],
    ],
  },
];

export default function CheatSheets() {
  const { sections } = useCurriculum();
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const sectionFilter = searchParams.get('section');
  const [q, setQ] = useState('');
  const [track, setTrack] = useState<string>('all');
  // Rendered in pages: 120 cards at once is a lot of DOM for no benefit.
  const [limit, setLimit] = useState(48);

  /** Cards are built from the verified curriculum snippets — never re-typed. */
  const cards = useMemo(() => {
    const pick = sections.filter((s) => {
      if (sectionFilter && s.id !== sectionFilter) return false;
      if (track === 'all') return true;
      const def = TRACK_DEFS.find((d) => d.id === track)!;
      return s.no >= def.from && s.no <= def.to;
    });
    const needle = q.trim().toLowerCase();
    return pick
      .flatMap((s) => s.learn.concepts.map((c) => ({ sid: s.id, no: s.no, section: s.title, ...c })))
      .filter((c) => c.code)
      .filter((c) => !needle || `${c.title} ${c.tip} ${c.code}`.toLowerCase().includes(needle));
  }, [sections, q, track, sectionFilter]);

  const visible = cards.slice(0, limit);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied: ${label}`, 'success', 1600);
    } catch {
      toast('Clipboard blocked — select the text and copy it manually.', 'warning');
    }
  };

  return (
    <div>
      <div className="row spread no-print" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ gap: 10 }}><BookMarked size={24} color="var(--violet)" /> CHEAT SHEETS</h1>
          <p className="muted small" style={{ maxWidth: 720 }}>
            A ready reference for revision. The cards below are built directly from the curriculum's
            <b> execute-verified</b> code — no copy-paste typos.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip">{cards.length} snippets</span>
          <button className="btn small" onClick={() => window.print()}><Printer size={13} /> Print / PDF</button>
        </div>
      </div>

      <div className="card no-print" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="searchbox" style={{ cursor: 'text', maxWidth: 'none', flex: 1 }}>
            <Search size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search concepts, keywords or code…"
              style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, color: 'inherit' }}
            />
          </div>
          <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Filter by track">
            <option value="all">All tracks</option>
            {TRACK_DEFS.map((d) => <option key={d.id} value={d.id}>{t(d.nameKey as LocaleKey)}</option>)}
          </select>
        </div>
      </div>

      {!sectionFilter && (
        <>
          <h2 style={{ marginTop: 18 }}>Python syntax quick reference</h2>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
            {SYNTAX.map((g) => (
              <div key={g.group} className="card">
                <h3 style={{ marginTop: 0 }}>{g.group}</h3>
                {g.rows.map(([label, code]) => (
                  <div key={label} style={{ marginBottom: 8 }}>
                    <div className="row spread">
                      <span className="small muted">{label}</span>
                      <button className="btn small ghost no-print" onClick={() => copy(code, label)} aria-label={`Copy ${label}`}><Copy size={11} /></button>
                    </div>
                    <pre className="codeblock">{code}</pre>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={{ marginTop: 20 }}>From the curriculum</h2>
      {!cards.length && (
        <div className="empty-state">
          <span className="big">🔎</span>
          <b>No snippet matched</b>
          <span className="small">Clear the search or choose another track.</span>
        </div>
      )}
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        {visible.map((c, i) => (
          <div key={`${c.sid}-${i}`} className="card">
            <div className="row spread">
              <div style={{ minWidth: 0 }}>
                <span className="chip">s{String(c.no).padStart(2, '0')} · {c.section}</span>
                <h3 style={{ margin: '6px 0 0' }}>{c.title}</h3>
              </div>
              <button className="btn small ghost no-print" onClick={() => copy(c.code, c.title)} aria-label={`Copy ${c.title}`}><Copy size={12} /></button>
            </div>
            <pre className="codeblock">{c.code}</pre>
            {c.output && <div className="small muted"><b>Output:</b> <code className="inline-code">{c.output.split('\n')[0].slice(0, 90)}</code></div>}
            {c.tip && <p className="small muted" style={{ marginBottom: 0 }}>{c.tip}</p>}
            <Link className="btn small no-print" style={{ marginTop: 8 }} to={`/lesson/${c.sid}/learn`}>Open lesson <ArrowRight size={12} /></Link>
          </div>
        ))}
      </div>
      {cards.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 14 }} className="no-print">
          <button className="btn" onClick={() => setLimit((l) => l + 48)}>
            Show {Math.min(48, cards.length - limit)} more ({cards.length - limit} left)
          </button>
        </div>
      )}
    </div>
  );
}
