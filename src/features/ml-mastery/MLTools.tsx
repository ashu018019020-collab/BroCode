import { Link } from 'react-router-dom';
import { BookOpen, Code2, ExternalLink, FlaskConical } from 'lucide-react';

/**
 * The ML course's tool shelf.
 *
 * It points only at surfaces that actually exist. The browser runtime ships Python, NumPy and
 * Pandas; Scikit-learn, XGBoost and SHAP are not bundled, so those examples link out instead of
 * pretending they run here.
 */
export function MLTools() {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <b className="small"><FlaskConical size={13} /> Machine Learning toolbox</b>
        <span className="chip">Python · NumPy · Pandas run here</span>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        The in-browser Code Bro kernel is deliberately limited to the wheels the app ships. Use the
        Python Playground for the dependency-light labs in this course; open Scikit-learn, XGBoost,
        LightGBM, CatBoost and SHAP work in Google Colab or a local virtual environment.
      </p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <Link className="btn small" to="/notebooks"><BookOpen size={12} /> Code Bro</Link>
        <Link className="btn small" to="/playground"><Code2 size={12} /> Python Playground</Link>
        <Link className="btn small" to="/numpy-pandas">NumPy + Pandas Lab</Link>
        <a
          className="btn small ghost"
          href="https://colab.research.google.com/"
          target="_blank"
          rel="noreferrer"
        >
          Google Colab <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
