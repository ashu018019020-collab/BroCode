/**
 * Machine Learning — expansion batch 1.
 *
 * The first published batch gave every module the same three interview, one coding and two logic
 * records. All 27 modules were tied for the smallest bank, so this batch adds one genuinely new
 * interview answer, coding task and logic question to each module. The records are merged by
 * `course.mjs`; the generator still derives the output/practice records from tested topic code.
 *
 * Nothing here is a counter or a placeholder. Every coding `solution` prints exactly `expected`,
 * and `ml-course.test.mjs` executes it with the local Python interpreter.
 */
import { q, k } from './_shared.mjs';

export const expansions = {
  ml01: {
    interview: [q(
      'What is the difference between a model parameter and a hyperparameter?',
      'A parameter is learned from the training data, such as a regression weight or a neural-network weight. A hyperparameter is chosen before training, such as a learning rate, tree depth or K in KNN; it controls the learning process and is selected with validation data, never fitted by the training loop itself.',
    )],
    coding: [k(
      'Positive rate from counts',
      'A test set contains 5 positive examples out of 100. Print the positive rate as a decimal.',
      'positives = 5\ntotal = 100\n# print the rate\n',
      'positives = 5\ntotal = 100\nprint(positives / total)',
      '0.05',
      'Divide the positives by the full row count.',
    )],
    logic: [q(
      'A dataset has 95 negative and 5 positive rows. A model predicts negative for every row. What accuracy does it report, and what does that number hide?',
      'It reports 95% accuracy because 95 of 100 rows are negative. It catches zero positives, so recall on the positive class is 0; accuracy alone hides the complete failure on the class that usually matters most.',
    )],
  },

  ml02: {
    interview: [q(
      'Why is a mutable default argument dangerous in Python?',
      'The default object is created once when the function is defined, not once per call. A list or dictionary default is therefore shared across calls, so appending in one call changes what the next caller sees. Use `None` as the sentinel and create the container inside the function.',
    )],
    coding: [k(
      'Count unique labels',
      'Given labels ["spam", "ham", "spam"], print the number of distinct labels.',
      'labels = ["spam", "ham", "spam"]\n# count distinct labels\n',
      'labels = ["spam", "ham", "spam"]\nprint(len(set(labels)))',
      '2',
      'A set keeps one copy of each value.',
    )],
    logic: [q(
      'What does `[x * 2 for x in range(3) if x % 2]` evaluate to?',
      'It evaluates to `[2]`: range(3) gives 0, 1 and 2; the filter keeps only the odd value 1, and the expression doubles it.',
    )],
  },

  ml03: {
    interview: [q(
      'What does NumPy broadcasting do when arrays of shape (3, 1) and (1, 4) meet?',
      'It aligns the trailing dimensions and stretches each singleton dimension logically, producing a (3, 4) result without physically copying either input. Broadcasting is a shape rule, so the dimensions must be compatible: equal, or one of them must be 1.',
    )],
    coding: [k(
      'Column means of a matrix',
      'For the matrix [[1, 2], [3, 4]], print the mean of each column with NumPy.',
      'import numpy as np\na = np.array([[1, 2], [3, 4]])\n# print column means\n',
      'import numpy as np\na = np.array([[1, 2], [3, 4]])\nprint(a.mean(axis=0))',
      '[2. 3.]',
      'Reducing down the rows leaves one mean per column.',
    )],
    logic: [q(
      'For a NumPy array of shape (4, 3), what shape does `.mean(axis=1)` return, and what does each value mean?',
      'It returns shape (4,), one value per row. `axis=1` collapses the three columns of each row, so each result is the mean of that row.',
    )],
  },

  ml04: {
    interview: [q(
      'What does Pandas `groupby` actually do internally?',
      'It splits the rows by key, applies the requested aggregation or transformation to each group, and combines the results into a new Series or DataFrame. Group keys that are missing are excluded by default, which is why a null category can silently disappear from a report.',
    )],
    coding: [k(
      'Count missing cells',
      'For a DataFrame with two columns, count every missing cell in the whole table and print the integer total.',
      'import pandas as pd\ndf = pd.DataFrame({"a": [1, None, 3], "b": [None, 5, None]})\n# print total missing cells\n',
      'import pandas as pd\ndf = pd.DataFrame({"a": [1, None, 3], "b": [None, 5, None]})\nprint(int(df.isna().sum().sum()))',
      '3',
      'Sum the boolean mask once for each axis.',
    )],
    logic: [q(
      'A DataFrame has five rows. Its right table has unique keys and exactly two left rows match. How many rows does an inner merge return?',
      'Two rows. An inner merge keeps only matching keys, and because the right keys are unique each matching left row produces one row.',
    )],
  },

  ml05: {
    interview: [q(
      'What is the difference between a derivative and a gradient?',
      'A derivative measures how a scalar output changes with one scalar input. A gradient collects the partial derivatives with respect to every parameter into a vector; it points in the direction of steepest increase, which is why training moves in the opposite direction.',
    )],
    coding: [k(
      'Dot product of two vectors',
      'Compute the dot product of [1, 2, 3] and [2, 1, 4] and print the integer result.',
      'a = [1, 2, 3]\nb = [2, 1, 4]\n# print the dot product\n',
      'a = [1, 2, 3]\nb = [2, 1, 4]\nprint(sum(x * y for x, y in zip(a, b)))',
      '16',
      'Multiply matching positions, then add the products.',
    )],
    logic: [q(
      'If f(x) = 3x², what is the derivative f′(2)?',
      '12. The derivative is 6x, so at x = 2 it is 12; the slope is measured per unit change in x.',
    )],
  },

  ml06: {
    interview: [q(
      'What is the difference between standard deviation and standard error?',
      'Standard deviation describes the spread of individual observations around the mean. Standard error describes the uncertainty of an estimated statistic, commonly the mean, and shrinks roughly as 1/√n as the sample grows.',
    )],
    coding: [k(
      'Standard error of the mean',
      'For [2, 4, 6], print the sample standard error of the mean, rounded to three decimals.',
      'import math\nimport statistics\nxs = [2, 4, 6]\n# print the standard error\n',
      'import math\nimport statistics\nxs = [2, 4, 6]\nprint(round(statistics.stdev(xs) / math.sqrt(len(xs)), 3))',
      '1.155',
      'Sample standard deviation divided by the square root of n.',
    )],
    logic: [q(
      'A disease has 1% prevalence. A test has 90% sensitivity and 90% specificity. If a person tests positive, is the probability of disease close to 90%?',
      'No. It is about 8.3%. With 10,000 people, about 90 true positives and 990 false positives occur; the positive predictive value is 90 / (90 + 990), because the low base rate dominates the false positives.',
    )],
  },

  ml07: {
    interview: [q(
      'What is the difference between data missing at random and data missing not at random?',
      'Missing at random means the probability of missingness can be explained by observed variables; a model using those variables can impute it without a special missingness model. Missing not at random means the missing value itself drives whether it is missing, such as high earners refusing to report income; that needs a stronger assumption or a sensitivity analysis.',
    )],
    coding: [k(
      'Missing percentage',
      'For [1, None, 3, None], print the missing percentage as a number.',
      'values = [1, None, 3, None]\n# print the missing percentage\n',
      'values = [1, None, 3, None]\nprint(sum(value is None for value in values) / len(values) * 100)',
      '50.0',
      'Count missing values, divide by the total, then multiply by 100.',
    )],
    logic: [q(
      'A correlation coefficient is exactly 0. Does that prove the two variables are independent?',
      'No. Correlation measures linear association only. Two variables can have a strong non-linear relationship, such as a parabola, while their linear correlation is zero; always inspect the scatter plot before concluding independence.',
    )],
  },

  ml08: {
    interview: [q(
      'Why is one-hot encoding usually preferred over integer codes for unordered categories?',
      'Integer codes imply an order and a distance: a model may treat “blue = 2” as twice “red = 1” and can interpolate a category that does not exist. One-hot encoding gives each category its own binary column, removing the false ordering at the cost of more columns.',
    )],
    coding: [k(
      'Z-score one value',
      'With training mean 10 and standard deviation 2, print the z-score of the value 14.',
      'mean = 10\nstd = 2\nvalue = 14\n# print the z-score\n',
      'mean = 10\nstd = 2\nvalue = 14\nprint((value - mean) / std)',
      '2.0',
      'Subtract the training mean, then divide by the training standard deviation.',
    )],
    logic: [q(
      'A one-hot encoder was fitted on red and green, then sees blue at inference. What should happen?',
      'It should not silently map blue to red or green. A safe encoder is configured to ignore unknown categories, producing all zeros, or to reserve an explicit “unknown” column; the choice must match how the model was trained and be documented.',
    )],
  },

  ml09: {
    interview: [q(
      'What is data leakage, and what is one concrete example?',
      'Data leakage is information from the target or the test period entering training, making validation look better than production. Scaling or imputing with statistics computed on the full dataset before the split is a common example; fit those steps on training data only.',
    )],
    coding: [k(
      'Chronological split boundary',
      'A dataset has 100 ordered rows and uses the first 80% for training. Print the number of training rows.',
      'rows = 100\ntrain_fraction = 0.8\n# print the boundary\n',
      'rows = 100\ntrain_fraction = 0.8\nprint(int(rows * train_fraction))',
      '80',
      'The split is a position in the ordered rows, not a random sample.',
    )],
    logic: [q(
      'Training accuracy is 0.99 and validation accuracy is 0.60. Is the model overfitting or underfitting, and what should you check next?',
      'It is overfitting: it fits the training rows far better than unseen rows. Check for leakage and an unrepresentative split, then simplify the model or add regularisation, more data or better validation before tuning further.',
    )],
  },

  ml10: {
    interview: [q(
      'What does the intercept represent in a linear regression?',
      'It is the prediction when every feature is zero. It anchors the line so the slope does not have to pass through the origin; in data where zero is outside the observed range, it is a mathematical anchor rather than a business-meaningful prediction.',
    )],
    coding: [k(
      'Predict from a fitted line',
      'For slope 2.5, intercept -1 and x = 4, print the prediction.',
      'slope = 2.5\nintercept = -1\nx = 4\n# print the prediction\n',
      'slope = 2.5\nintercept = -1\nx = 4\nprint(slope * x + intercept)',
      '9.0',
      'Multiply the input by the slope, then add the intercept.',
    )],
    logic: [q(
      'A model has R² = 0 on validation data. What does that mean relative to predicting the mean?',
      'It means the model is no better than predicting the validation mean; R² compares the model’s squared error with that baseline. A negative R² means it is worse than the mean, which is possible on unseen data.',
    )],
  },

  ml11: {
    interview: [q(
      'Why does Lasso produce zero coefficients while Ridge usually does not?',
      'Lasso adds an L1 penalty, whose diamond-shaped constraint reaches corners where some coefficients are exactly zero. Ridge’s L2 penalty has a circular constraint that shrinks coefficients smoothly, rarely all the way to zero. Lasso therefore performs selection; Ridge is better when many small effects should remain.',
    )],
    coding: [k(
      'L2 penalty from weights',
      'With weights [3, 4] and alpha 0.5, print the L2 penalty alpha × Σw².',
      'weights = [3, 4]\nalpha = 0.5\n# print the penalty\n',
      'weights = [3, 4]\nalpha = 0.5\nprint(alpha * sum(w * w for w in weights))',
      '12.5',
      'Square each weight, sum, then multiply by alpha.',
    )],
    logic: [q(
      'A degree-9 polynomial fits the training data almost perfectly but performs worse than a degree-2 model on validation. What is happening, and what are two responses?',
      'The high-degree model is overfitting: it has learned noise and has high variance. Reduce the degree or add regularisation, and collect more data or use a more robust validation scheme before trusting the training fit.',
    )],
  },

  ml12: {
    interview: [q(
      'How do you interpret a logistic regression coefficient on the log-odds scale?',
      'Holding the other features fixed, a one-unit increase in that feature changes the log-odds of the positive class by the coefficient. The odds multiply by exp(coefficient); a positive coefficient raises the probability, but the size of the probability change depends on the current score.',
    )],
    coding: [k(
      'Convert probability to odds',
      'For probability 0.8, print the odds p / (1 - p).',
      'p = 0.8\n# print the odds\n',
      'p = 0.8\nprint(round(p / (1 - p), 1))',
      '4.0',
      'Odds compare the event with its complement.',
    )],
    logic: [q(
      'A classifier outputs 0.8 and currently uses a 0.5 threshold. If the threshold is raised to 0.9, what normally happens to precision and recall?',
      'Precision normally rises because only more confident positives are accepted, while recall normally falls because some true positives now score below the higher bar. The exact trade-off must be measured on validation data.',
    )],
  },

  ml13: {
    interview: [q(
      'Why is K-nearest neighbours called a lazy learner?',
      'It does no explicit parameter fitting during training; it stores the examples. Most of the work happens at prediction time, when it computes distances to the stored points. That makes inference slower and memory-heavy as the dataset grows.',
    )],
    coding: [k(
      'Manhattan distance',
      'Print the Manhattan distance between (1, 2) and (4, 6).',
      'a = (1, 2)\nb = (4, 6)\n# print the distance\n',
      'a = (1, 2)\nb = (4, 6)\nprint(abs(a[0] - b[0]) + abs(a[1] - b[1]))',
      '7',
      'Manhattan distance adds the absolute differences per coordinate.',
    )],
    logic: [q(
      'KNN with k = 1 is trained on noisy labels. What is the main risk, and what is one remedy?',
      'A single neighbour makes the prediction highly sensitive to label noise and local outliers, so variance is high. Increase k and weight neighbours by distance, while scaling features and validating the choice rather than assuming a larger k is always better.',
    )],
  },

  ml14: {
    interview: [q(
      'Why can a very deep decision tree overfit?',
      'It can keep splitting until leaves are almost pure, fitting idiosyncratic noise and rare training rows. The tree then has high variance and poor generalisation. Limit depth, require a minimum number of samples per leaf, or prune and validate.',
    )],
    coding: [k(
      'Majority vote of three trees',
      'Three trees vote ["A", "B", "A"]. Print the majority label.',
      'from collections import Counter\nvotes = ["A", "B", "A"]\n# print the majority label\n',
      'from collections import Counter\nvotes = ["A", "B", "A"]\nprint(Counter(votes).most_common(1)[0][0])',
      'A',
      'Count the votes and take the most common label.',
    )],
    logic: [q(
      'What is the Gini impurity of a binary node with 50 positive and 50 negative examples?',
      '0.5. The positive and negative proportions are both 0.5, so 1 − (0.5² + 0.5²) = 1 − 0.5 = 0.5. A pure node has impurity 0.',
    )],
  },

  ml15: {
    interview: [q(
      'Why is F1 not always the right metric?',
      'F1 ignores true negatives, weights precision and recall equally, and treats every error as equally costly. In spam, fraud or medical screening the cost of a false positive and a false negative differs, so a cost-sensitive metric, PR-AUC or a threshold chosen for the decision may be more appropriate.',
    )],
    coding: [k(
      'Specificity from a confusion matrix',
      'For TN = 90 and FP = 10, print specificity.',
      'tn = 90\nfp = 10\n# print specificity\n',
      'tn = 90\nfp = 10\nprint(tn / (tn + fp))',
      '0.9',
      'Specificity is TN divided by all actual negatives.',
    )],
    logic: [q(
      'Precision is 0.5 and recall is 0.5. What is F1?',
      '0.5. F1 is 2PR / (P + R), so 2 × 0.5 × 0.5 / 1 = 0.5; equal precision and recall produce that same value.',
    )],
  },

  ml16: {
    interview: [q(
      'What assumptions does K-Means make about a cluster?',
      'It assumes clusters are roughly spherical, have similar spread, and are well represented by their centroid; it also requires K in advance and is sensitive to feature scale and outliers. Violating these assumptions can produce confident but meaningless assignments.',
    )],
    coding: [k(
      'Assign to the nearest centroid',
      'For point 0 and centroids [-2, 3], print the nearest centroid.',
      'point = 0\ncentroids = [-2, 3]\n# print the nearest centroid\n',
      'point = 0\ncentroids = [-2, 3]\nprint(min(centroids, key=lambda c: abs(point - c)))',
      '-2',
      'Compare absolute distances and keep the smallest.',
    )],
    logic: [q(
      'What do silhouette scores near 1, 0 and -1 mean?',
      'Near 1 means points are much closer to their own cluster than the next nearest one; near 0 means the clusters overlap at the boundary; near -1 means points are probably assigned to the wrong cluster. It is a diagnostic, not proof that K is correct.',
    )],
  },

  ml17: {
    interview: [q(
      'What does a principal component represent geometrically?',
      'It is a direction in the centred feature space that captures the largest remaining variance, with each later component orthogonal to the earlier ones. The first component is the best single linear direction for preserving variance, not necessarily the direction that best predicts a target.',
    )],
    coding: [k(
      'Cumulative variance of two components',
      'Explained variance ratios are [0.5, 0.3, 0.1]. Print the cumulative share of the first two components.',
      'ratios = [0.5, 0.3, 0.1]\n# print the cumulative share\n',
      'ratios = [0.5, 0.3, 0.1]\nprint(sum(ratios[:2]))',
      '0.8',
      'Cumulative variance adds the ratios in component order.',
    )],
    logic: [q(
      'What does a cumulative explained variance of 0.9 for the first three components mean?',
      'Those three components retain 90% of the total variance in the original feature matrix. The remaining 10% is discarded; whether that is acceptable depends on the task and on how much predictive signal, not just variance, those components carry.',
    )],
  },

  ml18: {
    interview: [q(
      'Why is accuracy a poor headline metric for anomaly detection?',
      'Anomalies are rare, so predicting “normal” for every row can score very high accuracy while detecting nothing. Report precision, recall and PR-AUC on the anomaly class, plus the alert budget, because the cost of missed anomalies and false alarms is asymmetric.',
    )],
    coding: [k(
      'IQR upper fence',
      'For Q1 = 10 and Q3 = 20, print the upper fence at 1.5 × IQR.',
      'q1 = 10\nq3 = 20\n# print the upper fence\n',
      'q1 = 10\nq3 = 20\nprint(q3 + 1.5 * (q3 - q1))',
      '35.0',
      'IQR is Q3 − Q1; add 1.5 IQR to Q3.',
    )],
    logic: [q(
      'A feature has mean 10 and standard deviation 2. What is the z-score of 17, and would a |z| > 3 rule flag it?',
      'The z-score is (17 − 10) / 2 = 3.5. A strict |z| > 3 rule flags it; the threshold is a policy choice and assumes the feature’s distribution is reasonably represented by its mean and standard deviation.',
    )],
  },

  ml19: {
    interview: [q(
      'Why can a feature with high correlation to the target still be useless in a multivariable model?',
      'Its information may already be carried by another correlated feature, so its unique contribution is small. Correlation is also marginal and linear; a feature can look strong alone yet add nothing once interactions and other predictors are present. Check multivariable importance and redundancy, not just the pairwise correlation.',
    )],
    coding: [k(
      'Top correlation by absolute value',
      'For names ["a", "b", "c"] and correlations [-0.2, 0.8, 0.1], print the name with the largest absolute correlation.',
      'names = ["a", "b", "c"]\ncorrelations = [-0.2, 0.8, 0.1]\n# print the top name\n',
      'names = ["a", "b", "c"]\ncorrelations = [-0.2, 0.8, 0.1]\nprint(max(zip(names, correlations), key=lambda pair: abs(pair[1]))[0])',
      'b',
      'Compare absolute values, then take the matching name.',
    )],
    logic: [q(
      'Permutation importance for feature A drops validation accuracy from 0.90 to 0.85. What does the 0.05 mean, and what does it not mean?',
      'It estimates that shuffling A costs about five accuracy points in this fitted model and validation sample. It is not proof that A causes the outcome, and when features are correlated the importance can be split or hidden among them.',
    )],
  },

  ml20: {
    interview: [q(
      'What is the difference between resampling and class weighting for an imbalanced target?',
      'Resampling changes the training rows, either by duplicating the minority class or dropping majority rows; class weighting keeps the rows but makes minority errors count more in the loss. Both can improve minority recall, but both can distort predicted probabilities, so recalibration and validation are required.',
    )],
    coding: [k(
      'Cost-sensitive threshold',
      'If a false negative costs 10 and a false positive costs 1, print the cost-minimising probability threshold rounded to two decimals.',
      'cost_fn = 10\ncost_fp = 1\n# print the threshold\n',
      'cost_fn = 10\ncost_fp = 1\nprint(round(cost_fp / (cost_fp + cost_fn), 2))',
      '0.09',
      'The threshold is the false-positive cost over the sum of both error costs.',
    )],
    logic: [q(
      'A test set has 100 positives. A model catches 40 of them. What is recall, and why is accuracy not enough to judge it?',
      'Recall is 40 / 100 = 0.40. Accuracy also counts the many true negatives, so a model can have high accuracy while missing most positives; you must report the metric that reflects the cost of those misses.',
    )],
  },

  ml21: {
    interview: [q(
      'Why are lag features useful in time-series machine learning?',
      'They give each row a controlled view of the past, such as yesterday’s demand or the value seven days ago, so a tabular model can learn temporal dependence. Lags must be built only from information available before the prediction time, or the model leaks the future.',
    )],
    coding: [k(
      'Rolling mean of the last two values',
      'For [10, 20, 30], print the rolling mean with a window of two, starting at the second value.',
      'values = [10, 20, 30]\n# print the rolling means\n',
      'values = [10, 20, 30]\nprint([(values[i - 1] + values[i]) / 2 for i in range(1, len(values))])',
      '[15.0, 25.0]',
      'Each output averages the current value and the one before it.',
    )],
    logic: [q(
      'Why is a random train/test split dangerous for a time series?',
      'It can train on future observations and test on the past, leaking information that would not be available at prediction time. Use a chronological split with a gap when needed, and validate on later periods that mirror deployment.',
    )],
  },

  ml22: {
    interview: [q(
      'What is the difference between content-based and collaborative filtering?',
      'Content-based filtering recommends items similar to what a user liked using item features; collaborative filtering uses patterns across many users’ interactions, such as “users who liked this also liked that.” Collaborative filtering can find unexpected taste matches but struggles with new users or items; content features help with cold start.',
    )],
    coding: [k(
      'Top item by score',
      'For scores {"a": 0.2, "b": 0.8, "c": 0.5}, print the highest-scoring item.',
      'scores = {"a": 0.2, "b": 0.8, "c": 0.5}\n# print the top item\n',
      'scores = {"a": 0.2, "b": 0.8, "c": 0.5}\nprint(max(scores, key=scores.get))',
      'b',
      'Let max compare the dictionary values, not the keys.',
    )],
    logic: [q(
      'What is the cosine similarity of the vectors [1, 0] and [0, 1], and what does it mean for recommendations?',
      'It is 0. The vectors are orthogonal, so they share no direction; cosine similarity measures angle rather than magnitude, and a zero score means no similarity in that feature space.',
    )],
  },

  ml23: {
    interview: [q(
      'Why is TF-IDF often better than raw word counts for text classification?',
      'TF-IDF downweights terms that appear in many documents, so common words such as “the” do not dominate, while terms frequent in one document but rare across the corpus receive more weight. It still produces a sparse, high-dimensional representation and does not understand word order or meaning.',
    )],
    coding: [k(
      'Build a sorted vocabulary',
      'For the text "ML is fun", print the distinct lowercase words in sorted order.',
      'text = "ML is fun"\n# print the vocabulary\n',
      'text = "ML is fun"\nprint(sorted(set(text.lower().split())))',
      "['fun', 'is', 'ml']",
      'Lowercase, split, remove duplicates with a set, then sort.',
    )],
    logic: [q(
      'A document has the tokens ["cat", "cat", "dog"]. What is the term frequency of "cat" within the document?',
      'It is 2/3, or about 0.67. Term frequency is the count of the term divided by the total number of tokens in that document; document frequency, which TF-IDF also uses, counts how many documents contain it.',
    )],
  },

  ml24: {
    interview: [q(
      'What does backpropagation compute, and what does the optimiser do with it?',
      'Backpropagation applies the chain rule to compute the gradient of the loss with respect to every weight. The optimiser uses those gradients to update the weights, for example with gradient descent or Adam; backpropagation computes direction, the optimiser decides the step.',
    )],
    coding: [k(
      'Dense layer parameter count',
      'A dense layer has 3 inputs and 2 outputs and uses a bias for each output. Print the total number of trainable parameters.',
      'inputs = 3\noutputs = 2\n# print the parameter count\n',
      'inputs = 3\noutputs = 2\nprint((inputs + 1) * outputs)',
      '8',
      'Each output has one weight per input plus one bias.',
    )],
    logic: [q(
      'What happens if you stack two linear layers with no activation between them?',
      'The composition is still a single linear transformation. Depth adds no representational power without a non-linearity, so the network cannot learn curved boundaries that a single linear layer could not already express.',
    )],
  },

  ml25: {
    interview: [q(
      'What is the difference between a transformer and an estimator in scikit-learn?',
      'A transformer learns a feature transformation, typically with `fit` and `transform`, such as scaling or imputation. An estimator learns to predict a target with `fit` and `predict`. A Pipeline chains transformers into a final estimator so the same fitted preprocessing is used in training and inference.',
    )],
    coding: [k(
      'Apply the training mean',
      'Training values are [1, 3]. Print the transformed value of a test value 5 after subtracting the training mean.',
      'train = [1, 3]\ntest_value = 5\n# apply the training mean\n',
      'train = [1, 3]\ntest_value = 5\nprint(test_value - sum(train) / len(train))',
      '3.0',
      'Compute the mean on training rows only, then reuse that number.',
    )],
    logic: [q(
      'A scaler is fitted on all rows before the train/test split. Why is the resulting validation score optimistic?',
      'The scaler has already seen the test rows’ mean and spread, so information from the evaluation set influenced training. That is preprocessing leakage; fit the scaler inside the training fold or pipeline, then transform the held-out data with those training statistics.',
    )],
  },

  ml26: {
    interview: [q(
      'Why should a deployed model artifact be versioned together with its preprocessing?',
      'A prediction depends on the exact estimator, feature order, encodings, imputation values and library versions used in training. Versioning only the model file makes rollback and reproduction ambiguous; version the whole pipeline and schema so a prediction can be traced to one reproducible artifact.',
    )],
    coding: [k(
      'Validate required fields',
      'For payload {"age": 30} and required fields ["age", "income"], print whether every required field is present.',
      'payload = {"age": 30}\nrequired = ["age", "income"]\n# print the validation result\n',
      'payload = {"age": 30}\nrequired = ["age", "income"]\nprint(all(key in payload for key in required))',
      'False',
      'Check presence for every required key.',
    )],
    logic: [q(
      'A health endpoint returns 200, but the model file it needs is missing. Is the service ready to serve predictions?',
      'No. A liveness check can say the process is running, but readiness must verify the model artifact and dependencies. Return a failure from readiness and keep the service out of traffic until it can actually serve; a 200 that hides a missing model is a false health signal.',
    )],
  },

  ml27: {
    interview: [q(
      'What is the difference between fairness through unawareness and measuring disparate impact?',
      'Fairness through unawareness removes a protected attribute from the model, but proxies such as postcode, school or usage patterns can still encode it. Disparate-impact analysis measures outcomes across groups, exposing gaps that removing a column cannot prove are absent.',
    )],
    coding: [k(
      'Disparate impact ratio',
      'Positive rates are 0.6 and 0.3. Print the ratio of the lower rate to the higher rate, rounded to two decimals.',
      'rate_a = 0.6\nrate_b = 0.3\n# print the ratio\n',
      'rate_a = 0.6\nrate_b = 0.3\nprint(round(min(rate_a, rate_b) / max(rate_a, rate_b), 2))',
      '0.5',
      'Divide the smaller rate by the larger one.',
    )],
    logic: [q(
      'A model has equal accuracy for groups A and B, but it approves group A at twice the rate. Does equal accuracy prove the model is fair?',
      'No. Equal accuracy can coexist with very different selection rates, error types or false-positive costs. Fairness depends on the decision and the harm; report outcome rates, error rates by group and sample sizes before making a claim.',
    )],
  },
};
