/** Device profile: decides how much work the page is allowed to do. */
export interface Profile {
  mobile: boolean;
  coarse: boolean;
  reducedMotion: boolean;
  maxDpr: number;
  tier: 'high' | 'mid' | 'low';
}

export function detectProfile(): Profile {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const narrow = matchMedia('(max-width: 820px)').matches;
  const mobile = coarse || narrow;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  let tier: Profile['tier'] = 'high';
  if (mobile || cores <= 4 || memory <= 4) tier = 'mid';
  if (mobile && (cores <= 4 || memory <= 3)) tier = 'low';
  const maxDpr = tier === 'high' ? 1.75 : tier === 'mid' ? 1.5 : 1.25;
  return { mobile, coarse, reducedMotion, maxDpr, tier };
}

/** Shared pointer state in normalised device coordinates (-1..1), plus velocity. */
export const pointer = {
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  vx: 0,
  vy: 0,
  clientX: 0,
  clientY: 0,
  active: false,
};

export function trackPointer() {
  window.addEventListener(
    'pointermove',
    (e) => {
      pointer.clientX = e.clientX;
      pointer.clientY = e.clientY;
      pointer.x = (e.clientX / innerWidth) * 2 - 1;
      pointer.y = -((e.clientY / innerHeight) * 2 - 1);
      pointer.active = true;
    },
    { passive: true },
  );
}

/** Called once per frame by the main loop: derives a smoothed velocity. */
export function updatePointer(dt: number) {
  const vx = (pointer.x - pointer.px) / Math.max(dt, 1 / 240);
  const vy = (pointer.y - pointer.py) / Math.max(dt, 1 / 240);
  pointer.vx += (vx - pointer.vx) * 0.25;
  pointer.vy += (vy - pointer.vy) * 0.25;
  pointer.px = pointer.x;
  pointer.py = pointer.y;
}
