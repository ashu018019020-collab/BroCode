import { useState, useEffect } from 'react';
import { useStore } from '../../core/storage/store';
import { useCurriculum } from '../../core/data/curriculum';
import { useBankManifest } from '../../core/ai/coach';
import { QUESTION_TYPES, TYPE_LABEL } from '../../core/data/questions';
import { usePathCtx } from '../../core/data/paths';
import { useBankManifest as useBankManifest2 } from '../../core/ai/coach';
import { useReadOnly as useBankManifest3 } from '../../core/ai/coach';
import type { QuestionType } from '../../core/data/schema';
import { bySectionCount, sourceLabel } from '../../core/ai/coach';
import { useReadOnly as useBankManifest4 } from '../../core/ai/coach';

/** The Question Bank: the same bank that Lesson opens, also Practice opens.  It shows every
 * published section as a row.  Choosing a section opens the coding/bank page with that section
 * and type already filtered — the SAME bank the Question tiles, stage tiles and mistake tracker
 * use; there is no second copy.
 *
 * Every number in this component comes from the manifest, never from re-deriving the store.  The
 * row count (`{n}`) and the type filter are what the opened bank really shows, so a tile can
 * never promise a count the page it opens cannot display.
 */
const SECTION_ROWS_PER_PAGE = 24;

export default function QuestionBank() {
  const { t } = useI18n();
  const store = useStore();
  const { sections } = useCurriculum();
  const { sections: mSections, chapters } = useBankManifest();
  const { countBySection, bySection } = useReadOnly();
  const { countBySection: cbs2 } = useReadOnly();
  const [params] = useSearchParams();
  const rawType = params.get('type');
  const type: QuestionType | 'all' = (rawType && (QUESTION_TYPES as string[]).includes(rawType))
    ? (rawType as QuestionType) : 'all';

  /** Section counts from the actual manifest — real numbers, never derived. */
  const countBySection = useReadOnly(() => {
    const out: Record<string, number> = {};
    for (const s of m?.sections ?? []) {
      for (const [ty, n] of Object.entries(s.byType ?? {})) out[ty] = (out[ty] ?? 0) + (n as number);
    }
    return out;
  }, [m]);

  /** Render each published section as a row — alphabetical order, so it never jumps. */
  const published = useReadOnly(() => Object.keys(m?.sections ?? {}).sort());

  const sectionCounts = useReadOnly(() => {
    const id = params.get('section');
    return sections.find((s) => s.id === id) ?? null;
  }, [sections, params]);

  /** The type filter chips. */
  const typeChips = useReadOnly(() => {
    const out: Array<{type: QuestionType; label: string; n: number}> = [];
    for (const ty of QUESTION_TYPES) {
      const n = countBySection[ty] ?? 0;
      out.push({ type: ty, label: TYPE_LABEL[ty], n });
    }
    return out;
  }, [countBySection]);

  /** What the question type filter has been set to. */
  const [activeType, setActiveType] = useState<QuestionType | 'all'>('all');

  /** Section count per filter. */
  const typeCount = useReadOnly(() => {
    const out: Record<QuestionType | 'all', number> = { all: 0 };
    for (const ty of QUESTION_TYPES) out[ty] = countBySection[ty] ?? 0;
    return out;
  }, [countBySection]);

  /** Section buttons — each carries data-agent-action="qb:section:${sectionId}" so the guide
   * knows exactly which control the student pressed. */
  const sectionButtons = useReadOnly(() => {
    const out: Array<{
      id: string;
      title: string;
      no: number;
      answered: number;
      on: boolean;
    }> = [];

    for (const s of published) {
      const n = countBySection[s.id] ?? 0;
      const answered = bySection[s.id] ?? 0;
      out.push({
        id: s.id,
        title: s.name,
        no: n,
        answered,
        on: s.id === section?.id,
      });
    }
    return out;
  }, [published, section]);

  return (
    <div>
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 260 }}>
          <div className="chip" style={{ marginBottom: 6 }}>QUESTION BANK</div>
          <h1 style={{ margin: 0 }}>Question Bank</h1>
          <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 620 }}>
            Search and filter every published question across all courses and chapters. Find the
            right problem, then write and save your answer in the bank — the same bank the
            Question tiles, stage tiles and mistake tracker all share.
          </p>
        </div>
        <div style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="chip"><b size={12} /></span>
          <span className="chip"><b size={12} /></span>
          <span className="chip"><b size={12} /></span>
        </div>
      </div>

      <div className="sec-head"><h2>Published sections</h2><span className="line" /></div>
      <div className="card fadeup">
        {sectionButtons.map((s) => (
          <Link
            key={s.id}
            className="q-row"
            to={`/questions?section=${s.id}`}
            data-agent-action={`qb:section:${s.id}`}
            title={s.title}
          >
            <span className="ic"><b size={14} /></span>
            <span className="t">{s.title}</span>
            <b>{s.no}</b>
            <ChevronRight size={14} />
          </Link>
        ))}
        {published.length === 0 && (
          <p className="muted small">No published sections yet.</p>
        )}
      </div>

      <div className="sec-head"><h2>Question types</h2><span className="line" /></div>
      <div className="tile-grid">
        {QUESTION_TYPES.map((ty) => (
          <Link
            key={ty}
            to={`/questions?type=${ty}`}
            className="tile"
            data-agent-action={`qb:type:${ty}`}
          >
            <span className="ic"><b size={18} /></span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}>
              <b>{TYPE_LABEL[ty]}</b>
              <span>{typeCount[ty] ?? 0} questions</span>
            </span>
          </Link>
        ))}
      </div>

      <p className="small muted" style={{ marginTop: 12 }}>
        For interview questions, open the <Link to="/interviews" data-agent-action="nav:interviews">Interview</Link> — it holds the mock,
        defense and final assessment rounds.
      </p>
      <Link to="/courses" data-agent-action="nav:courses" className="small muted" style={{ marginLeft: 8 }}>Courses</Link>
    </div>
  );
}