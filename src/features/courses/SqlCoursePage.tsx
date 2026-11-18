import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { CourseLogo } from '../../components/shared/CourseLogo';
import { useSqlMasterclass } from '../../core/data/sqlmasterclass';
import { masterclassHref, masterclassSelection, type MasterclassBank, type MasterclassLevel } from '../../core/learning/masterclass';
import { MasterclassPanel } from '../labs/SqlMasterclass';

/**
 * /course/sql — the SQL catalog course, backed by the published SQL Masterclass.
 *
 * The catalog's SQL record owns one roadmap step, but the full course is the 37-module
 * masterclass. The shared panel owns the module/topic list, progress and outcomes, so this page
 * only supplies the course header and opens that panel by default.
 *
 * The open module and bank live in the URL (`?module=sql13&bank=logic`), so a refresh or a shared
 * link reopens the same place — and the SQL Lab reads the same two params.
 */
export default function SqlCoursePage() {
  const file = useSqlMasterclass();
  const [params, setParams] = useSearchParams();
  const selection = masterclassSelection(params, file?.modules ?? []);
  /** Functional update: one click can change two parts (a chip opens its module and resets the bank). */
  const select = (next: { moduleId?: string; bank?: MasterclassBank; level?: MasterclassLevel }) =>
    setParams((current) => masterclassHref(current, next), { replace: true });

  if (!file) {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 320, marginTop: 12 }} />
      </div>
    );
  }

  const { course } = file;

  return (
    <div>
      <Link
        to="/courses"
        className="small muted"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 8 }}
      >
        <ChevronLeft size={13} /> All courses
      </Link>

      <div className="card glow fadeup tone-orange">
        <div className="row" style={{ gap: 12, minWidth: 'min(260px, 100%)' }}>
          <CourseLogo logo="postgresql" name="SQL" size={64} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0 }}>{course.title}</h1>
          </div>
        </div>
        <p className="small muted" style={{ margin: '12px 0 0', maxWidth: 860 }}>{course.description}</p>
      </div>

      <MasterclassPanel
        file={file}
        defaultOpen
        moduleId={selection.moduleId}
        bank={selection.bank}
        level={selection.level}
        onModuleChange={(moduleId) => select({ moduleId })}
        onBankChange={(bank) => select({ bank })}
        onLevelChange={(level) => select({ level })}
      />
    </div>
  );
}
