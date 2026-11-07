import { useMemo, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Database, Radio, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthProvider';
import { useCurriculum } from '../../core/data/curriculum';
import { useCourseIndex } from '../../core/data/courses';
import { useBankManifest } from '../../core/data/questions';
import { useNotebooks } from '../../core/data/notebooks';
import { useOwnerCourses } from '../../core/data/owner-courses';
import { contentHealth, type Severity } from '../../core/learning/content-health';
import { STEPS } from '../../core/learning/roadmap';
import { loadCourseAuditReport, type CourseAuditReport } from '../../core/data/course-audit';

/**
 * /admin/content — the owner's content & publishing centre.
 *
 * `/admin` owns accounts and the custom-card studio; this page owns the CATALOG view: what is
 * published, which real gaps the published registries have, and what to fix first. Every number and
 * every finding comes from `contentHealth()` (pure, tested) reading the same registries the learner
 * surfaces read — so the owner is looking at exactly what a learner gets, not a separate report.
 *
 * The guard mirrors `AdminUsersPage`: `Protect` only ensures a session, so the page itself sends a
 * non-administrator away. The server's role check is still the real gate; this is the UI half.
 */
const severityChip: Record<Severity, string> = {
  high: 'chip hard',
  medium: 'chip medium',
  low: 'chip',
};

const severityIcon: Record<Severity, typeof AlertTriangle> = {
  high: ShieldAlert,
  medium: AlertTriangle,
  low: Activity,
};

export default function OwnerContentPage() {
  const { user, loading } = useAuth();
  const { sections } = useCurriculum();
  const index = useCourseIndex();
  const banks = useBankManifest();
  const notebooks = useNotebooks();
  const owner = useOwnerCourses();

  const health = useMemo(() => contentHealth({
    courses: (index?.courses ?? []).map((course) => ({
      slug: course.slug,
      name: course.name,
      steps: course.steps.length,
      sections: Object.keys(course.sections).length,
      objectives: course.meta.objectives.length,
      prerequisites: course.meta.prerequisites.length,
      minutes: course.meta.minutes,
    })),
    sections: sections.map((section) => ({
      id: section.id,
      no: section.no,
      title: section.title,
      interview: section.interview.length,
      coding: section.coding.length,
      logic: section.logic.length,
      checkpoint: section.checkpoint.length,
      mini: !!section.mini?.what,
      builds: section.projectLab.length,
      bank: banks ? (banks.sections.find((entry) => entry.sectionId === section.id)?.published ?? 0) : null,
    })),
    stepsExpected: STEPS.length,
    bank: banks ? { total: banks.total, sections: banks.sections.length } : null,
    notebooks: notebooks ? notebooks.length : null,
    ownerCards: owner.rows
      ? owner.rows.map((row) => ({ slug: row.slug, name: row.name, hidden: row.hidden }))
      : null,
  }), [index, sections, banks, notebooks, owner.rows]);

  const [audit, setAudit] = useState<CourseAuditReport | null>(null);
  useEffect(() => {
    setAudit(loadCourseAuditReport());
  }, []);

  if (loading) {
    return (
      <div aria-busy="true">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 260, marginTop: 12 }} />
      </div>
    );
  }
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;

  const p = health.publishing;

  return (
    <div>
      {/* ------------------------------- hero ------------------------------- */}
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}><Database size={12} /> OWNER · CONTENT</div>
            <h1 style={{ margin: 0 }}>Content &amp; publishing</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 640 }}>
              What the catalog currently publishes and which real gaps it has — read from the same
              registries a learner loads. Nothing here is a separate report: if a finding says a section
              has no coding tasks, that is what the section page shows too.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <span className="chip">{p.courses} courses</span>
              <span className="chip">{p.steps} / {p.stepsExpected} steps</span>
              <span className="chip">{p.sections} sections</span>
              <span className={health.counts.high ? 'chip hard' : 'chip easy'}>
                {health.counts.high} high · {health.counts.medium} medium · {health.counts.low} low
              </span>
            </div>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn small" to="/admin">Accounts &amp; cards <ArrowRight size={12} /></Link>
            <Link className="btn small" to="/courses">View catalog <ArrowRight size={12} /></Link>
          </div>
        </div>
      </div>

      {/* --------------------------- publishing status --------------------------- */}
      <div className="sec-head"><h2><Radio size={16} color="var(--cyan)" /> Publishing status</h2><span className="line" /></div>
      <div className="card fadeup">
        <div className="oh-grid">
          <div className="oh-stat"><b>{p.courses}</b><span className="small muted">courses published</span></div>
          <div className="oh-stat"><b>{p.steps} / {p.stepsExpected}</b><span className="small muted">roadmap steps published</span></div>
          <div className="oh-stat"><b>{p.sections}</b><span className="small muted">curriculum sections</span></div>
          <div className="oh-stat">
            <b>{p.bankQuestions === null ? '—' : p.bankQuestions}</b>
            <span className="small muted">
              bank questions{p.bankSections === null ? ' (manifest not loaded)' : ` · ${p.bankSections} sections`}
            </span>
          </div>
          <div className="oh-stat">
            <b>{p.notebooks === null ? '—' : p.notebooks}</b>
            <span className="small muted">notebooks{p.notebooks === null ? ' (manifest not loaded)' : ''}</span>
          </div>
          <div className="oh-stat">
            <b>{p.ownerVisible === null ? '—' : `${p.ownerVisible} / ${(p.ownerVisible ?? 0) + (p.ownerHidden ?? 0)}`}</b>
            <span className="small muted">
              owner cards visible{p.ownerHidden === null ? ' (could not read)' : ` · ${p.ownerHidden} hidden`}
            </span>
          </div>
        </div>
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          A dash means the registry has not loaded or could not be read — it never means zero.
        </p>
      </div>

      {/* ---------------------------- course audit report ---------------------------- */}
      <div className="sec-head"><h2><Database size={16} color="var(--violet)" /> Course audit report</h2><span className="line" /></div>
      <div className="card fadeup">
        {audit ? (
          <>
            <div className="oh-grid">
              <div className="oh-stat"><b>{audit.courses}</b><span className="small muted">courses</span></div>
              <div className="oh-stat"><b>{audit.indexRange}</b><span className="small muted">index range</span></div>
              <div className="oh-stat"><b>{audit.sourceItems.toLocaleString()}</b><span className="small muted">source items</span></div>
              <div className="oh-stat"><b>{audit.migratedItems.toLocaleString()}</b><span className="small muted">migrated items</span></div>
              <div className="oh-stat"><b>{audit.indexEntries.toLocaleString()}</b><span className="small muted">index entries</span></div>
              <div className="oh-stat"><b>{audit.courseMinutes.toLocaleString()}</b><span className="small muted">course minutes</span></div>
            </div>
            <div className="oh-finding" style={{ marginTop: 12 }}>
              <span className="chip">{audit.metaProblems === 0 ? 'clean' : 'metadata'}</span>
              <div>
                <b className="small row" style={{ gap: 6 }}><CheckCircle2 size={13} /> Course metadata completeness</b>
                <div className="small muted">
                  {audit.metaProblems === 0
                    ? `${audit.courses}/${audit.courses} courses complete`
                    : `${audit.courses - audit.metaProblems}/${audit.courses} courses complete · ${audit.metaProblems} problems`}
                </div>
              </div>
            </div>
            <div className="oh-finding">
              <span className="chip">gaps</span>
              <div>
                <b className="small row" style={{ gap: 6 }}><ShieldAlert size={13} /> Roadmap index integrity</b>
                <div className="small muted">
                  index {audit.indexRange}
                  {audit.indexGaps.length === 0 && audit.indexDuplicates.length === 0
                    ? '· no gaps, no duplicate numbers'
                    : `· gaps: ${audit.indexGaps.length || 'none'} · duplicates: ${audit.indexDuplicates.length || 'none'}`}
                  {' · '}
                  {audit.unmappedItems === 0 && audit.unsorted.length === 0
                    ? 'every source item is mapped'
                    : `${audit.unmappedItems} unmapped · ${audit.unsorted.length ? audit.unsorted.slice(0, 3).join(', ') : 'no unsorted'}`}
                </div>
              </div>
            </div>
            <div className="oh-finding">
              <span className="chip">refs</span>
              <div>
                <b className="small row" style={{ gap: 6 }}><Radio size={13} /> Reference resolution</b>
                <div className="small muted">
                  unresolved refs: {audit.unresolvedRefs}
                  {audit.unresolvedRefs === 0 ? '· all tagged refs resolve' : `· first: ${audit.unsorted[0] ?? '—'}`}
                  {' · '}
                  true duplicates removed: {audit.trueDuplicatesRemoved || 'none'}
                  {' · '}
                  orphan items: {audit.orphanItems || 'none'}
                </div>
              </div>
            </div>
            <div className="oh-finding">
              <span className="chip">families</span>
              <div>
                <b className="small row" style={{ gap: 6 }}><Activity size={13} /> Published family counts</b>
                <div className="small muted">
                  steps {audit.families.steps}
                  {' · '}sections {audit.families.sections}
                  {' · '}tracks {audit.families.tracks}
                  {' · '}playbook {audit.families.playbook}
                  {' · '}questions {audit.families.questions.toLocaleString()}
                  {' · '}notebooks {audit.families.notebooks}
                  {' · '}projects {audit.families.projects}
                  {' · '}interviewPrep {audit.families.interviewPrep}
                </div>
              </div>
            </div>
            <div className="small muted" style={{ margin: '12px 0 0' }}>
              This report is published from `npm run audit:write` under `artifacts/course-audit-report.json`.
              It is read at the data boundary so the owner centre shows exactly the same numbers the
              course audit script prints.
            </div>
          </>
        ) : (
          <div className="small muted" style={{ marginTop: 8 }}>
            Course audit report not loaded yet.
          </div>
        )}
      </div>

      {/* ------------------------------ attention ------------------------------ */}
      <div className="sec-head"><h2><AlertTriangle size={16} color="var(--amber)" /> Needs attention</h2><span className="line" /></div>
      {health.attention.length === 0 ? (
        <div className="card fadeup row" style={{ gap: 10 }}>
          <CheckCircle2 size={18} color="var(--green)" />
          <span>No gaps found in the published registries.</span>
        </div>
      ) : (
        <div className="card fadeup">
          {health.attention.map((finding) => {
            const Icon = severityIcon[finding.severity];
            return (
              <div key={finding.id} className="oh-finding">
                <span className={severityChip[finding.severity]}>{finding.severity}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b className="small row" style={{ gap: 6 }}><Icon size={13} /> {finding.label}</b>
                  <div className="small muted">{finding.detail}</div>
                </div>
                <Link className="oh-go" to={finding.to}>Open <ArrowRight size={11} /></Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
