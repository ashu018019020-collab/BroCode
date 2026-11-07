export type CourseAuditReport = {
  readonly sourceItems: number;
  readonly migratedItems: number;
  readonly families: {
    readonly steps: number;
    readonly sections: number;
    readonly tracks: number;
    readonly playbook: number;
    readonly questions: number;
    readonly notebooks: number;
    readonly projects: number;
    readonly interviewPrep: number;
  };
  readonly courses: number;
  readonly courseLevels: Record<string, number>;
  readonly courseMinutes: number;
  readonly metaProblems: number;
  readonly indexEntries: number;
  readonly indexRange: string;
  readonly indexGaps: readonly number[];
  readonly indexDuplicates: readonly number[];
  readonly trueDuplicatesRemoved: number;
  readonly orphanItems: number;
  readonly unmappedItems: number;
  readonly unresolvedRefs: number;
  readonly itemsWithRelated: number;
  readonly crossChapterItems: number;
  readonly problems: number;
  readonly unsorted: readonly string[];
  readonly resolvers: {
    readonly bankIds: number;
    readonly playbookIds: number;
    readonly notebookIds: number;
    readonly sectionIds: number;
    readonly trackIds: number;
    readonly projects: number;
    readonly mocks: number;
    readonly questionBanks: number;
  };
  readonly brokenBefore: number;
  readonly brokenAfter: number;
};

export { loadCourseAuditReport } from '../data/course-audit';
