/** Bundled datasets — loadable offline in the SQL lab and the NumPy/Pandas lab. */
export interface Dataset { name: string; desc: string; columns: string[]; rows: (string | number)[][] }

export const DATASETS: Dataset[] = [
  {
    name: 'students', desc: 'Student roster with marks for joins and groupby.',
    columns: ['id', 'name', 'age', 'city', 'marks'],
    rows: [
      [1, 'Ashu', 22, 'Pune', 88], [2, 'Sara', 21, 'Delhi', 92], [3, 'Ravi', 23, 'Mumbai', 75],
      [4, 'Neha', 22, 'Pune', 81], [5, 'Omar', 24, 'Delhi', 67], [6, 'Priya', 21, 'Mumbai', 95],
      [7, 'John', 23, 'Pune', 58], [8, 'Aisha', 22, 'Delhi', 79],
    ],
  },
  {
    name: 'sales', desc: 'Order lines: product, qty, revenue — for aggregation practice.',
    columns: ['order_id', 'product', 'qty', 'revenue'],
    rows: [
      [101, 'Laptop', 1, 55000], [101, 'Mouse', 2, 1500], [102, 'Laptop', 1, 52000],
      [103, 'Phone', 3, 45000], [104, 'Mouse', 5, 3750], [104, 'Keyboard', 2, 4000],
      [105, 'Phone', 1, 15000], [106, 'Monitor', 2, 24000], [106, 'Keyboard', 1, 2000],
    ],
  },
  {
    name: 'customers', desc: 'Customers keyed by id — join with orders.',
    columns: ['id', 'name', 'city', 'joined'],
    rows: [
      [1, 'Ravi', 'Mumbai', '2023-01-15'], [2, 'Sara', 'Delhi', '2023-02-20'],
      [3, 'Ashu', 'Pune', '2023-03-05'], [4, 'Neha', 'Pune', '2023-04-12'],
      [5, 'Omar', 'Delhi', '2023-05-30'],
    ],
  },
  {
    name: 'employees', desc: 'Salary data with departments — WHERE vs HAVING practice.',
    columns: ['id', 'name', 'dept', 'salary'],
    rows: [
      [1, 'Kiran', 'AI', 90000], [2, 'Meena', 'Data', 75000], [3, 'Arjun', 'AI', 95000],
      [4, 'Zoya', 'Web', 60000], [5, 'Vikas', 'Data', 72000], [6, 'Ira', 'Web', 64000],
    ],
  },
  {
    name: 'expenses', desc: 'Daily spend entries — totals, splits, cleaning.',
    columns: ['id', 'date', 'category', 'amount'],
    rows: [
      [1, '2024-01-02', 'food', 450], [2, '2024-01-02', 'travel', 120], [3, '2024-01-03', 'food', 380],
      [4, '2024-01-05', 'rent', 12000], [5, '2024-01-06', 'food', 290], [6, '2024-01-06', 'travel', 95],
      [7, '2024-01-07', 'misc', 500],
    ],
  },
  {
    name: 'chat_logs', desc: 'Chatbot conversation logs — text analytics practice.',
    columns: ['id', 'user', 'intent', 'confidence'],
    rows: [
      [1, 'u1', 'greeting', 0.98], [2, 'u2', 'order_status', 0.91], [3, 'u1', 'refund', 0.87],
      [4, 'u3', 'greeting', 0.99], [5, 'u2', 'order_status', 0.72], [6, 'u4', 'complaint', 0.95],
      [7, 'u3', 'other', 0.41],
    ],
  },
];

export const datasetAsCSV = (d: Dataset) =>
  [d.columns.join(','), ...d.rows.map((r) => r.join(','))].join('\n');

export const seedForSQL = (d: Dataset) => ({ name: d.name, rows: [d.columns, ...d.rows] });
