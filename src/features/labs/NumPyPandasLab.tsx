import { useState } from 'react';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { JupyterNotebook } from '../../components/code/JupyterNotebook';
import { DATASETS } from '../../core/data/datasets';
import { codeSlot } from '../../core/platform/keys';

const NUMPY_EXAMPLES = [
  { title: 'Array basics', code: 'import numpy as np\na = np.array([[1, 2, 3], [4, 5, 6]])\nprint(a.shape, a.ndim, a.dtype)\nprint(a[1, 2])\nprint(a[:, 1])\n' },
  { title: 'Broadcasting + vectorization', code: 'import numpy as np\na = np.array([1, 2, 3])\nprint(a * 10)\nprint(a + np.array([10, 20, 30]))\nprint(np.sqrt(a))\n' },
  { title: 'Axis + aggregation', code: 'import numpy as np\nm = np.array([[1, 2], [3, 4]])\nprint(m.sum(axis=0))  # columns\nprint(m.sum(axis=1))  # rows\nprint(m.mean(), m.max())\n' },
  { title: 'AI-flavored: cosine similarity', code: 'import numpy as np\ndef cosine(a, b):\n    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))\nprint(cosine(np.array([1, 0, 1]), np.array([1, 1, 0])))\n' },
];

const PANDAS_EXAMPLES = [
  { title: 'DataFrame inspect', code: 'import pandas as pd\ndf = pd.DataFrame({"name": ["A", "B", "C"], "marks": [88, 72, 95]})\nprint(df.head())\nprint(df["marks"].describe())\n' },
  { title: 'Filter + sort', code: 'import pandas as pd\ndf = pd.DataFrame({"name": ["A", "B", "C", "D"], "marks": [88, 72, 95, 60]})\nprint(df[df["marks"] > 70].sort_values("marks", ascending=False))\n' },
  { title: 'GroupBy + aggregate', code: 'import pandas as pd\ndf = pd.DataFrame({"city": ["Pune", "Delhi", "Pune", "Delhi"], "marks": [80, 90, 70, 85]})\nprint(df.groupby("city")["marks"].agg(["count", "mean"]))\n' },
  { title: 'Missing values', code: 'import pandas as pd\nimport numpy as np\ndf = pd.DataFrame({"a": [1, np.nan, 3]})\nprint(df.isna().sum())\nprint(df.fillna(0))\n' },
];

/** Per-dataset pandas workflows — every example runs offline against the seeded CSV. */
const DATA_EXAMPLES: Record<string, { title: string; code: string }[]> = {
  students: [
    { title: 'Load + inspect', code: `import pandas as pd\ndf = pd.read_csv('students.csv')\nprint(df.shape)\nprint(df.head())\nprint(df.describe())\n` },
    { title: 'Filter + sort', code: `import pandas as pd\ndf = pd.read_csv('students.csv')\ntop = df[df['marks'] > 80].sort_values('marks', ascending=False)\nprint(top[['name', 'city', 'marks']])\n` },
    { title: 'GroupBy + aggregate', code: `import pandas as pd\ndf = pd.read_csv('students.csv')\nprint(df.groupby('city')['marks'].agg(['count', 'mean']))\n` },
    { title: 'Top performer', code: `import pandas as pd\ndf = pd.read_csv('students.csv')\nprint(df['city'].value_counts())\nprint(df.loc[df['marks'].idxmax(), ['name', 'marks']])\n` },
  ],
  sales: [
    { title: 'Revenue by product', code: `import pandas as pd\ndf = pd.read_csv('sales.csv')\nrev = df.groupby('product')['revenue'].sum().sort_values(ascending=False)\nprint(rev)\n` },
    { title: 'Derived column', code: `import pandas as pd\ndf = pd.read_csv('sales.csv')\ndf['unit_price'] = df['revenue'] / df['qty']\nprint(df.nlargest(3, 'unit_price')[['product', 'qty', 'unit_price']])\n` },
  ],
  customers: [
    { title: 'Join two datasets', code: `import pandas as pd\ns = pd.read_csv('students.csv')\nc = pd.read_csv('customers.csv')\nm = pd.merge(s, c[['name', 'joined']], on='name', how='left')\nprint(m[['name', 'city', 'joined']])\n` },
    { title: 'Missing values', code: `import pandas as pd\ns = pd.read_csv('students.csv')\nc = pd.read_csv('customers.csv')\nm = pd.merge(s, c[['name', 'joined']], on='name', how='left')\nprint('missing joined:', m['joined'].isna().sum())\nm['joined'] = m['joined'].fillna('never')\nprint(m[['name', 'joined']])\n` },
  ],
  employees: [
    { title: 'Dept salary stats', code: `import pandas as pd\ndf = pd.read_csv('employees.csv')\nprint(df.groupby('dept')['salary'].agg(['count', 'mean', 'max']))\n` },
    { title: 'Pandas HAVING', code: `import pandas as pd\ndf = pd.read_csv('employees.csv')\ng = df.groupby('dept')['salary'].mean()\nprint(g[g > 70000])  # the pandas equivalent of SQL HAVING\n` },
  ],
  expenses: [
    { title: 'Clean dates', code: `import pandas as pd\ndf = pd.read_csv('expenses.csv', parse_dates=['date'])\ndf['weekday'] = df['date'].dt.day_name()\nprint(df[['date', 'weekday', 'category', 'amount']])\n` },
    { title: 'Category totals', code: `import pandas as pd\ndf = pd.read_csv('expenses.csv')\nprint(df.groupby('category')['amount'].sum().sort_values(ascending=False))\n` },
  ],
  chat_logs: [
    { title: 'Intent analysis', code: `import pandas as pd\ndf = pd.read_csv('chat_logs.csv')\nprint(df['intent'].value_counts())\nprint(df.groupby('intent')['confidence'].mean().sort_values(ascending=False))\n` },
    { title: 'Low confidence', code: `import pandas as pd\ndf = pd.read_csv('chat_logs.csv')\nlow = df[df['confidence'] < 0.75]\nprint(low[['user', 'intent', 'confidence']])\n` },
  ],
};

export default function NumPyPandasLab() {
  const [tab, setTab] = useState<'numpy' | 'pandas' | 'datasets'>('numpy');
  const [sel, setSel] = useState(0);
  const [ds, setDs] = useState('students');
  // sel is reset to 0 on every tab/dataset switch and only advanced by pills
  // rendered from the current list, so list[sel] is always in range.
  const list = tab === 'datasets' ? DATA_EXAMPLES[ds] : tab === 'numpy' ? NUMPY_EXAMPLES : PANDAS_EXAMPLES;
  const ex = list[sel];

  return (
    <div>
      <HubCrumb hub="/labs" hubLabel="Labs" page="NumPy + Pandas" />
      <h1>🔢 NumPy + Pandas Mode</h1>
      <p className="muted small">INPUT → CODE → TABLE/OUTPUT → EXPLANATION. Examples run in the bundled local Python runtime (numpy + pandas included). The bundled datasets are loaded as CSV files, so pd.read_csv works everywhere Python runs.</p>

      <div className="row" style={{ margin: '12px 0' }}>
        <button className={`stagepill ${tab === 'numpy' ? 'active' : ''}`} onClick={() => { setTab('numpy'); setSel(0); }}>NumPy</button>
        <button className={`stagepill ${tab === 'pandas' ? 'active' : ''}`} onClick={() => { setTab('pandas'); setSel(0); }}>Pandas</button>
        <button className={`stagepill ${tab === 'datasets' ? 'active' : ''}`} onClick={() => { setTab('datasets'); setSel(0); }}>Datasets</button>
      </div>

      {tab === 'datasets' && (
        <div className="grid2" style={{ margin: '12px 0' }}>
          {DATASETS.map((d) => (
            <div key={d.name} className="card" style={{ margin: 0 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <button className={`stagepill ${ds === d.name ? 'active' : ''}`} onClick={() => { setDs(d.name); setSel(0); }}>{d.name}</button>
                <span className="muted small">{d.desc}</span>
              </div>
              <div className="tablewrap">
                <table className="data">
                  <thead><tr>{d.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{d.rows.slice(0, 3).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <p className="small muted" style={{ marginTop: 4 }}>{d.rows.length} rows · available as {d.name}.csv in Python</p>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        {list.map((e, i) => (
          <button key={e.title} className={`stagepill ${i === sel ? 'active' : ''}`} onClick={() => setSel(i)}>{e.title}</button>
        ))}
      </div>

      <div className="card">
        <b className="small">INPUT:</b>
        <p className="small muted">{ex.title} — run it, then change one value and predict the new output first.</p>
      </div>
      <JupyterNotebook
        storageKey={tab === 'datasets' ? codeSlot.npLab('datasets', `${ds}-${sel}`) : codeSlot.npLab(tab, sel)}
        starter={ex.code}
        title={ex.title}
        sectionId="s17"
      />
    </div>
  );
}
