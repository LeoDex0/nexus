import { gsap } from 'gsap';

export interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
  visible: boolean;
}

type Frame = (s: Surface, dt: number, t: number) => void;

/**
 * A crisp 2D canvas that tracks its element's size and only runs its frame
 * callback while it is on screen.
 */
export function surface(canvas: HTMLCanvasElement, frame: Frame, opts: { maxDpr?: number; onResize?: (s: Surface) => void } = {}) {
  const ctx = canvas.getContext('2d', { alpha: true })!;
  const s: Surface = { canvas, ctx, w: 1, h: 1, dpr: 1, visible: false };
  let t = 0;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    s.dpr = Math.min(devicePixelRatio || 1, opts.maxDpr ?? 2);
    s.w = Math.max(1, r.width);
    s.h = Math.max(1, r.height);
    canvas.width = Math.round(s.w * s.dpr);
    canvas.height = Math.round(s.h * s.dpr);
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    opts.onResize?.(s);
  };

  const tick = (_time: number, deltaMs: number) => {
    const dt = Math.min(deltaMs / 1000, 1 / 20);
    t += dt;
    frame(s, dt, t);
  };

  new ResizeObserver(resize).observe(canvas);
  resize();

  new IntersectionObserver(
    ([entry]) => {
      const was = s.visible;
      s.visible = entry.isIntersecting;
      if (s.visible && !was) gsap.ticker.add(tick);
      if (!s.visible && was) gsap.ticker.remove(tick);
    },
    { rootMargin: '80px 0px' },
  ).observe(canvas);

  return s;
}

/** Hairline helper: draws crisp 1px lines in CSS pixels. */
export function hair(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
