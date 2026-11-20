/**
 * Machine Learning — quantitative drill library.
 *
 * The authored lessons explain a small number of ideas deeply. A professional course also needs
 * repeated, varied practice, so this module turns each module's chosen metrics into deterministic
 * exercises. Every case is parameterised, produces a real Python solution and a verified expected
 * output. Nothing here is a counter: the generated records are ordinary entries in the ten sections.
 *
 * `drillIds` selects ten families per module; `makeDrill` generates a fresh case for any index, so
 * the sections can ask for more practice without copying a record. The formula functions are also
 * the source of truth for the debug cases: a wrong mutation is printed beside the correct answer.
 */

const fixed = (value) => {
  const n = Math.abs(value) < 1e-9 ? 0 : value;
  return (Math.floor(n * 100 + 0.5) / 100).toFixed(2);
};

const integer = (value) => String(Math.trunc(value));
const list = (values) => `[${values.join(', ')}]`;
const n = (m, i, salt = 0, min = 1, span = 20) => min + ((m * 17 + i * 13 + salt * 7) % span);

const FORMULAS = {
  accuracy: {
    label: 'accuracy',
    values: (m, i) => {
      const total = 20 + n(m, i, 1, 0, 80);
      const correct = Math.max(1, Math.min(total - 1, Math.round(total * (0.55 + ((m + i * 3) % 35) / 100))));
      return [correct, total];
    },
    setup: ([correct, total]) => `correct = ${correct}\ntotal = ${total}`,
    expr: () => 'correct / total',
    prompt: ([correct, total]) => `A validation run has ${correct} correct predictions out of ${total}. What is the accuracy, rounded to two decimals?`,
    answer: ([correct, total]) => correct / total,
    hint: 'Accuracy is correct predictions divided by all predictions.',
    bug: 'The denominator was changed, so the metric no longer describes the full validation set.',
  },
  error_rate: {
    label: 'error rate',
    values: (m, i) => {
      const total = 20 + n(m, i, 2, 0, 90);
      const errors = 1 + n(m, i, 3, 0, Math.max(2, total - 2));
      return [Math.min(errors, total - 1), total];
    },
    setup: ([errors, total]) => `errors = ${errors}\ntotal = ${total}`,
    expr: () => 'errors / total',
    prompt: ([errors, total]) => `A batch of ${total} requests produced ${errors} errors. What is the error rate, rounded to two decimals?`,
    answer: ([errors, total]) => errors / total,
    hint: 'Error rate is errors divided by all requests.',
    bug: 'The code used the success count or changed the denominator instead of dividing errors by all requests.',
  },
  base_rate: {
    label: 'base rate',
    values: (m, i) => {
      const total = 50 + n(m, i, 4, 0, 150);
      const positive = 2 + n(m, i, 5, 0, Math.max(3, Math.floor(total / 3)));
      return [positive, total];
    },
    setup: ([positive, total]) => `positive = ${positive}\ntotal = ${total}`,
    expr: () => 'positive / total',
    prompt: ([positive, total]) => `A dataset has ${positive} positive rows out of ${total}. What is the positive base rate, rounded to two decimals?`,
    answer: ([positive, total]) => positive / total,
    hint: 'The base rate is the share of positives in the full dataset.',
    bug: 'The calculation used the negative count or forgot to divide by the full row count.',
  },
  percent_change: {
    label: 'percent change',
    values: (m, i) => [10 + n(m, i, 6, 0, 90), 20 + n(m, i, 7, 0, 110)],
    setup: ([oldValue, newValue]) => `old_value = ${oldValue}\nnew_value = ${newValue}`,
    expr: () => '(new_value - old_value) / old_value * 100',
    prompt: ([oldValue, newValue]) => `A metric moved from ${oldValue} to ${newValue}. What is the percentage change, rounded to two decimals?`,
    answer: ([oldValue, newValue]) => ((newValue - oldValue) / oldValue) * 100,
    hint: 'Subtract the old value, divide by the old value, then multiply by 100.',
    bug: 'The code divided by the new value or omitted the multiplication by 100.',
  },
  mean: {
    label: 'mean',
    values: (m, i) => Array.from({ length: 4 }, (_, j) => 2 + n(m, i, 8 + j, 0, 25)),
    setup: (values) => `values = ${list(values)}`,
    expr: () => 'sum(values) / len(values)',
    prompt: (values) => `For the values ${values.join(', ')}, what is the mean, rounded to two decimals?`,
    answer: (values) => values.reduce((a, b) => a + b, 0) / values.length,
    hint: 'Add every value and divide by the number of values.',
    bug: 'The code divided by the wrong count or summed a different list.',
  },
  median: {
    label: 'median',
    values: (m, i) => Array.from({ length: 5 }, (_, j) => 2 + n(m, i, 20 + j, 0, 30)),
    imports: 'import statistics',
    setup: (values) => `values = ${list(values)}`,
    expr: () => 'statistics.median(values)',
    prompt: (values) => `For the values ${values.join(', ')}, what is the median, rounded to two decimals?`,
    answer: (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    },
    hint: 'Sort the values first; the median is the middle one for an odd-length list.',
    bug: 'The code took an endpoint or forgot to sort before selecting the middle value.',
  },
  ratio: {
    label: 'ratio',
    values: (m, i) => [2 + n(m, i, 25, 0, 30), 1 + n(m, i, 26, 0, 15)],
    setup: ([part, whole]) => `part = ${part}\nwhole = ${whole}`,
    expr: () => 'part / whole',
    prompt: ([part, whole]) => `A subgroup has ${part} events out of ${whole} possible events. What is the ratio, rounded to two decimals?`,
    answer: ([part, whole]) => part / whole,
    hint: 'Divide the subgroup count by the whole.',
    bug: 'The operands were reversed, so the ratio now describes a different quantity.',
  },
  difference: {
    label: 'difference',
    values: (m, i) => [10 + n(m, i, 27, 0, 50), 2 + n(m, i, 28, 0, 30)],
    setup: ([a, b]) => `first = ${a}\nsecond = ${b}`,
    expr: () => 'first - second',
    prompt: ([a, b]) => `A model scores ${a} and the baseline scores ${b}. What is the absolute difference?`,
    answer: ([a, b]) => a - b,
    hint: 'Subtract the baseline from the model score.',
    bug: 'The operands were reversed, so the sign no longer describes the improvement.',
  },
  weighted_average: {
    label: 'weighted average',
    values: (m, i) => {
      const scores = Array.from({ length: 3 }, (_, j) => 50 + n(m, i, 30 + j, 0, 50));
      const weights = Array.from({ length: 3 }, (_, j) => 1 + n(m, i, 40 + j, 0, 5));
      return [scores, weights];
    },
    setup: ([scores, weights]) => `scores = ${list(scores)}\nweights = ${list(weights)}`,
    expr: () => 'sum(score * weight for score, weight in zip(scores, weights)) / sum(weights)',
    prompt: ([scores, weights]) => `Scores ${scores.join(', ')} have weights ${weights.join(', ')}. What is the weighted average, rounded to two decimals?`,
    answer: ([scores, weights]) => scores.reduce((sum, score, i) => sum + score * weights[i], 0) / weights.reduce((a, b) => a + b, 0),
    hint: 'Multiply each score by its weight, sum, then divide by the sum of weights.',
    bug: 'The code averaged the scores without applying their weights.',
  },
  zscore: {
    label: 'z-score',
    values: (m, i) => [20 + n(m, i, 50, 0, 70), 10 + n(m, i, 51, 0, 30), 1 + n(m, i, 52, 0, 8)],
    setup: ([value, mean, sd]) => `value = ${value}\nmean = ${mean}\nsd = ${sd}`,
    expr: () => '(value - mean) / sd',
    prompt: ([value, mean, sd]) => `A value is ${value}, the mean is ${mean} and the standard deviation is ${sd}. What is its z-score, rounded to two decimals?`,
    answer: ([value, mean, sd]) => (value - mean) / sd,
    hint: 'Subtract the mean, then divide by the standard deviation.',
    bug: 'The code subtracted in the wrong order or divided by the mean instead of the standard deviation.',
  },
  cost_threshold: {
    label: 'cost-sensitive threshold',
    values: (m, i) => [1 + n(m, i, 55, 0, 12), 1 + n(m, i, 56, 0, 25)],
    setup: ([costFp, costFn]) => `cost_fp = ${costFp}\ncost_fn = ${costFn}`,
    expr: () => 'cost_fp / (cost_fp + cost_fn)',
    prompt: ([costFp, costFn]) => `A false positive costs ${costFp} and a false negative costs ${costFn}. What is the cost-minimising probability threshold, rounded to two decimals?`,
    answer: ([costFp, costFn]) => costFp / (costFp + costFn),
    hint: 'The threshold is the false-positive cost over the sum of both error costs.',
    bug: 'The code divided by one cost alone instead of the sum of both costs.',
  },
  class_weight: {
    label: 'balanced class weight',
    values: (m, i) => {
      const total = 100 + n(m, i, 60, 0, 300);
      const positive = 5 + n(m, i, 61, 0, 40);
      return [total, Math.min(positive, total - 1)];
    },
    setup: ([total, positive]) => `total = ${total}\npositive = ${positive}`,
    expr: () => 'total / (2 * positive)',
    prompt: ([total, positive]) => `A training set has ${total} rows and ${positive} positives. What balanced positive class weight does the common heuristic give, rounded to two decimals?`,
    answer: ([total, positive]) => total / (2 * positive),
    hint: 'Use total rows divided by twice the positive count.',
    bug: 'The code used the negative count or omitted the factor of two.',
  },
  dot: {
    label: 'dot product',
    values: (m, i) => [
      Array.from({ length: 3 }, (_, j) => 1 + n(m, i, 70 + j, 0, 9)),
      Array.from({ length: 3 }, (_, j) => 1 + n(m, i, 73 + j, 0, 9)),
    ],
    setup: ([a, b]) => `a = ${list(a)}\nb = ${list(b)}`,
    expr: () => 'sum(x * y for x, y in zip(a, b))',
    prompt: ([a, b]) => `Compute the dot product of ${a.join(', ')} and ${b.join(', ')}.`,
    answer: ([a, b]) => a.reduce((sum, x, j) => sum + x * b[j], 0),
    hint: 'Multiply matching positions, then add the products.',
    bug: 'The code added the vectors before multiplying, or multiplied the wrong positions.',
  },
  euclidean: {
    label: 'Euclidean distance',
    values: (m, i) => [
      Array.from({ length: 2 }, (_, j) => n(m, i, 80 + j, 0, 15)),
      Array.from({ length: 2 }, (_, j) => n(m, i, 82 + j, 0, 15)),
    ],
    setup: ([a, b]) => `a = ${list(a)}\nb = ${list(b)}`,
    imports: 'import math',
    expr: () => 'math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))',
    prompt: ([a, b]) => `Compute the Euclidean distance between ${a.join(', ')} and ${b.join(', ')}.`,
    answer: ([a, b]) => Math.sqrt(a.reduce((sum, x, j) => sum + (x - b[j]) ** 2, 0)),
    hint: 'Square the differences, add them, then take the square root.',
    bug: 'The code returned the squared distance and skipped the square root.',
  },
  manhattan: {
    label: 'Manhattan distance',
    values: (m, i) => [
      Array.from({ length: 3 }, (_, j) => 1 + n(m, i, 84 + j, 0, 12)),
      Array.from({ length: 3 }, (_, j) => 1 + n(m, i, 87 + j, 0, 12)),
    ],
    setup: ([a, b]) => `a = ${list(a)}\nb = ${list(b)}`,
    expr: () => 'sum(abs(x - y) for x, y in zip(a, b))',
    prompt: ([a, b]) => `Compute the Manhattan distance between ${a.join(', ')} and ${b.join(', ')}.`,
    answer: ([a, b]) => a.reduce((sum, x, j) => sum + Math.abs(x - b[j]), 0),
    hint: 'Add the absolute differences coordinate by coordinate.',
    bug: 'The code squared the differences, which computes a Euclidean-style penalty instead.',
  },
  cosine: {
    label: 'cosine similarity',
    values: (m, i) => [
      Array.from({ length: 3 }, (_, j) => 1 + n(m, i, 90 + j, 0, 8)),
      Array.from({ length: 3 }, (_, j) => 1 + n(m, i, 93 + j, 0, 8)),
    ],
    setup: ([a, b]) => `a = ${list(a)}\nb = ${list(b)}`,
    imports: 'import math',
    expr: () => 'sum(x * y for x, y in zip(a, b)) / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))',
    prompt: ([a, b]) => `Compute the cosine similarity of ${a.join(', ')} and ${b.join(', ')}.`,
    answer: ([a, b]) => {
      const dot = a.reduce((sum, x, j) => sum + x * b[j], 0);
      const na = Math.sqrt(a.reduce((sum, x) => sum + x * x, 0));
      const nb = Math.sqrt(b.reduce((sum, y) => sum + y * y, 0));
      return dot / (na * nb);
    },
    hint: 'Divide the dot product by the product of both vector lengths.',
    bug: 'The code omitted one vector norm, so the result is no longer a cosine similarity.',
  },
  variance_share: {
    label: 'explained variance share',
    values: (m, i) => [4 + n(m, i, 100, 0, 12), 2 + n(m, i, 101, 0, 8), 1 + n(m, i, 102, 0, 5)],
    setup: ([first, second, third]) => `variances = [${first}, ${second}, ${third}]`,
    expr: () => 'variances[0] / sum(variances)',
    prompt: ([first, second, third]) => `Three components explain variance ${first}, ${second} and ${third}. What share does the first component explain, rounded to two decimals?`,
    answer: ([first, second, third]) => first / (first + second + third),
    hint: 'Divide the first variance by the total of all three.',
    bug: 'The code divided by the second variance or by one component instead of the total.',
  },
  mse: {
    label: 'mean squared error',
    values: (m, i) => [
      Array.from({ length: 4 }, (_, j) => 2 + n(m, i, 110 + j, 0, 20)),
      Array.from({ length: 4 }, (_, j) => 2 + n(m, i, 114 + j, 0, 20)),
    ],
    setup: ([actual, predicted]) => `actual = ${list(actual)}\npredicted = ${list(predicted)}`,
    expr: () => 'sum((a - p) ** 2 for a, p in zip(actual, predicted)) / len(actual)',
    prompt: ([actual, predicted]) => `Actual values are ${actual.join(', ')} and predictions are ${predicted.join(', ')}. What is the MSE, rounded to two decimals?`,
    answer: ([actual, predicted]) => actual.reduce((sum, a, j) => sum + (a - predicted[j]) ** 2, 0) / actual.length,
    hint: 'Square each residual, add, then divide by the number of rows.',
    bug: 'The code averaged absolute residuals or divided by the wrong number of rows.',
  },
  mae: {
    label: 'mean absolute error',
    values: (m, i) => [
      Array.from({ length: 4 }, (_, j) => 2 + n(m, i, 120 + j, 0, 20)),
      Array.from({ length: 4 }, (_, j) => 2 + n(m, i, 124 + j, 0, 20)),
    ],
    setup: ([actual, predicted]) => `actual = ${list(actual)}\npredicted = ${list(predicted)}`,
    expr: () => 'sum(abs(a - p) for a, p in zip(actual, predicted)) / len(actual)',
    prompt: ([actual, predicted]) => `Actual values are ${actual.join(', ')} and predictions are ${predicted.join(', ')}. What is the MAE, rounded to two decimals?`,
    answer: ([actual, predicted]) => actual.reduce((sum, a, j) => sum + Math.abs(a - predicted[j]), 0) / actual.length,
    hint: 'Take the absolute residual, add, then divide by the row count.',
    bug: 'The code squared the residuals, so it computed MSE rather than MAE.',
  },
  rmse: {
    label: 'root mean squared error',
    values: (m, i) => [
      Array.from({ length: 4 }, (_, j) => 2 + n(m, i, 130 + j, 0, 20)),
      Array.from({ length: 4 }, (_, j) => 2 + n(m, i, 134 + j, 0, 20)),
    ],
    setup: ([actual, predicted]) => `actual = ${list(actual)}\npredicted = ${list(predicted)}`,
    imports: 'import math',
    expr: () => 'math.sqrt(sum((a - p) ** 2 for a, p in zip(actual, predicted)) / len(actual))',
    prompt: ([actual, predicted]) => `Actual values are ${actual.join(', ')} and predictions are ${predicted.join(', ')}. What is the RMSE, rounded to two decimals?`,
    answer: ([actual, predicted]) => Math.sqrt(actual.reduce((sum, a, j) => sum + (a - predicted[j]) ** 2, 0) / actual.length),
    hint: 'Compute MSE first, then take its square root.',
    bug: 'The code forgot the square root, leaving the result in squared units.',
  },
  gradient_step: {
    label: 'gradient descent step',
    values: (m, i) => [2 + n(m, i, 140, 0, 15), 1 + n(m, i, 141, 0, 12), 0.1 + ((m + i) % 8) / 10],
    setup: ([weight, gradient, lr]) => `weight = ${weight}\ngradient = ${gradient}\nlr = ${lr}`,
    expr: () => 'weight - lr * gradient',
    prompt: ([weight, gradient, lr]) => `A weight is ${weight}, its gradient is ${gradient} and the learning rate is ${lr}. What is the next weight, rounded to two decimals?`,
    answer: ([weight, gradient, lr]) => weight - lr * gradient,
    hint: 'Move opposite the gradient: weight minus learning rate times gradient.',
    bug: 'The code added the gradient, so it performed gradient ascent instead of descent.',
  },
  sigmoid: {
    label: 'sigmoid',
    values: (m, i) => [-4 + n(m, i, 150, 0, 9)],
    imports: 'import math',
    setup: ([z]) => `z = ${z}`,
    expr: () => '1 / (1 + math.exp(-z))',
    prompt: ([z]) => `What is the sigmoid of z = ${z}, rounded to two decimals?`,
    answer: ([z]) => 1 / (1 + Math.exp(-z)),
    hint: 'The sigmoid is 1 / (1 + e^-z).',
    bug: 'The code used e^z instead of e^-z, reversing the probability.',
  },
  odds: {
    label: 'odds',
    values: (m, i) => [0.1 + ((m + i) % 8) / 10],
    setup: ([p]) => `p = ${p}`,
    expr: () => 'p / (1 - p)',
    prompt: ([p]) => `A probability is ${p}. What are the corresponding odds, rounded to two decimals?`,
    answer: ([p]) => p / (1 - p),
    hint: 'Odds are p divided by 1 minus p.',
    bug: 'The code used p divided by p, or reversed the complement.',
  },
  precision: {
    label: 'precision',
    values: (m, i) => [5 + n(m, i, 160, 0, 30), 1 + n(m, i, 161, 0, 15)],
    setup: ([tp, fp]) => `tp = ${tp}\nfp = ${fp}`,
    expr: () => 'tp / (tp + fp)',
    prompt: ([tp, fp]) => `A classifier has ${tp} true positives and ${fp} false positives. What is its precision, rounded to two decimals?`,
    answer: ([tp, fp]) => tp / (tp + fp),
    hint: 'Precision is TP divided by TP plus FP.',
    bug: 'The code divided by TP plus FN, which computes recall instead of precision.',
  },
  recall: {
    label: 'recall',
    values: (m, i) => [5 + n(m, i, 170, 0, 30), 1 + n(m, i, 171, 0, 15)],
    setup: ([tp, fn]) => `tp = ${tp}\nfn = ${fn}`,
    expr: () => 'tp / (tp + fn)',
    prompt: ([tp, fn]) => `A classifier has ${tp} true positives and ${fn} false negatives. What is its recall, rounded to two decimals?`,
    answer: ([tp, fn]) => tp / (tp + fn),
    hint: 'Recall is TP divided by TP plus FN.',
    bug: 'The code divided by TP plus FP, which computes precision instead of recall.',
  },
  f1: {
    label: 'F1 score',
    values: (m, i) => [5 + n(m, i, 180, 0, 30), 1 + n(m, i, 181, 0, 15), 1 + n(m, i, 182, 0, 15)],
    setup: ([tp, fp, fn]) => `tp = ${tp}\nfp = ${fp}\nfn = ${fn}`,
    expr: () => '2 * (tp / (tp + fp)) * (tp / (tp + fn)) / ((tp / (tp + fp)) + (tp / (tp + fn)))',
    prompt: ([tp, fp, fn]) => `A classifier has TP = ${tp}, FP = ${fp} and FN = ${fn}. What is its F1 score, rounded to two decimals?`,
    answer: ([tp, fp, fn]) => {
      const precision = tp / (tp + fp);
      const recall = tp / (tp + fn);
      return (2 * precision * recall) / (precision + recall);
    },
    hint: 'F1 is 2 × precision × recall divided by precision + recall.',
    bug: 'The code used a simple average of precision and recall instead of the harmonic mean.',
  },
  specificity: {
    label: 'specificity',
    values: (m, i) => [20 + n(m, i, 190, 0, 50), 1 + n(m, i, 191, 0, 15)],
    setup: ([tn, fp]) => `tn = ${tn}\nfp = ${fp}`,
    expr: () => 'tn / (tn + fp)',
    prompt: ([tn, fp]) => `A classifier has ${tn} true negatives and ${fp} false positives. What is its specificity, rounded to two decimals?`,
    answer: ([tn, fp]) => tn / (tn + fp),
    hint: 'Specificity is TN divided by TN plus FP.',
    bug: 'The code divided by the positive count, which is sensitivity, not specificity.',
  },
  gini: {
    label: 'Gini impurity',
    values: (m, i) => [0.1 + ((m + i * 2) % 8) / 10],
    setup: ([p]) => `p = ${p}`,
    expr: () => '1 - (p * p + (1 - p) ** 2)',
    prompt: ([p]) => `A binary node has positive fraction ${p}. What is its Gini impurity, rounded to two decimals?`,
    answer: ([p]) => 1 - (p * p + (1 - p) ** 2),
    hint: 'Gini is 1 minus the sum of squared class proportions.',
    bug: 'The code summed the probabilities without squaring them.',
  },
  entropy: {
    label: 'binary entropy',
    values: (m, i) => [0.1 + ((m + i) % 8) / 10],
    imports: 'import math',
    setup: ([p]) => `p = ${p}`,
    expr: () => '-p * math.log2(p) - (1 - p) * math.log2(1 - p)',
    prompt: ([p]) => `A binary node has positive fraction ${p}. What is its entropy in bits, rounded to two decimals?`,
    answer: ([p]) => -p * Math.log2(p) - (1 - p) * Math.log2(1 - p),
    hint: 'Entropy is minus the sum of each proportion times its base-2 logarithm.',
    bug: 'The code used the natural logarithm instead of base 2, changing the unit.',
  },
  iqr: {
    label: 'interquartile range',
    values: (m, i) => {
      const q1 = 5 + n(m, i, 200, 0, 20);
      const q3 = q1 + 2 + n(m, i, 201, 0, 15);
      return [q1, q3];
    },
    setup: ([q1, q3]) => `q1 = ${q1}\nq3 = ${q3}`,
    expr: () => 'q3 - q1',
    prompt: ([q1, q3]) => `A distribution has Q1 = ${q1} and Q3 = ${q3}. What is its interquartile range?`,
    answer: ([q1, q3]) => q3 - q1,
    hint: 'IQR is Q3 minus Q1.',
    bug: 'The code added the quartiles or returned the upper fence instead of the IQR.',
  },
  rolling_mean: {
    label: 'rolling mean',
    values: (m, i) => {
      const series = Array.from({ length: 5 }, (_, j) => 5 + n(m, i, 210 + j, 0, 20));
      return [series, 3];
    },
    setup: ([series, window]) => `values = ${list(series)}\nwindow = ${window}`,
    expr: () => 'sum(values[-window:]) / window',
    prompt: ([series, window]) => `For the series ${series.join(', ')}, what is the mean of the last ${window} values, rounded to two decimals?`,
    answer: ([series, window]) => series.slice(-window).reduce((a, b) => a + b, 0) / window,
    hint: 'Take the last window values, add them, divide by the window size.',
    bug: 'The code used the first window or included a value after the forecast point.',
  },
  tfidf: {
    label: 'TF-IDF',
    values: (m, i) => [0.1 + ((m + i) % 5) / 10, 1 + n(m, i, 220, 0, 5)],
    setup: ([tf, idf]) => `tf = ${tf}\nidf = ${idf}`,
    expr: () => 'tf * idf',
    prompt: ([tf, idf]) => `A term has term frequency ${tf} and inverse document frequency ${idf}. What is its TF-IDF score, rounded to two decimals?`,
    answer: ([tf, idf]) => tf * idf,
    hint: 'Multiply term frequency by inverse document frequency.',
    bug: 'The code added TF and IDF instead of multiplying them.',
  },
  token_frequency: {
    label: 'token frequency',
    values: (m, i) => {
      const count = 1 + n(m, i, 230, 0, 5);
      const total = count + 2 + n(m, i, 231, 0, 12);
      return [count, total];
    },
    setup: ([count, total]) => `count = ${count}\ntotal = ${total}`,
    expr: () => 'count / total',
    prompt: ([count, total]) => `A document has ${count} occurrences of a token out of ${total} tokens. What is the token frequency, rounded to two decimals?`,
    answer: ([count, total]) => count / total,
    hint: 'Divide the token count by the document token total.',
    bug: 'The code divided by the vocabulary size or by the document count.',
  },
  parameter_count: {
    label: 'dense-layer parameter count',
    values: (m, i) => [2 + n(m, i, 240, 0, 10), 1 + n(m, i, 241, 0, 8)],
    setup: ([inputs, outputs]) => `inputs = ${inputs}\noutputs = ${outputs}`,
    expr: () => '(inputs + 1) * outputs',
    integerOutput: true,
    prompt: ([inputs, outputs]) => `A dense layer has ${inputs} inputs and ${outputs} outputs, with one bias per output. How many trainable parameters does it have?`,
    answer: ([inputs, outputs]) => (inputs + 1) * outputs,
    hint: 'Each output has one weight per input plus one bias.',
    bug: 'The code omitted the bias parameters or multiplied by the wrong dimension.',
  },
  latency_budget: {
    label: 'latency budget',
    values: (m, i) => [10 + n(m, i, 250, 0, 90), 2 + n(m, i, 251, 0, 20)],
    setup: ([requests, seconds]) => `requests = ${requests}\nseconds = ${seconds}`,
    expr: () => 'seconds * 1000 / requests',
    prompt: ([requests, seconds]) => `${requests} requests took ${seconds} seconds in total. What is the average latency in milliseconds, rounded to two decimals?`,
    answer: ([requests, seconds]) => (seconds * 1000) / requests,
    hint: 'Convert seconds to milliseconds, then divide by the request count.',
    bug: 'The code divided seconds by requests without converting to milliseconds.',
  },
  disparate_impact: {
    label: 'disparate impact ratio',
    values: (m, i) => [0.2 + ((m + i) % 7) / 10, 0.3 + ((m + i * 2) % 5) / 10],
    setup: ([rateA, rateB]) => `rate_a = ${rateA}\nrate_b = ${rateB}`,
    expr: () => 'min(rate_a, rate_b) / max(rate_a, rate_b)',
    prompt: ([rateA, rateB]) => `Two groups have positive rates ${rateA} and ${rateB}. What is the disparate impact ratio (smaller over larger), rounded to two decimals?`,
    answer: ([rateA, rateB]) => Math.min(rateA, rateB) / Math.max(rateA, rateB),
    hint: 'Divide the smaller group rate by the larger one.',
    bug: 'The code divided the larger rate by the smaller one, producing a ratio above one.',
  },
  minmax: {
    label: 'min-max scaling',
    values: (m, i) => {
      const values = Array.from({ length: 4 }, (_, j) => 5 + n(m, i, 260 + j, 0, 30));
      return [values, values[1]];
    },
    setup: ([values, value]) => `values = ${list(values)}\nvalue = ${value}`,
    expr: () => '(value - min(values)) / (max(values) - min(values))',
    prompt: ([values, value]) => `For values ${values.join(', ')}, what is the min-max scaled value of ${value}, rounded to two decimals?`,
    answer: ([values, value]) => (value - Math.min(...values)) / (Math.max(...values) - Math.min(...values)),
    hint: 'Subtract the minimum and divide by the range.',
    bug: 'The code divided by the maximum or forgot to subtract the minimum.',
  },
  missing_rate: {
    label: 'missing percentage',
    values: (m, i) => {
      const total = 20 + n(m, i, 270, 0, 60);
      const missing = 1 + n(m, i, 271, 0, Math.max(2, Math.floor(total / 4)));
      return [missing, total];
    },
    setup: ([missing, total]) => `missing = ${missing}\ntotal = ${total}`,
    expr: () => 'missing / total * 100',
    prompt: ([missing, total]) => `A column has ${missing} missing cells out of ${total}. What is the missing percentage, rounded to two decimals?`,
    answer: ([missing, total]) => (missing / total) * 100,
    hint: 'Divide missing by total, then multiply by 100.',
    bug: 'The code reported a fraction rather than a percentage, or divided by the non-missing count.',
  },
};

/** Ten deliberate-practice families per module. The values are generated, the module context is not. */
export const drillIds = {
  ml01: ['accuracy', 'error_rate', 'base_rate', 'mean', 'ratio', 'difference', 'weighted_average', 'zscore', 'cost_threshold', 'percent_change'],
  ml02: ['mean', 'median', 'ratio', 'percent_change', 'difference', 'weighted_average', 'accuracy', 'class_weight', 'zscore', 'cost_threshold'],
  ml03: ['mean', 'dot', 'euclidean', 'variance_share', 'mse', 'mae', 'rmse', 'zscore', 'gradient_step', 'missing_rate'],
  ml04: ['mean', 'median', 'percent_change', 'ratio', 'weighted_average', 'accuracy', 'base_rate', 'missing_rate', 'difference', 'zscore'],
  ml05: ['dot', 'gradient_step', 'euclidean', 'mean', 'mse', 'mae', 'sigmoid', 'variance_share', 'cosine', 'weighted_average'],
  ml06: ['mean', 'median', 'zscore', 'base_rate', 'odds', 'sigmoid', 'percent_change', 'weighted_average', 'iqr', 'difference'],
  ml07: ['mean', 'median', 'iqr', 'zscore', 'percent_change', 'ratio', 'difference', 'missing_rate', 'base_rate', 'weighted_average'],
  ml08: ['zscore', 'minmax', 'missing_rate', 'percent_change', 'mean', 'ratio', 'class_weight', 'accuracy', 'difference', 'cosine'],
  ml09: ['accuracy', 'error_rate', 'base_rate', 'class_weight', 'percent_change', 'precision', 'recall', 'f1', 'cost_threshold', 'mean'],
  ml10: ['mse', 'mae', 'rmse', 'mean', 'zscore', 'percent_change', 'dot', 'gradient_step', 'weighted_average', 'difference'],
  ml11: ['variance_share', 'dot', 'gradient_step', 'mean', 'zscore', 'weighted_average', 'percent_change', 'mse', 'mae', 'rmse'],
  ml12: ['sigmoid', 'odds', 'accuracy', 'precision', 'recall', 'f1', 'cost_threshold', 'base_rate', 'zscore', 'entropy'],
  ml13: ['euclidean', 'manhattan', 'cosine', 'precision', 'recall', 'f1', 'accuracy', 'base_rate', 'class_weight', 'mean'],
  ml14: ['gini', 'entropy', 'accuracy', 'precision', 'recall', 'f1', 'class_weight', 'weighted_average', 'variance_share', 'mean'],
  ml15: ['precision', 'recall', 'f1', 'specificity', 'accuracy', 'base_rate', 'cost_threshold', 'error_rate', 'class_weight', 'zscore'],
  ml16: ['euclidean', 'manhattan', 'mean', 'variance_share', 'cosine', 'class_weight', 'accuracy', 'ratio', 'weighted_average', 'difference'],
  ml17: ['variance_share', 'mean', 'dot', 'cosine', 'euclidean', 'zscore', 'weighted_average', 'percent_change', 'mse', 'rmse'],
  ml18: ['zscore', 'iqr', 'base_rate', 'error_rate', 'precision', 'recall', 'f1', 'cost_threshold', 'mean', 'median'],
  ml19: ['difference', 'precision', 'recall', 'accuracy', 'mean', 'variance_share', 'ratio', 'cost_threshold', 'percent_change', 'zscore'],
  ml20: ['class_weight', 'base_rate', 'precision', 'recall', 'f1', 'cost_threshold', 'accuracy', 'error_rate', 'weighted_average', 'percent_change'],
  ml21: ['percent_change', 'mean', 'rolling_mean', 'difference', 'ratio', 'mae', 'rmse', 'mse', 'zscore', 'weighted_average'],
  ml22: ['cosine', 'dot', 'euclidean', 'ratio', 'precision', 'recall', 'accuracy', 'weighted_average', 'mean', 'difference'],
  ml23: ['tfidf', 'token_frequency', 'mean', 'ratio', 'precision', 'recall', 'f1', 'accuracy', 'weighted_average', 'percent_change'],
  ml24: ['dot', 'sigmoid', 'parameter_count', 'gradient_step', 'mean', 'mse', 'euclidean', 'cosine', 'weighted_average', 'variance_share'],
  ml25: ['accuracy', 'error_rate', 'percent_change', 'latency_budget', 'cost_threshold', 'mean', 'zscore', 'ratio', 'difference', 'weighted_average'],
  ml26: ['latency_budget', 'error_rate', 'percent_change', 'base_rate', 'cost_threshold', 'precision', 'recall', 'f1', 'mean', 'zscore'],
  ml27: ['disparate_impact', 'base_rate', 'percent_change', 'difference', 'ratio', 'precision', 'recall', 'f1', 'accuracy', 'cost_threshold'],
};

const printLine = (formula) => (formula.integerOutput
  ? 'print(int(answer))'
  : 'rounded = math.floor(answer * 100 + 0.5) / 100\nprint(f"{rounded:.2f}")');
const importsFor = (formula) => [...new Set(['import math', formula.imports].filter(Boolean))];
const expectedFor = (formula, values) => (formula.integerOutput ? integer(formula.answer(values)) : fixed(formula.answer(values)));

/**
 * Build one fresh, fully executable drill case. The same function supplies Coding Lab, Logic,
 * Practice, Interview and Debug records, so a solution cannot drift from its expected output.
 */
export function makeDrill(moduleId, formulaId, index) {
  const formula = FORMULAS[formulaId];
  if (!formula) throw new Error(`unknown drill formula: ${formulaId}`);
  const moduleNumber = Number(String(moduleId).replace(/\D/g, '')) || 1;
  const values = formula.values(moduleNumber, index);
  const setup = formula.setup(values);
  const solution = [...importsFor(formula), setup, `answer = ${formula.expr(values)}`, printLine(formula)].filter(Boolean).join('\n');
  const expected = expectedFor(formula, values);
  const bugIndex = index % 4;
  const mutation = bugIndex === 0
    ? 'answer = answer + 1'
    : bugIndex === 1
      ? 'answer = answer * 0.9'
      : bugIndex === 2
        ? 'answer = answer - 1'
        : 'answer = answer * 1.1';
  const brokenAnswer = bugIndex === 0
    ? formula.answer(values) + 1
    : bugIndex === 1
      ? formula.answer(values) * 0.9
      : bugIndex === 2
        ? formula.answer(values) - 1
        : formula.answer(values) * 1.1;
  const brokenOutput = formula.integerOutput ? integer(brokenAnswer) : fixed(brokenAnswer);
  const broken = [...importsFor(formula), setup, `answer = ${formula.expr(values)}`, mutation, printLine(formula)].filter(Boolean).join('\n');
  return {
    formula: formulaId,
    label: formula.label,
    values,
    prompt: formula.prompt(values),
    answer: expected,
    hint: formula.hint,
    setup,
    solution,
    expected,
    starter: [...importsFor(formula), setup, '', '# calculate the requested value and print it to two decimals', ''].filter(Boolean).join('\n'),
    broken,
    brokenOutput,
    error: `This prints ${brokenOutput}, but the correct result is ${expected}. ${formula.bug}`,
    bug: formula.bug,
  };
}

export const formulaIds = Object.keys(FORMULAS);
