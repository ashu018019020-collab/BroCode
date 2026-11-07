/**
 * THE PROJECT LAB, AS DATA.
 *
 * `/projects` already had every project brief, but the screen flattened them into one card shape and
 * read the build gate as `attempt.done`. Three problems lived in that shape, none of them visible
 * until the page was asked to answer a learner's real question — "which build, in what order, and
 * have I defended it?":
 *
 *   1. `done` is not the curriculum's gate. `stagePassed` is "the record EXISTS", because a scored
 *      project record can be `{score, tries}` with no `done` flag at all. Asking for `.done` quietly
 *      dropped those builds, so a card said "not built" while Career counted it as done.
 *   2. Nothing on a card knew whether the section had been DEFENDED, even though the defense gate
 *      (`st:<sid>:defense`) and its score are stored by the lesson's own defense stage.
 *   3. The authored build material (files, architecture, build target, edge cases, the question a
 *      reviewer asks) was scattered across an expandable panel in arbitrary order, so "follow the
 *      build" was really "read six fragments".
 *
 * This module owns all three, as plain data: the page renders it, the tests drive it, and the gate
 * rule is imported (`stageAttempt`) rather than re-spelled. Pure — no React, no store.
 */
import type { Attempt, Section } from '../../types';
import { labAttempt, stageAttempt } from '../platform/keys';

/** One authored beat of a build, in the order a learner actually works through it. */
export interface ProjectStep {
  /** 1-based reading order. Not a progress measure — progress is `built`. */
  no: number;
  label: string;
  detail: string;
}

export interface ProjectBrief {
  /** React key + anchor id (stable across renders). */
  key: string;
  /** Curriculum section this build belongs to. */
  sid: string;
  no: number;
  section: string;
  tier: string;
  name: string;
  what: string;
  files: string;
  architecture: string;
  /** The authored definition of done — also the tutor's "Done when:" line. */
  buildTarget: string;
  code: string;
  output: string;
  explanation: string;
  defenseQuestion: string;
  edgeCases: string[];
  /** The lesson stage that teaches this build. */
  route: string;
  /** The attempt key the "mark built" button writes. */
  stageKey: string;
  /**
   * The build gate record exists — `stagePassed`'s rule, not `.done`. A scored record counts.
   * NOTE: one gate per SECTION per stage, exactly as the curriculum writes it, so every project-lab
   * item in a section shares this flag. Changing that would orphan stored keys.
   */
  built: boolean;
  /** The section's defense gate record exists. */
  defended: boolean;
  /** The stored defense score, or null when the defense was never scored. */
  defenseScore: number | null;
  /** The authored material, numbered. Empty strings are omitted, never rendered as a blank beat. */
  steps: ProjectStep[];
}

/**
 * One section's defense gate, read from `st:<sid>:defense` — the record the lesson's own defense
 * stage writes (`Lesson.tsx` scores it out of 100).
 */
export interface DefenseGate {
  sid: string;
  no: number;
  section: string;
  /** How many buildable projects the section owns (mini + Project Lab items). */
  builds: number;
  /** The gate record EXISTS — the same rule the build cards print, so a 40% defense is still "done". */
  defended: boolean;
  /** The stored score, or null when the defense was recorded without one. */
  score: number | null;
  route: string;
}

/**
 * The ONE reading of a section's defense record. The build cards and the Defense page both call it,
 * so a defense cannot read as done on one screen and pending on the other.
 */
export function defenseOf(
  attempts: Record<string, Attempt>,
  sid: string,
): { defended: boolean; score: number | null } {
  const record = attempts[stageAttempt(sid, 'defense')];
  return { defended: !!record, score: record?.score ?? null };
}

/**
 * Every section that owns a build, with the defense record its lesson stage stored.
 *
 * Sections with nothing to build are excluded rather than listed as "pending": a defense is only
 * owed after a build, and a row for a section that never asked for one would be a denominator the
 * curriculum does not have.
 */
export function buildDefenses(
  sections: Section[],
  attempts: Record<string, Attempt>,
): DefenseGate[] {
  const out: DefenseGate[] = [];
  for (const s of sections) {
    const builds = (s.mini?.what ? 1 : 0) + (s.projectLab ?? []).length;
    if (!builds) continue;
    const { defended, score } = defenseOf(attempts, s.id);
    out.push({
      sid: s.id,
      no: s.no,
      section: s.title,
      builds,
      defended,
      score,
      route: `/lesson/${s.id}/defense`,
    });
  }
  return out;
}

export interface ProjectSummary {
  total: number;
  built: number;
  defended: number;
  /** Builds complete as a percentage; 0 (never NaN) when there is nothing to build. */
  pct: number;
}

interface BuildInput {
  what: string;
  files: string;
  architecture: string;
  buildTarget: string;
  edgeCases: string[];
  defenseQuestion: string;
}

/**
 * The authored build path, in reading order: the problem, the files to create, the pipeline, the
 * definition of done, what to break, and the question a reviewer will ask. Nothing is generated —
 * each beat is a field the curriculum already authored, and an empty field is skipped rather than
 * printed as a placeholder.
 */
export function buildPath(input: BuildInput): ProjectStep[] {
  const rows: Array<[string, string]> = [
    ['What you build', input.what],
    ['Files', input.files],
    ['Architecture', input.architecture],
    ['Build target', input.buildTarget],
    ['Edge cases', input.edgeCases.join(' · ')],
    ['Explain it', input.defenseQuestion],
  ];
  return rows
    .filter(([, detail]) => !!detail)
    .map(([label, detail], i) => ({ no: i + 1, label, detail }));
}

/**
 * Every buildable project in the curriculum, with its real gate and defense status.
 *
 * Mini projects and Project Lab items are both included; the mini project's own gate is
 * `st:<sid>:mini`, a lab item's is `st:<sid>:project` (the section-level gate the curriculum
 * writes). `attempts` is `state.attempts` — the module never reads the store.
 */
export function projectBriefs(
  sections: Section[],
  attempts: Record<string, Attempt>,
): ProjectBrief[] {
  const out: ProjectBrief[] = [];

  for (const s of sections) {
    const { defended, score: defenseScore } = defenseOf(attempts, s.id);

    const mini = s.mini;
    if (mini?.what) {
      const stageKey = stageAttempt(s.id, 'mini');
      out.push({
        key: `mini:${s.id}`,
        sid: s.id,
        no: s.no,
        section: s.title,
        tier: 'Mini Project',
        name: mini.name || `Mini project · ${s.title}`,
        what: mini.what,
        files: mini.files,
        architecture: mini.architecture,
        buildTarget: mini.buildTarget,
        code: mini.code,
        output: mini.output,
        explanation: mini.explanation,
        defenseQuestion: mini.interview,
        edgeCases: mini.edgeCases ?? [],
        route: `/lesson/${s.id}/mini`,
        stageKey,
        built: !!attempts[stageKey],
        defended,
        defenseScore,
        steps: buildPath({
          what: mini.what,
          files: mini.files,
          architecture: mini.architecture,
          buildTarget: mini.buildTarget,
          edgeCases: mini.edgeCases ?? [],
          defenseQuestion: mini.interview,
        }),
      });
    }

    (s.projectLab ?? []).forEach((p, i) => {
      const stageKey = stageAttempt(s.id, 'project');
      out.push({
        key: labAttempt(s.id, i),
        sid: s.id,
        no: s.no,
        section: s.title,
        tier: p.tier || 'Project Lab',
        name: p.name,
        what: p.what,
        files: p.files,
        architecture: p.architecture,
        buildTarget: p.buildTarget,
        code: p.code,
        output: '',
        explanation: p.followUp,
        defenseQuestion: p.defense,
        edgeCases: p.debugCue ? [p.debugCue] : [],
        route: `/lesson/${s.id}/project`,
        stageKey,
        built: !!attempts[stageKey],
        defended,
        defenseScore,
        steps: buildPath({
          what: p.what,
          files: p.files,
          architecture: p.architecture,
          buildTarget: p.buildTarget,
          edgeCases: p.debugCue ? [p.debugCue] : [],
          defenseQuestion: p.defense,
        }),
      });
    });
  }

  return out;
}

/**
 * Which build to open next.
 *
 * Prefers a section the learner has actually started (`masteryOf(sid) > 0`) — a build in a chapter
 * you have read is the one you can finish — and otherwise takes the first unbuilt project in
 * curriculum order, so a brand-new learner is never handed build #37. `null` means every build is
 * done; the page then says so instead of picking one anyway.
 */
export function nextBuild(
  briefs: ProjectBrief[],
  masteryOf: (sid: string) => number,
): ProjectBrief | null {
  const open = briefs.filter((b) => !b.built);
  if (!open.length) return null;
  return open.find((b) => masteryOf(b.sid) > 0) ?? open[0];
}

/** The three numbers the page header prints, from the same briefs the cards render. */
export function projectSummary(briefs: ProjectBrief[]): ProjectSummary {
  const total = briefs.length;
  const built = briefs.filter((b) => b.built).length;
  const defended = briefs.filter((b) => b.defended).length;
  return { total, built, defended, pct: total ? Math.round((built / total) * 100) : 0 };
}
