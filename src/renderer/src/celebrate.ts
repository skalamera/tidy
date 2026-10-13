import confetti from 'canvas-confetti';

/** A small burst for approvals, a big one for the finished return. Skipped when the user prefers reduced motion. */
export function celebrate(size: 'small' | 'big'): void {
  if (typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  void confetti(
    size === 'big'
      ? { particleCount: 160, spread: 100, origin: { y: 0.35 }, colors: ['#146A64', '#F5B83D', '#7C9EFF', '#F28C8C'] }
      : { particleCount: 50, spread: 60, origin: { y: 0.8 }, colors: ['#146A64', '#F5B83D'] },
  );
}
