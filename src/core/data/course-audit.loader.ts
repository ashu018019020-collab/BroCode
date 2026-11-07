import type { CourseAuditReport } from '../learning/course-audit';

declare const RAW_REPORT: { default?: CourseAuditReport };
const _RAW_REPORT: { default?: CourseAuditReport } = RAW_REPORT;

/**
 * `artifacts/course-audit-report.json` is the single generated artifact for the course audit
 * report. The generator writes it from the same `build()` the suite asserts against, so the
 * owner content centre reads exactly the same numbers the audit prints.
 *
 * It is intentionally NOT under `public/generated/courses/`: that folder is the courses
 * generator's output tree, and the suite asserts that tree matches a fresh build byte-for-byte.
 * A hand-published artifact there would fail that assertion.
 */
export const loadCourseAuditReport = (): CourseAuditReport | null => {
  if (!_RAW_REPORT) return null;
  return _RAW_REPORT.default ?? null;
};
