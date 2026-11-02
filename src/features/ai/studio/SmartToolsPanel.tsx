import {
  ArrowUpRight, BookOpen, Bug, Code2, Compass, GitCompare, GraduationCap, Layers,
  ListChecks, MessageSquarePlus, Rocket, Sparkles, Target, Wand2,
} from 'lucide-react';
import { SMART_TOOLS, smartToolPrompt, smartToolRoute, type SmartTool, type SmartToolContext, type SmartToolId } from '../../../core/ai/smart-tools';

/**
 * Smart Tools: fourteen actions, none of them decorative.
 *
 * An `ask` tool sends a prompt to the same grounded engine the conversation uses; a `route` tool opens
 * the surface that really owns that job. When a tool genuinely cannot run (a code tool with no code,
 * or a topic-less "explain simply") its card says so and stays disabled — a press that produces
 * nothing is exactly the dead button this panel must not have.
 */
export interface SmartToolsPanelProps {
  context: SmartToolContext;
  busy: boolean;
  onAsk: (prompt: string) => void;
  onRoute: (route: string) => void;
}

const ICONS: Record<SmartToolId, typeof Sparkles> = {
  'explain-simple': Sparkles,
  'deep-explanation': Layers,
  'real-example': Compass,
  'debug-code': Bug,
  'practice': ListChecks,
  'interview': Target,
  'interview-prep': GraduationCap,
  'project': Rocket,
  'quiz': Wand2,
  'summarize': BookOpen,
  'compare': GitCompare,
  'plan': Compass,
  'follow-up': MessageSquarePlus,
  'code-review': Code2,
};

function reason(tool: SmartTool): string {
  if (tool.id === 'debug-code' || tool.id === 'code-review') return 'Paste code first';
  return 'Ask a question first';
}

export function SmartToolsPanel({ context, busy, onAsk, onRoute }: SmartToolsPanelProps) {
  return (
    <section className="tools-card glass" aria-label="Smart tools">
      <header className="tools-head">
        <div>
          <span className="eyebrow">Intelligence</span>
          <h2>Smart tools</h2>
        </div>
        <span className="chip-quiet">{SMART_TOOLS.length} actions</span>
      </header>

      <div className="tool-grid">
        {SMART_TOOLS.map((tool) => {
          const Icon = ICONS[tool.id];
          const prompt = tool.kind === 'ask' ? smartToolPrompt(tool.id, context) : null;
          const route = tool.kind === 'route' ? smartToolRoute(tool.id, context) : '';
          const enabled = tool.kind === 'ask' ? Boolean(prompt) : Boolean(route);
          return (
            <button
              key={tool.id}
              type="button"
              className="tool"
              disabled={!enabled || busy}
              title={enabled ? tool.hint : reason(tool)}
              onClick={() => {
                if (tool.kind === 'ask' && prompt) onAsk(prompt);
                else if (tool.kind === 'route' && route) onRoute(route);
              }}
            >
              <span className="tool-icon"><Icon size={14} /></span>
              <span className="tool-text">
                <b>{tool.label}</b>
                <small>{enabled ? tool.note : reason(tool)}</small>
              </span>
              {tool.kind === 'route' && <ArrowUpRight size={12} className="tool-go" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
