/**
 * The mentor's conversational layer.
 *
 * BroCode's assistant is a deterministic retrieval engine — it never invents an answer. That is the
 * right rule, but a raw retrieved passage read aloud is not a lesson: it opens with a heading, keeps
 * every sentence at the same weight, and repeats the whole paragraph when a learner asks "example
 * do". This module is the missing teaching turn. It can only RESHAPE the text the retrieval engine
 * already returned:
 *
 *   in simple words → why it works → the example in the source → where to practise it
 *
 * Every technical sentence in every block is a contiguous piece of the retrieved answer. The only
 * authored strings are labels ("Why it works", "Try this"), the greeting/closing, and the
 * "the source has no example" refusal — no explanation, no number and no example is generated. That
 * is what makes the same engine safe offline and behind a voice.
 *
 * Pure: no React, no store, no browser API. The hook that speaks it lives in
 * `src/components/shared/useVoiceTutor.ts`; the wording that can be wrong is testable here.
 */
import type { Answer } from './assistant';
import type { VoiceLangId } from './voice';

export type MentorIntent =
  | 'greeting'
  | 'explain'
  | 'simpler'
  | 'example'
  | 'why'
  | 'repeat'
  | 'hint'
  | 'next'
  | 'practice'
  | 'thanks'
  | 'unknown';

export interface MentorHistoryTurn {
  role: 'learner' | 'mentor';
  text: string;
  /** Sources shown under the turn; persisted so reloading the panel keeps them. */
  sources?: { title: string; route: string }[];
  intent?: MentorIntent;
}

export type MentorBlockKind = 'simple' | 'why' | 'example' | 'where' | 'refusal';

export interface MentorBlock {
  kind: MentorBlockKind;
  /** Already localised: the label is the only part of a block this module writes itself. */
  label: string;
  /** A contiguous slice of the retrieved answer (or a clearly-labelled refusal/instruction). */
  text: string;
  /** True when the block came from a fenced code example, so the screen can keep the fence. */
  code?: boolean;
}

export interface MentorReply {
  intent: MentorIntent;
  /** Markdown for the conversation panel. */
  text: string;
  /** Short, speech-ready text. Derived from `text`; bounded again by `spokenReply` at the speaker. */
  spoken: string;
  blocks: MentorBlock[];
  /** Safe next asks. They are prompts, never claims about the content. */
  followUps: string[];
  /** True when this repeats an idea already explained in this conversation. */
  repeat: boolean;
  /** The source title, when one was retrieved. */
  topic?: string;
}

interface Copy {
  greeting: string;
  thanks: string;
  noMatch: string;
  simple: string;
  why: string;
  example: string;
  where: string;
  noExample: string;
  noReason: string;
  practiceLabel: string;
  practiceOnly: string;
  practiceLead: string;
  repeatLead: string;
  shortLead: string;
  hintLead: string;
  exampleLead: string;
  whyLead: string;
  explainLead: string;
  closing: string;
  followUps: {
    explain: string[];
    example: string[];
    why: string[];
    shorter: string[];
    greeting: string[];
    practice: string[];
  };
}

const COPY: Record<'en' | 'hi', Copy> = {
  en: {
    greeting:
      'Hi, I am your BroCode mentor. Tell me the topic you want to understand, and I will explain it in simple words with an example from your lessons.',
    thanks: 'You are welcome. Ask me another topic whenever you are ready.',
    noMatch:
      'I could not find this exact topic in the bundled lessons, so I will not invent an answer. Try the concept name (for example "list vs tuple", "decorators", "SQL joins"), or open the lesson from the source list.',
    simple: 'In simple words',
    why: 'Why it works',
    example: 'Example',
    where: 'Where this comes from',
    noExample:
      'The lesson for this topic does not contain a code example, so I will not make one up. Open the source below to see the exact wording.',
    noReason:
      'This lesson states the rule but does not explain the reason in this passage. I will not invent one — open the source below for the full context.',
    practiceLabel: 'This is a practice question',
    practiceOnly:
      'The closest match in the lessons is a practice question, not an explanation, so I will not invent the theory. Open the question to attempt it, or ask about the concept by name (for example "list vs tuple").',
    practiceLead: 'I found a practice question in the lessons, not an explanation.',
    repeatLead: 'We covered this a moment ago. Here is the short version rather than the whole explanation again.',
    shortLead: 'Here is the shortest version the lesson gives.',
    hintLead: 'Here is a nudge, not the full answer. Try it once before I show more.',
    exampleLead: 'Here is the example from the lesson.',
    whyLead: 'Here is the reason the lesson gives.',
    explainLead: 'Let me take this in four small steps: the plain idea, why it works, an example, and where to practise it.',
    closing: 'Ask a follow-up whenever you want — I will keep the same topic in mind.',
    followUps: {
      explain: ['Give me an example', 'Why does this work?', 'Explain in simpler words', 'Ask me a practice question'],
      example: ['Explain this example line by line', 'What is the edge case?', 'Ask me a practice question'],
      why: ['Give me an example', 'Explain in simpler words', 'Ask me a practice question'],
      shorter: ['Give me an example', 'Ask me a practice question'],
      greeting: ['Explain a concept', 'What should I learn next?', 'Give me a practice question'],
      practice: ['Explain the concept first', 'Give me an example', 'Ask a harder question'],
    },
  },
  hi: {
    greeting:
      'Hi, main tumhara BroCode mentor hoon. Jo topic samajhna hai batao — simple bhasha mein, lesson ke example ke saath samjhaunga.',
    thanks: 'Koi baat nahi. Jab mann kare, agla topic pooch lo.',
    noMatch:
      'Yeh exact topic bundled lessons mein nahi mila, isliye main apna answer nahi banaunga. Concept ka naam bol ke try karo (jaise "list vs tuple", "decorators", "SQL joins"), ya source list se lesson kholo.',
    simple: 'Simple bhasha mein',
    why: 'Kyun aisa hota hai',
    example: 'Example',
    where: 'Yeh kahan se aaya',
    noExample:
      'Is topic ke lesson mein code example nahi hai, isliye main bana kar nahi bataunga. Neeche source kholo aur exact wording padho.',
    noReason:
      'Lesson rule to bata raha hai, par is passage mein reason nahi likha. Main reason bana kar nahi bataunga — poora context neeche source mein hai.',
    practiceLabel: 'Yeh practice question hai',
    practiceOnly:
      'Lesson mein sabse kareeb match ek practice question hai, explanation nahi — isliye main theory bana kar nahi bataunga. Question kholo aur try karo, ya concept ka naam bol ke poocho (jaise "list vs tuple").',
    practiceLead: 'Mujhe lessons mein practice question mila hai, explanation nahi.',
    repeatLead: 'Yeh hum thodi der pehle cover kar chuke hain. Poora explanation dobara dene ke bajaye short version sun lo.',
    shortLead: 'Lesson jo sabse chhota version deta hai, wahi sun lo.',
    hintLead: 'Yeh ek nudge hai, poora answer nahi. Ek baar khud try karo, phir main aur batata hoon.',
    exampleLead: 'Lesson ka example yeh hai.',
    whyLead: 'Lesson jo reason deta hai, woh yeh hai.',
    explainLead: 'Chalo chaar chhote steps mein: simple idea, kyun kaam karta hai, example, aur practice kahan se karni hai.',
    closing: 'Follow-up poochte raho — main isi topic ko yaad rakhunga.',
    followUps: {
      explain: ['Ek example do', 'Yeh kaam kyun karta hai?', 'Aur simple bhasha mein batao', 'Practice question poocho'],
      example: ['Is example ko line by line samjhao', 'Edge case kya hai?', 'Practice question poocho'],
      why: ['Ek example do', 'Aur simple bhasha mein batao', 'Practice question poocho'],
      shorter: ['Ek example do', 'Practice question poocho'],
      greeting: ['Ek concept samjhao', 'Aage kya seekhna chahiye?', 'Practice question do'],
      practice: ['Pehle concept samjhao', 'Ek example do', 'Thoda hard question poocho'],
    },
  },
};

const language = (lang: VoiceLangId | undefined): Copy => (lang === 'hi-IN' ? COPY.hi : COPY.en);

/** Lowercased words only — used for repetition, never to rewrite content. */
export function normalizeAsk(text: string): string {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * What the learner is asking FOR, independent of the topic.
 *
 * Order matters: "explain in simpler words with an example" is a simpler request first, because the
 * learner has already told us the full answer is too much. "Repeat" outranks "explain" for the same
 * reason, and a bare "why?" is only read as `why` when it is a whole short ask — otherwise a real
 * question containing the word "why" would lose its topic.
 */
export function classifyMentorIntent(text: string): MentorIntent {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw) return 'unknown';
  if (/^(hi|hello|hey|namaste|namaskar|hii+|yo)\b/.test(raw) || /^(brocode )?(mentor )?(se kaise|kaise ho)/.test(raw)) return 'greeting';
  if (/^(thanks|thank you|thx|shukriya|dhanyavad|dhanyawad)\b/.test(raw)) return 'thanks';
  if (/\b(repeat|again|dobara|phir (se )?bolo|phir se|samajh nahi aaya|samjha nahi|didn'?t (get|understand))\b/.test(raw)) return 'repeat';
  if (/\b(simple|simpler|easier|aasan|saral|aur simple|bachche|layman|dumb it down|short version|chhota)\b/.test(raw)) return 'simpler';
  if (/\b(example|examples|udaharan|sample|demo|code dikhao|show me code)\b/.test(raw)) return 'example';
  if (/^(why|kyun|kyu)\b|^(why|kyun|kyu)[?.!]*$/.test(raw)) return 'why';
  if (/\b(hint|clue|nudge|madad|tip)\b/.test(raw)) return 'hint';
  if (/\b(next|agla|aage|what should i (learn|do)|what next)\b/.test(raw)) return 'next';
  if (/\b(practice|exercise|quiz|test me|question|sawal|drill)\b/.test(raw)) return 'practice';
  if (raw.length > 1) return 'explain';
  return 'unknown';
}

interface ParsedAnswer {
  title: string;
  bodyParagraphs: string[];
  code: string | null;
  all: string;
  /** True when the retrieval returned a practice item with no authored answer. */
  questionOnly: boolean;
  /** The authored `Why:` paragraph of a Question/Answer passage, when the source wrote one. */
  why: string | null;
}

/**
 * Split the retrieved Markdown into the few shapes a teaching turn needs.
 *
 * A first line that is entirely bold is the passage's TITLE, not its explanation — keeping it inside
 * the "simple" block made the voice read "Lists. Lists are mutable…" in every answer.
 *
 * The assistant also retrieves QUESTION-BANK documents, which arrive as
 * `Question: **title**\n\nAnswer: …\n\nWhy: …`. The question is the title, never the explanation;
 * a practice item with no `Answer:` at all is flagged `questionOnly` so the caller can refuse instead
 * of reading the question aloud as if it were the lesson.
 */
function parseAnswer(text: string): ParsedAnswer {
  const all = String(text ?? '').trim();
  const fence = all.match(/```([a-z0-9+#-]*)\n?([\s\S]*?)```/i);
  const code = fence ? fence[2].replace(/\s+$/, '') : null;
  const withoutFence = fence ? all.replace(fence[0], '\n\n') : all;

  let title = '';
  let questionOnly = false;
  let why: string | null = null;
  let bodySource = withoutFence;
  if (/^Question:\s*/i.test(withoutFence)) {
    const heading = withoutFence.match(/^Question:\s*([\s\S]*?)(?:\n\n|$)/i);
    title = (heading?.[1] ?? '').replace(/\*\*/g, '').trim();
    const answerAt = withoutFence.search(/\n\n(?:Answer|Why):\s*/i);
    if (answerAt < 0) {
      questionOnly = true;
      bodySource = '';
    } else {
      const authoredWhy = withoutFence.match(/\n{2,}Why:\s*([\s\S]+)$/i);
      if (authoredWhy) why = authoredWhy[1].trim();
      bodySource = withoutFence
        .slice(answerAt)
        .replace(/^\n\n(?:Answer|Why):\s*/i, '')
        .replace(/\n{2,}Why:\s*/gi, '\n\n')
        .trim();
    }
  }

  const paragraphs = bodySource
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!title && paragraphs.length && /^\*\*[^*]+\*\*$/.test(paragraphs[0])) {
    title = paragraphs[0].replace(/\*\*/g, '').trim();
    paragraphs.shift();
  }
  return { title, bodyParagraphs: paragraphs, code, all, questionOnly, why };
}

/** The first N sentences of a paragraph, never cutting mid-sentence. */
function firstSentences(text: string, max: number): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = '';
  for (const sentence of sentences) {
    const candidate = out ? `${out} ${sentence}` : sentence;
    if (out && candidate.length > max) break;
    out = candidate;
    if (out.length >= max) break;
  }
  return (out || text.slice(0, max)).trim();
}

/** A contiguous paragraph that carries the reason, if the source wrote one. */
function findParagraph(paragraphs: string[], pattern: RegExp): string | null {
  for (const paragraph of paragraphs) {
    if (pattern.test(paragraph)) return paragraph.trim();
  }
  return null;
}

/**
 * The four teaching blocks, extracted — never authored.
 *
 * `simple` is always present when there is an answer. `why`/`example` are OMITTED when the source
 * does not contain them; the caller turns that absence into an explicit refusal, because a missing
 * block is a fact about the lesson and a fabricated one would be a lie about it.
 */
export function teachingBlocks(answer: Answer | null | undefined, lang: VoiceLangId): MentorBlock[] {
  const copy = language(lang);
  const text = answer?.text ?? '';
  const parsed = parseAnswer(text);
  if (!parsed.all) return [];

  const blocks: MentorBlock[] = [];
  const body = parsed.bodyParagraphs.length ? parsed.bodyParagraphs : [parsed.all];
  const simpleSource = body[0] ?? parsed.all;
  blocks.push({
    kind: 'simple',
    label: copy.simple,
    text: firstSentences(simpleSource.replace(/^\s*[-*•]\s+/gm, ''), 520),
  });

  const whyParagraph = parsed.why ?? findParagraph(
    parsed.bodyParagraphs,
    /\b(because|since|so that|that is why|reason|kyunki|isliye|kyun ki)\b/i,
  );
  if (whyParagraph && whyParagraph !== simpleSource) {
    blocks.push({ kind: 'why', label: copy.why, text: firstSentences(whyParagraph, 420) });
  }

  if (parsed.code) {
    blocks.push({ kind: 'example', label: copy.example, text: parsed.code, code: true });
  } else {
    const exampleParagraph = findParagraph(
      parsed.bodyParagraphs,
      /^(example|for example|for instance|e\.g\.|jaise|udaharan)|(\bexample:)/i,
    );
    if (exampleParagraph && exampleParagraph !== simpleSource) {
      blocks.push({ kind: 'example', label: copy.example, text: firstSentences(exampleParagraph, 420) });
    }
  }

  const source = answer?.sources?.find((s) => s.title?.trim());
  if (source) {
    blocks.push({
      kind: 'where',
      label: copy.where,
      text: `${source.title.trim()}${source.route ? ` (${source.route})` : ''}`,
    });
  }
  return blocks;
}

function hasBlock(blocks: MentorBlock[], kind: MentorBlockKind): boolean {
  return blocks.some((block) => block.kind === kind);
}

/** One vocabulary for the follow-up chips, keyed by the intent that produced them. */
function followUpsFor(copy: Copy, intent: MentorIntent): string[] {
  switch (intent) {
    case 'greeting': return copy.followUps.greeting;
    case 'example': return copy.followUps.example;
    case 'why': return copy.followUps.why;
    case 'simpler': return copy.followUps.shorter;
    case 'repeat': return copy.followUps.shorter;
    case 'practice': return copy.followUps.practice;
    case 'next': return copy.followUps.practice;
    case 'hint': return copy.followUps.shorter;
    default: return copy.followUps.explain;
  }
}

function renderText(title: string, blocks: MentorBlock[], lead: string, closing: string): string {
  const lines: string[] = [];
  if (title) lines.push(`**${title}**`);
  lines.push(lead);
  for (const block of blocks) {
    lines.push(`\n### ${block.label}`);
    lines.push(block.code ? `\`\`\`python\n${block.text}\n\`\`\`` : block.text);
  }
  lines.push(`\n${closing}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function speechFrom(lead: string, blocks: MentorBlock[], closing: string): string {
  // The source line is shown on screen but not read: a route is a place to click, not a sentence.
  const spoken = blocks
    .filter((block) => block.kind !== 'where')
    .map((block) => `${block.label}. ${block.text}`)
    .join(' ');
  return [lead, spoken, closing].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** A greeting that can name the page it was asked from, without inventing a page when there is none. */
export function mentorGreeting(where: string | undefined, lang: VoiceLangId): MentorReply {
  const copy = language(lang);
  const place = String(where ?? '').trim();
  const hello = place
    ? (lang === 'hi-IN' ? `Abhi tum ${place} par ho. ` : `You are on ${place}. `)
    : '';
  return {
    intent: 'greeting',
    text: `${hello}${copy.greeting}`,
    spoken: `${hello}${copy.greeting}`,
    blocks: [],
    followUps: copy.followUps.greeting,
    repeat: false,
  };
}

export interface MentorTurnOptions {
  lang: VoiceLangId;
  history?: MentorHistoryTurn[];
  /** The page the learner is on — used by the greeting only. */
  where?: string;
  /** A short topic label from the caller's context, if it has one. */
  topic?: string;
}

/**
 * The one entry point: an ask + the retrieved answer → a teaching turn.
 *
 * `answer` may be null for a greeting/thanks (no retrieval needed). For every other intent a null
 * answer is answered honestly as "not found" rather than with a guessed topic.
 */
export function mentorTurn(input: string, answer: Answer | null, opts: MentorTurnOptions): MentorReply {
  const copy = language(opts.lang);
  const intent = classifyMentorIntent(input);
  const history = opts.history ?? [];
  const asked = normalizeAsk(input);
  const previousMentor = [...history].reverse().find((turn) => turn.role === 'mentor');
  const repeat = !!asked && history.some((turn) => turn.role === 'learner' && normalizeAsk(turn.text) === asked);
  // The passage's own title (bold heading or the question itself) beats the section name: a
  // Question/Answer document is about the question, not about the page it was found on.
  const passageTitle = answer ? parseAnswer(answer.text).title : '';
  const title = (passageTitle || answer?.sources?.[0]?.title || opts.topic || '').trim();
  const blocks = teachingBlocks(answer, opts.lang);
  const followUps = followUpsFor(copy, intent);

  if (intent === 'greeting' || intent === 'thanks') {
    const text = intent === 'greeting' ? mentorGreeting(opts.where, opts.lang).text : copy.thanks;
    return {
      intent,
      text,
      spoken: text,
      blocks: [],
      followUps: intent === 'greeting' ? copy.followUps.greeting : copy.followUps.explain,
      repeat: false,
      topic: opts.topic,
    };
  }

  if (!answer?.text?.trim() || !blocks.length) {
    return {
      intent,
      text: copy.noMatch,
      spoken: copy.noMatch,
      blocks: [],
      followUps: copy.followUps.greeting,
      repeat: false,
      topic: opts.topic,
    };
  }

  // A retrieved PRACTICE item (Question: … with no authored Answer:) is not an explanation. Reading
  // it aloud as one made the mentor say "In simple words: How do you reverse a linked list?" — the
  // question was presented as the lesson. Explanatory intents refuse and point at the question;
  // practice intents show it as the practice question it actually is.
  if (answer && parseAnswer(answer.text).questionOnly) {
    const parsed = parseAnswer(answer.text);
    const heading = parsed.title || title;
    const questionText = parsed.all.replace(/^Question:\s*/i, '').replace(/\*\*/g, '').trim();
    if (intent === 'practice' || intent === 'next') {
      const block: MentorBlock = { kind: 'simple', label: copy.practiceLabel, text: questionText };
      const lead = intent === 'practice'
        ? (opts.lang === 'hi-IN'
          ? 'Lesson ka yeh practice question hai — code likh kar try karo, main answer bana kar nahi dunga.'
          : 'Here is the practice question from the lesson — write the code yourself; I will not invent an answer.')
        : (opts.lang === 'hi-IN'
          ? 'Agle step ke liye yeh practice question hai — main answer bana kar nahi dunga.'
          : 'The next step is this practice question — I will not invent an answer for it.');
      return {
        intent,
        text: renderText(heading, [block], lead, copy.closing),
        spoken: `${lead} ${questionText}`,
        blocks: [block],
        followUps: copy.followUps.practice,
        repeat: false,
        topic: heading || undefined,
      };
    }
    const refusal: MentorBlock = { kind: 'refusal', label: copy.practiceLabel, text: copy.practiceOnly };
    const lead = copy.practiceLead;
    return {
      intent,
      text: renderText(heading, [refusal], lead, copy.closing),
      spoken: `${lead} ${copy.practiceOnly}`,
      blocks: [refusal],
      followUps: copy.followUps.explain,
      repeat: false,
      topic: heading || undefined,
    };
  }

  // A repeated ask gets the short version, not the whole answer — the common complaint about
  // assistants is that they repeat the same wall of text when the learner says "samjha nahi".
  const shortVersionIntent = intent === 'explain' || intent === 'unknown' || intent === 'simpler';
  if (intent === 'repeat' || (repeat && shortVersionIntent)) {
    const short = blocks.find((block) => block.kind === 'simple') ?? blocks[0];
    const lead = repeat ? copy.repeatLead : copy.shortLead;
    const shown = [short];
    return {
      intent: repeat ? 'repeat' : 'simpler',
      text: renderText(title, shown, lead, copy.closing),
      spoken: speechFrom(lead, shown, ''),
      blocks: shown,
      followUps: copy.followUps.shorter,
      repeat: true,
      topic: title || undefined,
    };
  }

  if (intent === 'simpler') {
    const short = blocks.find((block) => block.kind === 'simple') ?? blocks[0];
    return {
      intent,
      text: renderText(title, [short], copy.shortLead, copy.closing),
      spoken: speechFrom(copy.shortLead, [short], ''),
      blocks: [short],
      followUps: copy.followUps.shorter,
      repeat: false,
      topic: title || undefined,
    };
  }

  if (intent === 'hint') {
    const short = blocks.find((block) => block.kind === 'simple') ?? blocks[0];
    return {
      intent,
      text: renderText(title, [short], copy.hintLead, copy.closing),
      spoken: speechFrom(copy.hintLead, [short], copy.closing),
      blocks: [short],
      followUps: copy.followUps.shorter,
      repeat: false,
      topic: title || undefined,
    };
  }

  if (intent === 'example') {
    const example = blocks.find((block) => block.kind === 'example');
    if (!example) {
      const refusal: MentorBlock = { kind: 'refusal', label: copy.example, text: copy.noExample };
      return {
        intent,
        text: renderText(title, [refusal], copy.exampleLead, copy.closing),
        spoken: `${copy.exampleLead} ${copy.noExample}`,
        blocks: [refusal],
        followUps: copy.followUps.why,
        repeat: false,
        topic: title || undefined,
      };
    }
    return {
      intent,
      text: renderText(title, [example], copy.exampleLead, copy.closing),
      spoken: speechFrom(copy.exampleLead, [example], ''),
      blocks: [example],
      followUps: copy.followUps.example,
      repeat: false,
      topic: title || undefined,
    };
  }

  if (intent === 'why') {
    const why = blocks.find((block) => block.kind === 'why');
    if (!why) {
      const refusal: MentorBlock = { kind: 'refusal', label: copy.why, text: copy.noReason };
      return {
        intent,
        text: renderText(title, [refusal], copy.whyLead, copy.closing),
        spoken: `${copy.whyLead} ${copy.noReason}`,
        blocks: [refusal],
        followUps: copy.followUps.why,
        repeat: false,
        topic: title || undefined,
      };
    }
    return {
      intent,
      text: renderText(title, [why], copy.whyLead, copy.closing),
      spoken: speechFrom(copy.whyLead, [why], ''),
      blocks: [why],
      followUps: copy.followUps.why,
      repeat: false,
      topic: title || undefined,
    };
  }

  if (intent === 'next' || intent === 'practice') {
    const where = blocks.find((block) => block.kind === 'where');
    const lead = intent === 'practice'
      ? (opts.lang === 'hi-IN'
        ? 'Practice ke liye source ke practice section se shuru karo. Main lecture ka answer bana kar nahi dunga.'
        : 'Start from the practice section in the source below. I will not invent questions the lesson does not have.')
      : (opts.lang === 'hi-IN'
        ? 'Agla step source ke lesson mein hai — main route bana kar nahi bataunga.'
        : 'The next step is inside the source lesson — I will not invent a route.');
    const shown = where ? [where] : blocks.slice(0, 1);
    return {
      intent,
      text: renderText(title, shown, lead, copy.closing),
      spoken: speechFrom(lead, shown.filter((b) => b.kind !== 'where'), ''),
      blocks: shown,
      followUps: copy.followUps.practice,
      repeat: false,
      topic: title || undefined,
    };
  }

  if (intent === 'unknown' && !previousMentor) {
    return {
      intent,
      text: copy.noMatch,
      spoken: copy.noMatch,
      blocks: [],
      followUps: copy.followUps.greeting,
      repeat: false,
      topic: opts.topic,
    };
  }

  // The full teaching turn. Missing reason/example are stated, never filled in.
  const full = [...blocks];
  if (!hasBlock(full, 'why')) {
    full.splice(1, 0, { kind: 'refusal', label: copy.why, text: copy.noReason });
  }
  if (!hasBlock(full, 'example')) {
    full.splice(Math.min(2, full.length), 0, { kind: 'refusal', label: copy.example, text: copy.noExample });
  }
  return {
    intent: 'explain',
    text: renderText(title, full, copy.explainLead, copy.closing),
    spoken: speechFrom(copy.explainLead, full, copy.closing),
    blocks: full,
    followUps: copy.followUps.explain,
    repeat: false,
    topic: title || undefined,
  };
}
