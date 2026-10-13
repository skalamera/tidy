import { Check, Lock } from 'lucide-react';
import type { AppView } from '../../../core/view';
import { AI_NAMES } from '../../../shared/ai';
import type { SectionId } from '../../../shared/state';
import { usd } from '../format';
import { STATUS_LABEL } from '../labels';
import { Icon } from './Icon';

function Result({ label, refund, owed }: { label: string; refund: number; owed: number }) {
  return (
    <div className="result">
      <span>{label}</span>
      <strong className={refund > 0 ? 'good' : undefined}>{refund > 0 ? `${usd(refund)} refund` : `${usd(owed)} owed`}</strong>
    </div>
  );
}

export function Sidebar({
  view,
  current,
  onOpen,
  onChangeAi,
}: {
  view: AppView;
  current: SectionId;
  onOpen: (id: SectionId) => void;
  onChangeAi: () => void;
}) {
  const { approved, total } = view.progress;
  return (
    <nav className="sidebar" aria-label="Steps">
      <div className="brand">
        <span className="logo" aria-hidden>
          t
        </span>
        <div>
          <strong>Tidy</strong>
          <span className="brand-sub">2025 tax return</span>
        </div>
      </div>
      <div className="progress" aria-label={`${approved} of ${total} steps approved`}>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${(approved / total) * 100}%` }} />
        </div>
        <span>
          {approved} of {total} steps approved
        </span>
      </div>
      <ol className="steps">
        {view.sections.map((s) => (
          <li key={s.id}>
            <button
              className={`step status-${s.status}${s.id === current ? ' current' : ''}`}
              onClick={() => onOpen(s.id)}
              disabled={s.status === 'locked'}
              title={s.status === 'locked' ? 'Unlocks after the steps above are approved' : s.blurb}
              aria-current={s.id === current ? 'step' : undefined}
            >
              <span className="step-icon">
                {s.status === 'approved' ? (
                  <Check size={16} />
                ) : s.status === 'locked' ? (
                  <Lock size={14} />
                ) : (
                  <Icon name={s.icon} size={16} />
                )}
              </span>
              <span className="step-text">
                <span className="step-title">{s.title}</span>
                <span className="step-status">
                  {s.status !== 'locked' && s.openQuestions > 0 ? `${s.openQuestions} to answer` : STATUS_LABEL[s.status]}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="results">
        <p className="eyebrow">So far</p>
        <Result label="Federal" refund={view.summary.refund} owed={view.summary.owed} />
        {view.summary.state && <Result label="Maryland" refund={view.summary.state.refund} owed={view.summary.state.owed} />}
      </div>
      {view.aiProvider && (
        <div className="ai-line">
          <span>
            AI: <strong>{AI_NAMES[view.aiProvider].ai}</strong>
          </span>
          <button onClick={onChangeAi} aria-label="Change AI">
            Change
          </button>
        </div>
      )}
    </nav>
  );
}
