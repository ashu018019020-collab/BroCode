import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Check, Loader2, X } from 'lucide-react';
import {
  AGENT_LABEL_ATTR, actionSelector, guidePlan, guideRecovery, guideStatusLabel, verifyGuide,
  type GuideStatus, type GuideStep,
} from '../../core/ai/actions';
import { useCourseIndex, useSectionPct } from '../../core/data/courses';
import { sectionAvg } from '../../core/learning/courses';
import { useAuth } from '../../core/auth/AuthProvider';
import { stopGuide, useGuideRequest, type GuideRequest } from './guideStore';

/**
 * The visible half of guided navigation.
 *
 * It draws a ring around ONE registered control and a card that names that control by the label the
 * control itself carries (`data-agent-label`, `aria-label`, or its own text). It never clicks, never
 * scrolls the learner somewhere and leaves them there, and never claims success from a click:
 * `verifyGuide` looks at the ROUTE, so a click that was swallowed by an error still reads as
 * "waiting" (or "not found"), never as done.
 *
 * The overlay is portalled to `document.body` on purpose. `.aidock` sets `backdrop-filter`, which
 * makes it a containing block for fixed-position descendants — a `position: fixed` ring rendered
 * inside the assistant would be positioned against the dock and clipped by its `overflow: hidden`.
 * The portal also means the highlight survives the card that started it unmounting.
 */
export function GuideLayer() {
  const request = useGuideRequest();
  if (!request) return null;
  // A new goal or language starts a fresh session (fresh speech, fresh measurements).
  return <GuideSession key={`${request.goal}:${request.lang}`} request={request} />;
}

interface Rect { top: number; left: number; width: number; height: number; bottom: number }

function isHittable(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
  const y = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === el || el.contains(hit));
}

/**
 * The SAME action is wired on more than one surface on purpose: the sidebar link and the mobile
 * bottom-nav item are both `nav:/courses`, and which one is reachable depends on the viewport. Pick
 * the first that is laid out and actually hit-testable; fall back to the first laid-out one (the ring
 * must still show where the control is, even if something is covering it).
 */
function findVisible(id: string): HTMLElement | null {
  const laidOut = Array.from(document.querySelectorAll<HTMLElement>(actionSelector(id))).filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  });
  if (!laidOut.length) return null;
  return laidOut.find(isHittable) ?? laidOut[0];
}

function isDisabled(el: HTMLElement): boolean {
  return el.hasAttribute('disabled')
    || el.getAttribute('aria-disabled') === 'true'
    || el.classList.contains('disabled');
}

/** The control's own name, not a guess. A whole card provides `data-agent-label` for this. */
function readLabel(el: HTMLElement): string {
  const authored = el.getAttribute(AGENT_LABEL_ATTR)?.trim();
  const aria = el.getAttribute('aria-label')?.trim();
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return (authored || aria || text).slice(0, 70);
}

function GuideSession({ request }: { request: GuideRequest }) {
  const location = useLocation();
  const index = useCourseIndex();
  const pctOf = useSectionPct();
  const { user, loading } = useAuth();
  const courses = useMemo(
    () => (index?.courses ?? []).map((card) => ({ slug: card.slug, name: card.name, pct: sectionAvg(card, pctOf) })),
    [index, pctOf],
  );
  const plan = useMemo(
    // `undefined` while the session is being restored — never gate a visitor on a guess.
    () => guidePlan(location.pathname, courses, request.lang, loading ? undefined : !!user),
    [location.pathname, courses, request.lang, loading, user],
  );
  const step: GuideStep | null = plan.kind === 'step' ? plan.step : null;
  const stepId = step?.id ?? null;

  const [rect, setRect] = useState<Rect | null>(null);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<GuideStatus>('waiting');
  const [graceOver, setGraceOver] = useState(false);
  const [cardHeight, setCardHeight] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const spoke = useRef<string | null>(null);

  const presence = useRef(false);
  const disabled = useRef(false);
  const routeRef = useRef(location.pathname);
  routeRef.current = location.pathname;

  // Highlight geometry. A frame loop, not a scroll listener: the ring must also follow the sidebar
  // opening, a lazy route committing, and the list re-flowing under it. State is written only when
  // the rounded box actually changes, so this does not re-render 60 times a second.
  useEffect(() => {
    if (!stepId) { setRect(null); presence.current = false; return; }
    let frame = 0;
    let lastKey = '';
    let seenLabel = '';
    const tick = () => {
      const el = findVisible(stepId);
      presence.current = !!el;
      disabled.current = !!el && isDisabled(el);
      if (el) {
        const box = el.getBoundingClientRect();
        const key = `${Math.round(box.top)},${Math.round(box.left)},${Math.round(box.width)},${Math.round(box.height)}`;
        if (key !== lastKey) {
          lastKey = key;
          setRect({ top: box.top, left: box.left, width: box.width, height: box.height, bottom: box.bottom });
        }
        if (!seenLabel) {
          seenLabel = readLabel(el);
          setLabel(seenLabel);
        }
      } else if (lastKey) {
        lastKey = '';
        setRect(null);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stepId]);

  // Reset per step, then scroll the control into view once.
  useEffect(() => {
    if (!step) return;
    setStatus('waiting');
    setGraceOver(false);
    setLabel('');
    const el = findVisible(step.id);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [stepId]);

  // Verify, rather than believe. `verifyGuide` owns the policy; this only supplies the snapshot.
  useEffect(() => {
    if (!step) return;
    const timer = window.setInterval(() => {
      setStatus(verifyGuide(step, {
        route: routeRef.current,
        present: presence.current,
        disabled: disabled.current,
      }));
    }, 350);
    return () => window.clearInterval(timer);
  }, [stepId]);

  // "Not found" is only reported after a grace period: a lazy route commits late, and a control
  // that is about to appear must not be announced as missing.
  useEffect(() => {
    setGraceOver(false);
    const timer = window.setTimeout(() => setGraceOver(true), 1400);
    return () => window.clearTimeout(timer);
  }, [stepId, location.pathname]);

  // One line per step, with the control's REAL label. This is the tutor naming the button.
  useEffect(() => {
    if (!step) return;
    if (!label || status === 'missing') return;
    if (spoke.current === step.id) return;
    spoke.current = step.id;
    const name = request.lang === 'hi-IN' ? 'Button' : 'Press';
    request.say(`${step.instruction} ${name} "${label}".`);
  }, [step, label, status, request]);

  useEffect(() => {
    if (!step || !graceOver || status !== 'missing') return;
    const key = `missing:${step.id}`;
    if (spoke.current === key) return;
    spoke.current = key;
    request.say(guideRecovery(step, request.lang));
  }, [step, graceOver, status, request]);

  useEffect(() => {
    if (plan.kind !== 'done' && plan.kind !== 'stopped') return;
    if (spoke.current === plan.kind) return;
    spoke.current = plan.kind;
    request.say(plan.message);
  }, [plan, request]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') stopGuide(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * The card must not cover the control it is describing — a highlight behind a tooltip is a guide
   * that cannot be followed. Its real height is measured, not assumed (the old 176px guess put the
   * card on top of the sidebar's Sign in link), and the first frame is hidden until it is known.
   */
  useLayoutEffect(() => {
    const measured = cardRef.current?.offsetHeight ?? 0;
    if (measured && measured !== cardHeight) setCardHeight(measured);
  }, [plan, label, status, cardHeight]);

  const width = Math.min(348, window.innerWidth - 24);
  const height = cardHeight || 210;
  let cardStyle: CSSProperties;
  if (rect) {
    const below = rect.bottom + 14;
    const above = rect.top - height - 14;
    const fitsBelow = below + height <= window.innerHeight - 44;
    const fitsAbove = above >= 8;
    let top = fitsBelow ? below : fitsAbove ? above : 12;
    // Still overlapping the control (a very tall card, a very short viewport)? Move to the far side.
    const overlaps = top < rect.bottom + 6 && top + height > rect.top - 6;
    if (overlaps) top = rect.top > window.innerHeight / 2 ? 12 : window.innerHeight - height - 44;
    cardStyle = {
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
      width,
      visibility: cardHeight ? 'visible' : 'hidden',
    };
  } else {
    cardStyle = { left: Math.max(12, (window.innerWidth - width) / 2), top: window.innerHeight - height - 56, width };
  }

  const recovery = step && graceOver && status === 'missing' ? guideRecovery(step, request.lang) : '';

  return createPortal(
    <div className="guide-layer">
      {rect && (
        <div
          className="guide-ring"
          aria-hidden="true"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <div ref={cardRef} className="guide-card" style={cardStyle} role="dialog" aria-label="Guided step" aria-live="polite">
        <div className="guide-head">
          <span className="guide-tag">GUIDE</span>
          <span className={`guide-status ${status}`}>
            {step ? guideStatusLabel(status, request.lang) : ''}
          </span>
          <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={stopGuide} aria-label="Cancel the guide">
            <X size={13} />
          </button>
        </div>

        {step ? (
          <>
            <p className="guide-instruction">{step.instruction}</p>
            <p className="guide-reason small">{step.reason}</p>
            {label && (
              <div className="guide-target">
                <span>Real control</span>
                <b>{label}</b>
              </div>
            )}
            {recovery && <p className="guide-reason small">{recovery}</p>}
          </>
        ) : plan.kind === 'done' ? (
          <p className="guide-instruction"><Check size={14} /> {plan.message}</p>
        ) : plan.kind === 'stopped' ? (
          <p className="guide-instruction">{plan.message}</p>
        ) : (
          <p className="guide-instruction"><Loader2 size={14} className="spin" /> Loading the course list…</p>
        )}

        <div className="guide-actions">
          <button type="button" className="btn small ghost" onClick={stopGuide}>Close guide</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
