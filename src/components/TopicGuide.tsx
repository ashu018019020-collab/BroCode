import type { Concept } from '../types';
import { useI18n } from '../i18n';

/**
 * Renders the authored guide attached to a concept — the "CODE KAISE KARTE HAIN" layer:
 * what/why/where, how it works, syntax, runnable examples with a line-by-line reading,
 * step-by-step build instructions, mistakes, best practices, real-world use, practice,
 * interview Q&A, a mini challenge, a debugging task, related topics and revision.
 *
 * PDF-derived concepts have no guide and this renders nothing, so the extracted lesson
 * stays exactly as it was. Guide content is hand-written (never PDF-derived) and is
 * labelled as such.
 */
export function TopicGuide({ concept, compact = false }: { concept: Concept; compact?: boolean }) {
  const { t } = useI18n();
  const g = concept.guide;
  if (!g) return null;

  const levelLabel = (l: string) => t(`guide.level.${l}` as 'guide.level.basic');

  return (
    <div className="guide" style={{ marginTop: 10 }}>
      <div className="row spread" style={{ alignItems: 'center' }}>
        <b className="small">🛠️ {t('guide.howToCode')}</b>
        <span className="chip" title={t('badge.authoredHint')}>{t('guide.badge')}</span>
      </div>

      <div className="guide-grid">
        <div><b className="small">{t('guide.what')}</b><p className="small">{g.what}</p></div>
        <div><b className="small">{t('guide.why')}</b><p className="small">{g.why}</p></div>
        <div><b className="small">{t('guide.where')}</b><p className="small">{g.whereUsed}</p></div>
        <div><b className="small">{t('guide.prereq')}</b><p className="small">{g.prereqs.join(' · ')}</p></div>
      </div>

      <div style={{ marginTop: 8 }}>
        <b className="small">{t('guide.how')}</b>
        <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{g.howItWorks}</p>
        <b className="small">{t('guide.syntax')}</b>
        <pre className="codeblock"><code>{g.syntax}</code></pre>
      </div>

      {g.howToCode.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <b className="small">{t('guide.howToCode')}</b>
          {g.howToCode.map((h, i) => (
            <div key={i} className="card" style={{ padding: 8, marginTop: 6 }}>
              <b className="small">{t('guide.step')} {i + 1}: {h.step}</b>
              <p className="small muted" style={{ margin: '4px 0' }}>{h.detail}</p>
              {h.code && <pre className="codeblock" style={{ fontSize: '.72rem' }}><code>{h.code}</code></pre>}
            </div>
          ))}
        </div>
      )}

      {g.examples.map((ex, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          <span className="chip">{levelLabel(ex.level)}</span>
          <pre className="codeblock" style={{ fontSize: '.72rem' }}><code>{ex.code}</code></pre>
          {ex.output && (
            <p className="small">
              <b>{t('guide.output')}:</b> <code>{ex.output}</code>{' '}
              {ex.verified === false && <span className="muted small">(documented — bundled runtime me chalega)</span>}
            </p>
          )}
          <div className="small">
            <b>{t('guide.lineByLine')}:</b>
            <ol style={{ margin: '4px 0 0 18px' }}>
              {ex.explain.map((line, j) => <li key={j}>{line}</li>)}
            </ol>
          </div>
        </div>
      ))}

      <div className="guide-grid" style={{ marginTop: 8 }}>
        <div>
          <b className="small">⚠️ {t('guide.mistakes')}</b>
          <ul className="small" style={{ margin: '4px 0 0 18px' }}>{g.commonMistakes.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
        <div>
          <b className="small">✅ {t('guide.practices')}</b>
          <ul className="small" style={{ margin: '4px 0 0 18px' }}>{g.bestPractices.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <b className="small">{t('guide.realWorld')}</b>
        <p className="small">{g.realWorld}</p>
      </div>

      {g.practice.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <b className="small">✍️ {t('guide.practice')}</b>
          {g.practice.map((p, i) => <p key={i} className="small">{p.difficulty}: {p.text}</p>)}
        </div>
      )}

      {!compact && g.interview.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <b className="small">🎤 {t('guide.interview')}</b>
          {g.interview.map((q, i) => (
            <p key={i} className="small"><b>{q.q}</b><br /><span className="muted">{q.a}</span></p>
          ))}
        </div>
      )}

      <div className="guide-grid" style={{ marginTop: 8 }}>
        <div><b className="small">🧩 {t('guide.mini')}</b><p className="small">{g.miniChallenge}</p></div>
        <div><b className="small">🐞 {t('guide.debug')}</b><p className="small">{g.debugTask}</p></div>
      </div>

      <div style={{ marginTop: 8 }}>
        <b className="small">🔗 {t('guide.related')}</b>
        <p className="small muted">{g.related.join(' · ')}</p>
        <b className="small">🧾 {t('guide.revision')}</b>
        <ul className="small" style={{ margin: '4px 0 0 18px' }}>{g.revision.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <p className="small">💡 <b>{t('guide.tip')}:</b> {g.interviewTip}</p>
      </div>
    </div>
  );
}
