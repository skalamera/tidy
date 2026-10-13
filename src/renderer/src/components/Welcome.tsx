import { ArrowRight, FileUp, MessagesSquare, Printer } from 'lucide-react';
import { Logo } from './Brand';

const STEPS = [
  { Icon: FileUp, title: 'Drop in your documents', text: 'Last year’s return and this year’s W-2s, 1099s and statements.' },
  { Icon: MessagesSquare, title: 'Answer a few questions', text: 'Tidy fills in everything it can and asks only what it can’t find.' },
  { Icon: Printer, title: 'Approve, print and mail', text: 'Your federal and Maryland forms, filled in and ready to sign.' },
];

export function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <main className="welcome">
      <Logo size={80} />
      <h1>Your 2025 taxes, tidied up.</h1>
      <p className="lead">Tidy reads your tax documents, fills in your return, and walks you through it one small step at a time.</p>
      <ol className="welcome-steps">
        {STEPS.map(({ Icon, title, text }, i) => (
          <li key={title}>
            <span className="welcome-num">{i + 1}</span>
            <Icon size={22} aria-hidden />
            <strong>{title}</strong>
            <p>{text}</p>
          </li>
        ))}
      </ol>
      <button className="btn primary big" onClick={onStart}>
        Let’s start <ArrowRight size={18} aria-hidden />
      </button>
      <p className="fine">
        Your documents stay on this Mac, encrypted. Tidy sends them only to the AI you pick, Claude or Gemini, to be read.
      </p>
    </main>
  );
}
