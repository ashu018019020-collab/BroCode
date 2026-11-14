import { useEffect, useMemo, useState } from 'react';
import { Check, Code2, Copy, Expand, Play, RotateCcw, Shrink, Sparkles, Trash2 } from 'lucide-react';
import { useSavedAnswer } from '../../core/storage/store';
import { EXAMPLE_CSS, EXAMPLE_HTML, STARTER_CSS, STARTER_HTML } from './samples';

/**
 * The CSS live playground.
 *
 * Two hard rules shape this component:
 *
 *   1. The preview is a SANDBOXED iframe with NO `allow-scripts` and NO `allow-same-origin`. CSS
 *      needs no script at all, so the document cannot run JavaScript, read this app's storage or
 *      cookies, or navigate the page around it — even if a learner pastes a script tag.
 *   2. Nothing is rendered until Run is pressed. Typing never reloads the preview, so a
 *      half-written rule does not flash a broken page on every keystroke.
 *
 * The HTML editor holds body markup and the CSS editor holds the stylesheet; the frame document is
 * assembled here, so a learner writes one fragment and one rule set instead of full boilerplate.
 */
type Draft = { html: string; css: string };

const STARTER: Draft = { html: STARTER_HTML, css: STARTER_CSS };
const EXAMPLE: Draft = { html: EXAMPLE_HTML, css: EXAMPLE_CSS };

function parseDraft(raw: string): Draft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Draft>;
    if (typeof value.html === 'string' && typeof value.css === 'string') return { html: value.html, css: value.css };
  } catch { /* older drafts are not JSON; fall through to the starter */ }
  return null;
}

function documentFor(draft: Draft): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CSS Playground</title>
  <style>
${draft.css}
  </style>
</head>
<body>
${draft.html}
</body>
</html>`;
}

export function CssPlayground({ moduleId, compact = false }: { moduleId?: string; compact?: boolean }) {
  const storageKey = moduleId ? `cssplay:${moduleId}` : 'cssplay';
  const [saved, save] = useSavedAnswer(storageKey);
  const initial = useMemo(() => parseDraft(saved) ?? STARTER, [saved]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [doc, setDoc] = useState<Draft>(initial);
  const [width, setWidth] = useState<'desktop' | 'tablet' | 'phone'>('desktop');
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const persist = (next: Draft) => save(JSON.stringify(next));
  const run = () => { setDoc(draft); persist(draft); };
  const reset = () => { setDraft(STARTER); setDoc(STARTER); persist(STARTER); };
  const clear = () => {
    const empty = { html: '', css: '' };
    setDraft(empty); setDoc(empty); persist(empty);
  };
  const loadExample = () => { setDraft(EXAMPLE); setDoc(EXAMPLE); persist(EXAMPLE); };
  const copy = async () => {
    const text = `<!-- index.html -->\n${draft.html}\n\n/* style.css */\n${draft.css}`;
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const frameWidth = width === 'phone' ? 360 : width === 'tablet' ? 768 : 0;
  const editorHeight = compact ? 170 : full ? 320 : 240;
  const frameHeight = compact ? 220 : full ? 360 : 280;
  const pads = useMemo(() => ({ padding: compact ? 8 : 12 }), [compact]);

  const body = (
    <div className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 8, minWidth: 0 }}>
          <Code2 size={15} color="var(--blue, #2965f1)" />
          <b className="small">CSS Playground</b>
          <span className="chip">sandboxed preview</span>
        </span>
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button type="button" className={`btn small ${width === 'desktop' ? 'primary' : ''}`} onClick={() => setWidth('desktop')}>Desktop</button>
          <button type="button" className={`btn small ${width === 'tablet' ? 'primary' : ''}`} onClick={() => setWidth('tablet')}>Tablet</button>
          <button type="button" className={`btn small ${width === 'phone' ? 'primary' : ''}`} onClick={() => setWidth('phone')}>Mobile</button>
          <button type="button" className="btn small" onClick={() => setFull((v) => !v)} title={full ? 'Exit full screen' : 'Full screen'}>
            {full ? <Shrink size={12} /> : <Expand size={12} />} {full ? 'Exit' : 'Full screen'}
          </button>
        </span>
      </div>

      <div className="row" style={{ gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small muted">index.html — body markup</span>
          <textarea
            value={draft.html}
            onChange={(e) => setDraft({ ...draft, html: e.target.value })}
            onBlur={() => persist(draft)}
            spellCheck={false}
            rows={12}
            className="editor"
            style={{ minHeight: editorHeight, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '.8rem', lineHeight: 1.5, padding: 10 }}
            aria-label="HTML editor"
          />
        </label>
        <label style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small muted">style.css — declarations</span>
          <textarea
            value={draft.css}
            onChange={(e) => setDraft({ ...draft, css: e.target.value })}
            onBlur={() => persist(draft)}
            spellCheck={false}
            rows={12}
            className="editor"
            style={{ minHeight: editorHeight, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '.8rem', lineHeight: 1.5, padding: 10 }}
            aria-label="CSS editor"
          />
        </label>
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small muted">Browser output</span>
          <div style={{ border: '1px solid var(--line, #e6e8ee)', borderRadius: 8, overflow: 'auto', background: '#fff', display: 'flex', justifyContent: 'center' }}>
            <iframe
              title="CSS playground preview"
              srcDoc={documentFor(doc)}
              sandbox=""
              style={{ width: frameWidth ? `min(100%, ${frameWidth}px)` : '100%', height: frameHeight, border: 0, background: '#fff' }}
            />
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn small primary" onClick={run}><Play size={12} /> Run</button>
        <button type="button" className="btn small" onClick={reset}><RotateCcw size={12} /> Reset</button>
        <button type="button" className="btn small" onClick={copy}>{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className="btn small" onClick={loadExample}><Sparkles size={12} /> Example</button>
        <button type="button" className="btn small" onClick={clear}><Trash2 size={12} /> Clear</button>
        {moduleId && <span className="small muted">draft saved for {moduleId}</span>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The preview runs in an isolated frame with scripts disabled: your CSS cannot read this app&apos;s
        storage or cookies, and no JavaScript in the document executes. Press Run after an edit.
      </p>
    </div>
  );

  if (!full) return body;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--bg, #f7f7f9)', overflow: 'auto', ...pads }}>
      {body}
    </div>
  );
}
