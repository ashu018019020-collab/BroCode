import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore, setState } from '../offline/store';

export default function PDFReader() {
  const params = useParams();
  const nav = useNavigate();
  const state = useStore();
  const [page, setPage] = useState(Number(params.page) || 1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1.1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const base = import.meta.env.BASE_URL ?? '/';
      (pdfjs as any).GlobalWorkerOptions.workerSrc = new URL(`${base}pdf/pdf.worker.min.js`, document.baseURI).href;
      const doc = await (pdfjs as any).getDocument(new URL(`${base}pdf/guide.pdf`, document.baseURI).href).promise;
      if (cancelled) return;
      pdfRef.current = doc;
      setNumPages(doc.numPages);
    })();
    return () => { cancelled = true; };
  }, []);

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
  }, [page, zoom, numPages]);

  const goto = (n: number) => { setPage(Math.min(Math.max(1, n), numPages || n)); };

  return (
    <div>
      <h1>📄 PDF Reader <span className="chip">secondary reference — the interactive curriculum is primary</span></h1>
      <div className="row" style={{ margin: '10px 0' }}>
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
          onClick={() => setState((s) => ({ ...s, bookmarks: [...s.bookmarks.filter((b) => b.page !== page), { id: `b${page}`, label: `Page ${page}`, page }] }))}
        >
          🔖 Bookmark this page
        </button>
      </div>

      {state.bookmarks.length > 0 && (
        <div className="row" style={{ marginBottom: 10 }}>
          {state.bookmarks.map((b) => (
            <button key={b.id} className="stagepill" onClick={() => goto(b.page)}>🔖 {b.label}</button>
          ))}
        </div>
      )}

      <div className="card pdfbox" style={{ overflow: 'auto', textAlign: 'center' }}>
        <canvas ref={canvasRef} style={{ border: '1px solid var(--border)', borderRadius: 8 }} />
        {!numPages && <p className="muted small">Loading PDF (local file, no internet)…</p>}
      </div>
    </div>
  );
}
