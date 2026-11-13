import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MovementOverlay } from '../components/MovementOverlay.jsx';

describe('MovementOverlay component (Pixel-accurate visual interpolation)', () => {
  const team = {
    id: 'team-1',
    code: 'T1',
    name: 'Red Team',
    color: '#ef4444'
  };

  // 50 cells grid: 5 rows of 10 columns (boustrophedon / zigzag)
  // Row 1: cells 1-10 (cols 1-10)
  // Row 2: cells 11-20 (cols 10-1)
  const cells = Array.from({ length: 50 }, (_, i) => {
    const num = i + 1;
    const row = Math.floor(i / 10) + 1;
    const colInRow = (i % 10) + 1;
    const column = row % 2 === 1 ? colInRow : (11 - colInRow);
    return { number: num, row, column };
  });

  it('renders nothing when not moving or missing required props', () => {
    const { container, rerender } = render(
      <MovementOverlay timeline={{ isMoving: false, currentCell: 5 }} team={team} cells={cells} />
    );
    expect(container.firstChild).toBeNull();

    rerender(<MovementOverlay timeline={{ isMoving: true, currentCell: null }} team={team} cells={cells} />);
    expect(container.firstChild).toBeNull();

    rerender(<MovementOverlay timeline={{ isMoving: true, currentCell: 5 }} team={null} cells={cells} />);
    expect(container.firstChild).toBeNull();
  });

  it('interpolates straight horizontal movement via translate calc with CSS variable', () => {
    // Move from cell 2 to cell 3 (both in Row 1: cell 2 is col 2, cell 3 is col 3)
    const timeline = {
      isMoving: true,
      phase: 'MOVING',
      currentCell: 3,
      prevCell: 2,
      subStepProgress: 0.2 // inside glide ratio (0.2 < 0.55)
    };

    render(<MovementOverlay timeline={timeline} team={team} cells={cells} />);
    const slot = screen.getByRole('status');
    // Placed on target cell grid coordinates
    expect(slot).toHaveStyle({ gridRow: '1', gridColumn: '3' });

    const token = slot.querySelector('.movement-overlay-token');
    expect(token).toBeInTheDocument();
    // deltaCol = 2 - 3 = -1, deltaRow = 0
    // translateX should use calc with --delta-x and fallback percentage
    const expectedTransform = new RegExp(
      'translate\\(calc\\(var\\(--delta-x, -100%\\) \\* [0-9.]+\\), '
      + 'calc\\(var\\(--delta-y, 0%\\) \\* [0-9.]+\\)\\)'
    );
    expect(token.style.transform).toMatch(expectedTransform);
  });

  it('interpolates zigzag corner drop from Row 1 to Row 2', () => {
    // Cell 10 is row 1, col 10. Cell 11 is row 2, col 10 (boustrophedon turn).
    const timeline = {
      isMoving: true,
      phase: 'MOVING',
      currentCell: 11,
      prevCell: 10,
      subStepProgress: 0.1
    };

    render(<MovementOverlay timeline={timeline} team={team} cells={cells} />);
    const slot = screen.getByRole('status');
    expect(slot).toHaveStyle({ gridRow: '2', gridColumn: '10' });

    const token = slot.querySelector('.movement-overlay-token');
    // deltaCol = 0, deltaRow = 1 - 2 = -1
    const expectedDropTransform = new RegExp(
      'translate\\(calc\\(var\\(--delta-x, 0%\\) \\* [0-9.]+\\), '
      + 'calc\\(var\\(--delta-y, -100%\\) \\* [0-9.]+\\)\\)'
    );
    expect(token.style.transform).toMatch(expectedDropTransform);
  });

  it('sets pixel CSS custom properties when bounding rects are available in DOM', () => {
    const timeline = {
      isMoving: true,
      phase: 'MOVING',
      currentCell: 3,
      prevCell: 2,
      subStepProgress: 0.2
    };

    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect() {
      if (this.getAttribute?.('data-cell-number') === '2') {
        return { left: 100, top: 50, width: 80, height: 80, right: 180, bottom: 130 };
      }
      if (this.classList?.contains('movement-overlay-slot')) {
        return { left: 220, top: 50, width: 80, height: 80, right: 300, bottom: 130 };
      }
      return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    });

    try {
      const { container } = render(
        <ol className="race-grid">
          <li data-cell-number="2">Cell 2</li>
          <li data-cell-number="3">Cell 3</li>
          <MovementOverlay timeline={timeline} team={team} cells={cells} />
        </ol>
      );

      const slotEl = container.querySelector('.movement-overlay-slot');
      expect(slotEl.style.getPropertyValue('--delta-x')).toBe('-120.00px');
      expect(slotEl.style.getPropertyValue('--delta-y')).toBe('0.00px');
    } finally {
      spy.mockRestore();
    }
  });

  it('handles START entrance launch (prevCell = 0) with scale and opacity', () => {
    const timeline = {
      isMoving: true,
      phase: 'MOVING',
      currentCell: 1,
      prevCell: 0,
      subStepProgress: 0.25
    };

    render(<MovementOverlay timeline={timeline} team={team} cells={cells} />);
    const slot = screen.getByRole('status');
    const token = slot.querySelector('.movement-overlay-token');
    expect(token.style.transform).toMatch(/scale\([0-9.]+\)/);
    expect(token.style.opacity).toMatch(/[0-9.]+/);
  });

  it('handles wrap-around lap transition (prevCell = 50 -> currentCell = 1)', () => {
    const timeline = {
      isMoving: true,
      phase: 'MOVING',
      currentCell: 1,
      prevCell: 50,
      subStepProgress: 0.2
    };

    render(<MovementOverlay timeline={timeline} team={team} cells={cells} />);
    const slot = screen.getByRole('status');
    const token = slot.querySelector('.movement-overlay-token');
    expect(token.style.transform).toMatch(/scale\([0-9.]+\)/);
    expect(token.style.opacity).toMatch(/[0-9.]+/);
  });

  it('remains static on target cell during settling/resting phase (subStepProgress >= 0.55)', () => {
    const timeline = {
      isMoving: true,
      phase: 'MOVING',
      currentCell: 5,
      prevCell: 4,
      subStepProgress: 0.6 // past 0.55 glide ratio
    };

    render(<MovementOverlay timeline={timeline} team={team} cells={cells} />);
    const slot = screen.getByRole('status');
    const token = slot.querySelector('.movement-overlay-token');
    // No transform or opacity override; token rests squarely in slot
    expect(token.style.transform).toBe('');
    expect(token.style.opacity).toBe('');
  });

  it('respects prefers-reduced-motion media query by omitting transform interpolation', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    try {
      const timeline = {
        isMoving: true,
        phase: 'MOVING',
        currentCell: 5,
        prevCell: 4,
        subStepProgress: 0.2
      };

      render(<MovementOverlay timeline={timeline} team={team} cells={cells} />);
      const slot = screen.getByRole('status');
      const token = slot.querySelector('.movement-overlay-token');
      expect(token.style.transform).toBe('');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('applies is-retreating class during PENALTY phase', () => {
    const timeline = {
      isMoving: true,
      phase: 'PENALTY',
      currentCell: 12,
      prevCell: 15,
      subStepProgress: 0.7
    };

    render(<MovementOverlay timeline={timeline} team={team} cells={cells} />);
    const slot = screen.getByRole('status');
    expect(slot).toHaveClass('movement-overlay-slot');
    expect(slot).toHaveClass('is-retreating');
  });
});
