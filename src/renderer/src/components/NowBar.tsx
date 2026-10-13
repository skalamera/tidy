import { ArrowRight, CircleAlert, LoaderCircle, PartyPopper, Sparkles } from 'lucide-react';
import type { Intent, NextAction } from '../../../core/nextAction';

const TONE_ICON = { go: Sparkles, wait: LoaderCircle, fix: CircleAlert, done: PartyPopper } as const;

/** The one thing to do next. Always visible at the top: one main button, sometimes with a quieter way out beside it. */
export function NowBar({ now, onIntent }: { now: NextAction; onIntent: (intent: Intent) => void }) {
  const Icon = TONE_ICON[now.tone];
  return (
    <section className={`nowbar tone-${now.tone}`} aria-live="polite" aria-label="Next step">
      <div className="nowbar-icon">
        <Icon size={22} className={now.tone === 'wait' ? 'spin' : undefined} aria-hidden />
      </div>
      <div className="nowbar-text">
        <p className="eyebrow">Next step</p>
        <h1>{now.title}</h1>
        <p>{now.detail}</p>
      </div>
      <div className="nowbar-actions">
        {now.secondary && (
          <button className="btn ghost" onClick={() => onIntent(now.secondary!.intent)}>
            {now.secondary.label}
          </button>
        )}
        {now.cta && (
          <button className="btn primary big" onClick={() => onIntent(now.cta!.intent)}>
            {now.cta.label}
            <ArrowRight size={18} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}
