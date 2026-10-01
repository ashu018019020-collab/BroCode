import { useMemo } from 'react';
import { useCurriculum } from './curriculum';
import { useStore } from '../storage/store';
import {
  LAB_ATTEMPT_PREFIX, NOTEBOOK_PREFIX, codeSlot, finalPart, labAttempt, learnView,
  levelForXp, resumeDefenseAnswer, stageAttempt,
} from '../platform/keys';
import { dueReview } from '../learning/review';
import { bankPractised, bankTouched } from '../learning/coverage';
import { interviewAccuracy } from '../assessment/accuracy';
import { playbookPractised } from '../assessment/playbook';
import { loadNotebooks, loadPlaybookIndex, loadPlaybookItems, loadPublished, useAsync } from './playbook';
import type { PathCtx } from '../learning/paths';

/**
 * Builds the numbers the extra-path cards print.
 *
 * This is the ONLY place that knows how a stored key is shaped for the path cards, and it takes
 * every shape from `core/platform/keys.ts` — the module that owns them — instead of hand-typing strings.
 * `core/learning/paths.ts` stays pure (it just reads the bag), which is what lets the test prove the
 * arithmetic without a browser or a localStorage.
 */

/** `${head}:` — the family prefix of a key built by core/platform/keys.ts. */
const family = (key: string, segments = 1) => `${key.split(':').slice(0, segments).join(':')}:`;

const PFX = {
  notebook: NOTEBOOK_PREFIX,
  mock: labAttempt('mock', ''),
  rag: labAttempt('rag', ''),
  playground: family(codeSlot.playgroundPython),
  sql: family(codeSlot.sqlLab),
  npLab: family(codeSlot.npLab('', '')),
  resume: family(resumeDefenseAnswer('', 0)),
  final: family(finalPart(''), 2),
} as const;

const keysWith = (record: Record<string, unknown>, prefix: string) =>
  Object.keys(record).filter((k) => k.startsWith(prefix));

export function usePathCtx(): PathCtx {
  const { sections, extras } = useCurriculum();
  const state = useStore();
  const pbIndex = useAsync(loadPlaybookIndex);
  const pbItems = useAsync(loadPlaybookItems);
  const published = useAsync(loadPublished);
  const notebooks = useAsync(loadNotebooks);

  const { attempts, savedCode, defenseAnswers, bookmarks, jobPrep } = state;

  return useMemo(() => {
    const list = pbItems?.items ?? null;

    const finalParts = new Set(
      keysWith(attempts, PFX.final).map((k) => k.slice(PFX.final.length).split(':').slice(0, -1).join(':')),
    ).size;

    const gates = (stage: string) => sections.filter((s) => !!attempts[stageAttempt(s.id, stage as 'project' | 'defense')]).length;
    const readSections = sections.filter((s) => !!attempts[learnView(s.id)]).length;

    return {
      sections: sections.map((s) => ({ id: s.id, no: s.no, title: s.title })),
      readSections,
      projectGates: gates('project'),
      defenseGates: gates('defense'),
      counts: {
        bankPractised: bankPractised(attempts),
        interviewPct: interviewAccuracy(state).pct,
        // Both places an interview answer can live: the lesson's own stage (`ia:` written into
        // state.interviewAnswers) and the standalone page's scored records (`lab:interview:`).
        interviewAnswers: Object.keys(state.interviewAnswers).length + keysWith(attempts, `${LAB_ATTEMPT_PREFIX}interview:`).length,
        notes: state.notes.length,
        mistakesOpen: state.mistakes.filter((m) => !m.fixed).length,
        mistakesTotal: state.mistakes.length,
        reviewDue: dueReview(state).length,
        mockDone: keysWith(attempts, PFX.mock).filter((k) => attempts[k].done === true).length,
        ragRounds: keysWith(attempts, PFX.rag).length,
        npSlots: keysWith(savedCode, PFX.npLab).length,
        playgroundSlots: keysWith(savedCode, PFX.playground).length,
        sqlSlots: keysWith(savedCode, PFX.sql).length,
        notebookCells: keysWith(attempts, PFX.notebook).filter((k) => attempts[k].done === true).length,
        resumeAnswers: Object.keys(defenseAnswers).filter((k) => k.startsWith(PFX.resume)).length,
        finalParts,
        jobPrepDone: Object.values(jobPrep).filter(Boolean).length,
        // The same engine helper the Playbook band uses, so this card and the band cannot disagree.
        playbookPractised: list ? playbookPractised(list, (id) => bankTouched(attempts, id)) : null,
        xp: state.xp,
        level: levelForXp(state.xp),
        streak: state.streak.current,
        bookmarksGuide: bookmarks.filter((b) => !b.id.startsWith('pb')).length,
        bookmarksPlaybook: bookmarks.filter((b) => b.id.startsWith('pb')).length,
      },
      published,
      // Item counts come from items.json (the banks — what a learner can really open). The
      // manifest's own tally is the document's OFFER, one higher: the import refused a question
      // whose text another bank already owned, and a denominator of 477 would make 100%
      // unreachable for a learner who finished all 476.
      playbook: pbIndex
        ? {
          pages: pbIndex.pages,
          chapters: pbIndex.chapters.length,
          items: list ? list.length : pbIndex.totals.items,
          interview: list
            ? list.filter((it) => it.type === 'interview').length
            : (pbIndex.totals.byType.interview ?? 0),
          labs: pbIndex.totals.labs,
          miniProjects: pbIndex.totals.miniProjectBlueprints + pbIndex.totals.miniProjectCapstones,
          methodAnswers: pbIndex.totals.methodAnswers,
        }
        : null,
      notebooks,
      mockTotal: extras.mockInterview.reduce((a, r) => a + r.questions.length, 0) + (extras.intensive?.length ?? 0),
    };
    // `state` is a new object on every store write, so its fields need no separate deps here.
  }, [sections, extras, state, published, pbIndex, pbItems, notebooks]);
}
