/**
 * `/mock-interviews` — the older entry point, now the SAME round as the interview tab.
 *
 * This page used to own a second, disconnected question collection (`extras.mockInterview` rounds
 * plus the `intensive` set) with its own timer, its own grading and its own progress keys. Two
 * interview experiences meant two answers to "which questions should I practise?".
 *
 * The collection is not deleted: `questionsFromExtras` folds it into the canonical plan pool, so a
 * round here and a round from the Interview hub draw from one bank, in one place, with the same
 * report and the same history. Old `mock:<round>:<i>` attempts still live in the store and in the
 * Progress page; nothing was rewritten.
 */
import { HubCrumb } from '../../components/learning/SectionChrome';
import { MockInterviewPanel } from '../ai/MockInterviewPanel';

export default function MockInterviews() {
  return (
    <div>
      <HubCrumb hub="/interviews" hubLabel="Interview" page="Mock Interviews" />
      <MockInterviewPanel />
    </div>
  );
}
