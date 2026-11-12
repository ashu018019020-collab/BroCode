import { useMemo, useState } from 'react';
import { BarChart3, Grid3x3, Layers, Sigma } from 'lucide-react';
import {
  broadcastShape, dtypeMemory, DTYPE_BYTES, gridShape, maskFilter, matmul, missingSummary, parseMatrix,
  parseShape, percentile, reshapeGrid, shapeSize, shapeStrides, sliceIndices, statsSummary, transpose,
  uniformSamples, type CompareOp, type Shape,
} from '../../core/learning/numpy-tools';

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line, #d6dbe4)',
  background: 'var(--bg2, #fff)', color: 'inherit', fontFamily: 'ui-monospace, monospace', fontSize: 13,
} as const;

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
      <span className="small muted" style={{ display: 'block' }}>{label}</span>
      <b style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</b>
    </div>
  );
}

/** Draws a shape as an index grid, so the learner sees which position each cell is. */
function ArrayVisualizer() {
  const [raw, setRaw] = useState('2, 3');
  const shape = parseShape(raw);
  const grid = shape ? gridShape(shape) : null;
  const draws = Boolean(shape && grid && shapeSize(shape) <= 24 && grid.rows <= 6 && grid.cols <= 8);
  const indices = useMemo(() => {
    if (!shape || shape.length !== 2) return null;
    return Array.from({ length: shape[0] }, (_, i) => Array.from({ length: shape[1] }, (_, j) => `[${i},${j}]`));
  }, [shape]);

  return (
    <div>
      <label className="small muted" htmlFor="nvisual-shape">Shape — enter 1 to 4 dimensions</label>
      <input id="nvisual-shape" value={raw} onChange={(e) => setRaw(e.target.value)} style={inputStyle} />
      {!shape && <p className="small" style={{ color: 'var(--red)' }}>Use positive whole numbers, e.g. <code>2, 3</code> or <code>2x3</code>.</p>}
      {shape && (
        <>
          <div className="row" style={{ gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
            <span className="chip">ndim · {shape.length}</span>
            <span className="chip">size · {shapeSize(shape)}</span>
            <span className="chip">strides · ({shapeStrides(shape).join(', ')})</span>
            <span className="chip">C-order</span>
          </div>
          <pre className="codeblock" style={{ margin: '0 0 8px' }}>{`a = np.zeros((${shape.join(', ')}), dtype=np.int64)\na.shape   # (${shape.join(', ')})`}</pre>
          {indices ? (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${indices[0].length}, minmax(48px, 1fr))`, gap: 6 }}>
              {indices.flatMap((row, i) => row.map((cell, j) => (
                <div
                  key={cell}
                  style={{
                    padding: '10px 4px', textAlign: 'center', borderRadius: 8, fontFamily: 'ui-monospace, monospace',
                    fontSize: 12, border: '1px solid var(--line, #d6dbe4)',
                    background: (i + j) % 2 ? 'var(--bg2, #f6f8fb)' : 'transparent',
                  }}
                >{cell}</div>
              )))}
            </div>
          ) : shape.length === 1 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(44px, 1fr))', gap: 6 }}>
              {Array.from({ length: shape[0] }, (_, i) => (
                <div key={i} style={{ padding: '10px 4px', textAlign: 'center', borderRadius: 8, border: '1px solid var(--line, #d6dbe4)', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>[{i}]</div>
              ))}
            </div>
          ) : draws ? (
            <p className="small muted" style={{ margin: 0 }}>{shape.length}-D shape accepted; the grid shows the first two axes.</p>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>That many cells is too many to draw — pick a smaller shape.</p>
          )}
        </>
      )}
    </div>
  );
}

function BroadcastingSimulator() {
  const [left, setLeft] = useState('3, 1');
  const [right, setRight] = useState('1, 4');
  const a = parseShape(left);
  const b = parseShape(right);
  const result = a && b ? broadcastShape(a, b) : null;

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px' }}>
          <label className="small muted" htmlFor="bcast-a">Shape A</label>
          <input id="bcast-a" value={left} onChange={(e) => setLeft(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label className="small muted" htmlFor="bcast-b">Shape B</label>
          <input id="bcast-b" value={right} onChange={(e) => setRight(e.target.value)} style={inputStyle} />
        </div>
      </div>
      {result && (
        <>
          <p className="small" style={{ margin: '8px 0 4px' }}>
            {result.ok
              ? <>Broadcastable → <b>({result.shape?.join(', ')})</b> with {result.shape ? shapeSize(result.shape) : 0} cells</>
              : <span style={{ color: 'var(--red)' }}>Not broadcastable — NumPy raises ValueError here.</span>}
          </p>
          <pre className="codeblock" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {result.ok
              ? `np.broadcast_shapes((${a?.join(', ')}), (${b?.join(', ')}))  # (${result.shape?.join(', ')})`
              : `np.broadcast_shapes((${a?.join(', ')}), (${b?.join(', ')}))  # ValueError`}
            {'\n'}
            {result.steps.join('\n')}
          </pre>
        </>
      )}
      {!result && <p className="small" style={{ color: 'var(--red)' }}>Both shapes need positive whole numbers.</p>}
    </div>
  );
}

function StatisticsPlayground() {
  const [raw, setRaw] = useState('12, 15, 18, 22, 30, 41');
  const values = raw.split(/[,\s]+/).filter(Boolean).map(Number);
  const valid = values.length > 0 && values.every((n) => Number.isFinite(n));
  const stats = valid ? statsSummary(values) : null;
  const quartileProbe = valid ? percentile(values, 25) : null;

  return (
    <div>
      <label className="small muted" htmlFor="nstats">Numbers — commas or spaces</label>
      <textarea id="nstats" value={raw} onChange={(e) => setRaw(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
      {!valid && <p className="small" style={{ color: 'var(--red)' }}>Enter only numbers, separated by commas or spaces.</p>}
      {stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginTop: 8 }}>
            <Cell label="count" value={String(stats.count)} />
            <Cell label="mean" value={num(stats.mean)} />
            <Cell label="median" value={num(stats.median)} />
            <Cell label="std (ddof=0)" value={num(stats.std)} />
            <Cell label="variance" value={num(stats.variance)} />
            <Cell label="min → max" value={`${num(stats.min)} → ${num(stats.max)}`} />
            <Cell label="p25 / p50 / p75" value={`${num(stats.p25)} / ${num(stats.p50)} / ${num(stats.p75)}`} />
            <Cell label="range (ptp)" value={num(stats.range)} />
          </div>
          <pre className="codeblock" style={{ margin: '8px 0 0' }}>{`a = np.array([${values.join(', ')}])
a.mean(), a.std(), np.percentile(a, 25)  # ${num(stats.mean)}, ${num(stats.std)}, ${num(quartileProbe as number)}`}</pre>
        </>
      )}
    </div>
  );
}

function MatrixLab() {
  const [left, setLeft] = useState('1, 2; 3, 4');
  const [right, setRight] = useState('5, 6; 7, 8');
  const a = parseMatrix(left);
  const b = parseMatrix(right);
  const product = a && b ? matmul(a, b) : null;
  const showMatrix = (m: number[][] | null) => (m ? m.map((r) => r.map(num).join('  ')).join('\n') : '—');

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <label className="small muted" htmlFor="nmat-a">Matrix A — rows by <code>;</code></label>
          <textarea id="nmat-a" value={left} onChange={(e) => setLeft(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <label className="small muted" htmlFor="nmat-b">Matrix B</label>
          <textarea id="nmat-b" value={right} onChange={(e) => setRight(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
      </div>
      {(!a || !b) && <p className="small" style={{ color: 'var(--red)' }}>Each row needs the same number of numbers, e.g. <code>1, 2; 3, 4</code>.</p>}
      {a && b && (
        <>
          <div className="row" style={{ gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
            <span className="chip">A · {a.length}×{a[0].length}</span>
            <span className="chip">B · {b.length}×{b[0].length}</span>
            <span className="chip">Aᵀ · {a[0].length}×{a.length}</span>
            <span className={`chip${product ? ' easy' : ' hard'}`}>{product ? 'A @ B works' : 'A @ B raises ValueError'}</span>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <span className="small muted">A @ B</span>
              <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{showMatrix(product)}</pre>
            </div>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <span className="small muted">A.T</span>
              <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{showMatrix(transpose(a))}</pre>
            </div>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Prefer <code>np.linalg.solve(A, b)</code> over computing <code>inv(A)</code> and multiplying — it is
            more stable and usually faster.
          </p>
        </>
      )}
    </div>
  );
}

function SlicingExplorer() {
  const [length, setLength] = useState('10');
  const [start, setStart] = useState('');
  const [stop, setStop] = useState('');
  const [step, setStep] = useState('1');
  const n = Number(length);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const plan = Number.isInteger(n) ? sliceIndices(n, num(start), num(stop), Number(step) || 0) : null;
  const chosen = new Set(plan?.indices ?? []);
  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 70px' }}><label className="small muted" htmlFor="sl-len">length</label><input id="sl-len" value={length} onChange={(e) => setLength(e.target.value)} style={inputStyle} /></div>
        <div style={{ flex: '1 1 70px' }}><label className="small muted" htmlFor="sl-start">start</label><input id="sl-start" value={start} onChange={(e) => setStart(e.target.value)} placeholder="blank" style={inputStyle} /></div>
        <div style={{ flex: '1 1 70px' }}><label className="small muted" htmlFor="sl-stop">stop</label><input id="sl-stop" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="blank" style={inputStyle} /></div>
        <div style={{ flex: '1 1 70px' }}><label className="small muted" htmlFor="sl-step">step</label><input id="sl-step" value={step} onChange={(e) => setStep(e.target.value)} style={inputStyle} /></div>
      </div>
      {plan?.error && <p className="small" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{plan.error}</p>}
      {plan && !plan.error && (
        <>
          <p className="small" style={{ margin: '8px 0 4px' }}>
            <code>a[{start || ''}:{stop || ''}:{step || ''}]</code> selects {plan.indices.length} of {n} elements
            {plan.indices.length ? ` — indices ${plan.indices.join(', ')}` : ' — an empty array'}.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(34px, 1fr))', gap: 4 }}>
            {Array.from({ length: Math.max(0, Math.min(40, n)) }, (_, i) => (
              <div key={i} style={{
                padding: '6px 2px', textAlign: 'center', borderRadius: 6, fontSize: 12,
                fontFamily: 'ui-monospace, monospace', border: '1px solid var(--line, #d6dbe4)',
                background: chosen.has(i) ? 'rgba(37, 99, 235, 0.18)' : 'transparent',
                borderColor: chosen.has(i) ? 'var(--blue, #2563eb)' : undefined,
              }}>{i}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MaskExplorer() {
  const [raw, setRaw] = useState('4, 11, 10, 15, 3');
  const [op, setOp] = useState<CompareOp>('>');
  const [threshold, setThreshold] = useState('10');
  const values = raw.split(/[,\s]+/).filter(Boolean).map(Number);
  const valid = values.length > 0 && values.every((v) => Number.isFinite(v));
  const result = valid ? maskFilter(values, op, Number(threshold)) : null;
  return (
    <div>
      <label className="small muted" htmlFor="mk-values">Values</label>
      <input id="mk-values" value={raw} onChange={(e) => setRaw(e.target.value)} style={inputStyle} />
      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <select value={op} onChange={(e) => setOp(e.target.value as CompareOp)} aria-label="comparison" style={{ ...inputStyle, width: 'auto' }}>
          {['>', '>=', '<', '<=', '==', '!='].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-label="threshold" style={{ ...inputStyle, width: 110 }} />
      </div>
      {result && (
        <>
          <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{`mask = a ${op} ${threshold}   # ${result.mask.map((b) => (b ? 1 : 0)).join(' ')}
a[mask]             # [${result.selected.join(' ')}]`}</pre>
          <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {values.map((v, i) => (
              <span key={`${v}-${i}`} className={`chip${result.mask[i] ? ' easy' : ''}`} style={{ fontFamily: 'ui-monospace, monospace' }}>{v}</span>
            ))}
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>{result.selected.length} of {values.length} cells pass the comparison.</p>
        </>
      )}
    </div>
  );
}

function ReshapeExplorer() {
  const [rows, setRows] = useState('2');
  const [cols, setCols] = useState('3');
  const r = Number(rows);
  const c = Number(cols);
  const grid = reshapeGrid(r, c);
  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 100px' }}><label className="small muted" htmlFor="rs-rows">rows</label><input id="rs-rows" value={rows} onChange={(e) => setRows(e.target.value)} style={inputStyle} /></div>
        <div style={{ flex: '1 1 100px' }}><label className="small muted" htmlFor="rs-cols">cols</label><input id="rs-cols" value={cols} onChange={(e) => setCols(e.target.value)} style={inputStyle} /></div>
      </div>
      {grid.length ? (
        <>
          <pre className="codeblock" style={{ margin: '8px 0 0' }}>{`np.arange(${r * c}).reshape(${r}, ${c})   # or reshape(-1, ${c})`}</pre>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(c, 8)}, minmax(36px, 1fr))`, gap: 4, marginTop: 8 }}>
            {grid.flatMap((row, i) => row.map((flat, j) => (
              <div key={flat} style={{ padding: '6px 2px', textAlign: 'center', fontSize: 12, borderRadius: 6, border: '1px solid var(--line, #d6dbe4)', fontFamily: 'ui-monospace, monospace' }}>
                {flat}<span className="muted" style={{ fontSize: 9, display: 'block' }}>[{i},{j}]</span>
              </div>
            )))}
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Flat index runs left to right, then down — C order. {r * c} cells.</p>
        </>
      ) : <p className="small" style={{ color: 'var(--red)' }}>Rows and columns must be positive whole numbers.</p>}
    </div>
  );
}

function MemoryCalculator() {
  const [dtype, setDtype] = useState('float64');
  const [count, setCount] = useState('1000000');
  const mem = dtypeMemory(dtype, Number(count));
  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 130px' }}>
          <label className="small muted" htmlFor="mc-dtype">dtype</label>
          <select id="mc-dtype" value={dtype} onChange={(e) => setDtype(e.target.value)} style={inputStyle}>
            {Object.keys(DTYPE_BYTES).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 130px' }}><label className="small muted" htmlFor="mc-count">elements</label><input id="mc-count" value={count} onChange={(e) => setCount(e.target.value)} style={inputStyle} /></div>
      </div>
      {mem ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginTop: 8 }}>
            <Cell label="itemsize" value={`${DTYPE_BYTES[dtype]} B`} />
            <Cell label="nbytes" value={String(mem.bytes)} />
            <Cell label="readable" value={mem.readable} />
          </div>
          <pre className="codeblock" style={{ margin: '8px 0 0' }}>{`np.zeros(${count}, dtype=np.${dtype}).nbytes  # ${mem.bytes}`}</pre>
        </>
      ) : <p className="small" style={{ color: 'var(--red)' }}>Elements must be a whole number.</p>}
    </div>
  );
}

function RngPlayground() {
  const [seed, setSeed] = useState('42');
  const [count, setCount] = useState('5');
  const values = uniformSamples(Number(seed) || 0, Number(count) || 0);
  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 110px' }}><label className="small muted" htmlFor="rng-seed">seed</label><input id="rng-seed" value={seed} onChange={(e) => setSeed(e.target.value)} style={inputStyle} /></div>
        <div style={{ flex: '1 1 110px' }}><label className="small muted" htmlFor="rng-count">count</label><input id="rng-count" value={count} onChange={(e) => setCount(e.target.value)} style={inputStyle} /></div>
      </div>
      <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{`rng = np.random.default_rng(${seed})
rng.random(${count})`}</pre>
      <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        {values.map((v, i) => <span key={i} className="chip" style={{ fontFamily: 'ui-monospace, monospace' }}>{v}</span>)}
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        Same seed, same numbers — that is reproducibility. This panel uses a small deterministic
        xorshift so it runs without a kernel; the NumPy snippet above is the real call, and Code Bro
        can run it for the exact PCG64 stream.
      </p>
    </div>
  );
}

function MissingExplorer() {
  const [raw, setRaw] = useState('1, null, -999, 5, nan');
  const [sentinel, setSentinel] = useState('-999');
  const parsed = raw.split(/[,\s]+/).filter(Boolean).map((t) => {
    if (t.toLowerCase() === 'null' || t.toLowerCase() === 'nan') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  });
  const summary = missingSummary(parsed, sentinel.trim() === '' ? null : Number(sentinel));
  return (
    <div>
      <label className="small muted" htmlFor="ms-values">Values (null / nan allowed)</label>
      <input id="ms-values" value={raw} onChange={(e) => setRaw(e.target.value)} style={inputStyle} />
      <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 120px' }}><label className="small muted" htmlFor="ms-sentinel">missing sentinel</label><input id="ms-sentinel" value={sentinel} onChange={(e) => setSentinel(e.target.value)} style={inputStyle} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginTop: 8 }}>
        <Cell label="cells" value={String(summary.total)} />
        <Cell label="missing" value={String(summary.missing)} />
        <Cell label="present" value={String(summary.present)} />
        <Cell label="mean (present)" value={summary.meanPresent === null ? '—' : num(summary.meanPresent)} />
        <Cell label="min / max" value={summary.minPresent === null ? '—' : `${num(summary.minPresent)} / ${num(summary.maxPresent as number)}`} />
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        A plain <code>.mean()</code> on this data returns nan (or a number dragged toward the sentinel).
        <code> np.nanmean</code> or a masked array skips the missing cells — the count above shows what it would ignore.
      </p>
    </div>
  );
}

const TOOLS = [
  { key: 'array', label: 'Array visualizer', icon: Grid3x3, render: () => <ArrayVisualizer /> },
  { key: 'broadcast', label: 'Broadcasting', icon: Layers, render: () => <BroadcastingSimulator /> },
  { key: 'slice', label: 'Slicing', icon: Grid3x3, render: () => <SlicingExplorer /> },
  { key: 'mask', label: 'Boolean mask', icon: Layers, render: () => <MaskExplorer /> },
  { key: 'reshape', label: 'Reshape', icon: Grid3x3, render: () => <ReshapeExplorer /> },
  { key: 'stats', label: 'Statistics', icon: Sigma, render: () => <StatisticsPlayground /> },
  { key: 'matrix', label: 'Matrix lab', icon: BarChart3, render: () => <MatrixLab /> },
  { key: 'memory', label: 'dtype memory', icon: BarChart3, render: () => <MemoryCalculator /> },
  { key: 'rng', label: 'Random & seeds', icon: Sigma, render: () => <RngPlayground /> },
  { key: 'missing', label: 'Missing values', icon: Sigma, render: () => <MissingExplorer /> },
] as const;

/**
 * The module's interactive tools, shared by all modules.
 *
 * Every panel computes with the pure rules in `core/learning/numpy-tools.ts`, so the numbers on screen
 * are the values NumPy would produce — no placeholder cards, no canned outputs.
 */
export function NTools() {
  const [tab, setTab] = useState<(typeof TOOLS)[number]['key']>('array');
  const active = TOOLS.find((t) => t.key === tab) ?? TOOLS[0];
  const shape = parseShape('2, 3');
  const sample: Shape = shape ?? [2, 3];

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <b className="small">Interactive NumPy tools</b>
        <span className="small muted">computed live · {shapeStrides(sample).length} axes supported</span>
      </div>
      <div className="row" style={{ gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.key}
              type="button"
              className={`chip${tool.key === tab ? ' easy' : ''}`}
              style={{ cursor: 'pointer' }}
              aria-pressed={tool.key === tab}
              onClick={() => setTab(tool.key)}
            >
              <Icon size={12} /> {tool.label}
            </button>
          );
        })}
      </div>
      {active.render()}
    </div>
  );
}
