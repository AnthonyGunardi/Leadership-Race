import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardViewport } from '../hooks/useBoardViewport.js';

let resize;
let viewportWidth;
let viewportHeight;
let canvasHeight;
const disconnect = vi.fn();

function ViewportHarness() {
  const { viewportRef, canvasRef, frameStyle } = useBoardViewport();
  return <main ref={viewportRef} data-testid="viewport">
    <div data-testid="frame" style={frameStyle}><div ref={canvasRef} data-testid="canvas" /></div>
  </main>;
}

describe('Board viewport fitting', () => {
  beforeEach(() => {
    viewportWidth = 1920;
    viewportHeight = 900;
    canvasHeight = 1080;
    disconnect.mockClear();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() { disconnect(); }
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
      return this.dataset.testid === 'viewport' ? viewportWidth : 1920;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
      return this.dataset.testid === 'viewport' ? viewportHeight : canvasHeight;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1920);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => canvasHeight);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => canvasHeight);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('uniformly fits the window and recalculates when fullscreen adds height', () => {
    render(<ViewportHarness />);
    const frame = screen.getByTestId('frame');
    expect(Number(frame.style.getPropertyValue('--board-fit-scale'))).toBeCloseTo(900 / 1080);
    viewportHeight = 1080;
    act(() => resize());
    expect(Number(frame.style.getPropertyValue('--board-fit-scale'))).toBe(1);
    viewportHeight = 900;
    act(() => resize());
    expect(Number(frame.style.getPropertyValue('--board-fit-scale'))).toBeCloseTo(900 / 1080);
  });

  it('contains increased content height rather than cropping its last rows', () => {
    render(<ViewportHarness />);
    canvasHeight = 1600;
    act(() => resize());
    const frame = screen.getByTestId('frame');
    expect(Number(frame.style.getPropertyValue('--board-fit-scale'))).toBeCloseTo(900 / 1600);
    expect(frame.style.getPropertyValue('--board-fit-height')).toBe('900px');
  });

  it('ignores an unmeasurable viewport and releases observers on unmount', () => {
    const { unmount } = render(<ViewportHarness />);
    const frame = screen.getByTestId('frame');
    const previous = frame.style.getPropertyValue('--board-fit-scale');
    viewportWidth = 0;
    act(() => resize());
    expect(frame.style.getPropertyValue('--board-fit-scale')).toBe(previous);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('leaves narrow mobile content at its native scale', () => {
    viewportWidth = 320;
    render(<ViewportHarness />);
    expect(Number(screen.getByTestId('frame').style.getPropertyValue('--board-fit-scale'))).toBe(1);
  });

  it('still follows window resizing when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<ViewportHarness />);
    viewportHeight = 1080;
    act(() => window.dispatchEvent(new window.Event('resize')));
    expect(Number(screen.getByTestId('frame').style.getPropertyValue('--board-fit-scale'))).toBe(1);
  });
});
