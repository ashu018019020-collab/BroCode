/**
 * Package registry. "availableOffline" is truth: Pyodide bundles
 * numpy + pandas (+ their deps) and the whole Python stdlib. Anything else
 * cannot be installed here and the UI must say so honestly.
 */
export interface PkgInfo {
  name: string;
  version: string;
  availableOffline: boolean;
  description: string;
  example: string;
  commonMistake?: string;
}

export const OFFLINE_PACKAGES: PkgInfo[] = [
  {
    name: 'numpy', version: '2.x', availableOffline: true,
    description: 'Arrays, vectorized math, the foundation of the data stack.',
    example: "import numpy as np\narr = np.array([1, 2, 3, 4, 5])\nprint('mean:', np.mean(arr))",
    commonMistake: 'np.mean is a function — call it: np.mean(arr). np.mean without () is just a reference.',
  },
  {
    name: 'pandas', version: '2.x', availableOffline: true,
    description: 'DataFrames for cleaning, filtering, grouping and analysis.',
    example: "import pandas as pd\ndf = pd.read_csv('students.csv')\nprint(df.head())\nprint(df['marks'].mean())",
    commonMistake: "read_csv('students.csv') works because the dataset is bundled — any other local path will FileNotFoundError."
  },
  {
    name: 'matplotlib', version: '—', availableOffline: false,
    description: 'Plotting library. Not bundled in this runtime.',
    example: '# Not available here. Build text-based charts with print() instead.',
  },
  {
    name: 'requests', version: '—', availableOffline: false,
    description: 'HTTP client. Network calls are disabled in this lab by design.',
    example: '# No network here: use the bundled datasets, not live APIs.',
  },
  {
    name: 'scikit-learn', version: '—', availableOffline: false,
    description: 'ML toolkit. Not bundled — ML sections use numpy/pandas implementations.',
    example: '# Not available here.',
  },
  {
    name: 'python-dotenv', version: '—', availableOffline: false,
    description: '.env loader. Not applicable in the browser sandbox.',
    example: '# Not available here.',
  },
  {
    name: 'sqlite3 (stdlib)', version: 'bundled', availableOffline: true,
    description: 'Python stdlib SQLite — full SQL engine, used by the SQL Lab.',
    example: "import sqlite3\ncon = sqlite3.connect(':memory:')\nprint('sqlite ready')",
  },
];

export function findPkg(name: string): PkgInfo | undefined {
  const n = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return OFFLINE_PACKAGES.find((p) => p.name.toLowerCase().startsWith(n) || n.startsWith(p.name.toLowerCase().split(' ')[0]));
}
