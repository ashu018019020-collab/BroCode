/**
 * Machine Learning — Zero to Professional: authored course source.
 *
 * Each module owns its real topics, interview answer, coding task, debug challenge, mini project,
 * project lab, defense answer and checkpoint questions. `scripts/ml-course.cjs` adds the derived
 * output/logic/practice records and publishes `public/generated/ml-course/index.json`.
 *
 * This is the first complete authored batch (all 27 modules × all 10 sections). The published
 * counts are real, not inflated to the 13,500 target; expansion work belongs in new authored
 * records here, never in a counter.
 */
import level1 from './level1.mjs';
import level2 from './level2.mjs';
import level3 from './level3.mjs';
import level4 from './level4.mjs';

export const course = {
  id: 'ml-mastery',
  slug: 'ml',
  title: 'Machine Learning — Zero to Professional',
  subtitle: 'From your first feature to a production model',
  tagline: 'A 27-module, ten-section ML school: learn the idea, write the Python, debug it, defend it and ship it.',
  description:
    'This course builds machine learning from the ground up. You start with what learning from data actually means, then Python, NumPy, Pandas, the mathematics and statistics, data preparation, regression, classification, trees and ensembles, evaluation, unsupervised learning, NLP, engineering and deployment. Every module ends with a checkpoint and a defense you can practise. It is designed for a complete beginner who wants entry-level ML Engineer and Data Scientist work, not a vocabulary tour.',
  standard: 'Beginner → Intermediate → Advanced → Professional',
  level: 'beginner → advanced',
  hours: 242,
  tone: 'violet',
  prerequisites: ['Basic computer confidence', 'School-level mathematics', 'Willingness to write Python'],
  outcomes: [
    'Explain supervised, unsupervised, semi-supervised and reinforcement learning without hand-waving.',
    'Write clean Python, NumPy and Pandas for real tabular data.',
    'Use the mathematics and statistics that models are actually built from.',
    'Run a complete ML workflow: frame, split, train, evaluate, improve and document.',
    'Build regression, classification, tree, ensemble, clustering, anomaly and NLP models.',
    'Choose an evaluation metric that matches the business cost of mistakes.',
    'Prevent data leakage and build reproducible experiments.',
    'Engineer reusable pipelines and deploy a model behind a validated API.',
    'Explain model decisions, limitations, fairness and privacy risks.',
    'Defend a capstone project in an interview-style conversation.',
  ],
  // The derived evidence and workspace use this exact list/order.
  modules: [
    'ml01', 'ml02', 'ml03', 'ml04', 'ml05', 'ml06', 'ml07', 'ml08', 'ml09', 'ml10',
    'ml11', 'ml12', 'ml13', 'ml14', 'ml15', 'ml16', 'ml17', 'ml18', 'ml19', 'ml20',
    'ml21', 'ml22', 'ml23', 'ml24', 'ml25', 'ml26', 'ml27',
  ],
};

export const modules = [...level1, ...level2, ...level3, ...level4];
export default { course, modules };
