import markUrl from '../assets/tidy-mark.png';
import { WORDMARK } from '../wordmark';

/** Tidy's logo: the "t" with sparkles on the teal tile. Decorative, because the name is always written next to it. */
export function Logo({ size }: { size: number }) {
  return <img className="logo" src={markUrl} alt="" width={size} height={size} draggable={false} />;
}

/** The "tidy" wordmark, drawn in the current text color. */
export function Wordmark({ height }: { height: number }) {
  const { box, baseline, glyphs } = WORDMARK;
  return (
    <svg
      className="wordmark"
      role="img"
      aria-label="Tidy"
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      width={(height * box.width) / box.height}
      height={height}
      fill="currentColor"
    >
      {glyphs.map((g) => (
        <path key={g.x} transform={`translate(${g.x} ${baseline})`} d={g.d} />
      ))}
    </svg>
  );
}
