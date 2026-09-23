import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurriculum } from '../data/curriculum';
import { useStore } from '../offline/store';
import { itemAttempt, learnView } from '../engine/keys';
import { useI18n } from '../i18n';
import { BookOpen, Search } from 'lucide-react';

/** Concepts hub: every concept from all 29 sections, searchable, status-aware. */
export default function ConceptHub() {
  const { sections } = useCurriculum();
  const state = useStore();
  const { t } = useI18n();
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const out: { sid: string; sec: string; title: string; level: string; done: boolean }[] = [];
    for (const s of sections) {
      s.learn.concepts.forEach((c, i) => {
        out.push({
          sid: s.id, sec: s.title, title: c.title, level: c.level,
          done: !!(state.attempts[learnView(s.id)] || state.attempts[itemAttempt(s.id, 'coding', i)]?.done),
        });
      });
    }
    const needle = q.trim().toLowerCase();
    return needle ? out.filter((r) => `${r.title} ${r.sec}`.toLowerCase().includes(needle)) : out;
  }, [sections, q, state.attempts]);

  return (
    <div>
      <h1 className="row" style={{ gap: 10 }}><BookOpen size={22} /> Concepts</h1>
      <p className="muted small">Every concept from the PDF curriculum, in one searchable index.</p>
      <div className="row" style={{ margin: '10px 0 16px' }}>
        <div className="row" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 10, padding: '2px 10px', background: 'rgba(0,0,0,.3)' }}>
          <Search size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search concepts…"
            aria-label="Search concepts"
            style={{ border: 'none', background: 'transparent', flex: 1, padding: '8px 6px' }}
          />
        </div>
        <span className="chip">{rows.length} concepts</span>
      </div>
      <div className="statgrid">
        {rows.map((r) => (
          <Link key={`${r.sid}-${r.title}`} to={`/lesson/${r.sid}/learn`} className="stat" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="row spread">
              <b className="small">{r.title}</b>
              {r.done ? <span style={{ color: 'var(--green)' }}>✓</span> : <span className="muted">○</span>}
            </div>
            <div className="l">{r.sec} · {r.level}</div>
          </Link>
        ))}
      </div>
      {!rows.length && <p className="muted">No concepts match “{q}”.</p>}
    </div>
  );
}
