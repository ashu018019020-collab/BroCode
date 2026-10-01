import { useMemo, useRef, useState } from 'react';
import {
  Percent, Clock, Flame, Trophy, Camera, Trash2, Plus, BookOpenCheck, CalendarRange, Activity,
} from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore, exportProgress, importProgress, addStudySeconds, setAvatar, today } from '../../core/storage/store';
import { sectionProgress, isMastered } from '../../core/learning/progress';
import { accuracyLine, bankAccuracy, bankAccuracyBySection, interviewAccuracy, pctText } from '../../core/assessment/accuracy';
import { levelForXp, levelProgress, XP_PER_LEVEL } from '../../core/platform/keys';
import {
  daySeries, studyTotals, studyStreak, weekTotals, heatmapYear, weekdayProfile, topDays,
  formatDuration, axisHours, type StudyDay,
} from '../../core/learning/study';
import { Bar, ProgressRing } from '../../components/ui/ui';

const TRACKS = [
  { name: 'Python', from: 1, to: 16, tone: 'green' },
  { name: 'NumPy/Pandas', from: 17, to: 18, tone: 'blue' },
  { name: 'SQL', from: 19, to: 19, tone: 'violet' },
  { name: 'ML/NLP', from: 20, to: 21, tone: 'fuchsia' },
  { name: 'GenAI/Agentic', from: 22, to: 23, tone: 'amber' },
  { name: 'APIs/Production', from: 24, to: 26, tone: 'orange' },
  { name: 'Interview/Projects', from: 27, to: 29, tone: 'gold' },
];

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const SPAN_DAYS = 14;

/**
 * The y-axis top for the study chart.
 *
 * A rounded ceiling (30m / 1h / 2h steps) instead of the peak itself: a bar that exactly touches the
 * top of the plot reads as "the maximum possible", and it moves under the learner every time the
 * peak changes. A fixed step also keeps the gridline labels readable (`1h`, not `47.3m`).
 */
function niceTop(minutes: number): number {
  if (minutes <= 30) return 30;
  const step = minutes <= 60 ? 30 : minutes <= 240 ? 60 : 120;
  return Math.ceil(minutes / step) * step;
}

/**
 * The picked photo, downscaled to a 128px square JPEG data URL.
 *
 * Never the original file. The whole app state is one JSON blob in localStorage that `setState`
 * re-serialises on EVERY write — 40 call sites, and a measured 1.18 MB once the question bank has
 * been used. A phone photo (2–5 MB) stored as a data URL would multiply every one of those writes by
 * a hundred. Centre-cropped to a square so a portrait does not squash into the circle.
 */
function toAvatar(file: File, size = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas unavailable')); return; }
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image could not be read')); };
    img.src = url;
  });
}

/**
 * The 14-day study chart, drawn with DIVs rather than SVG.
 *
 * Same output as the screenshots it is modelled on, but no viewBox to fight: a fixed viewBox either
 * letterboxes (with `meet`) or stretches the strokes (with `none`) as the viewport changes, and a
 * bar chart has no diagonal lines worth preserving. Divs re-lay out at any width, stay crisp, and
 * carry a native tooltip (`title`) for free.
 */
function StudyChart({ series, xp }: { series: StudyDay[]; xp: Record<string, number> }) {
  const peak = Math.max(0, ...series.map((d) => d.minutes));
  const top = niceTop(peak);
  const xpPeak = Math.max(0, ...series.map((d) => xp[d.key] ?? 0));
  return (
    <div className="chart-wrap">
      {/* y labels and the plot share a grid, so the labels can never drift from the gridlines */}
      <div className="chart-y">
        <span>{axisHours(top)}</span>
        <span>{axisHours(top / 2)}</span>
        <span>0</span>
      </div>
      <div className="chart-plot">
        <div className="chart-gridline" style={{ top: 0 }} />
        <div className="chart-gridline" style={{ top: '50%' }} />
        <div className="chart-gridline" style={{ bottom: 0 }} />
        <div className="chart-bars">
          {series.map((d, i) => {
            const pct = d.minutes > 0 ? Math.max(3, Math.round((d.minutes / top) * 100)) : 0;
            const isToday = i === series.length - 1;
            return (
              <div
                key={d.key}
                className={`chart-col${isToday ? ' today' : ''}`}
                title={`${DAY_LABEL[d.weekday]} ${d.key} — ${formatDuration(d.seconds)}${xp[d.key] ? ` · ${xp[d.key]} XP` : ''}`}
              >
                {/* A day with a few minutes still gets a visible sliver (3%): a 1px bar is
                    indistinguishable from a day with nothing, and the two mean different things. */}
                <div className="chart-bar" style={{ height: `${pct}%` }} />
              </div>
            );
          })}
        </div>
      </div>

      <div />
      <div className="chart-xp" title="XP earned each day">
        {series.map((d) => {
          const v = xp[d.key] ?? 0;
          return (
            <div key={d.key} className="chart-xp-col">
              <i style={{ height: `${xpPeak ? Math.max(v > 0 ? 8 : 0, Math.round((v / xpPeak) * 100)) : 0}%` }} />
            </div>
          );
        })}
      </div>

      <div />
      <div className="chart-x">
        {series.map((d, i) => (
          <span key={d.key} className={i === series.length - 1 ? 'today' : ''}>
            {DAY_SHORT[d.weekday]}
            <b>{Number(d.key.slice(8))}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ProgressPage() {
  const { sections } = useCurriculum();
  const state = useStore();
  const tKey = today();
  const study = state.study ?? {};
  const avatarFile = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  /* ---- study-time analysis (engine/study.ts owns every rule; this page only reads) ---- */
  const series = useMemo(() => daySeries(study, SPAN_DAYS, tKey), [study, tKey]);
  // A year, not three months: the grid is the only place a learner can see the shape of their habit. All
  // of its figures come windowed from the engine, so the card cannot print "this year" and an all-time
  // number on the same line.
  const year = useMemo(() => heatmapYear(study, tKey), [study, tKey]);
  const weekdays = useMemo(() => weekdayProfile(study, tKey), [study, tKey]);
  const totals = useMemo(() => studyTotals(study), [study]);
  const week = useMemo(() => weekTotals(study, tKey), [study, tKey]);
  const streak = useMemo(() => studyStreak(study, tKey), [study, tKey]);
  const best = useMemo(() => topDays(study, 1)[0] ?? null, [study]);

  const todaySeconds = study[tKey] ?? 0;
  const target = Math.max(15, state.profile.dailyMinutes || 60);
  const targetPct = Math.round((Math.min(target * 60, todaySeconds) / (target * 60)) * 100);

  const overall = Math.round(sections.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / Math.max(1, sections.length));
  const bank = bankAccuracy(state);
  const bySection = bankAccuracyBySection(state);
  const interview = interviewAccuracy(state);
  const mastered = sections.filter((s) => isMastered(s, state)).length;
  const level = levelForXp(state.xp);
  const levelPct = Math.round(levelProgress(state.xp) * 100);

  /** Points to the next level — the ring on the profile card is about XP, not about mastery. */
  const toNextLevel = XP_PER_LEVEL - (state.xp % XP_PER_LEVEL);

  const trackRows = TRACKS.map((t) => {
    const secs = sections.filter((s) => s.no >= t.from && s.no <= t.to);
    const pct = Math.round(secs.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / Math.max(1, secs.length));
    let graded = 0, correct = 0;
    for (const s of secs) {
      const a = bySection[s.id];
      if (!a) continue;
      graded += a.graded; correct += a.correct;
    }
    return { ...t, pct, accPct: graded ? Math.round((100 * correct) / graded) : null, graded };
  });

  /** Weakest first, GRADED answers only (see the guard in the JSX below — this shape is pinned). */
  const rows = trackRows.filter((r) => r.graded > 0).sort((a, b) => (a.accPct ?? 0) - (b.accPct ?? 0));
  const weekdayPeak = Math.max(1, ...weekdays.map((w) => w.avgSeconds));

  async function onPickAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarError(null);
    try {
      setAvatar(await toAvatar(file));
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : 'photo load nahi hui');
    }
  }

  return (
    <div>
      {/* ---------- profile ---------- */}
      <div className="card dash-hero">
        <div className="dash-id">
          <button
            className="dash-avatar"
            onClick={() => avatarFile.current?.click()}
            title={state.profile.avatar ? 'Photo badlo' : 'Photo lagao'}
            aria-label={state.profile.avatar ? 'Change profile photo' : 'Add a profile photo'}
          >
            {state.profile.avatar
              ? <img src={state.profile.avatar} alt="" width={72} height={72} />
              : <span className="init">{(state.profile.name || '?').slice(0, 1).toUpperCase()}</span>}
            {state.profile.avatar
              ? <span className="pick pick-x" title="Photo hatao" onClick={(e) => { e.stopPropagation(); setAvatar(''); }}>
                  <Trash2 size={13} />
                </span>
              : <span className="pick"><Camera size={13} /></span>}
          </button>
          <input
            ref={avatarFile}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onPickAvatar(f); }}
          />
          <div className="dash-idtext">
            <h1>{state.profile.name || 'Learner'}</h1>
            <div className="row small muted" style={{ gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              <span className="chip">⭐ Level {level} · {levelPct}%</span>
              <span className="chip">{state.xp} XP</span>
              <span className="chip">{state.profile.goal}</span>
              {avatarError && <span className="small" style={{ color: 'var(--red)' }}>{avatarError}</span>}
            </div>
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              Study time is measured while the app is open and being used, and saved per day — the
              grid below is that record, not an estimate.
            </p>
          </div>
        </div>

        <div className="dash-target">
          <ProgressRing pct={targetPct} size={104} label={`Aaj ${formatDuration(todaySeconds)} / target ${target}m`} />
          <div className="small muted" style={{ textAlign: 'center', marginTop: 4 }}>
            Aaj {formatDuration(todaySeconds)} / {target}m target
          </div>
          <div className="row small muted" style={{ gap: 6, justifyContent: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <span className="chip"><Flame size={11} /> {streak} din streak</span>
            <span className="chip">Next level: {toNextLevel} XP</span>
          </div>
        </div>
      </div>

      {/* ---------- the four numbers a dashboard owes you ---------- */}
      <div className="kpi-row">
        <div className="kpi tone-cyan">
          <span className="ic"><Clock size={15} /></span>
          <div><div className="n">{formatDuration(todaySeconds)}</div><div className="l">aaj padha</div></div>
        </div>
        <div className="kpi tone-blue">
          <span className="ic"><CalendarRange size={15} /></span>
          <div><div className="n">{formatDuration(week.thisWeek)}</div><div className="l">pichhle 7 din</div></div>
        </div>
        <div className="kpi tone-amber">
          <span className="ic"><Flame size={15} /></span>
          <div><div className="n">{streak} din</div><div className="l">study streak</div></div>
        </div>
        <div className="kpi tone-green">
          <span className="ic"><BookOpenCheck size={15} /></span>
          <div><div className="n">{mastered}/{sections.length}</div><div className="l">sections mastered</div></div>
        </div>
        <div className="kpi tone-violet">
          <span className="ic"><Trophy size={15} /></span>
          <div><div className="n">{state.xp}</div><div className="l">total XP</div></div>
        </div>
      </div>

      {/* ---------- study time ---------- */}
      <div className="card">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h3 className="row" style={{ gap: 8, margin: 0 }}><Clock size={16} color="var(--cyan)" /> Study time (last {SPAN_DAYS} days)</h3>
          <span className="row" style={{ gap: 8 }}>
            <span className="chip easy">{formatDuration(week.thisWeek)} is hafte</span>
            {
              /* No percentage against a week of zero: `deltaPct` is null there, and "+100%" would be
                 a number the learner never earned. */
              week.deltaPct !== null
                ? <span className={`chip ${week.deltaPct >= 0 ? 'easy' : 'hard'}`}>{week.deltaPct >= 0 ? '+' : ''}{week.deltaPct}% vs pichhla hafta</span>
                : <span className="chip">pehla hafta</span>
            }
          </span>
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>
          Bars = us din kitna padha. <b className="muted">Patli amber strip</b> = us din ka XP.
          Sirf wahi time ginta hai jab app khula ho aur aap chaalu ho — idle ya background tab add nahi hota.
        </p>

        <StudyChart series={series} xp={state.activity} />

        <div className="row spread" style={{ marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
          <div className="row small muted" style={{ gap: 14, flexWrap: 'wrap' }}>
            <span>Total: <b>{formatDuration(totals.seconds)}</b></span>
            <span>Active din: <b>{totals.activeDays}</b></span>
            <span>Best: <b>{best ? `${formatDuration(best.seconds)} · ${best.key}` : '—'}</b></span>
            <span>Avg (active din): <b>{formatDuration(totals.avgActiveSeconds)}</b></span>
          </div>
          <ManualLog />
        </div>
      </div>

      {/* ---------- consistency: the heat grid + which days actually get used ---------- */}
      <div className="card">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h3 className="row" style={{ gap: 8, margin: 0 }}><Activity size={16} color="var(--green)" /> Consistency (1 saal)</h3>
          <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className={`chip${year.activeDays > 0 ? ' easy' : ''}`}>{year.activeDays} / {year.days} din active</span>
            <span className="chip">{year.longestRun} din ki sabse lambi streak</span>
          </span>
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>
          Ek cell = ek din, ek column = ek hafta (Som se Som). Kaunsa din kitna padha, pura saal ek nazar me —
          <b> {formatDuration(year.totalSeconds)}</b> {year.from} se {year.to} tak
          {year.busiest && <> · best din <b>{year.busiest.key}</b> ({formatDuration(year.busiest.seconds)})</>}.
        </p>

        {/* One grid for the whole year: the weekday letters are a real first column and the month row a
            real first row, so a label sits above its own week without a hand-tuned offset. */}
        <div className="heat-wrap">
          <div
            className="heat-year"
            role="img"
            aria-label={`Study heat map, ${year.from} to ${year.to}: ${year.activeDays} active days, longest run ${year.longestRun} days`}
            style={{ gridTemplateColumns: `var(--heat-gutter) repeat(${year.weeks.length}, var(--heat-cell))` }}
          >
            {year.months.map((m) => (
              <span className="heat-month" aria-hidden="true" key={`${m.label}-${m.col}`} style={{ gridColumn: m.col + 2, gridRow: 1 }}>{m.label}</span>
            ))}
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span className="heat-daylabel" aria-hidden="true" key={i} style={{ gridColumn: 1, gridRow: i + 2 }}>{d}</span>
            ))}
            {year.weeks.map((w, col) => w.cells.map((c, row) => (
              <div
                key={c.key}
                className={`heat-cell l${c.level}${c.past ? '' : ' future'}`}
                style={{ gridColumn: col + 2, gridRow: row + 2 }}
                title={c.past ? `${c.key} — ${formatDuration(c.seconds)}` : `${c.key} — abhi aaya nahi`}
              />
            )))}
          </div>
        </div>
        <div className="row spread small muted" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
          <span className="row" style={{ gap: 6 }}>
            <span>kam</span>
            {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`heat-cell l${l}`} />)}
            <span>zyada</span>
          </span>
          <span>1 cell = 1 din · level 15m / 45m / 1.5h+ · bhare hue din hi padhe hue din hain</span>
        </div>

        <div className="sec-line" />
        <div className="row spread small" style={{ marginBottom: 6 }}>
          <b>Kis din padhte ho</b>
          <span className="muted">average per din</span>
        </div>
        <div className="weekday-row">
          {weekdays.map((w, i) => (
            <div className="weekday" key={i} title={`${DAY_LABEL[i]} — avg ${formatDuration(w.avgSeconds)} (${w.days} din)`}>
              <div className="bar-v"><i style={{ height: `${Math.round((w.avgSeconds / weekdayPeak) * 100)}%` }} /></div>
              <span>{DAY_SHORT[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- mastery + accuracy, side by side ---------- */}
      <div className="grid2 dash-bottom">
        <div className="card" style={{ margin: 0 }}>
          <h3 className="row" style={{ gap: 8, margin: 0 }}><Trophy size={16} color="var(--violet)" /> Mastery by track</h3>
          <div className="row" style={{ gap: 14, marginTop: 10 }}>
            <ProgressRing pct={overall} size={78} label="Overall mastery" />
            <div className="small muted" style={{ flex: 1, minWidth: 0 }}>
              Overall {overall}% · {mastered} mastered sections. Ye mastery hai (padha + practice + sach me pass),
              upar wale hours sirf time ginte hain.
            </div>
          </div>
          {trackRows.map((t) => (
            <div key={t.name} className={`trackline tone-${t.tone}`} style={{ margin: '9px 0' }}>
              <div className="row spread small"><span>{t.name}</span><span>{t.pct}%</span></div>
              <div className="bar tone-fill"><div style={{ width: `${t.pct}%` }} /></div>
            </div>
          ))}
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div className="row spread">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><Percent size={16} color="var(--green)" /> Answer accuracy</h3>
            <span className="chip">{accuracyLine(bank)}</span>
          </div>
          <p className="muted small" style={{ marginTop: 4 }}>
            Percentage = tumhare <b>khud grade kiye</b> answers me se kitne sahi. Rubric average = likhe
            answers ka model answer se keyword match (wahi rubric jo Interview Mode aur mock rounds use karte hain).
          </p>
          <div className="row" style={{ gap: 12, margin: '10px 0' }}>
            {/* Empty ring until something is graded, and it says so: `text` keeps it from printing
                "0%", which would be a verdict on answers the learner never graded. */}
            <ProgressRing pct={bank.pct ?? 0} size={84} label={accuracyLine(bank)} text={pctText(bank.pct)} />
            <div className="statgrid" style={{ flex: 1 }}>
              <div className="stat"><div className="n">{pctText(bank.pct)}</div><div className="l">accuracy ({bank.correct}/{bank.graded} sahi)</div></div>
              <div className="stat"><div className="n">{pctText(bank.avg)}</div><div className="l">rubric avg</div></div>
              <div className="stat"><div className="n">{pctText(interview.pct)}</div><div className="l">interview ({interview.answered})</div></div>
              <div className="stat"><div className="n">{bank.answered}</div><div className="l">total answers</div></div>
            </div>
          </div>
          {(() => {
            // The point of an accuracy figure is knowing where to go next, so it is ranked on GRADED
            // answers only — a track where answers were written but none graded has no percentage,
            // and a "(0/0 sahi) —" row would read as the weakest track. Nothing to rank, no block.
            if (!rows.length) return null;
            return (
              <>
                <div className="small muted">Track wise (sabse kamzor pehle)</div>
                {rows.map((r) => (
                  <div key={r.name} style={{ margin: '8px 0' }}>
                    <div className="row spread small">
                      <span>{r.name} <span className="muted">({r.graded} graded)</span></span>
                      <span>{pctText(r.accPct)}</span>
                    </div>
                    <Bar pct={r.accPct ?? 0} />
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      </div>

      <div className="card">
        <h3>Data</h3>
        <p className="small muted">
          Sab kuch browser me hai (localStorage) — study log bhi. Export se backup ya device badal sakte ho;
          import purana data wapas laata hai (naye din jud jaate hain, mitaaye nahi jaate).
        </p>
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

/**
 * Manual time entry.
 *
 * The tracker can only measure days the app was open, so a learner who studied on paper, or in
 * another editor, has no way to say so. This writes the SAME day bucket through the same store
 * action — it is data entry, not a second source of truth — and it is also how a fresh install gets
 * any history at all.
 */
function ManualLog() {
  const [date, setDate] = useState(today());
  const [minutes, setMinutes] = useState('');
  const value = Number(minutes);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && isFinite(value) && value > 0 && value <= 24 * 60;

  const add = () => {
    if (!valid) return;
    addStudySeconds(Math.round(value * 60), date);
    setMinutes('');
  };

  return (
    <div className="row manual-log" style={{ gap: 6 }}>
      <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Din" />
      <input
        type="number"
        min={1}
        max={1440}
        placeholder="min"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        style={{ width: 78 }}
        aria-label="Minutes"
      />
      <button className="btn small" disabled={!valid} onClick={add}><Plus size={13} /> Log karo</button>
      {date !== today() && <span className="small muted">purane din me add hoga</span>}
      {date === today() && <span className="small muted">aaj ke log me judega</span>}
    </div>
  );
}
