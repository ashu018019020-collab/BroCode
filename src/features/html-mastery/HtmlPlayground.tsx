import { useEffect, useMemo, useState } from 'react';
import { Check, Code2, Copy, Expand, Play, RotateCcw, Shrink, Sparkles, Trash2 } from 'lucide-react';
import { useSavedAnswer } from '../../core/storage/store';
import { EXAMPLE_HTML, STARTER_HTML } from './samples';

/**
 * The HTML live playground.
 *
 * Two hard rules shape this component:
 *
 *   1. The preview is a SANDBOXED iframe. `sandbox="allow-scripts"` without `allow-same-origin`
 *      gives the document an opaque origin, so learner markup can run its own scripts but cannot
 *      read this app's storage, cookies or session, cannot navigate the top page, and cannot reach
 *      into the parent document.
 *   2. Nothing is executed until the learner presses Run. Typing never injects a document, so a
 *      half-written page does not reload the preview on every keystroke.
 */
const STARTER = STARTER_HTML;
const EXAMPLE = EXAMPLE_HTML;

export function HtmlPlayground({ moduleId, compact = false }: { moduleId?: string; compact?: boolean }) {
  const storageKey = moduleId ? `htmlplay:${moduleId}` : 'htmlplay';
  const [saved, save] = useSavedAnswer(storageKey);
  const [draft, setDraft] = useState(saved || STARTER);
  const [doc, setDoc] = useState(saved || STARTER);
  const [width, setWidth] = useState<'full' | 'tablet' | 'phone'>('full');
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const run = () => { setDoc(draft); save(draft); };
  const reset = () => { setDraft(STARTER); setDoc(STARTER); save(STARTER); };
  const clear = () => { setDraft(''); setDoc(''); save(''); };
  const loadExample = () => { setDraft(EXAMPLE); setDoc(EXAMPLE); save(EXAMPLE); };
  const copy = async () => {
    await navigator.clipboard.writeText(draft).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const frameWidth = width === 'phone' ? 360 : width === 'tablet' ? 768 : 0;
  const editorHeight = compact ? 200 : full ? 360 : 260;
  const frameHeight = compact ? 200 : full ? 360 : 260;
  const pads = useMemo(() => ({ padding: compact ? 8 : 12 }), [compact]);

  const body = (
    <div className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 8, minWidth: 0 }}>
          <Code2 size={15} color="var(--orange, #e34f26)" />
          <b className="small">HTML Playground</b>
          <span className="chip">sandboxed preview</span>
        </span>
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button type="button" className={`btn small ${width === 'full' ? 'primary' : ''}`} onClick={() => setWidth('full')}>Full</button>
          <button type="button" className={`btn small ${width === 'tablet' ? 'primary' : ''}`} onClick={() => setWidth('tablet')}>Tablet</button>
          <button type="button" className={`btn small ${width === 'phone' ? 'primary' : ''}`} onClick={() => setWidth('phone')}>Phone</button>
          <button type="button" className="btn small" onClick={() => setFull((v) => !v)} title={full ? 'Exit full screen' : 'Full screen'}>
            {full ? <Shrink size={12} /> : <Expand size={12} />} {full ? 'Exit' : 'Full screen'}
          </button>
        </span>
      </div>

      <div className="row" style={{ gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small muted">index.html</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => save(draft)}
            spellCheck={false}
            rows={12}
            className="editor"
            style={{ minHeight: editorHeight, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '.8rem', lineHeight: 1.5, padding: 10 }}
            aria-label="HTML code editor"
          />
        </label>
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="small muted">Browser output</span>
          <div style={{ border: '1px solid var(--line, #e6e8ee)', borderRadius: 8, overflow: 'auto', background: '#fff', display: 'flex', justifyContent: 'center' }}>
            <iframe
              title="HTML playground preview"
              srcDoc={doc}
              sandbox="allow-scripts"
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
        The preview runs your markup in an isolated frame: it cannot read this app&apos;s storage or
        cookies, and it cannot navigate the page around it. Press Run after an edit.
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
