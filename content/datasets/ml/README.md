# Canonical ML datasets

These four datasets are bundled for the Machine Learning course. They are the canonical copies
distributed with scikit-learn, normalised to a single header row and comma-separated values.

| File | Rows | Features | Target | Task |
| --- | ---: | ---: | --- | --- |
| `iris.csv` | 150 | 4 | `species` (0 setosa, 1 versicolor, 2 virginica) | classification |
| `wine.csv` | 178 | 13 | `class` (0, 1, 2) | classification |
| `breast_cancer.csv` | 569 | 30 | `diagnosis` (0 malignant, 1 benign) | classification |
| `diabetes.csv` | 442 | 10 | `target` (disease progression) | regression |

## Provenance and licence

- Source repository: <https://github.com/scikit-learn/scikit-learn/tree/main/sklearn/datasets/data>
- The scikit-learn distribution is BSD-3-Clause. The datasets originate from the UCI Machine
  Learning Repository (Iris, Wine, Breast Cancer Wisconsin) and the diabetes study distributed by
  scikit-learn. Check the original dataset terms before redistributing them outside this course.
- Exact source files: `iris.csv`, `wine_data.csv`, `breast_cancer.csv`,
  `diabetes_data_raw.csv.gz` + `diabetes_target.csv.gz`.
- We only changed the representation: added column names, joined the diabetes feature and target
  files, and retained the canonical numeric labels.

## Runtime contract

`npm run ml:datasets:write` generates:

- `public/datasets/ml/*.csv` and `manifest.json` (downloads with SHA-256 provenance)
- `src/core/data/mlDatasets.ts` (raw CSV strings bundled into the offline Pyodide worker)

The browser never fetches data from an external URL. The worker seeds these files into its virtual
filesystem, so `np.genfromtxt('iris.csv', delimiter=',', names=True)` works without a network.
