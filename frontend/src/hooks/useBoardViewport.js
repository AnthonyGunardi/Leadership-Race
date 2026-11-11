import { useLayoutEffect, useRef, useState } from 'react';

/** Keeps display geometry uniform across browser chrome/fullscreen changes; mobile retains its flowing layout. */
export function useBoardViewport() {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const [frameStyle, setFrameStyle] = useState({
    '--board-fit-scale': 1,
    '--board-fit-width': '1920px',
    '--board-fit-height': '1080px'
  });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return undefined;

    /** Measures untransformed content so fonts, wrapped labels and viewport height cannot crop the canvas. */
    function fit() {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      const contentWidth = canvas.offsetWidth;
      const contentHeight = Math.max(canvas.offsetHeight, canvas.scrollHeight);
      if (!width || !height || !contentWidth || !contentHeight) return;
      const scale = width < 768 ? 1 : Math.min(width / contentWidth, height / contentHeight);
      const next = {
        '--board-fit-scale': scale,
        '--board-fit-width': `${contentWidth * scale}px`,
        '--board-fit-height': `${contentHeight * scale}px`
      };
      setFrameStyle((previous) => previous['--board-fit-scale'] === scale
        && previous['--board-fit-height'] === next['--board-fit-height']
        && previous['--board-fit-width'] === next['--board-fit-width'] ? previous : next);
    }

    fit();
    const observer = typeof globalThis.ResizeObserver === 'function' ? new globalThis.ResizeObserver(fit) : null;
    observer?.observe(viewport);
    observer?.observe(canvas);
    window.addEventListener('resize', fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  return { viewportRef, canvasRef, frameStyle };
}
