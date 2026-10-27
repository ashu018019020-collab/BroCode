/**
 * The mentor's answer, rendered without `dangerouslySetInnerHTML`.
 *
 * The text is authored by the retrieval engine, but it still contains Markdown. This renderer knows
 * exactly three things — a fenced code block, a `### label` heading, and `**bold**` — and escapes
 * everything else as text. That is enough for a lesson passage and avoids pulling a Markdown parser
 * (and an HTML injection surface) into a browser app.
 */
import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => (
    part.startsWith('**') && part.endsWith('**')
      ? <b key={index}>{part.slice(2, -2)}</b>
      : <span key={index}>{part}</span>
  ));
}

export function MentorText({ text }: { text: string }) {
  const source = String(text ?? '');
  const blocks: ReactNode[] = [];
  let code: string[] | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const body = paragraph.join(' ');
    blocks.push(<p key={`p-${blocks.length}`}>{inline(body)}</p>);
    paragraph = [];
  };

  for (const raw of source.split('\n')) {
    if (raw.startsWith('```')) {
      if (code) {
        blocks.push(
          <pre key={`code-${blocks.length}`} className="mentor-code">
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = null;
      } else {
        flushParagraph();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    if (!raw.trim()) { flushParagraph(); continue; }
    if (/^#{1,6}\s/.test(raw)) {
      flushParagraph();
      blocks.push(<b key={`h-${blocks.length}`} className="mentor-label">{raw.replace(/^#{1,6}\s*/, '')}</b>);
      continue;
    }
    paragraph.push(raw.trim());
  }
  if (code) {
    blocks.push(<pre key={`code-${blocks.length}`} className="mentor-code"><code>{code.join('\n')}</code></pre>);
  }
  flushParagraph();
  return <div className="mentor-rich">{blocks}</div>;
}
