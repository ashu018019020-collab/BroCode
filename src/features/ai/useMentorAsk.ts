import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../core/storage/store';
import { useCurriculum } from '../../core/data/curriculum';
import { loadKnowledgeIndex } from '../../core/data/knowledge';
import type { KnowledgeIndex } from '../../core/ai/knowledge';
import { askLocal, type Answer, type AssistantContext } from '../../core/ai/assistant';
import { mentorTurn, type MentorHistoryTurn, type MentorReply } from '../../core/ai/mentor';
import type { VoiceLangId } from '../../core/ai/voice';

/**
 * One mentor turn over the EXISTING offline engine.
 *
 * No model call and no second corpus: `askLocal` retrieves the bundled curriculum exactly as the
 * footer assistant does, and `mentorTurn` reshapes that answer into a teaching turn. The only state
 * this hook adds is the conversation itself, persisted per account so a reload does not forget the
 * topic.
 *
 * Deliberately not in `src/core/ai`: it imports the store and React, which the purity sweep forbids
 * there. The wording that can be wrong lives in the pure engine and its tests.
 */

const MAX_TURNS = 24;

function loadTurns(key: string): MentorHistoryTurn[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((turn) => turn && (turn.role === 'learner' || turn.role === 'mentor') && typeof turn.text === 'string')
      .slice(-MAX_TURNS)
      .map((turn) => ({
        role: turn.role,
        text: String(turn.text),
        ...(Array.isArray(turn.sources)
          ? { sources: turn.sources.filter((s: { title?: unknown; route?: unknown }) => typeof s?.title === 'string' && typeof s?.route === 'string') }
          : {}),
      }));
  } catch {
    return [];
  }
}

export interface MentorAsk {
  turns: MentorHistoryTurn[];
  busy: boolean;
  ask: (text: string, lang: VoiceLangId) => Promise<{ reply: MentorReply; answer: Answer } | null>;
  clear: () => void;
  /** How many hint-style asks this conversation has made — the existing hint ladder reads it. */
  askedHints: number;
}

export function useMentorAsk(logKey: string, context?: AssistantContext): MentorAsk {
  const { sections } = useCurriculum();
  const state = useStore();
  const [turns, setTurns] = useState<MentorHistoryTurn[]>(() => loadTurns(logKey));
  const [busy, setBusy] = useState(false);
  const [knowledge, setKnowledge] = useState<KnowledgeIndex | null>(null);
  const turnsRef = useRef(turns);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    setTurns(loadTurns(logKey));
  }, [logKey]);

  useEffect(() => {
    turnsRef.current = turns;
    try { localStorage.setItem(logKey, JSON.stringify(turns.slice(-MAX_TURNS))); } catch { /* quota or blocked */ }
  }, [turns, logKey]);

  const ask = useCallback(async (text: string, lang: VoiceLangId) => {
    const question = text.trim();
    if (!question || busy) return null;
    setBusy(true);
    try {
      let index = knowledge;
      if (!index) {
        try {
          index = await loadKnowledgeIndex();
          setKnowledge(index);
        } catch (cause) {
          // The assistant already answers from `sections` when this fails; the mentor keeps working.
          console.warn('BroCode mentor: knowledge index unavailable, using the bundled lessons.', cause);
        }
      }
      const history = turnsRef.current;
      const askedHints = history.filter((turn) => turn.role === 'learner' && /\b(hint|clue|madad|nudge)\b/i.test(turn.text)).length;
      const answer = askLocal(question, sections, state, contextRef.current, askedHints, index ?? undefined);
      const reply = mentorTurn(question, answer, {
        lang,
        history,
        where: contextRef.current?.where,
        topic: contextRef.current?.topic,
      });
      const learnerTurn: MentorHistoryTurn = { role: 'learner', text: question };
      // The retrieval can return the same document twice under two headings — dedupe so the chips
      // under a mentor turn never show the same link twice.
      const seen = new Set<string>();
      const sources = answer.sources
        .map((source) => ({ title: source.title, route: source.route }))
        .filter((source) => {
          const key = `${source.route} :: ${source.title}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const mentorTurnEntry: MentorHistoryTurn = {
        role: 'mentor',
        text: reply.text,
        sources,
        intent: reply.intent,
      };
      const next: MentorHistoryTurn[] = [...history, learnerTurn, mentorTurnEntry].slice(-MAX_TURNS);
      turnsRef.current = next;
      setTurns(next);
      return { reply, answer };
    } catch (cause) {
      console.error('BroCode mentor: the answer could not be produced.', cause);
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, knowledge, sections, state]);

  const clear = useCallback(() => {
    turnsRef.current = [];
    setTurns([]);
    try { localStorage.removeItem(logKey); } catch { /* blocked */ }
  }, [logKey]);

  return {
    turns,
    busy,
    ask,
    clear,
    askedHints: turns.filter((turn) => turn.role === 'learner' && /\b(hint|clue|madad|nudge)\b/i.test(turn.text)).length,
  };
}
