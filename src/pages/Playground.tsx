import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import {
  Play, Square, RotateCcw, Copy, Save, FolderPlus, FilePlus2, Trash2, Bot,
  Package, Folder, File as FileIcon, FileText, Lightbulb, Wrench, ChevronRight, ChevronDown,
} from 'lucide-react';
const MonacoIDE = lazy(() => import('../components/MonacoIDE').then((m) => ({ default: m.MonacoIDE })));
type IdeError = import('../components/MonacoIDE').IdeError;
import { runPython, stopPython, explainError } from '../features/coding/runners';
import { parseTraceback } from '../engine/traceback';
import { explainDiagnostic, hintLadder, nextTask, mistakeFromDiagnostic } from '../engine/tutor';
import { useStore, setState, addXp, addMistake } from '../offline/store';
import { codeSlot } from '../engine/keys';
import { OFFLINE_PACKAGES, findPkg } from '../data/packages';
import { useI18n } from '../i18n';
import { useCurriculum } from '../data/curriculum';
import { useNavigate } from 'react-router-dom';

interface WsFile { name: string; content: string }
const WS_KEY = 'aiml:workspace:v1';

const DEFAULT_FILES: WsFile[] = [
  {
    name: 'main.py',
    content: `import numpy as np

print("numpy", np.__version__)
print("Hello World")

name = input("Enter your name: ")
print(f"Hello, {name}!")

arr = np.array([1, 2, 3, 4, 5])
print("Array:", arr)

# Calculate the mean (intentional mistake: np.mean without call)
mean = np.mean
print("Mean:", mean(arr))
`,
  },
  {
    name: 'notes.txt',
    content: 'My Python learning notes.\n- Pyodide runs Python in the browser, fully offline.\n',
  },
  {
    name: 'README.md',
    content: '# AI-Engineer-Lab\n\nStarter workspace for the AI Engineer Master Lab.\nEdit main.py and press Run (Ctrl+Enter).\n',
  },
];

function loadWorkspace(): WsFile[] {
  try {
    const raw = localStorage.getItem(WS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.files) && parsed.files.every((f: any) => typeof f?.name === 'string' && typeof f?.content === 'string')) {
        return parsed.files;
      }
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_FILES;
}

export default function Playground() {
  const { t } = useI18n();
  const state = useStore();
  const { sections } = useCurriculum();
  const nav = useNavigate();
  const [files, setFiles] = useState<WsFile[]>(loadWorkspace);
  const [openName, setOpenName] = useState('main.py');
  const [stdin, setStdin] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string; ms?: number } | null>(null);
  const [showPackages, setShowPackages] = useState(false);
  const [tutorTab, setTutorTab] = useState<'explain' | 'hints' | 'next'>('explain');
  const [hintLevel, setHintLevel] = useState(1);
  const [mistakeSaved, setMistakeSaved] = useState(false);
  const [newName, setNewName] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const file = files.find((f) => f.name === openName) ?? files[0];
  const isPy = file?.name.endsWith('.py');
  const saved = state.savedCode[codeSlot.playgroundPython];

  useEffect(() => {
    try { localStorage.setItem(WS_KEY, JSON.stringify({ files })); } catch { /* quota */ }
  }, [files]);

  const open = (name: string) => {
    setOpenName(name);
    setOut(null);
  };

  const setContent = (content: string) => {
    if (!file) return;
    setFiles((fs) => fs.map((f) => (f.name === file.name ? { ...f, content } : f)));
  };

  const createFile = () => {
    const name = newName.trim();
    if (!name) return;
    const safe = name.replace(/[^\w.-]/g, '_');
    if (!files.some((f) => f.name === safe)) {
      setFiles((fs) => [...fs, { name: safe, content: safe.endsWith('.py') ? '# new python file\n' : '' }]);
      setOpenName(safe);
    }
    setNewName('');
  };

  const deleteFile = (name: string) => {
    if (files.length <= 1) return;
    setFiles((fs) => {
      const next = fs.filter((f) => f.name !== name);
      if (openName === name) setOpenName(next[0].name);
      return next;
    });
  };

  const renameFile = (name: string) => {
    const nn = prompt('Rename file', name);
    if (!nn) return;
    const safe = nn.trim().replace(/[^\w.-]/g, '_');
    if (!safe || files.some((f) => f.name === safe)) return;
    setFiles((fs) => fs.map((f) => (f.name === name ? { ...f, name: safe } : f)));
    if (openName === name) setOpenName(safe);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setOut(null);
    setHintLevel(1);
    setMistakeSaved(false);
    try {
      if (isPy) {
        const r = await runPython(file.content, stdin);
        setOut({ ok: r.ok, text: [r.output, r.error].filter(Boolean).join('\n'), ms: r.ms });
      } else {
        // Simple client-side runner for txt/md preview: show content stats.
        setOut({ ok: true, text: `${file.name}: ${file.content.split('\n').length} lines, ${file.content.length} chars`, ms: 0 });
      }
      // first successful python run in the playground awards XP once per day
      if (isPy && !state.attempts['pg:run']?.done) {
        setState((s) => ({ ...s, attempts: { ...s.attempts, 'pg:run': { done: true, ts: Date.now() } } }));
        addXp(5, 'coding', 'First playground run');
      }
    } catch (e: any) {
      setOut({ ok: false, text: String(e?.message ?? e) });
    }
    setBusy(false);
  };

  const save = () => {
    if (!file) return;
    setState((s) => ({ ...s, savedCode: { ...s.savedCode, [codeSlot.playgroundPython]: file.content } }));
  };

  const stop = () => { stopPython(); setBusy(false); };
  const copyCode = async () => { await navigator.clipboard.writeText(file?.content ?? '').catch(() => {}); };

  // Error intelligence — traceback → markers + tutor engine content
  const errText = out && !out.ok ? out.text : '';
  const diag = useMemo(() => parseTraceback(errText), [errText]);
  const runnerExpl = errText ? explainError(errText) : null;
  const tutor = useMemo(() => explainDiagnostic(diag), [diag]);
  const errors: IdeError[] = useMemo(() => {
    if (!diag?.line) return [];
    return [{ line: diag.line, message: `${diag.kind}: ${diag.message}`, severity: 'error' }];
  }, [diag]);

  // Tutor content (deterministic, rule-based)
  const fixSuggestion = useMemo(() => {
    if (!diag) return null;
    const content = file?.content ?? '';
    // `<var>.mean()` etc. on a list/str → the offline-correct numpy equivalent.
    const attrFix = diag.kind === 'AttributeError'
      ? diag.message.match(/has no attribute '(mean|median|std|var|sqrt)'/)
      : null;
    if (attrFix) {
      const attr = attrFix[1];
      const use = content.match(new RegExp(`(\\w+)\\.${attr}\\s*\\(`));
      if (use) {
        let fixed = content.replace(use[0], `np.${attr}(${use[1]}`);
        if (!/\bimport\s+numpy\b/.test(fixed)) fixed = `import numpy as np\n${fixed}`;
        return fixed;
      }
    }
    return null;
  }, [diag, file]);

  const applyFix = () => {
    if (fixSuggestion) setContent(fixSuggestion);
  };

  const runCount = Object.keys(state.attempts).filter((k) => k.startsWith('st:')).length;

  // Tutor: attempt count drives the hint ladder; next-task from real state.
  const attemptCount = state.attempts['pg:run']?.done ? 2 : 1;
  const hints = useMemo(() => hintLadder(tutor, attemptCount + (out?.ok === false ? 1 : 0), stdin.trim().length > 0), [tutor, attemptCount, out, stdin]);
  const task = useMemo(() => nextTask(state, sections ?? []), [state, sections]);
  const saveMistake = () => {
    if (!tutor || !file || mistakeSaved) return;
    addMistake(mistakeFromDiagnostic(tutor, file.content, errText));
    setMistakeSaved(true);
  };

  return (
    <div className="ide-grid">
      {/* LEFT: EXPLORER */}
      <div className="card ide-left">
        <div className="row spread">
          <h3 className="row" style={{ gap: 8, margin: 0 }}><Folder size={16} /> {t('pg.explorer')}</h3>
          <span className="small muted">AI-Engineer-Lab</span>
        </div>
        <div style={{ marginTop: 10 }}>
          {files.map((f) => (
            <div
              key={f.name}
              className={`file-row ${f.name === openName ? 'on' : ''}`}
              onClick={() => open(f.name)}
              onDoubleClick={() => renameFile(f.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') open(f.name); }}
            >
              {f.name.endsWith('.py') ? <FileIcon size={14} color="var(--cyan)" /> : f.name.endsWith('.md') ? <FileText size={14} color="var(--violet)" /> : <FileText size={14} />}
              <span style={{ flex: 1 }}>{f.name}</span>
              <button className="mini-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteFile(f.name); }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createFile(); }}
            placeholder="new-file.py"
            aria-label="New file name"
            style={{ flex: 1, minWidth: 100, padding: '5px 8px', fontSize: '.78rem' }}
          />
          <button className="btn small" onClick={createFile}><FilePlus2 size={13} /></button>
        </div>
      </div>

      {/* CENTER: EDITOR + IO */}
      <div className="ide-center">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="row spread" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="row" style={{ gap: 8 }}>
              <FileIcon size={14} color="var(--cyan)" />
              <b className="small">{file?.name ?? t('pg.noFile')}</b>
            </span>
            <span className="small muted">python-learning / {file?.name}</span>
          </div>
          {file && (
            <Suspense fallback={<div className="editor loading" style={{ height: 340 }}>Loading editor…</div>}>
            <MonacoIDE
              value={file.content}
              language={isPy ? 'python' : 'plaintext'}
              onChange={setContent}
              onRun={run}
              onSave={save}
              errors={errors}
              height={340}
            />
            </Suspense>
          )}
        </div>

        {/* RUN CONTROLS */}
        <div className="row" style={{ margin: '10px 0' }}>
          <button className="btn primary" onClick={run} disabled={busy}><Play size={14} /> {t('pg.run')} <span className="kbd">Ctrl+↵</span></button>
          <button className="btn" onClick={stop} disabled={!busy}><Square size={13} /> {t('pg.stop')}</button>
          <button className="btn" onClick={() => { setContent(saved ?? DEFAULT_FILES[0].content); setOut(null); }}><RotateCcw size={14} /> {t('pg.reset')}</button>
          <button className="btn" onClick={copyCode}><Copy size={14} /> {t('pg.copy')}</button>
          <button className="btn" onClick={save}><Save size={14} /> {t('pg.save')}</button>
        </div>

        {/* PROGRAM INPUT */}
        <div className="card">
          <div className="row spread">
            <h3 className="row small" style={{ gap: 8, margin: 0 }}><ChevronRight size={14} /> {t('pg.input')}</h3>
            <span className="muted small">{t('pg.inputHint')}</span>
            <button className="btn small" onClick={() => { setStdin(''); taRef.current?.focus(); }}>{t('pg.clear')}</button>
          </div>
          <textarea
            ref={taRef}
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            rows={2}
            placeholder={'Ahetesham\n25\nPython'}
            aria-label={t('pg.input')}
            className="editor"
            style={{ marginTop: 8, minHeight: 56 }}
          />
        </div>

        {/* OUTPUT CONSOLE */}
        <div className="card">
          <div className="row spread">
            <h3 className="row small" style={{ gap: 8, margin: 0 }}><ChevronDown size={14} /> {t('pg.output')}</h3>
            <span className="row" style={{ gap: 8 }}>
              {out && <span className={`chip ${out.ok ? 'easy' : 'hard'}`}>{out.ok ? `✓ ${t('pg.success')}` : `✕ ${t('pg.failed')}`}</span>}
              {out?.ms != null && <span className="muted small">Run completed • {out.ms}ms</span>}
              <button className="btn small" onClick={() => setOut(null)}>{t('pg.clear')}</button>
            </span>
          </div>
          <pre className="codeblock" style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', minHeight: 40 }}>{out?.text || '—'}</pre>
        </div>
      </div>

      {/* RIGHT: TUTOR + PACKAGES */}
      <div className="ide-right">
        <div className="card">
          <div className="row spread">
            <h3 className="row small" style={{ gap: 8, margin: 0 }}><Bot size={16} color="var(--cyan)" /> {t('pg.tutor')}</h3>
            <button className="mini-btn" title={t('pg.packages')} onClick={() => setShowPackages((v) => !v)}><Package size={13} /></button>
          </div>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>{t('pg.tutorSub')}</p>
          <div className="lang-toggle" style={{ width: '100%' }}>
            {(['explain', 'hints', 'next'] as const).map((k) => (
              <button key={k} className={tutorTab === k ? 'on' : ''} style={{ flex: 1 }} onClick={() => setTutorTab(k)}>
                {k === 'explain' ? t('pg.explain') : k === 'hints' ? t('pg.hints') : t('pg.nextTask')}
              </button>
            ))}
          </div>

          {tutorTab === 'explain' && (
            errText && tutor ? (
              <div className="stat" style={{ marginTop: 10, borderColor: 'rgba(248,113,113,.4)' }}>
                <b style={{ color: 'var(--red)' }}>⚠ {tutor.headline}</b>
                <p className="small mono" style={{ margin: '4px 0' }}>{tutor.kind}: {diag?.message}</p>
                <p className="small"><b>WHAT HAPPENED:</b> {tutor.what}</p>
                <p className="small"><b>WHY:</b> {tutor.cause}</p>
                <p className="small"><b>HOW TO FIX:</b> {tutor.fix}</p>
                <pre className="codeblock" style={{ fontSize: '.72rem', margin: '6px 0' }}><code>{tutor.example}</code></pre>
                <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  {fixSuggestion && <button className="btn small primary" onClick={applyFix}><Wrench size={12} /> {t('pg.fixIt')}</button>}
                  <button className="btn small" onClick={saveMistake} disabled={mistakeSaved}>
                    {mistakeSaved ? '✓ Mistake Tracker me save ho gaya' : 'Save to Mistake Tracker'}
                  </button>
                </div>
              </div>
            ) : errText && runnerExpl ? (
              <div className="stat" style={{ marginTop: 10, borderColor: 'rgba(248,113,113,.4)' }}>
                <b style={{ color: 'var(--red)' }}>⚠ {t('pg.errorOn')} {diag?.line ?? '?'}</b>
                <p className="small mono" style={{ margin: '4px 0' }}>{diag?.kind}: {diag?.message}</p>
                <p className="small">{runnerExpl.what}</p>
                <p className="small muted">{runnerExpl.cause}</p>
                <div className="row" style={{ marginTop: 8 }}>
                  {fixSuggestion && <button className="btn small primary" onClick={applyFix}><Wrench size={12} /> {t('pg.fixIt')}</button>}
                </div>
              </div>
            ) : (
              <div className="stat" style={{ marginTop: 10 }}>
                <b className="small">{file?.name}</b>
                <p className="small muted" style={{ marginTop: 4 }}>
                  {isPy
                    ? 'Run karo — main.py me numpy version, greeting aur array mean print hoga. Error aaye to yahan explanation milegi.'
                    : 'Ye ek text file hai — .py files run hoti hain.'}
                </p>
              </div>
            )
          )}
          {tutorTab === 'hints' && (
            <div className="stat" style={{ marginTop: 10 }}>
              <b className="small row" style={{ gap: 6 }}><Lightbulb size={13} color="var(--amber)" /> {t('pg.hint')} <span className="muted">({Math.min(hintLevel, hints.length)}/{hints.length})</span></b>
              <div style={{ marginTop: 6 }}>
                {hints.slice(0, hintLevel).map((h, i) => (
                  <p key={i} className="small" style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>💡 {h}</p>
                ))}
              </div>
              {hintLevel < hints.length && (
                <button className="btn small" style={{ marginTop: 6 }} onClick={() => setHintLevel((v) => v + 1)}>Aur hint chahiye →</button>
              )}
              {!errText && <p className="small muted" style={{ marginTop: 6 }}>Tip: input() values Program Input box me ek-per-line do. np.mean(arr) — function ko call karna mat bhoolo.</p>}
            </div>
          )}
          {tutorTab === 'next' && (
            <div className="stat" style={{ marginTop: 10 }}>
              <b className="small">{task.label}</b>
              <p className="small muted" style={{ margin: '4px 0 8px' }}>{task.reason}</p>
              <button className="btn small primary" onClick={() => nav(task.route)}>Start →</button>
              <p className="small muted" style={{ marginTop: 8 }}>Playground runs so far: {runCount} stage activities</p>
            </div>
          )}
        </div>

        {showPackages && (
          <div className="card">
            <h3 className="row small" style={{ gap: 8, margin: 0 }}><Package size={15} /> {t('pg.packages')}</h3>
            <div style={{ marginTop: 8 }}>
              {OFFLINE_PACKAGES.map((p) => (
                <div key={p.name} className="row spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="small"><b>{p.name}</b> <span className="muted">{p.version}</span></span>
                  {p.availableOffline ? <span className="chip easy">✓ {t('pg.installedAlready')}</span> : <span className="chip hard">{t('pg.notOffline')}</span>}
                </div>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>{findPkg('numpy')?.description}</p>
          </div>
        )}

        {/* LEARNING PROGRESS mini */}
        <div className="card">
          <h3 className="row small" style={{ gap: 8, margin: 0 }}>🎯 Learning Progress</h3>
          <div className="row spread small" style={{ marginTop: 8 }}>
            <span>{state.xp} XP · Level {Math.floor(Math.sqrt(state.xp / 50)) + 1}</span>
            <span>🔥 {state.streak.current}d</span>
          </div>
          <div className="bar" style={{ marginTop: 6 }}>
            <div style={{ width: `${Math.min(100, ((state.xp % 50) / 50) * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
