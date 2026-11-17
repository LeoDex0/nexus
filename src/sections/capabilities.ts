import type { Profile } from '../core/env';
import { gridViz } from '../viz/grid';
import { flowViz } from '../viz/flow';
import { matterViz } from '../viz/matter';
import { signalViz } from '../viz/signal';

export function initCapabilities(profile: Profile) {
  const q = (sel: string) => document.querySelector<HTMLCanvasElement>(sel)!;
  const reduced = profile.reducedMotion;
  gridViz(q('[data-viz="grid"]'), document.querySelector('[data-grid-state]'), reduced);
  flowViz(q('[data-viz="flow"]'), profile.mobile, reduced);
  // Matter: a real 3D specimen when WebGL is there, loaded as the section nears
  const matterCanvas = q('[data-viz="matter"]');
  const table = document.querySelector<HTMLElement>('[data-matter-table]');
  const probe = document.createElement('canvas');
  const gl = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  if (!gl) matterViz(matterCanvas, table, reduced);
  else {
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        import('../viz/matter3d')
          .then(({ matter3d }) => matter3d(matterCanvas, table, reduced))
          .catch(() => matterViz(matterCanvas, table, reduced));
      },
      { rootMargin: '120% 0px' },
    );
    io.observe(matterCanvas);
  }
  signalViz(q('[data-viz="signal"]'), innerWidth < 720, reduced);
}
