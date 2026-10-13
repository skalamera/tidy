import { CircleAlert, Info, OctagonAlert } from 'lucide-react';
import type { Flag } from '../../../shared/state';

const LOOK = {
  blocker: { label: 'Must fix', Icon: OctagonAlert },
  warning: { label: 'Heads up', Icon: CircleAlert },
  info: { label: 'Good to know', Icon: Info },
} as const;

export function FlagList({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="flags">
      {flags.map((f) => {
        const { label, Icon } = LOOK[f.severity];
        return (
          <li key={f.id} className={`flag ${f.severity}`}>
            <Icon size={18} aria-hidden />
            <div>
              <p className="eyebrow">{label}</p>
              <strong>{f.title}</strong>
              <p>{f.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
