// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Logo, Wordmark } from '../../src/renderer/src/components/Brand';
import { WORDMARK } from '../../src/renderer/src/wordmark';

afterEach(cleanup);

describe('brand', () => {
  it('draws the "tidy" wordmark as one image named Tidy, at the height asked for and undistorted', () => {
    render(<Wordmark height={30} />);
    const svg = screen.getByRole('img', { name: 'Tidy' });
    expect(svg.querySelectorAll('path')).toHaveLength(4);
    expect(svg.getAttribute('height')).toBe('30');
    expect(Number(svg.getAttribute('width'))).toBeCloseTo((30 * WORDMARK.box.width) / WORDMARK.box.height, 5);
  });

  it('shows the logo as decoration, because the name is always written next to it', () => {
    const { container } = render(<Logo size={36} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('src')).toMatch(/tidy-mark\.png$/);
    expect(img?.getAttribute('width')).toBe('36');
    expect(img?.getAttribute('height')).toBe('36');
  });
});
