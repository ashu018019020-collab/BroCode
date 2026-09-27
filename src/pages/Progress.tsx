import { Percent } from 'lucide-react';
import { useCurriculum } from '../data/curriculum';
import { useStore, exportProgress, importProgress } from '../offline/store';
import { sectionProgress, isMastered } from '../engine/progress';
import { accuracyLine, bankAccuracy, bankAccuracyBySection, interviewAccuracy, pctText } from '../engine/accuracy';
import { Bar, ProgressRing } from '../components/ui';

const TRACKS = [
  { name: 'Python', from: 1, to: 16 },
  { name: 'NumPy/Pandas', from: 17, to: 18 },
  { name: 'SQL', from: 19, to: 19 },
  { name: 'ML/NLP', from: 20, to: 21 },
  { name: 'GenAI/Agentic', from: 22, to: 23 },
  { name: 'APIs/Production', from: 24, to: 26 },
  { name: 'Interview/Projects', from: 27, to: 29 },
];

export default function ProgressPage() {
  const { sections } = useCurriculum();
  const state = useStore();
  const overall = Math.round(sections.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / sections.length);
  const activity = Object.entries(state.activity).sort().slice(-14);
  const bank = bankAccuracy(state);
  const bySection = bankAccuracyBySection(state);
  const interview = interviewAccuracy(state);

  return (
    <div>
      <h1>📊 Progress</h1>
      <div className="row" style={{ margin: '14px 0' }}>
        <ProgressRing pct={overall} size={110} label="Overall mastery" />
        <div className="statgrid" style={{ flex: 1 }}>
          <div className="stat"><div className="n">{sections.filter((s) => isMastered(s, state)).length}</div><div className="l">mastered</div></div>
          <div className="stat"><div className="n">{state.xp}</div><div className="l">XP</div></div>
          <div className="stat"><div className="n">{state.mistakes.filter((m) => !m.fixed).length}</div><div className="l">open mistakes</div></div>
          <div className="stat"><div className="n">{Object.values(state.activity).reduce((a, b) => a + b, 0)}</div><div className="l">total XP earned</div></div>
        </div>
      </div>

      {/* ANSWER ACCURACY — "kitna sahi hai, percentage me". Every figure is measured: the ratio of
          correct self-grades, the rubric average of written answers, and standalone interview
          practice. Nothing here is estimated from mastery, which is a different thing. */}
      <div className="card">
        <div className="row spread">
          <h3 className="row" style={{ gap: 8, margin: 0 }}><Percent size={16} color="var(--green)" /> Answer accuracy</h3>
          <span className="chip">{accuracyLine(bank)}</span>
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>
          Percentage = tumhare <b>khud grade kiye</b> answers me se kitne sahi. Rubric average = tumhare likhe
          answers ka model answer se keyword match (wahi rubric jo Interview Mode aur mock rounds use karte hain).
        </p>
        <div className="row" style={{ margin: '10px 0' }}>
          {/* The ring is drawn empty until something is graded, and says so: `text` keeps it from
              printing "0%", which would be a verdict on answers the learner never graded. */}
          <ProgressRing pct={bank.pct ?? 0} size={92} label={accuracyLine(bank)} text={pctText(bank.pct)} />
          <div className="statgrid" style={{ flex: 1 }}>
            <div className="stat"><div className="n">{pctText(bank.pct)}</div><div className="l">accuracy ({bank.correct}/{bank.graded} sahi)</div></div>
            <div className="stat"><div className="n">{pctText(bank.avg)}</div><div className="l">rubric avg (likhe answers)</div></div>
            <div className="stat"><div className="n">{pctText(interview.pct)}</div><div className="l">interview practice ({interview.answered})</div></div>
            <div className="stat"><div className="n">{bank.answered}</div><div className="l">total answers</div></div>
          </div>
        </div>

        {/* Per track, weakest first: the point of an accuracy figure is knowing where to go next.
            Ranked on GRADED answers only — a track where the learner wrote answers but graded none
            has no percentage, and a "(0/0 sahi) —" row would look like a failing track. */}
        {(() => {
          const rows = TRACKS.map((t) => {
            let graded = 0, correct = 0, answered = 0;
            for (const s of sections) {
              if (s.no < t.from || s.no > t.to) continue;
              const a = bySection[s.id];
              if (!a) continue;
              graded += a.graded; correct += a.correct; answered += a.answered;
            }
            return { name: t.name, pct: graded ? Math.round((100 * correct) / graded) : null, answered, correct, graded };
          }).filter((r) => r.graded > 0).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
          if (!rows.length) return null;
          return (
          <>
            <div className="small muted">Track wise (sabse kamzor pehle)</div>
            {rows.map((r) => (
                <div key={r.name} style={{ margin: '8px 0' }}>
                  <div className="row spread small">
                    <span>{r.name} <span className="muted">({r.correct}/{r.graded} sahi)</span></span>
                    <span>{pctText(r.pct)}</span>
                  </div>
                  <Bar pct={r.pct ?? 0} />
                </div>
              ))}
          </>
          );
        })()}
      </div>

      <div className="card">
        <h3>Mastery by track</h3>
        {TRACKS.map((t) => {
          const secs = sections.filter((s) => s.no >= t.from && s.no <= t.to);
          const pct = Math.round(secs.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / Math.max(1, secs.length));
          return (
            <div key={t.name} style={{ margin: '8px 0' }}>
              <div className="row spread small"><span>{t.name}</span><span>{pct}%</span></div>
              <Bar pct={pct} />
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Activity (last 14 active days)</h3>
        {!activity.length && <p className="muted small">No activity recorded yet.</p>}
        {activity.map(([d, xp]) => (
          <div key={d} className="row spread small" style={{ padding: '2px 0' }}>
            <span>{d}</span>
            <span className="row" style={{ gap: 8 }}>
              <span style={{ width: 120 }} className="bar"><div style={{ width: `${Math.min(100, xp / 3)}%` }} /></span>
              <span className="muted">{xp} XP</span>
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Data</h3>
        <p className="small muted">All progress lives in your browser (localStorage). Export to back up or move devices.</p>
        <div className="row">
          <button className="btn" onClick={exportProgress}>⬇ Export progress (JSON)</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            ⬆ Import progress
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => {
              e.target.value = '';
              const f = e.target.files?.[0];
              if (f) importProgress(f).then(() => alert('Progress imported.')).catch((err) => alert('Import failed: progress NOT changed. ' + err.message));
            }} />
          </label>
        </div>
      </div>
    </div>
  );
}
