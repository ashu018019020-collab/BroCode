/**
 * Machine Learning — checkpoint format expansion.
 *
 * Every module already ships two authored MCQs. This batch adds the four checkpoint formats the
 * course was missing WITHOUT replacing those MCQs: true/false, fill-in-the-blank, code-output and a
 * written answer self-assessed against three criteria.
 *
 * The fill-in-the-blank and code-output records are built from the module's own two code topics, so
 * their solutions and expected outputs are the already-published, tested samples. `ml-course.test.mjs`
 * runs them again, and for a blank it substitutes the answer back into the code and compares the real
 * output. The true/false claims and written answers are authored below, with an explanation on every
 * record.
 */
const specs = {
  ml01: {
    tf: {
      q: 'True or false: a model that memorises its training labels but fails on new rows is overfitting.',
      answer: 'True',
      why: 'Memorising training detail while losing generalisation is the definition of overfitting; the gap between training and validation performance exposes it.',
    },
    blankToken: '8',
    written: {
      q: 'Written checkpoint: explain the difference between supervised and unsupervised learning, and name one concrete task for each.',
      answer: 'Supervised learning trains on labelled examples to predict a target, such as predicting house price from features. Unsupervised learning looks for structure without a target label, such as grouping customers by purchasing behaviour. Both use data, but only supervised learning has an answer key during training.',
      rubric: [
        'Names labelled versus unlabelled data, not just “two types of learning”.',
        'Gives one supervised task with a target and one unsupervised task without a target.',
        'States that unsupervised learning still has an objective, even without labels.',
      ],
      why: 'The decisive difference is the presence of a target label; the tasks show that both settings still learn structure from data.',
    },
  },
  ml02: {
    tf: {
      q: 'True or false: a Python list is immutable, so appending to it raises an error.',
      answer: 'False',
      why: 'Lists are mutable and support append; tuples are the common immutable sequence. Mutability is exactly why a shared list default can leak state.',
    },
    blankToken: '80',
    written: {
      q: 'Written checkpoint: explain why a mutable default argument can leak state between calls, and state the safe fix.',
      answer: 'Python creates the default list or dictionary once when the function is defined, so every call shares the same object. Mutating it in one call changes the value seen by later calls. Use `None` as the default and create a fresh container inside the function.',
      rubric: [
        'Says the default object is created once, not once per call.',
        'Describes the observable leak: a later call inherits an earlier mutation.',
        'Gives the `None` sentinel fix that creates a new container inside the function.',
      ],
      why: 'The danger is shared mutable state, not the list syntax; `None` makes the fresh allocation explicit.',
    },
  },
  ml03: {
    tf: {
      q: 'True or false: NumPy broadcasting can combine an array of shape (3, 1) with one of shape (1, 4).',
      answer: 'True',
      why: 'The singleton dimensions stretch logically to produce a (3, 4) result; the non-singleton dimensions are compatible because one side is 1.',
    },
    blankToken: '3',
    written: {
      q: 'Written checkpoint: explain what `axis=0` does in a NumPy aggregation, and give an example shape change.',
      answer: '`axis=0` collapses the rows, so each output value aggregates down a column. For a `(4, 3)` array, `.sum(axis=0)` returns shape `(3,)`: one sum for each of the three columns. `axis=1` would collapse the columns and return `(4,)`.',
      rubric: [
        'Identifies row-wise collapse, or one result per column.',
        'Gives a concrete input shape and the resulting output shape.',
        'Contrasts axis 0 with axis 1, or explains that the named axis is removed.',
      ],
      why: 'The axis is the dimension being reduced, so `axis=0` removes the row dimension and leaves the columns.',
    },
  },
  ml04: {
    tf: {
      q: 'True or false: Pandas `.iloc` selects rows by their index labels.',
      answer: 'False',
      why: '`.iloc` is position-based; `.loc` is label-based. After a sort, the same position can point at a different original row.',
    },
    blankToken: '80',
    written: {
      q: 'Written checkpoint: explain the difference between `.loc` and `.iloc`, and state which is safer after a sort.',
      answer: '`.loc` selects by index label, while `.iloc` selects by integer position. After sorting or filtering, positions change but labels still identify the original rows, so `.loc` is safer when the label is the intended key. `.iloc` is appropriate when the question is literally “the first three rows”.',
      rubric: [
        'Defines `.loc` as label-based and `.iloc` as position-based.',
        'Explains that a sort or filter changes positions but not labels.',
        'Chooses `.loc` for label identity and `.iloc` for literal position, rather than calling one universally better.',
      ],
      why: 'The common bug is using `.iloc` after a sort and silently selecting a different row; the label is the stable identity.',
    },
  },
  ml05: {
    tf: {
      q: 'True or false: gradient descent updates parameters opposite to the gradient to reduce the loss.',
      answer: 'True',
      why: 'The gradient points toward steepest increase, so subtracting a scaled gradient moves downhill. Adding it would ascend.',
    },
    blankToken: '-1.0',
    written: {
      q: 'Written checkpoint: explain why gradient descent subtracts the learning rate times the gradient.',
      answer: 'The gradient points toward the steepest increase of the loss. To reduce the loss, we move in the opposite direction, so the update is parameter minus learning rate times gradient. The learning rate controls the step size: too large can overshoot, too small is slow.',
      rubric: [
        'Says the gradient points toward increasing loss.',
        'Explains that subtraction moves opposite the gradient to descend.',
        'Mentions that the learning rate controls step size and can cause overshoot or slow progress.',
      ],
      why: 'The sign is the core: adding the gradient ascends, subtracting descends; the learning rate only scales the step.',
    },
  },
  ml06: {
    tf: {
      q: 'True or false: a p-value is the probability that the null hypothesis is true.',
      answer: 'False',
      why: 'A p-value is the probability of data at least as extreme as observed, assuming the null is true. It is not the posterior probability of the null.',
    },
    blankToken: '6',
    written: {
      q: 'Written checkpoint: explain what a p-value does and does not mean.',
      answer: 'A p-value is the probability of observing data at least as extreme as ours, assuming the null hypothesis is true. It is not the probability that the null is true, nor the probability that the result will replicate. A small p-value is evidence against the null under the model, not proof of a large or important effect.',
      rubric: [
        'Conditions on the null hypothesis being true.',
        'Describes the probability of data at least as extreme, not the probability of the hypothesis.',
        'Mentions that significance is not effect size, importance or proof.',
      ],
      why: 'The p-value is a tail probability about data under a null; reversing it into “probability the null is true” is the common error.',
    },
  },
  ml07: {
    tf: {
      q: 'True or false: a correlation of exactly zero proves that two variables are independent.',
      answer: 'False',
      why: 'Correlation captures linear association only. A strong non-linear relationship can have zero linear correlation while the variables remain dependent.',
    },
    blankToken: '30',
    written: {
      q: 'Written checkpoint: explain why correlation does not imply causation, and name one confounder that could explain a positive correlation.',
      answer: 'Correlation measures linear association, but two variables can move together because a third variable drives both, or because of reverse causation. For example, ice-cream sales and drowning rates correlate, but hot weather increases both. Causation requires a design or assumption that rules out such confounders.',
      rubric: [
        'Distinguishes association from a causal mechanism.',
        'Names a concrete confounder or a reverse-causation path.',
        'States what additional evidence or design would be needed for a causal claim.',
      ],
      why: 'A confounder changes both variables, creating a correlation with no direct causal edge; the weather example makes that mechanism concrete.',
    },
  },
  ml08: {
    tf: {
      q: 'True or false: a scaler should be fitted on the training data only, then reused to transform validation and test data.',
      answer: 'True',
      why: 'Fitting computes statistics. If test rows contribute to the mean or spread, evaluation information leaks into preprocessing and the score becomes optimistic.',
    },
    blankToken: '3.0',
    written: {
      q: 'Written checkpoint: explain why a scaler or imputer must be fitted on training data only.',
      answer: 'Fitting computes statistics such as the mean, standard deviation or median. If those statistics include validation or test rows, information from the evaluation data leaks into training and the score becomes optimistic. Fit on the training fold, then transform validation, test and production data with those stored statistics.',
      rubric: [
        'Names the statistics learned by the preprocessing step.',
        'Explains the leakage path from evaluation rows into training.',
        'States the correct order: fit on train, then transform held-out data.',
      ],
      why: 'Preprocessing is part of the model; letting it see the test set is leakage even though no target label is used.',
    },
  },
  ml09: {
    tf: {
      q: 'True or false: a random train/test split is always correct for time-ordered data.',
      answer: 'False',
      why: 'A random split can train on future rows and test on past rows, leaking information that would not be available at prediction time.',
    },
    blankToken: '10',
    written: {
      q: 'Written checkpoint: explain overfitting and describe two validation-based responses.',
      answer: 'Overfitting is fitting training noise so closely that performance on unseen data is worse. Compare training and validation curves to detect it, then simplify the model or add regularisation, and collect more representative data. Tune the response against a validation split, not the test set.',
      rubric: [
        'Defines overfitting as a train/unseen performance gap, not just “high accuracy”.',
        'Gives two distinct responses such as simplification or regularisation, and more data.',
        'Keeps model selection on validation data and the test set untouched.',
      ],
      why: 'The diagnosis is the gap, and the remedy must change capacity or data rather than merely training longer.',
    },
  },
  ml10: {
    tf: {
      q: 'True or false: R-squared can be negative on validation data.',
      answer: 'True',
      why: 'R-squared compares squared error with the mean baseline. A model worse than predicting the validation mean produces a negative value.',
    },
    blankToken: '6',
    written: {
      q: 'Written checkpoint: interpret a regression slope and intercept, and state one thing R-squared does not tell you.',
      answer: 'The slope is the predicted change in the target for a one-unit increase in the feature, holding the model fixed. The intercept is the prediction when the feature is zero, which may be outside the observed range. R-squared describes the share of variance explained in this sample; it does not prove causation or guarantee good predictions on a different population.',
      rubric: [
        'Interprets the slope as a per-unit change in the target.',
        'Explains the intercept as the prediction at zero, with the range caveat.',
        'States that R-squared is not causation, not out-of-sample proof, or not the only quality measure.',
      ],
      why: 'The slope is conditional on the model and feature scale; R-squared is an in-sample fit summary, not a causal or deployment guarantee.',
    },
  },
  ml11: {
    tf: {
      q: 'True or false: Lasso can shrink some coefficients exactly to zero.',
      answer: 'True',
      why: 'The L1 penalty produces sparse solutions, so Lasso can remove features entirely; Ridge’s L2 penalty usually shrinks without reaching zero.',
    },
    blankToken: '10',
    written: {
      q: 'Written checkpoint: compare Ridge and Lasso regularisation and state when you would prefer each.',
      answer: 'Ridge adds an L2 penalty, shrinking coefficients smoothly and handling correlated features without forcing them to zero. Lasso adds an L1 penalty, which can set coefficients exactly to zero and produce a sparse model. Prefer Lasso when a smaller interpretable feature set is useful; prefer Ridge when many small effects should remain and correlated features should share weight.',
      rubric: [
        'Names L2 for Ridge and L1 for Lasso.',
        'Explains Lasso’s sparsity or selection versus Ridge’s smooth shrinkage.',
        'Gives a context-based preference rather than declaring one always better.',
      ],
      why: 'The penalty geometry explains the behaviour: L1 reaches zero coefficients, while L2 shrinks without eliminating.',
    },
  },
  ml12: {
    tf: {
      q: 'True or false: logistic regression applies a sigmoid so its output can be interpreted as a probability.',
      answer: 'True',
      why: 'The sigmoid maps a real-valued score into (0, 1), and the model is trained so that value estimates the positive-class probability.',
    },
    blankToken: '0.0',
    written: {
      q: 'Written checkpoint: explain why logistic regression uses log loss instead of mean squared error for a binary target.',
      answer: 'Log loss is the negative log-likelihood of the observed binary labels under the predicted probabilities, so it strongly penalises confident wrong predictions. MSE on probabilities is not the right likelihood for binary outcomes and can produce weaker gradients and poor calibration. The sigmoid keeps outputs in [0, 1], and log loss matches that probabilistic model.',
      rubric: [
        'Connects log loss to the likelihood of binary labels.',
        'Mentions the penalty for confident wrong probabilities.',
        'Contrasts this with MSE’s unsuitable error or likelihood for binary outcomes.',
      ],
      why: 'The model predicts a Bernoulli probability; log loss is its proper scoring rule, while MSE is a regression loss.',
    },
  },
  ml13: {
    tf: {
      q: 'True or false: KNN generally needs feature scaling when its features use different units.',
      answer: 'True',
      why: 'KNN compares distances. A feature with a larger numeric range can dominate the distance and drown out otherwise informative features.',
    },
    blankToken: '1.2',
    written: {
      q: 'Written checkpoint: explain why KNN needs feature scaling and how the choice of k changes bias and variance.',
      answer: 'KNN compares distances, so a feature measured in a larger unit can dominate the distance and drown out the others; scaling puts features on comparable terms. A small k follows local noise and has high variance, while a large k smooths across more neighbours and can become biased toward the majority or broader region.',
      rubric: [
        'Explains that unscaled units distort the distance metric.',
        'Connects small k to low bias/high variance and large k to smoother, higher-bias predictions.',
        'Mentions validation for choosing k rather than assuming one value.',
      ],
      why: 'Distance is the model, so scale changes the neighbours; k controls the local-versus-global trade-off.',
    },
  },
  ml14: {
    tf: {
      q: 'True or false: a random forest trains trees independently, while gradient boosting fits trees sequentially to errors.',
      answer: 'True',
      why: 'Bagging builds independent trees and averages them; boosting adds shallow trees one at a time, each targeting the current residual or gradient.',
    },
    blankToken: '0.5',
    written: {
      q: 'Written checkpoint: compare a random forest with gradient boosting.',
      answer: 'A random forest trains many deep trees independently on bootstrapped samples and random feature subsets, then averages or votes; it mainly reduces variance. Gradient boosting adds shallow trees sequentially, each fitting the current residuals or gradient, and mainly reduces bias. Forests are easier to parallelise; boosting can be more accurate but needs careful learning rate and early stopping.',
      rubric: [
        'Says random forest trees are independent or bagged and combined by vote/average.',
        'Says boosting trees are sequential and fit residual or gradient errors.',
        'Mentions a practical trade-off such as parallelism, overfitting control or tuning.',
      ],
      why: 'The distinction is parallel variance reduction versus sequential bias reduction, not simply “both are ensembles”.',
    },
  },
  ml15: {
    tf: {
      q: 'True or false: F1 ignores true negatives.',
      answer: 'True',
      why: 'F1 combines precision and recall; neither uses true negatives. That is one reason it can be unsuitable for problems where true negatives matter.',
    },
    blankToken: '40',
    written: {
      q: 'Written checkpoint: explain when accuracy is misleading and choose a better metric for fraud screening.',
      answer: 'Accuracy is misleading when one class dominates: predicting “not fraud” for every transaction can score very high while catching no fraud. Fraud screening should report precision and recall for the fraud class, often with PR-AUC, and choose a threshold from the cost of missed fraud versus false alarms. The business alert budget also matters.',
      rubric: [
        'Explains the majority-class or base-rate failure of accuracy.',
        'Chooses a fraud-sensitive metric such as recall, precision or PR-AUC.',
        'Connects the threshold to asymmetric error costs or alert capacity.',
      ],
      why: 'A rare positive class makes accuracy uninformative; the useful question is which fraud cases are caught and at what false-alarm cost.',
    },
  },
  ml16: {
    tf: {
      q: 'True or false: K-Means guarantees the globally optimal clustering for any dataset.',
      answer: 'False',
      why: 'K-Means optimises a non-convex objective and converges to a local optimum that depends on initialisation; multiple starts are common.',
    },
    blankToken: '10',
    written: {
      q: 'Written checkpoint: explain how K-Means assigns points and state one important assumption or limitation.',
      answer: 'K-Means assigns each point to the nearest centroid, then recomputes each centroid as the mean of its assigned points and repeats until assignments stabilise. It assumes roughly spherical clusters with similar spread and needs K in advance; it can converge to a local optimum and is sensitive to initialisation, scale and outliers.',
      rubric: [
        'Describes the assign-then-update loop.',
        'Names one real assumption such as spherical or similar-sized clusters, or known K.',
        'Names one limitation such as local optima, initialisation, scale or outliers.',
      ],
      why: 'The algorithm optimises within-cluster squared distance, which is why its geometry and initialisation matter.',
    },
  },
  ml17: {
    tf: {
      q: 'True or false: PCA components are ordered by the amount of variance they explain.',
      answer: 'True',
      why: 'The first component captures the most variance, the second the most remaining variance under orthogonality, and so on.',
    },
    blankToken: '1',
    written: {
      q: 'Written checkpoint: explain what PCA preserves and what it can lose.',
      answer: 'PCA finds orthogonal linear directions that maximise retained variance, so it preserves as much variance as possible for a chosen number of components. It can lose low-variance directions that still predict the target, and the new components are linear combinations that are harder to interpret than original features. Standardisation matters when features use different units.',
      rubric: [
        'Says PCA preserves variance in orthogonal linear components.',
        'Names a loss: discarded variance, predictive signal or interpretability.',
        'Mentions scaling or the need to choose the number of components.',
      ],
      why: 'PCA is unsupervised compression: high variance is not the same as target relevance, and components are not original features.',
    },
  },
  ml18: {
    tf: {
      q: 'True or false: accuracy is a reliable headline metric when anomalies are extremely rare.',
      answer: 'False',
      why: 'Predicting every row as normal can achieve very high accuracy while detecting zero anomalies; precision, recall and PR-AUC are more informative.',
    },
    blankToken: '100',
    written: {
      q: 'Written checkpoint: explain why anomaly detection needs precision and recall, and how a z-score threshold trades errors.',
      answer: 'Anomalies are rare, so a high-accuracy all-normal model is useless; precision measures how many alerts are true anomalies, and recall measures how many anomalies were caught. Lowering a z-score threshold catches more anomalies but raises false alarms; raising it does the opposite. The right threshold depends on investigation capacity and the cost of a miss.',
      rubric: [
        'Explains why accuracy fails under class imbalance.',
        'Defines precision and recall in terms of alerts and caught anomalies.',
        'Explains the threshold trade-off and ties it to costs or capacity.',
      ],
      why: 'The z-score is a signal, not a decision rule; the threshold encodes the relative cost of false alarms and misses.',
    },
  },
  ml19: {
    tf: {
      q: 'True or false: permutation importance measures the performance drop after shuffling one feature.',
      answer: 'True',
      why: 'It breaks the feature–target relationship by permuting values, then measures how much validation performance falls relative to the fitted model.',
    },
    blankToken: '6',
    written: {
      q: 'Written checkpoint: explain the difference between a local and a global explanation, and state one limitation of permutation importance.',
      answer: 'A local explanation explains one prediction, such as why this applicant was rejected; a global explanation summarises behaviour across the dataset, such as which features matter overall. Permutation importance measures the performance drop after shuffling a feature, but correlated features can share or hide importance, and it depends on the fitted model and validation sample.',
      rubric: [
        'Contrasts one prediction with dataset-level behaviour.',
        'Describes permutation importance as a performance drop after shuffling.',
        'Names a limitation such as correlated features, model dependence or sample dependence.',
      ],
      why: 'Explanation scope and correlation are different issues: a local reason can differ from global importance, and shuffling can break feature relationships.',
    },
  },
  ml20: {
    tf: {
      q: 'True or false: class weighting changes the training loss without duplicating rows.',
      answer: 'True',
      why: 'The rows stay the same; their loss contributions are reweighted. Resampling is the approach that changes the row distribution.',
    },
    blankToken: '100',
    written: {
      q: 'Written checkpoint: compare class weighting with resampling for an imbalanced target, and state one risk.',
      answer: 'Class weighting keeps the training rows but increases the loss contribution of the minority class; resampling changes the rows by duplicating minority examples or removing majority ones. Both can raise minority recall, but both can distort predicted probabilities and overfit duplicated points, so recalibrate and validate on the original distribution.',
      rubric: [
        'Distinguishes changing the loss weights from changing the row distribution.',
        'Explains the intended effect on minority learning or recall.',
        'Names a risk such as calibration damage, overfitting or a changed base rate.',
      ],
      why: 'The methods intervene in different places—loss versus data—and both can make probability estimates no longer match the deployed population.',
    },
  },
  ml21: {
    tf: {
      q: 'True or false: lag features must be built using only information available before the prediction time.',
      answer: 'True',
      why: 'A lag that uses future values leaks the target period into training and cannot be reproduced at inference; the feature must respect the forecast origin.',
    },
    blankToken: '30',
    written: {
      q: 'Written checkpoint: explain why time-series validation must be chronological, and name one consequence of using a random split.',
      answer: 'A random split can train on future observations and test on the past, so the model sees information it would not have at prediction time. That leaks the future and makes the validation score optimistic. Use a chronological cutoff, and add a gap when features or labels span multiple periods, so training never peeks past the forecast origin.',
      rubric: [
        'States that a random split can put future data in training.',
        'Explains the resulting leakage or optimistic evaluation.',
        'Recommends chronological validation, with a gap when needed.',
      ],
      why: 'Deployment only has the past; validation must reproduce that information boundary.',
    },
  },
  ml22: {
    tf: {
      q: 'True or false: collaborative filtering has no cold-start problem for a brand-new user with no interactions.',
      answer: 'False',
      why: 'Without interactions, there are no similar users or items to use; that is the cold-start problem. Content features or onboarding signals can provide a prior.',
    },
    blankToken: '0',
    written: {
      q: 'Written checkpoint: explain the cold-start problem and one way content features can reduce it.',
      answer: 'Cold start is the lack of interaction history for a new user or item, so collaborative filtering has no ratings to compare. Content features such as genre, description or user-declared interests can place the new entity near known ones and provide an initial recommendation. As interactions arrive, the system can blend or switch to collaborative signals.',
      rubric: [
        'Defines cold start for a new user or item.',
        'Explains why collaborative filtering lacks the needed history.',
        'Gives a content-based fallback and a path to blend with interactions later.',
      ],
      why: 'Cold start is an information problem; content features provide a prior until behavioural data exists.',
    },
  },
  ml23: {
    tf: {
      q: 'True or false: TF-IDF generally gives rare terms more weight than terms that appear in every document.',
      answer: 'True',
      why: 'The inverse-document-frequency factor falls as a term appears in more documents, so ubiquitous terms are downweighted.',
    },
    blankToken: 'b',
    written: {
      q: 'Written checkpoint: explain TF-IDF and why it often helps text classification.',
      answer: 'TF-IDF multiplies a term’s frequency in a document by a weight that falls as the term appears in more documents. Common words such as “the” are downweighted, while terms that distinguish a document are emphasised. It produces a sparse, interpretable feature vector, though it ignores word order and deeper meaning.',
      rubric: [
        'Explains term frequency and inverse document frequency.',
        'States that common terms are downweighted and discriminative terms emphasised.',
        'Names a limitation such as sparsity, no word order or no semantics.',
      ],
      why: 'The IDF factor turns raw counts into a relative signal; it is still a bag-of-words representation.',
    },
  },
  ml24: {
    tf: {
      q: 'True or false: removing every activation function from a deep network turns the whole model into a linear transformation.',
      answer: 'True',
      why: 'A composition of linear layers is still linear. Non-linear activations are what let depth represent curved boundaries and complex features.',
    },
    blankToken: '-1',
    written: {
      q: 'Written checkpoint: explain why activation functions are necessary and what backpropagation computes.',
      answer: 'Without a non-linear activation, stacked layers compose into one linear transformation, so depth adds no representational power. A non-linearity lets the network learn curved decision boundaries and complex features. Backpropagation applies the chain rule to compute the loss gradient with respect to every weight; the optimiser then uses those gradients to update the weights.',
      rubric: [
        'Explains the linear-collapse problem without activations.',
        'States that activations add non-linearity or representational power.',
        'Describes backpropagation as gradient computation via the chain rule, separate from the optimiser update.',
      ],
      why: 'Activation changes the function class; backpropagation changes how parameters are learned, not the network’s forward capacity.',
    },
  },
  ml25: {
    tf: {
      q: 'True or false: fitting a scaler on the full dataset before splitting is safe because scaling is unsupervised.',
      answer: 'False',
      why: 'Unsupervised does not mean leakage-free. The scaler learns the test set’s mean and spread, so evaluation information influences training preprocessing.',
    },
    blankToken: '3',
    written: {
      q: 'Written checkpoint: explain train/serve skew and one pipeline practice that prevents it.',
      answer: 'Train/serve skew is when training and inference apply different preprocessing, feature order, defaults or model versions, so production inputs do not match what the model learned. Package preprocessing and the estimator in one pipeline, fit it once on training data, and reuse the same artifact and schema at inference. Log the feature contract and test a real request path.',
      rubric: [
        'Defines skew as a difference between training and serving transformations or contracts.',
        'Recommends one shared fitted pipeline or artifact rather than duplicated code.',
        'Mentions validation of the actual serving path, schema or version.',
      ],
      why: 'The model only sees the features serving produces; a correct model with different preprocessing is still wrong.',
    },
  },
  ml26: {
    tf: {
      q: 'True or false: a successful liveness check proves that the model artifact is loaded and ready to serve predictions.',
      answer: 'False',
      why: 'Liveness only says the process is running. Readiness must check the model artifact and dependencies before the instance receives traffic.',
    },
    blankToken: '30',
    written: {
      q: 'Written checkpoint: explain the difference between liveness and readiness, and why a model version should be recorded.',
      answer: 'Liveness says the process is running; readiness says it can actually serve traffic, including a loaded model and available dependencies. A 200 from a liveness endpoint does not prove the model artifact is present. Recording the model version and preprocessing version makes predictions reproducible, supports rollback and lets you investigate drift or incidents.',
      rubric: [
        'Distinguishes process health from ability to serve.',
        'Gives a readiness check that includes the model or its dependencies.',
        'Explains versioning for reproducibility, rollback or incident analysis.',
      ],
      why: 'A live process can still be unable to predict; readiness and artifact provenance are separate operational guarantees.',
    },
  },
  ml27: {
    tf: {
      q: 'True or false: equal accuracy across two groups proves that the model approves both groups at equal rates.',
      answer: 'False',
      why: 'Accuracy and selection rate are different metrics. A model can be equally accurate while approving one group much more often, or vice versa.',
    },
    blankToken: '60',
    written: {
      q: 'Written checkpoint: explain the difference between demographic parity and equal accuracy, and why fairness still needs context.',
      answer: 'Demographic parity compares selection or positive-decision rates across groups; equal accuracy compares overall correctness within each group. A model can have equal accuracy while approving one group at a much higher rate, or equal rates while making different kinds of errors. The appropriate fairness question depends on the decision, the harm and the affected population, so multiple group-level metrics and context are needed.',
      rubric: [
        'Defines demographic parity as comparable selection or positive rates.',
        'Defines equal accuracy as comparable correctness, and notes that the two can diverge.',
        'States that fairness depends on context, harms or the decision, not one universal metric.',
      ],
      why: 'Parity and accuracy measure different things; neither alone establishes fair treatment.',
    },
  },
};

/** Replace exactly one occurrence with `___`; the missing token is the authored answer. */
function blankCode(code, token, moduleId) {
  const at = code.indexOf(token);
  if (at < 0) throw new Error(`checkpoint-expansion: ${moduleId} token ${JSON.stringify(token)} is not in the sample`);
  if (code.indexOf(token, at + token.length) >= 0) {
    throw new Error(`checkpoint-expansion: token ${JSON.stringify(token)} is ambiguous in the sample`);
  }
  return `${code.slice(0, at)}___${code.slice(at + token.length)}`;
}

export function checkpointAdditions(module) {
  const spec = specs[module.id];
  if (!spec) throw new Error(`checkpoint-expansion: no checkpoint batch for ${module.id}`);
  const codeTopics = (module.topics ?? []).filter((topic) => topic.code);
  if (codeTopics.length < 2) throw new Error(`checkpoint-expansion: ${module.id} needs two code topics`);
  const [blankTopic, outputTopic] = codeTopics;
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
      q: `Checkpoint (fill in the blank): restore the missing token in this ${blankTopic.title} sample.`,
      code: blankCode(blankTopic.code, spec.blankToken, module.id),
      solution: blankTopic.code,
      answer: spec.blankToken,
      expected: blankTopic.output,
      why: `The missing token is ${spec.blankToken}; with it restored the sample prints ${blankTopic.output}. ${blankTopic.body}`,
    },
    {
      format: 'output',
      q: `Checkpoint (code output): predict exactly what this ${outputTopic.title} sample prints.`,
      code: outputTopic.code,
      answer: outputTopic.output,
      expected: outputTopic.output,
      why: `The verified output is ${outputTopic.output}. ${outputTopic.body}`,
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
