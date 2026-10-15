import type { SectionId } from '../shared/state';
import type { SectionState } from './sections';

export type Intent =
  | { type: 'welcome' }
  | { type: 'open_settings' }
  | { type: 'upload' }
  | { type: 'skip_prior_year' }
  | { type: 'open_section'; sectionId: SectionId }
  | { type: 'export' };

export interface NextAction {
  title: string;
  detail: string;
  cta: { label: string; intent: Intent } | null;
  /** A quieter second choice beside the main button, for when the main one doesn't apply to everyone. */
  secondary?: { label: string; intent: Intent };
  tone: 'go' | 'wait' | 'fix' | 'done';
}

export interface NextActionInput {
  welcomed: boolean;
  hasApiKey: boolean;
  hasPriorYear: boolean;
  priorYearSkipped: boolean;
  busyDocs: number;
  sections: SectionState[];
  missingDocs: number;
  /** "Must fix" flags. While any is open the return can't be printed, so the Now bar never says it's ready. */
  blockers?: { sectionId: SectionId; title: string }[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The ONE thing the user should do now. Shown in the Now bar at the top of every screen. */
export function nextAction(i: NextActionInput): NextAction {
  if (!i.welcomed) {
    return {
      title: 'Welcome to Tidy',
      detail: 'We’ll do your 2025 taxes together, one small step at a time.',
      cta: { label: 'Let’s start', intent: { type: 'welcome' } },
      tone: 'go',
    };
  }
  if (!i.hasApiKey) {
    return {
      title: 'Connect Tidy to an AI',
      detail: 'Pick Claude or Gemini and paste its API key once. It stays in your Mac’s Keychain.',
      cta: { label: 'Add key', intent: { type: 'open_settings' } },
      tone: 'go',
    };
  }
  if (!i.hasPriorYear && !i.priorYearSkipped && i.busyDocs === 0) {
    return {
      title: 'Start with last year’s return',
      detail: 'Drop your 2024 tax return PDF. We’ll use it to fill in most of 2025.',
      cta: { label: 'Upload', intent: { type: 'upload' } },
      secondary: { label: 'I don’t have it', intent: { type: 'skip_prior_year' } },
      tone: 'go',
    };
  }
  const current = i.sections.find((s) => s.status !== 'approved');
  const order = i.sections.map((s) => s.id);
  const reached = current ? order.indexOf(current.id) : order.length;
  const mustFix = (i.blockers ?? [])
    .filter((b) => order.indexOf(b.sectionId) <= reached)
    .sort((a, b) => order.indexOf(a.sectionId) - order.indexOf(b.sectionId));
  const fix = (): NextAction | null => {
    const b = mustFix[0];
    if (!b) return null;
    const more = mustFix.length - 1;
    return {
      title: b.title,
      detail: `Tidy can’t print your return until this is sorted.${more > 0 ? ` Then ${plural(more, 'more thing')} to fix.` : ''}`,
      cta: { label: 'Show me', intent: { type: 'open_section', sectionId: b.sectionId } },
      tone: 'fix',
    };
  };
  if (!current) {
    return (
      fix() ?? {
        title: 'Your return is ready',
        detail: 'Download the print-ready package and follow the filing steps.',
        cta: { label: 'Download package', intent: { type: 'export' } },
        tone: 'done',
      }
    );
  }
  const open = { type: 'open_section', sectionId: current.id } as const;
  if (current.status === 'working') {
    return {
      title: `Reading ${plural(i.busyDocs, 'document')}…`,
      detail: 'Usually under a minute each. Ask anything in the chat meanwhile.',
      cta: null,
      tone: 'wait',
    };
  }
  if (current.status === 'needs_answers') {
    if (current.id === 'documents' && i.missingDocs > 0) {
      return {
        title: `${plural(i.missingDocs, 'document')} still missing`,
        detail: 'Drop them in, or tell us you won’t get them this year.',
        cta: { label: 'Open documents', intent: open },
        tone: 'go',
      };
    }
    return {
      title: `Answer ${plural(current.openQuestions, 'quick question')}`,
      detail: `They’re in “${current.title}”. Your answers fill in the rest automatically.`,
      cta: { label: 'Answer', intent: open },
      tone: 'go',
    };
  }
  // Answers can clear a blocker, so questions come first; then anything that must be fixed, before more approving.
  const blocker = fix();
  if (blocker) return blocker;
  if (current.status === 'needs_reapproval') {
    return {
      title: `${current.title} changed. Take another look`,
      detail: 'New information updated this section. Check what changed, then approve again.',
      cta: { label: 'Review changes', intent: open },
      tone: 'fix',
    };
  }
  return {
    title: `Review and approve: ${current.title}`,
    detail: 'Check the numbers. Click any amount to see exactly where it came from.',
    cta: { label: 'Review', intent: open },
    tone: 'go',
  };
}
