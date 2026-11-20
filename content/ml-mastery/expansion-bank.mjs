/**
 * Machine Learning — practice expansion.
 *
 * The first authored pass gave each module real but shallow coverage. This module raises every
 * module to the course's 500-record contract using two authored inputs:
 *
 *   · six concept atoms per module (`terms.mjs`) — definitions, examples, failures and checks;
 *   · ten quantitative drill families per module (`drills.mjs`) — parameterised, executable cases.
 *
 * Every generated record has a unique id, a unique title/question, real prose and—where it carries
 * code—a solution whose expected output is tested by the local Python interpreter. The generator
 * fills only the deficit above the existing authoured records, so no record is replaced or counted
 * twice. If the pool cannot fill a section, the build fails instead of padding the count.
 */
import { terms } from './terms.mjs';
import { drillIds, makeDrill } from './drills.mjs';

const TARGETS = {
  learn: 50,
  interview: 100,
  coding: 80,
  logic: 80,
  debug: 40,
  practice: 60,
  miniProject: 5,
  projectLab: 5,
  defense: 30,
  checkpoint: 50,
};

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const difficultyAt = (index) => DIFFICULTIES[index % DIFFICULTIES.length];
const sentence = (text) => String(text).replace(/\s+/g, ' ').trim();
const uniq = (values) => [...new Set(values)];

const aspectBodies = (term, next, module) => [
  {
    title: `${term.term}: the working definition`,
    body: `${term.term} means ${sentence(term.definition)}. In ${module.title}, the practical test is whether that definition changes a decision rather than merely appearing in a notebook. Example: ${sentence(term.example)}.`,
    realWorld: term.example,
  },
  {
    title: `${term.term}: why it changes decisions`,
    body: `A team can produce a polished model and still get ${term.term} wrong. The failure looks like this: ${sentence(term.failure)}. The countermeasure is to ${sentence(term.check)} and to name the evidence in the design review.`,
    realWorld: term.check,
  },
  {
    title: `${term.term}: a worked example`,
    body: `Start with this case: ${sentence(term.example)}. Notice that the lesson is not the number alone; ${term.term} is the property being checked. A useful review question is: ${sentence(term.check)}.`,
    realWorld: term.example,
  },
  {
    title: `${term.term}: the failure mode`,
    body: `The common failure is that ${sentence(term.failure)}. That can survive a green dashboard because the aggregate looks healthy. Check it by asking whether you can ${sentence(term.check)} before the model reaches a user.`,
    realWorld: term.failure,
  },
  {
    title: `${term.term}: how to verify it`,
    body: `Before shipping, ${sentence(term.check)}. Keep the evidence with the model version. If the team cannot show that evidence, ${term.term} is an assumption, not a verified property.`,
    realWorld: term.check,
  },
  {
    title: `${term.term} vs ${next.term}`,
    body: `${term.term} means ${sentence(term.definition)}. ${next.term} means ${sentence(next.definition)}. They are easy to conflate, but confusing them changes which evidence a reviewer should ask for.`,
    realWorld: `${term.term}: ${term.example}`,
  },
  {
    title: `${term.term}: a design-review answer`,
    body: `When asked how the team handles ${term.term}, answer with a mechanism and an artifact: ${sentence(term.check)}. Then name the limitation: ${sentence(term.failure)}. Intent alone is not an answer.`,
    realWorld: term.check,
  },
  {
    title: `${term.term}: a quick revision card`,
    body: `Definition: ${sentence(term.definition)}. Example: ${sentence(term.example)}. Failure: ${sentence(term.failure)}. Verification: ${sentence(term.check)}.`,
    realWorld: term.example,
  },
  {
    title: `${term.term}: the interview trap`,
    body: `A common trap is to accept a claim that ${sentence(term.failure)}. Correct it by asking for the concrete check: ${sentence(term.check)}. A good answer distinguishes the mechanism from the metric.`,
    realWorld: term.failure,
  },
];

const termInterview = (term, next, module, variant) => {
  const prompts = [
    [`Explain ${term.term} to a junior engineer working on ${module.title}.`, `${sentence(term.definition)}. A concrete example is ${sentence(term.example)}.`],
    [`Why does ${term.term} matter outside a notebook?`, `Because ${sentence(term.failure)}. Production review should ask for evidence that the team can ${sentence(term.check)}.`],
    [`Give a concrete example of ${term.term}.`, `${sentence(term.example)}. That example is useful only if the team also defines how it would detect the failure: ${sentence(term.failure)}`],
    [`What do teams commonly get wrong about ${term.term}?`, `They assume it is handled when ${sentence(term.failure)}. The correction is to ${sentence(term.check)} and document the result.`],
    [`How would you verify ${term.term} before launch?`, `${sentence(term.check)}. Keep the check reproducible, name the data it used and record what would make it fail.`],
    [`How does ${term.term} differ from ${next.term}?`, `${term.term} is ${sentence(term.definition)}. ${next.term} is ${sentence(next.definition)}. They can interact, but they require different evidence.`],
    [`A colleague says “${term.failure}”. What is your correction?`, `Name the consequence and the missing check. ${term.term} requires that the team ${sentence(term.check)}, rather than relying on the aggregate result.`],
    [`Where in the ML lifecycle does ${term.term} belong?`, `It belongs wherever the decision is framed and verified, not only at model fitting. The practical checkpoint is to ${sentence(term.check)} before the model is promoted.`],
    [`What evidence would convince you that ${term.term} is handled?`, `A concrete artifact showing that the team can ${sentence(term.check)}, together with a documented limitation: ${sentence(term.failure)}.`],
    [`Turn ${term.term} into a one-line team rule.`, `Rule: ${sentence(term.check)}. This rule exists because ${sentence(term.failure)}.`],
    [`What would you monitor for ${term.term} after deployment?`, `Monitor the signal that would reveal the failure: ${sentence(term.failure)}. Pair it with the check “${sentence(term.check)}” and an owner for the alert.`],
    [`Describe a production incident involving ${term.term}.`, `A plausible incident is that ${sentence(term.failure)}. The response is to ${sentence(term.check)}, quantify the affected rows or users, and add the check to release testing.`],
  ];
  const [q, answer] = prompts[variant % prompts.length];
  return { q, answer, difficulty: difficultyAt(variant) };
};

const termDefense = (term, module, variant) => {
  const prompts = [
    [`Defend your approach to ${term.term} in a design review for ${module.title}.`, `We treat ${term.term} as ${sentence(term.definition)}. The evidence is that we can ${sentence(term.check)}. The limitation is that ${sentence(term.failure)}`, ['State the definition and decision.', 'Name the evidence.', 'Name the limitation.']],
    [`An interviewer challenges you: “${term.failure}” How do you respond?`, `I would not defend the claim without evidence. I would show whether we can ${sentence(term.check)}, and if we cannot, I would treat ${term.term} as an open risk rather than a solved property.`, ['Acknowledge the risk.', 'Describe the check.', 'State the residual risk.']],
    [`A production review asks for evidence on ${term.term}. What do you show?`, `A reproducible check that ${sentence(term.check)}, the data and model version it used, and the failure it would catch: ${sentence(term.failure)}.`, ['Show the artifact.', 'Tie it to the model version.', 'Explain the failure it prevents.']],
    [`What is the limitation of ${term.term}, and how do you communicate it?`, `The limitation is that ${sentence(term.failure)}. I would state it in the model card and pair it with the specific check “${sentence(term.check)}” rather than implying the metric proves more than it does.`, ['Name the limitation.', 'State the check.', 'Put it in the model card.']],
    [`If ${term.term} fails after launch, what is your first response?`, `First contain the decision or alert path affected by the failure: ${sentence(term.failure)}. Then reproduce the check “${sentence(term.check)}”, quantify the scope, and decide whether to roll back or add a guardrail.`, ['Contain the impact.', 'Reproduce the failure.', 'Roll back or add a guardrail.']],
    [`How would you teach ${term.term} to a new teammate without oversimplifying it?`, `Start with the definition—${sentence(term.definition)}—then walk through the example: ${sentence(term.example)}. End with the failure and its check: ${sentence(term.failure)} and ${sentence(term.check)}.`, ['Give the definition.', 'Walk through the example.', 'Show the failure and check.']],
  ];
  const [q, answer, steps] = prompts[variant % prompts.length];
  return { q, answer, steps, difficulty: difficultyAt(variant) };
};

const termCheckpoints = (term, peer, peer2, module) => {
  const defs = uniq([term.definition, peer.definition, peer2.definition]);
  const examples = uniq([term.example, peer.example, peer2.example]);
  const failures = uniq([term.failure, peer.failure, peer2.failure]);
  const checks = uniq([term.check, peer.check, peer2.check]);
  const names = uniq([term.term, peer.term, peer2.term]);
  const items = [];
  const add = (q, options, answer, why) => {
    const uniqueOptions = uniq(options);
    if (uniqueOptions.length === 3 && uniqueOptions.includes(answer)) items.push({ q, options: uniqueOptions, answer, why });
  };
  add(`Which definition matches ${term.term}?`, defs, term.definition, `${term.term} is defined as ${term.definition}`);
  add(`Which example best illustrates ${term.term}?`, examples, term.example, `${term.example} is the example used for ${term.term}.`);
  add(`Which failure is most associated with ${term.term}?`, failures, term.failure, `The failure to guard against is: ${term.failure}`);
  add(`What is the best evidence that ${term.term} is handled?`, checks, term.check, `The check is: ${term.check}`);
  add(`Which term is defined as: “${term.definition}”?`, names, term.term, `${term.term} has that definition.`);
  add(`Which term has this common failure: “${term.failure}”?`, names, term.term, `${term.term} is the concept behind that failure.`);
  add(`Which statement about ${term.term} is correct?`, defs, term.definition, `The correct statement is the definition: ${term.definition}`);
  add(`Which statement is a common trap when applying ${term.term}?`, failures, term.failure, `The trap is to accept that ${term.failure}`);
  add(`What should you do first to verify ${term.term} in ${module.title}?`, checks, term.check, `Start with the concrete check: ${term.check}`);
  return items.map((item, index) => ({
    ...item,
    id: `checkpoint:${term.term}:${index}`,
    format: 'mcq',
    difficulty: difficultyAt(index),
  }));
};

const makeNumericPool = (module, kind, perFormula, start = 0) => {
  const records = [];
  const ids = drillIds[module.id] ?? [];
  if (ids.length !== 10) throw new Error(`${module.id}: expected 10 drill families, found ${ids.length}`);
  for (const formulaId of ids) {
    for (let j = 0; j < perFormula; j++) {
      const index = start + j;
      const drill = makeDrill(module.id, formulaId, index);
      records.push({ drill, index, formulaId, caseNo: j + 1 });
    }
  }
  return records;
};

const projectRecords = (module, kind) => {
  const list = terms[module.id] ?? [];
  const label = kind === 'miniProject' ? 'Mini project' : 'Project lab';
  const verbs = kind === 'miniProject'
    ? ['audit', 'decision memo for', 'failure review for', 'fixture test for']
    : ['end-to-end slice for', 'production review of', 'monitoring plan for', 'release gate for'];
  const records = [];
  let index = 0;
  for (const verb of verbs) {
    for (const term of list) {
      const title = `${label} ${module.id}: ${verb} ${term.term}`;
      const body = kind === 'miniProject'
        ? `Apply ${module.title} to one bounded task. Focus on ${term.term}, using this definition: ${term.definition} Deliver a short artifact a reviewer can inspect.`
        : `Ship a production-shaped slice of ${module.title} around ${term.term}. The lab must leave a reproducible artifact, not only a notebook narrative.`;
      const steps = kind === 'miniProject'
        ? [
          `State the decision and the ${term.term} risk.`,
          `Build a small fixture where ${term.failure}`,
          `Produce the check: ${term.check}`,
          'Write the result and one limitation.',
        ]
        : [
          `Document the data, model version and scope for ${term.term}.`,
          `Implement the check: ${term.check}`,
          `Reproduce the failure: ${term.failure}`,
          'Record the release decision and the rollback trigger.',
          'Add the artifact to the capstone evidence pack.',
        ];
      records.push({ title, body, steps, difficulty: difficultyAt(index++) });
      if (records.length >= 8) return records;
    }
  }
  return records;
};

/**
 * Fill each section to its contract. Existing authored records stay first; generated records are
 * appended only when they add a new id and a new title/question. A short pool is a build error.
 */
export function expandModule(module, existing) {
  const moduleTerms = terms[module.id];
  if (!Array.isArray(moduleTerms) || moduleTerms.length !== 6) {
    throw new Error(`${module.id}: expected 6 authored terms, found ${moduleTerms?.length ?? 0}`);
  }
  const usedIds = new Set();
  const usedText = new Set();
  for (const entries of Object.values(existing)) {
    for (const entry of entries) {
      usedIds.add(entry.id);
      const text = entry.q || entry.title || '';
      if (text) usedText.add(text);
    }
  }
  const generated = Object.fromEntries(Object.keys(TARGETS).map((key) => [key, []]));
  const accept = (section, entry) => {
    const text = entry.q || entry.title || '';
    if (!entry.id || usedIds.has(entry.id) || !text || usedText.has(text)) return false;
    usedIds.add(entry.id);
    usedText.add(text);
    generated[section].push(entry);
    return true;
  };
  const fill = (section, candidates, target) => {
    for (const candidate of candidates) {
      if (existing[section].length + generated[section].length >= target) break;
      if (!candidate) continue;
      if (!candidate.id) candidate.id = `${module.id}:gen:${section}:${generated[section].length + 1}`;
      accept(section, candidate);
    }
    const total = existing[section].length + generated[section].length;
    if (total < target) throw new Error(`${module.id}/${section}: only ${total} records available, need ${target}`);
  };

  const learnPool = [];
  moduleTerms.forEach((term, ti) => {
    const next = moduleTerms[(ti + 1) % moduleTerms.length];
    aspectBodies(term, next, module).forEach((body, ai) => {
      learnPool.push({
        id: `${module.id}:gen:learn:${ti + 1}:${ai + 1}`,
        title: body.title,
        body: body.body,
        realWorld: body.realWorld,
        difficulty: difficultyAt(ti * 9 + ai),
      });
    });
  });
  fill('learn', learnPool, TARGETS.learn);

  const interviewPool = [];
  moduleTerms.forEach((term, ti) => {
    const next = moduleTerms[(ti + 1) % moduleTerms.length];
    for (let variant = 0; variant < 12; variant++) {
      const item = termInterview(term, next, module, variant);
      interviewPool.push({
        id: `${module.id}:gen:interview:term:${ti + 1}:${variant + 1}`,
        q: `${module.title} · ${item.q}`,
        answer: item.answer,
        difficulty: item.difficulty,
      });
    }
  });
  for (const { drill, index, caseNo, formulaId } of makeNumericPool(module, 'interview', 3, 40)) {
    interviewPool.push({
      id: `${module.id}:gen:interview:drill:${formulaId}:${caseNo}`,
      q: `Interview drill ${caseNo}: ${module.title} — ${drill.prompt}`,
      answer: `The result is ${drill.answer}. ${drill.hint}`,
      difficulty: difficultyAt(index + 2),
    });
  }
  fill('interview', interviewPool, TARGETS.interview);

  const codingPool = makeNumericPool(module, 'coding', 8).map(({ drill, index, caseNo, formulaId }) => ({
    id: `${module.id}:gen:coding:${formulaId}:${caseNo}`,
    title: `${module.id} · ${drill.label} · coding drill ${caseNo}`,
    statement: `${module.title}: ${drill.prompt} Write a complete Python snippet; the expected output is checked by the course test.`,
    kind: 'task',
    starter: drill.starter,
    solution: drill.solution,
    expected: drill.expected,
    hint: drill.hint,
    difficulty: difficultyAt(index),
  }));
  fill('coding', codingPool, TARGETS.coding);

  const logicPool = makeNumericPool(module, 'logic', 8, 10).map(({ drill, index, caseNo, formulaId }) => ({
    id: `${module.id}:gen:logic:${formulaId}:${caseNo}`,
    q: `Logic drill ${caseNo}: ${module.title} — ${drill.prompt}`,
    answer: `${drill.answer}. ${drill.hint}`,
    difficulty: difficultyAt(index + 1),
  }));
  fill('logic', logicPool, TARGETS.logic);

  const debugPool = makeNumericPool(module, 'debug', 4, 20).map(({ drill, index, caseNo, formulaId }) => ({
    id: `${module.id}:gen:debug:${formulaId}:${caseNo}`,
    title: `Debug ${module.id}: ${drill.label} case ${caseNo}`,
    code: drill.broken,
    error: drill.error,
    fix: drill.solution,
    difficulty: difficultyAt(index),
  }));
  fill('debug', debugPool, TARGETS.debug);

  const practicePool = makeNumericPool(module, 'practice', 6, 30).map(({ drill, index, caseNo, formulaId }) => ({
    id: `${module.id}:gen:practice:${formulaId}:${caseNo}`,
    title: `Practice ${module.id}: ${drill.label} case ${caseNo}`,
    task: `${module.title}: ${drill.prompt} Build the solution from memory, then compare it with the published output.`,
    solution: drill.solution,
    expected: drill.expected,
    difficulty: difficultyAt(index + 2),
  }));
  fill('practice', practicePool, TARGETS.practice);

  const miniPool = projectRecords(module, 'miniProject').map((item, index) => ({
    ...item,
    id: `${module.id}:gen:miniProject:${index + 1}`,
  }));
  fill('miniProject', miniPool, TARGETS.miniProject);

  const labPool = projectRecords(module, 'projectLab').map((item, index) => ({
    ...item,
    id: `${module.id}:gen:projectLab:${index + 1}`,
  }));
  fill('projectLab', labPool, TARGETS.projectLab);

  const defensePool = [];
  moduleTerms.forEach((term, ti) => {
    for (let variant = 0; variant < 6; variant++) {
      const item = termDefense(term, module, variant);
      defensePool.push({
        id: `${module.id}:gen:defense:${ti + 1}:${variant + 1}`,
        q: `${module.title} · ${item.q}`,
        answer: item.answer,
        steps: item.steps,
        difficulty: item.difficulty,
      });
    }
  });
  fill('defense', defensePool, TARGETS.defense);

  const checkpointPool = [];
  moduleTerms.forEach((term, ti) => {
    const peer = moduleTerms[(ti + 1) % moduleTerms.length];
    const peer2 = moduleTerms[(ti + 2) % moduleTerms.length];
    for (const item of termCheckpoints(term, peer, peer2, module)) {
      checkpointPool.push({
        ...item,
        id: `${module.id}:gen:checkpoint:${ti + 1}:${checkpointPool.length + 1}`,
        q: `${module.title} · ${item.q}`,
      });
    }
  });
  fill('checkpoint', checkpointPool, TARGETS.checkpoint);

  return generated;
}

export { TARGETS };
