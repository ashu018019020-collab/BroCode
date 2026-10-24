import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FileText, Library } from 'lucide-react';
import { useStore, setState } from '../../core/storage/store';

/**
 * The bundled books. `guide.pdf` is the original curriculum book and keeps the plain `/pdf/:page`
 * URL space; `playbook.pdf` is the V15 source and lives under `/pdf/playbook/:page`. A page number
 * only means something inside ONE book, so the two never share a path.
 */
const SOURCES = {
  guide: { file: 'guide.pdf', label: 'Curriculum book', note: 'secondary reference — the interactive curriculum is primary' },
  playbook: { file: 'playbook.pdf', label: 'Playbook V15', note: 'second source — its items are already imported into each section\'s Question Bank' },
} as const;
type SourceKey = keyof typeof SOURCES;

/**
 * Bookmarks predate the second book and are keyed `b<page>`, which still means guide.pdf. The
 * playbook's are keyed `pb<page>`, so the id itself says which book a bookmark opens — no store
 * migration, and an old bookmark keeps working.
 */
const bookmarkId = (source: SourceKey, page: number) => (source === 'playbook' ? `pb${page}` : `b${page}`);
const bookmarkSource = (id: string): SourceKey => (id.startsWith('pb') ? 'playbook' : 'guide');

export default function PDFReader() {
  const params = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const state = useStore();
  const source: SourceKey = loc.pathname.startsWith('/pdf/playbook') ? 'playbook' : 'guide';
  const book = SOURCES[source];
  const [page, setPage] = useState(Number(params.page) || 1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1.1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    // The old document must not stay renderable while the other book loads: its page count and
    // pages belong to a different file, and rendering them under the new title would be a lie.
    pdfRef.current = null;
    setNumPages(0);
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const base = import.meta.env.BASE_URL ?? '/';
      (pdfjs as any).GlobalWorkerOptions.workerSrc = new URL(`${base}pdf/pdf.worker.min.js`, document.baseURI).href;
      const doc = await (pdfjs as any).getDocument(new URL(`${base}pdf/${book.file}`, document.baseURI).href).promise;
      if (cancelled) return;
      pdfRef.current = doc;
      setNumPages(doc.numPages);
    })();
    return () => { cancelled = true; };
  }, [book.file]);

  // A deep link (or a bookmark) that changes the page in the URL moves the reader too.
  useEffect(() => { setPage(Number(params.page) || 1); }, [params.page, source]);

  useEffect(() => {
    (async () => {
      const doc = pdfRef.current;
      if (!doc) return;
      const p = Math.min(Math.max(1, page), doc.numPages);
      const pg = await doc.getPage(p);
      const viewport = pg.getViewport({ scale: zoom });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width; canvas.height = viewport.height;
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    })();
  }, [page, zoom, numPages, source]);

  const goto = (n: number) => { setPage(Math.min(Math.max(1, n), numPages || n)); };

  const openBookmark = (b: { id: string; page: number }) => {
    const target = bookmarkSource(b.id);
    if (target === source) goto(b.page);
    else nav(target === 'playbook' ? `/pdf/playbook/${b.page}` : `/pdf/${b.page}`);
  };

  return (
    <div>
      <h1 className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <FileText size={20} /> PDF Reader <span className="chip">{book.label}</span>
        <span className="chip">{book.note}</span>
      </h1>

      {/* Source switcher — both books ship with the app and are read offline. Page 1 of each: a page
          number does not carry across documents, so switching never pretends that it does. */}
      <div className="row" style={{ margin: '10px 0', flexWrap: 'wrap' }}>
        {(Object.keys(SOURCES) as SourceKey[]).map((key) => (
          <button
            key={key}
            className={`stagepill ${key === source ? 'active' : ''}`}
            aria-pressed={key === source}
            onClick={() => nav(key === 'playbook' ? '/pdf/playbook' : '/pdf')}
          >
            <Library size={12} /> {SOURCES[key].label}
          </button>
        ))}
        {source === 'playbook' && <Link className="btn small" to="/playbook">📘 Chapter index</Link>}
      </div>

      <div className="row" style={{ margin: '10px 0', flexWrap: 'wrap' }}>
        <button className="btn small" onClick={() => goto(page - 1)} disabled={page <= 1}>←</button>
        <span className="small">Page <b>{page}</b> / {numPages || '…'}</span>
        <button className="btn small" onClick={() => goto(page + 1)} disabled={page >= numPages}>→</button>
        <button className="btn small" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}>−</button>
        <button className="btn small" onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}>+</button>
        <input
          type="number"
          min={1}
          value={page}
          onChange={(e) => goto(Number(e.target.value))}
          style={{ width: 80 }}
          aria-label="Jump to page"
        />
        <button
          className="btn small"
          onClick={() => {
            const id = bookmarkId(source, page);
            const label = source === 'playbook' ? `Playbook p.${page}` : `Page ${page}`;
            setState((s) => ({ ...s, bookmarks: [...s.bookmarks.filter((b) => b.id !== id), { id, label, page }] }));
          }}
        >
          🔖 Bookmark this page
        </button>
      </div>

      {state.bookmarks.length > 0 && (
        <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          {state.bookmarks.map((b) => (
            <button key={b.id} className="stagepill" onClick={() => openBookmark(b)}>🔖 {b.label}</button>
          ))}
        </div>
      )}

      <div className="card pdfbox" style={{ overflow: 'auto', textAlign: 'center' }}>
        <canvas ref={canvasRef} style={{ border: '1px solid var(--border)', borderRadius: 8 }} />
        {!numPages && <p className="muted small">Loading PDF…</p>}
      </div>
    </div>
  );
}
