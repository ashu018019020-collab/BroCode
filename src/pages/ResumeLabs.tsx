import DefensePage from './DefensePage';

/** Route alias: Resume Labs and Project Defense share the resume-project surface. */
export default function ResumeLabs() {
  return (
    <div>
      <div className="card" style={{ borderColor: 'var(--purple)' }}>
        <p className="small muted">
          Resume labs consolidate the PDF's resume-alignment material: pitch templates, architecture stories and the
          defense questions below. The AI chatbot, n8n agentic workflow, Power BI and analytics stories live here.
        </p>
      </div>
      <DefensePage />
    </div>
  );
}
