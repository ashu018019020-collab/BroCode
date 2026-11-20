/**
 * Machine Learning — authored checkpoint batch 2.
 *
 * The first checkpoint batch gave every module one true/false, one fill-in-the-blank, one code
 * output and one written rubric item. This batch adds a second true/false, a second blank and a
 * second written item, all grounded in the module's own lesson. The expansion generator fills the
 * remainder of the 50-checkpoint section, so these authored records replace generic generated MCQs
 * rather than inflating the 500-record contract.
 *
 * Every blank carries its full solution and verified output. `ml-course.test.mjs` executes both the
 * restored solution and the filled template.
 */
const specs = {
  ml01: {
    tf: {
      q: 'Checkpoint (true/false): a model with 99% training accuracy and 70% validation accuracy is probably overfitting.',
      answer: 'True',
      why: 'The large gap means the model fits training-specific detail that does not transfer. Check for leakage, then simplify or regularise before trusting the training score.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the denominator in this validation-accuracy calculation.',
      code: 'correct = 18\ntotal = 24\nprint(round(correct / ___, 2))',
      answer: 'total',
      expected: '0.75',
      why: 'The denominator is the full number of validation rows, so 18 / 24 gives 0.75.',
    },
    written: {
      q: 'Written checkpoint: explain why a majority-class baseline is required before evaluating a churn model.',
      answer: 'A majority-class baseline predicts the most common label for every row and establishes the score that a real model must beat. It exposes class imbalance: with 10% churn, a constant “no churn” prediction is 90% accurate while catching no churners. Comparing the model with that baseline on the same split and metric prevents a high but meaningless accuracy number from being presented as progress.',
      rubric: [
        'Defines the baseline as always predicting the majority class.',
        'Explains that it exposes imbalance and gives a comparison point.',
        'Requires the same split and metric for a fair comparison.',
      ],
      why: 'A model is only useful relative to a trivial predictor; without the baseline, accuracy can hide a completely useless classifier.',
    },
  },
  ml02: {
    tf: {
      q: 'Checkpoint (true/false): a tuple can be modified after it is created.',
      answer: 'False',
      why: 'Tuples are immutable. Use a list when the sequence must change, and a tuple for fixed records or multiple return values.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the sentinel used to filter missing marks.',
      code: 'marks = [80, None, 90]\nclean = [mark for mark in marks if mark is not ___]\nprint(len(clean))',
      answer: 'None',
      expected: '2',
      why: '`None` represents the missing value; the comprehension keeps the two real marks.',
    },
    written: {
      q: 'Written checkpoint: explain why an ML project should pin its Python package versions, and name one artifact that records them.',
      answer: 'A model result is reproducible only if the code, data and dependencies that produced it can be recreated. A library upgrade can silently change defaults, numerical behaviour or serialization, so the same notebook may produce a different result later. Record the interpreter and direct dependency versions in a lockfile or requirements file and keep that artifact with the experiment.',
      rubric: [
        'Connects reproducibility to the exact code and dependency environment.',
        'Names a concrete failure caused by an unpinned upgrade.',
        'Mentions a lockfile, requirements file or equivalent artifact.',
      ],
      why: 'Pinning turns “it worked once” into a rerunnable experiment rather than an undocumented claim.',
    },
  },
  ml03: {
    tf: {
      q: 'Checkpoint (true/false): for a (5, 3) NumPy array, `.sum(axis=0)` returns three column totals.',
      answer: 'True',
      why: '`axis=0` collapses the five rows, leaving one result for each of the three columns. The output shape is (3,).',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the number of columns being aggregated.',
      code: 'matrix = [[1, 2], [3, 4]]\nprint([sum(row[i] for row in matrix) for i in range(___)])',
      answer: '2',
      expected: '[4, 6]',
      why: 'The matrix has two columns, so range(2) sums positions 0 and 1: 1+3 and 2+4.',
    },
    written: {
      q: 'Written checkpoint: explain what an axis means in a NumPy aggregation and give one shape example.',
      answer: 'An axis is the dimension being reduced. For a (4, 3) array, `.sum(axis=0)` collapses the rows and returns shape (3,), one total per column; `.sum(axis=1)` collapses the columns and returns shape (4,), one total per row. Reading the axis correctly prevents plausible but transposed results.',
      rubric: [
        'Defines the axis as the dimension being reduced.',
        'Gives a concrete input shape and output shape.',
        'Contrasts axis 0 with axis 1 or states the resulting shape.',
      ],
      why: 'A correct number on the wrong axis can still be a bug; the shape makes the intended reduction explicit.',
    },
  },
  ml04: {
    tf: {
      q: 'Checkpoint (true/false): Pandas `.loc` selects rows by integer position rather than by index label.',
      answer: 'False',
      why: '`.loc` is label-based; `.iloc` is position-based. After a sort, those two meanings can point at different rows.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the city used to calculate the Pune revenue.',
      code: 'orders = [{"city": "Pune", "amount": 80}, {"city": "Delhi", "amount": 90}, {"city": "Pune", "amount": 70}]\nprint(sum(row["amount"] for row in orders if row["city"] == "___"))',
      answer: 'Pune',
      expected: '150',
      why: 'The filter keeps the two Pune orders, 80 + 70, and excludes Delhi.',
    },
    written: {
      q: 'Written checkpoint: explain why chained assignment in Pandas can silently fail to update the original DataFrame.',
      answer: 'Chained indexing such as `df[df.a > 0]["b"] = 1` can operate on a temporary copy, so the assignment may not reach the original object. Pandas may also emit a SettingWithCopy warning. Use one explicit `.loc[row_mask, "b"] = 1` assignment and verify the number of changed rows.',
      rubric: [
        'Explains the temporary-copy or uncertain-target problem.',
        'Contrasts chained indexing with a single `.loc` assignment.',
        'Requires checking the affected rows after the assignment.',
      ],
      why: 'The bug is dangerous because the code may run without an exception while leaving the source unchanged.',
    },
  },
  ml05: {
    tf: {
      q: 'Checkpoint (true/false): gradient descent adds the gradient to a parameter in order to reduce the loss.',
      answer: 'False',
      why: 'The gradient points toward increasing loss. Minimisation moves in the opposite direction, subtracting the scaled gradient.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the learning-rate variable in this update.',
      code: 'weight = 4.0\ngradient = 8.0\nlearning_rate = 0.1\nprint(round(weight - ___ * gradient, 2))',
      answer: 'learning_rate',
      expected: '3.2',
      why: 'The update subtracts learning rate × gradient: 4.0 − 0.1 × 8 = 3.2.',
    },
    written: {
      q: 'Written checkpoint: explain the difference between a derivative and a gradient, and why training uses the negative gradient.',
      answer: 'A derivative measures how a scalar output changes with one scalar input; a gradient collects the partial derivatives with respect to every parameter into a vector. The gradient points in the direction of steepest increase, so minimising a loss moves in the negative-gradient direction. The learning rate controls the step size.',
      rubric: [
        'Distinguishes a scalar derivative from a vector of partial derivatives.',
        'States that the gradient points toward increasing loss.',
        'Explains that subtraction moves downhill and mentions step size.',
      ],
      why: 'The sign is not cosmetic: adding the gradient ascends, subtracting it descends.',
    },
  },
  ml06: {
    tf: {
      q: 'Checkpoint (true/false): a p-value is the probability that the null hypothesis is true.',
      answer: 'False',
      why: 'It is the probability of observing data at least as extreme as ours, assuming the null is true. It is not a posterior probability of the null.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the evidence term in Bayes theorem.',
      code: 'prior = 0.2\nlikelihood = 0.5\nevidence = 0.25\nprint(round(prior * likelihood / ___, 2))',
      answer: 'evidence',
      expected: '0.4',
      why: 'Bayes theorem divides prior × likelihood by the evidence: 0.2 × 0.5 / 0.25 = 0.4.',
    },
    written: {
      q: 'Written checkpoint: explain what a 95% confidence interval means and what it does not guarantee.',
      answer: 'A 95% confidence interval is produced by a procedure that would capture the true parameter in about 95% of repeated samples under its assumptions. It expresses uncertainty around an estimate, not the probability that this particular interval contains the truth. It also does not guarantee that the study was unbiased or that the effect is practically important.',
      rubric: [
        'Describes the repeated-sampling or procedure-based meaning.',
        'Avoids claiming a 95% probability for this specific interval.',
        'Mentions assumptions, bias or practical importance as separate issues.',
      ],
      why: 'The confidence level belongs to the procedure, while a single interval is either covering or not.',
    },
  },
  ml07: {
    tf: {
      q: 'Checkpoint (true/false): a correlation coefficient of exactly zero proves that two variables are independent.',
      answer: 'False',
      why: 'Correlation measures linear association only. A strong non-linear relationship can have zero linear correlation, so inspect the scatter plot.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the percentage multiplier in this missing-value calculation.',
      code: 'values = [1, None, 3, None]\nprint(sum(value is None for value in values) / len(values) * ___)',
      answer: '100',
      expected: '50.0',
      why: 'Two of four values are missing, so the fraction is 0.5 and the percentage is 50.0.',
    },
    written: {
      q: 'Written checkpoint: explain why missingness should be measured before choosing a cleaning strategy.',
      answer: 'Missingness can be concentrated in a subgroup or in the target itself, so dropping rows can silently change the population. Measure missing counts by column, by target class and over time. Then decide whether to drop, impute or investigate the collection process, and document the assumption behind that choice.',
      rubric: [
        'Connects missingness patterns to bias or population change.',
        'Recommends measuring by column and by target or time.',
        'Chooses a strategy with a documented assumption rather than defaulting to drop.',
      ],
      why: 'The cleaning method is a modelling decision; without the pattern, a convenient fill can distort the signal.',
    },
  },
  ml08: {
    tf: {
      q: 'Checkpoint (true/false): fitting a scaler on the full dataset before the train/test split is safe because scaling is unsupervised.',
      answer: 'False',
      why: 'Unsupervised does not mean leakage-free. The scaler learns test-set statistics, so evaluation information influences training preprocessing.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the training standard deviation in this z-score.',
      code: 'mean = 10\nstd = 2\nvalue = 14\nprint((value - mean) / ___)',
      answer: 'std',
      expected: '2.0',
      why: 'The z-score is (14 − 10) / 2 = 2.0; the denominator is the training standard deviation.',
    },
    written: {
      q: 'Written checkpoint: explain why one-hot encoding is usually preferred to integer codes for unordered categories.',
      answer: 'Integer codes imply an order and a distance that the categories do not have; a model can treat “blue = 2” as twice “red = 1”. One-hot encoding gives each category its own binary column, removing the false ordering. It costs more columns and needs an explicit strategy for unseen categories.',
      rubric: [
        'Explains the false order or distance created by integer codes.',
        'Describes one binary column per category.',
        'Mentions the cost in dimensionality or unseen-category handling.',
      ],
      why: 'The representation should match the meaning: unordered labels should not become an accidental numeric scale.',
    },
  },
  ml09: {
    tf: {
      q: 'Checkpoint (true/false): the test set can be used repeatedly to choose hyperparameters as long as the final model is refitted.',
      answer: 'False',
      why: 'Repeated test-set decisions turn it into a validation set and bias the final estimate. Select on validation or cross-validation, then test once.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the collection whose length is the denominator.',
      code: 'labels = [0, 0, 1, 1, 1]\nprint(max(labels.count(0), labels.count(1)) / len(___))',
      answer: 'labels',
      expected: '0.6',
      why: 'The majority class has three of five rows, so 3 / len(labels) = 0.6.',
    },
    written: {
      q: 'Written checkpoint: distinguish overfitting from underfitting and name one diagnostic for each.',
      answer: 'Overfitting fits training noise: training performance is much better than validation performance, often with high variance. Underfitting misses the real pattern: both training and validation performance are poor, often with high bias. Compare learning curves and training-versus-validation gaps; then simplify or regularise for overfitting, or add relevant capacity or features for underfitting.',
      rubric: [
        'Defines overfitting as a large train/validation gap.',
        'Defines underfitting as poor performance on both training and validation.',
        'Names a diagnostic and a corresponding response.',
      ],
      why: 'The two failures need opposite remedies; a single accuracy number cannot tell them apart.',
    },
  },
  ml10: {
    tf: {
      q: 'Checkpoint (true/false): mean squared error is measured in the original target units.',
      answer: 'False',
      why: 'MSE is in squared target units. RMSE returns to the original unit, which is why it is often easier to explain.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the number of observations in this MSE.',
      code: 'actual = [3, 5, 7]\npredicted = [2, 5, 8]\nprint(round(sum((a - p) ** 2 for a, p in zip(actual, predicted)) / ___, 2))',
      answer: 'len(actual)',
      expected: '0.67',
      why: 'The squared errors are 1, 0 and 1; their sum is 2, divided by 3 observations gives 0.67.',
    },
    written: {
      q: 'Written checkpoint: explain why a high R-squared does not prove that a regression model is useful.',
      answer: 'R-squared measures the fraction of target variance explained on a particular sample relative to a mean baseline. It can be high while the model is systematically wrong for a subgroup, badly calibrated, unstable over time or causally unsupported. Report target-unit error, residual patterns, subgroup performance and the decision cost before calling the model useful.',
      rubric: [
        'Defines R-squared as explained variance against a mean baseline.',
        'Names at least two separate failure modes, such as subgroup error or instability.',
        'Recommends target-unit errors, residual checks or decision-cost evidence.',
      ],
      why: 'Explained variance is one summary of one sample, not evidence of production value or causal correctness.',
    },
  },
  ml11: {
    tf: {
      q: 'Checkpoint (true/false): Lasso can set some coefficients exactly to zero.',
      answer: 'True',
      why: 'The L1 penalty has corners that produce sparse solutions, so Lasso can perform feature selection; Ridge usually shrinks without exact zeros.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the penalty term in this shrinkage ratio.',
      code: 'base = 8\nalpha = 2\nprint(round(base / (base + ___), 2))',
      answer: 'alpha',
      expected: '0.8',
      why: 'The ratio is 8 / (8 + 2) = 0.8; alpha is the regularisation strength.',
    },
    written: {
      q: 'Written checkpoint: explain why regularised regression requires feature scaling.',
      answer: 'The penalty treats every coefficient on the same scale. A feature measured in rupees gets a tiny coefficient while one measured in millions gets a large one, so the penalty is unfair without scaling. Standardise inside the training pipeline, tune alpha after scaling, and fit the scaler on training rows only.',
      rubric: [
        'Explains that the penalty is applied to coefficient magnitude.',
        'Shows why different feature units make the penalty unfair.',
        'Requires scaling inside the training pipeline before tuning alpha.',
      ],
      why: 'Without a common scale, the regularisation strength is an accidental function of measurement units.',
    },
  },
  ml12: {
    tf: {
      q: 'Checkpoint (true/false): a logistic regression model outputs a class label before any decision threshold is chosen.',
      answer: 'False',
      why: 'It outputs a probability or score. A threshold turns that score into a class, and the threshold should reflect error costs.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the score inside the sigmoid.',
      code: 'import math\nz = 1\nprint(round(1 / (1 + math.exp(-___)), 2))',
      answer: 'z',
      expected: '0.73',
      why: 'The sigmoid is 1 / (1 + e^-z); with z = 1 the result is about 0.73.',
    },
    written: {
      q: 'Written checkpoint: explain why a fraud model may use a threshold below 0.5.',
      answer: 'A false negative, a missed fraud, usually costs much more than a false positive that a reviewer can inspect. Lowering the threshold catches more frauds at the cost of more alerts. Choose the threshold from the relative error costs and the review capacity, then report precision, recall and the expected daily volume.',
      rubric: [
        'Connects the threshold to asymmetric error costs.',
        'Explains the precision/recall trade-off.',
        'Mentions operational review capacity or alert volume.',
      ],
      why: '0.5 is a default, not a business decision; the threshold should reflect what each mistake costs.',
    },
  },
  ml13: {
    tf: {
      q: 'Checkpoint (true/false): K-nearest neighbours usually needs feature scaling when it uses distances.',
      answer: 'True',
      why: 'Distance combines every feature, so a column measured in thousands can dominate one measured in fractions.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the missing horizontal difference in this distance.',
      code: 'import math\ndx = 3\ndy = 4\nprint(math.hypot(___, dy))',
      answer: 'dx',
      expected: '5.0',
      why: 'The Euclidean distance is sqrt(3² + 4²) = 5.0.',
    },
    written: {
      q: 'Written checkpoint: explain the difference between precision and recall and give a case where each matters more.',
      answer: 'Precision is TP / (TP + FP): of the rows flagged positive, how many were right. Recall is TP / (TP + FN): of the actual positives, how many were found. Precision matters when false alarms are expensive, such as a small expert review queue; recall matters when misses are costly, such as fraud or disease screening. Report both with the threshold and error costs.',
      rubric: [
        'Defines precision with the flagged-positive denominator.',
        'Defines recall with the actual-positive denominator.',
        'Gives a scenario where each error cost dominates.',
      ],
      why: 'The two metrics answer different operational questions; one alone can hide a bad error mix.',
    },
  },
  ml14: {
    tf: {
      q: 'Checkpoint (true/false): a random forest averages trees trained on bootstrap samples and random feature subsets.',
      answer: 'True',
      why: 'Those two sources of randomness decorrelate the trees, and averaging reduces variance compared with one deep tree.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the class probability in this Gini impurity.',
      code: 'p = ___\nprint(round(1 - (p * p + (1 - p) ** 2), 2))',
      answer: '0.5',
      expected: '0.5',
      why: 'A balanced binary node has p = 0.5 and Gini impurity 0.5.',
    },
    written: {
      q: 'Written checkpoint: explain the main difference between bagging and gradient boosting.',
      answer: 'Bagging trains models independently on bootstrap samples and averages them, mainly reducing variance. Gradient boosting fits trees sequentially, each new tree targeting the current errors or gradients, mainly reducing bias. Boosting can be more accurate on tabular data but is more sensitive to learning rate, depth and overfitting.',
      rubric: [
        'Describes bagging as independent models on resampled data.',
        'Describes boosting as sequential correction of current errors.',
        'Connects the methods to variance versus bias and their tuning risk.',
      ],
      why: 'The ensemble structure determines whether the main benefit is stability or error correction.',
    },
  },
  ml15: {
    tf: {
      q: 'Checkpoint (true/false): accuracy is sufficient to judge a classifier when the positive class is rare.',
      answer: 'False',
      why: 'A constant-negative predictor can score high accuracy while catching zero positives. Report precision, recall, PR-AUC or cost-weighted metrics.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the second factor in the F1 denominator.',
      code: 'tp, fp, fn = 40, 10, 10\nprecision = tp / (tp + fp)\nrecall = tp / (tp + fn)\nprint(round(2 * precision * recall / (precision + ___), 2))',
      answer: 'recall',
      expected: '0.8',
      why: 'F1 is 2PR / (P + R); both precision and recall are 0.8, so F1 is 0.8.',
    },
    written: {
      q: 'Written checkpoint: explain when a precision-recall curve is more informative than an ROC curve.',
      answer: 'ROC uses the false-positive rate, whose denominator is the large negative class, so it can look reassuring even when the absolute number of false positives is huge. A PR curve focuses on the positive class and shows the precision cost of finding more positives. On rare-positive problems, report prevalence, PR-AUC and the chosen operating threshold.',
      rubric: [
        'Explains the negative-class denominator in ROC.',
        'Connects PR to the positive class and precision cost.',
        'Mentions prevalence or the operating threshold.',
      ],
      why: 'With rare positives, the operational cost is dominated by false alarms that ROC can visually understate.',
    },
  },
  ml16: {
    tf: {
      q: 'Checkpoint (true/false): K-Means requires the number of clusters K to be chosen before fitting.',
      answer: 'True',
      why: 'K is a model input. The elbow and silhouette methods help choose it, but the algorithm itself does not discover K.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the number of points in this centroid.',
      code: 'points = [2, 4, 6]\nprint(sum(points) / ___)',
      answer: 'len(points)',
      expected: '4.0',
      why: 'The centroid is the mean: (2 + 4 + 6) / 3 = 4.0.',
    },
    written: {
      q: 'Written checkpoint: explain why a mathematically valid clustering can still be useless for a business.',
      answer: 'Clustering always returns groups; it does not know which distinctions support a decision. A tight segmentation can split customers in ways no team can target, or group them by a proxy that should not drive action. Validate stability, interpretability and whether the groups differ on an outcome worth changing.',
      rubric: [
        'States that clustering has no inherent business objective.',
        'Names a failure such as unactionable or unstable segments.',
        'Requires validation against an actionable outcome.',
      ],
      why: 'Numerical separation is necessary but not sufficient; the segments must support a real decision.',
    },
  },
  ml17: {
    tf: {
      q: 'Checkpoint (true/false): PCA components are ordered by the amount of variance they explain.',
      answer: 'True',
      why: 'The first component captures the largest variance, and each later component is orthogonal and explains no more than the previous one.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the total variance in this explained-share calculation.',
      code: 'variances = [4, 1]\nprint(round(4 / ___, 2))',
      answer: 'sum(variances)',
      expected: '0.8',
      why: 'The first component explains 4 of the total 5 variance units, so its share is 0.8.',
    },
    written: {
      q: 'Written checkpoint: explain when PCA is a better choice than feature selection.',
      answer: 'PCA is useful when many features are correlated and the goal is compression, denoising or visualisation into a small number of components. Feature selection is better when the original columns must remain interpretable, for example for a regulated explanation or a data-collection decision. PCA components are combinations, so they usually sacrifice direct feature meaning.',
      rubric: [
        'Connects PCA to correlated features and compression.',
        'Connects feature selection to preserving interpretable original columns.',
        'Mentions the loss of direct feature meaning in PCA.',
      ],
      why: 'The choice is about whether the deliverable needs compact variance or named, actionable columns.',
    },
  },
  ml18: {
    tf: {
      q: 'Checkpoint (true/false): deleting every statistical outlier is the safest default before training.',
      answer: 'False',
      why: 'An outlier can be a data-entry error, a rare valid customer or the fraud signal itself. Investigate, document and choose keep, cap or remove.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the lower quartile in this upper-fence calculation.',
      code: 'q1 = 10\nq3 = 20\nprint(q3 + 1.5 * (q3 - ___))',
      answer: 'q1',
      expected: '35.0',
      why: 'The IQR is 20 − 10 = 10, so the upper fence is 20 + 1.5 × 10 = 35.0.',
    },
    written: {
      q: 'Written checkpoint: explain how to evaluate an anomaly detector when labels are incomplete.',
      answer: 'Inspect a sample of alerts with domain experts, measure precision at a fixed review capacity, test stability across seeds and time, and track downstream outcomes. If a small labelled set exists, report precision and recall on it while naming its sampling bias. Never treat unlabelled rows as confirmed negatives.',
      rubric: [
        'Uses expert review or a labelled sample rather than pretending labels are complete.',
        'Measures precision at a realistic alert budget or stability over time.',
        'Explicitly refuses to treat missing labels as negatives.',
      ],
      why: 'Anomaly evaluation is an investigation process, not supervised accuracy on a silently incomplete label set.',
    },
  },
  ml19: {
    tf: {
      q: 'Checkpoint (true/false): permutation importance proves that a feature causes the outcome.',
      answer: 'False',
      why: 'It measures how much a fitted model relies on a feature on a particular dataset. Correlation, redundancy and leakage can all change the result without causation.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the permuted score in this importance drop.',
      code: 'base_score = 0.9\npermuted_score = 0.7\nprint(round(base_score - ___, 2))',
      answer: 'permuted_score',
      expected: '0.2',
      why: 'The importance estimate is the drop from 0.9 to 0.7, which is 0.2.',
    },
    written: {
      q: 'Written checkpoint: explain the difference between a local explanation and a global explanation.',
      answer: 'A local explanation describes why one prediction happened, such as a SHAP waterfall for one applicant. A global explanation summarises behaviour across many rows, such as mean absolute SHAP or partial dependence. Local explanations can vary widely; global summaries can hide subgroup failures, so use both and state that they are model attributions, not proof of causation.',
      rubric: [
        'Defines local as one prediction and global as many predictions.',
        'Gives a concrete example of each.',
        'Mentions subgroup variation, causation or both limitations.',
      ],
      why: 'The two scopes answer different questions; an aggregate can look stable while an individual decision is driven by another feature.',
    },
  },
  ml20: {
    tf: {
      q: 'Checkpoint (true/false): SMOTE should be applied to the test set so evaluation matches the balanced training data.',
      answer: 'False',
      why: 'Test data must reflect the real population. SMOTE belongs only inside training folds; synthetic evaluation data would distort the metric.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the total row count in this base rate.',
      code: 'positive = 10\ntotal = 100\nprint(round(positive / ___, 2))',
      answer: 'total',
      expected: '0.1',
      why: 'The positive base rate is 10 / 100 = 0.1.',
    },
    written: {
      q: 'Written checkpoint: compare class weighting with resampling for an imbalanced target and name one shared risk.',
      answer: 'Class weighting keeps the rows but increases the loss contribution of the minority class; resampling changes the row distribution by duplicating minority examples or removing majority ones. Both can raise minority recall, but both can distort predicted probabilities and overfit duplicated or discarded patterns. Recalibrate and validate on the original distribution.',
      rubric: [
        'Distinguishes changing loss weights from changing the rows.',
        'States the intended minority-recall benefit.',
        'Names a shared risk such as calibration damage or overfitting.',
      ],
      why: 'Both interventions change the effective training distribution, so the untouched real distribution is still the evaluation target.',
    },
  },
  ml21: {
    tf: {
      q: 'Checkpoint (true/false): a random train/test split is safe for a time-series forecasting problem.',
      answer: 'False',
      why: 'A random split can train on future observations and test on the past, leaking information that would not exist at prediction time.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the lag offset in these adjacent pairs.',
      code: 'values = [5, 6, 7]\nprint(list(zip(values, values[___:])))',
      answer: '1',
      expected: '[(5, 6), (6, 7)]',
      why: 'A lag of one pairs each value with the next one; the final value has no successor, so zip stops.',
    },
    written: {
      q: 'Written checkpoint: explain how to prevent leakage when building time-series features.',
      answer: 'Every feature at time t must be computable from information available before t. Use shifts, not centred windows; fit scalers on the training period; validate chronologically with a gap when the label or features span multiple periods. A feature built from the target period is leakage even if it improves the backtest.',
      rubric: [
        'States the information boundary at the prediction timestamp.',
        'Mentions shifts or past-only windows and training-only fitting.',
        'Requires chronological validation and a gap when needed.',
      ],
      why: 'The model will only have the past in production; a feature that peeks ahead is unavailable at inference.',
    },
  },
  ml22: {
    tf: {
      q: 'Checkpoint (true/false): collaborative filtering handles a brand-new user with no interactions without any cold-start strategy.',
      answer: 'False',
      why: 'With no interactions there are no similar users or items to compare. Content features, popularity priors or onboarding signals are needed.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the key function in this top-item lookup.',
      code: 'scores = {"a": 0.2, "b": 0.8, "c": 0.5}\nprint(max(scores, key=___))',
      answer: 'scores.get',
      expected: 'b',
      why: '`max` must compare the dictionary values, so `key=scores.get` returns the key with the highest score.',
    },
    written: {
      q: 'Written checkpoint: explain why cosine similarity is often preferred to raw interaction counts for user-item recommendations.',
      answer: 'Raw counts reward users who interact with everything, making them look similar to many people. Cosine similarity compares the direction of the interaction vectors and normalises by their lengths, so a high-volume user is not automatically similar to everyone. It still ignores magnitude, which may carry useful preference strength, so the choice should match the task.',
      rubric: [
        'Explains the popularity or magnitude bias in raw counts.',
        'Describes cosine as direction-based and length-normalised.',
        'Mentions a limitation or when magnitude still matters.',
      ],
      why: 'Similarity should measure shared preference direction, not simply who clicked more.',
    },
  },
  ml23: {
    tf: {
      q: 'Checkpoint (true/false): TF-IDF generally downweights terms that appear in many documents.',
      answer: 'True',
      why: 'The inverse-document-frequency factor falls as a term becomes more common across the corpus, reducing the weight of ubiquitous words.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the normalisation method in this vocabulary builder.',
      code: 'text = "ML is fun"\nprint(sorted(set(text.___().split())))',
      answer: 'lower',
      expected: "['fun', 'is', 'ml']",
      why: 'Lowercasing makes “ML” and “ml” the same token before splitting, deduplicating and sorting.',
    },
    written: {
      q: 'Written checkpoint: explain why a text vectoriser must be fitted on training text only.',
      answer: 'The vectoriser learns a vocabulary and document frequencies from the text it sees. Fitting on all rows lets test or future text influence the feature space, which is leakage and produces an optimistic estimate. Fit on training text, then transform validation, test and live text with the stored vocabulary; handle unseen terms explicitly.',
      rubric: [
        'Names vocabulary or document-frequency statistics as learned state.',
        'Explains how all-data fitting leaks evaluation information.',
        'Requires fitting on training text and transforming later data with the stored state.',
      ],
      why: 'The feature representation is part of the model; learning it from the evaluation set contaminates the comparison.',
    },
  },
  ml24: {
    tf: {
      q: 'Checkpoint (true/false): stacking linear layers without any activation still produces a non-linear model.',
      answer: 'False',
      why: 'A composition of linear transformations is still linear. Non-linear activations are what let depth represent curved boundaries.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the output width in this dense-layer parameter count.',
      code: 'inputs = 3\noutputs = 2\nprint((inputs + 1) * ___)',
      answer: 'outputs',
      expected: '8',
      why: 'Each of the two outputs has three weights plus one bias, so (3 + 1) × 2 = 8.',
    },
    written: {
      q: 'Written checkpoint: explain what backpropagation computes and what the optimiser does with it.',
      answer: 'Backpropagation applies the chain rule to compute the gradient of the loss with respect to every weight. The optimiser consumes those gradients and updates the weights, for example with gradient descent or Adam. Backpropagation computes the direction; the optimiser decides the step size and update rule.',
      rubric: [
        'Describes backpropagation as gradient computation through the chain rule.',
        'Separates the gradient from the optimiser update.',
        'Names a concrete update method or step-size control.',
      ],
      why: 'Confusing the two makes it hard to debug whether a training failure is a gradient problem or an optimisation problem.',
    },
  },
  ml25: {
    tf: {
      q: 'Checkpoint (true/false): a preprocessing pipeline should be fitted separately on the training and test sets.',
      answer: 'False',
      why: 'Fit once on training data, then transform validation, test and serving data with the same stored object. Separate fitting leaks test statistics and creates inconsistency.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the training mean in this inference calculation.',
      code: 'train = [1, 3]\ntest_value = 5\nmean = sum(train) / len(train)\nprint(test_value - ___)',
      answer: 'mean',
      expected: '3.0',
      why: 'The training mean is 2.0; applying it to the test value 5 gives 3.0 without recomputing from test data.',
    },
    written: {
      q: 'Written checkpoint: a new serving service loads the same model but preprocesses requests differently. Explain the skew risk and the artifact-level fix.',
      answer: 'Train/serve skew is a difference between training and serving preprocessing, feature order, defaults or model versions, so production inputs do not match what the model learned. Package preprocessing and the estimator in one fitted pipeline, version the artifact and schema, and test the real serving path with a known fixture.',
      rubric: [
        'Defines skew as a difference in transformations or contracts.',
        'Recommends one shared fitted pipeline rather than duplicated code.',
        'Mentions a serving-path test, schema or artifact version.',
      ],
      why: 'A correct model fed differently transformed features is still wrong in production.',
    },
  },
  ml26: {
    tf: {
      q: 'Checkpoint (true/false): a successful liveness check proves that the model artifact is loaded and ready.',
      answer: 'False',
      why: 'Liveness only says the process is running. Readiness must check the model artifact and dependencies before traffic is sent.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the required-field collection in this validation.',
      code: 'required = ["age", "income"]\npayload = {"age": 30}\nprint(all(key in payload for key in ___))',
      answer: 'required',
      expected: 'False',
      why: 'The payload is missing income, so checking every required key returns False.',
    },
    written: {
      q: 'Written checkpoint: explain the difference between liveness and readiness and why model versioning matters for rollback.',
      answer: 'Liveness says the process is alive; readiness says it can actually serve predictions, including a loaded model and available dependencies. A live process can still be unable to predict. Recording the model and preprocessing versions makes predictions reproducible and lets an operator roll back to a known artifact during drift or an incident.',
      rubric: [
        'Distinguishes process health from ability to serve.',
        'Gives a readiness check that includes the model or dependencies.',
        'Connects versioning to reproducibility or rollback.',
      ],
      why: 'Operational health and model provenance answer different questions; both are required to serve safely.',
    },
  },
  ml27: {
    tf: {
      q: 'Checkpoint (true/false): equal accuracy across two groups proves that the model approves both groups at equal rates.',
      answer: 'False',
      why: 'Accuracy and positive-decision rate are different metrics. A model can be equally accurate while selecting one group much more often.',
    },
    blank: {
      q: 'Checkpoint (fill in the blank): restore the larger rate in this disparate-impact ratio.',
      code: 'rate_a = 0.6\nrate_b = 0.3\nprint(round(min(rate_a, rate_b) / ___, 2))',
      answer: 'max(rate_a, rate_b)',
      expected: '0.5',
      why: 'The disparate-impact ratio divides the lower rate by the higher one: 0.3 / 0.6 = 0.5.',
    },
    written: {
      q: 'Written checkpoint: an audit finds equal accuracy but different approval rates. Explain which fairness question is unanswered and what evidence you need.',
      answer: 'Demographic parity compares positive or selection rates across groups; equal accuracy compares correctness within each group. A model can have equal accuracy while approving one group much more often, or equal rates while making different kinds of errors. The appropriate fairness question depends on the decision, the harm and the affected population, so report several group-level metrics and the context.',
      rubric: [
        'Defines demographic parity as comparable selection or positive rates.',
        'Defines equal accuracy as comparable correctness and notes they can diverge.',
        'States that fairness depends on context, harms or the decision.',
      ],
      why: 'Parity and accuracy measure different things; neither alone establishes fair treatment.',
    },
  },
};

/** Build the three new authored checkpoint records for a module. */
export function checkpointAdditions2(module) {
  const spec = specs[module.id];
  if (!spec) throw new Error(`checkpoint-batch2: no checkpoint batch for ${module.id}`);
  const solution = spec.blank.code.replace('___', spec.blank.answer);
  if (!spec.blank.code.includes('___')) throw new Error(`checkpoint-batch2: ${module.id} blank has no ___`);
  return [
    {
      format: 'truefalse',
      q: spec.tf.q,
      options: ['True', 'False'],
      answer: spec.tf.answer,
      why: spec.tf.why,
    },
    {
      format: 'blank',
      q: spec.blank.q,
      code: spec.blank.code,
      solution,
      answer: spec.blank.answer,
      expected: spec.blank.expected,
      why: spec.blank.why,
    },
    {
      format: 'rubric',
      q: spec.written.q,
      answer: spec.written.answer,
      rubric: spec.written.rubric,
      why: spec.written.why,
    },
  ];
}
