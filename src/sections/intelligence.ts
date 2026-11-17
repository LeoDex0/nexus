import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Profile } from '../core/env';
import type { Scroller } from '../core/scroll';
import { clamp, invLerp } from '../util/math';
import type { Network } from '../intel/network';

/**
 * Intelligence: the 3D network is loaded only when the section approaches
 * and renders only while it is on screen. Stages follow the scroll; the
 * stage buttons jump the scroll to their stage so both stay in sync.
 */
export function initIntelligence(profile: Profile, scroll: Scroller) {
  const section = document.getElementById('intelligence')!;
  const field = section.querySelector<HTMLElement>('.intel__field')!;
  const canvas = section.querySelector<HTMLCanvasElement>('.intel__canvas')!;
  const labels = section.querySelector<HTMLElement>('.intel__labels')!;
  const items = [...section.querySelectorAll<HTMLElement>('.intel__phases li')];
  const buttons = [...section.querySelectorAll<HTMLButtonElement>('.intel__phase')];
  const bars = [...section.querySelectorAll<HTMLElement>('.intel__progress span')];
  const out = {
    flight: section.querySelector<HTMLElement>('[data-intel="flight"]')!,
    reinforced: section.querySelector<HTMLElement>('[data-intel="reinforced"]')!,
    events: section.querySelector<HTMLElement>('[data-intel="events"]')!,
  };

  let net: Network | null = null;
  let loading = false;
  let visible = false;
  let stage = 0;
  let lastReadout = 0;

  const setStage = (i: number) => {
    if (i === stage && net?.stage === i) return;
    stage = i;
    net?.setStage(i);
    items.forEach((li, k) => {
      li.classList.toggle('is-active', k === i);
      buttons[k].setAttribute('aria-current', k === i ? 'step' : 'false');
    });
  };

  const top = () => section.getBoundingClientRect().top + scroll.y();
  buttons.forEach((b, i) =>
    b.addEventListener('click', () => {
      const range = section.offsetHeight - innerHeight;
      scroll.to(top() + ((i + 0.5) / 4) * range);
    }),
  );

  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      const p = self.progress;
      bars.forEach((b, i) => b.style.setProperty('--p', String(clamp(p * 4 - i))));
      setStage(Math.min(3, Math.floor(p * 4)));
    },
  });

  const size = () => {
    if (!net) return;
    const r = field.getBoundingClientRect();
    net.resize(r.width, r.height, r.width > 900 ? 0.17 : 0);
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    try {
      const { Network } = await import('../intel/network');
      net = new Network(canvas, labels, { lite: profile.mobile, reduced: profile.reducedMotion });
      net.setStage(stage);
      size();
      new ResizeObserver(size).observe(field);
    } catch {
      field.classList.add('is-static');
    }
  };

  // load well before the section is reached; render only while visible
  new IntersectionObserver(([e]) => e.isIntersecting && load(), { rootMargin: '150% 0px' }).observe(section);
  new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '0px' }).observe(field);

  gsap.ticker.add((_t, delta) => {
    if (!net || !visible) return;
    const dt = Math.min(delta / 1000, 1 / 20);
    // pull back out of the core as the section arrives
    const y = scroll.y();
    net.enter = profile.reducedMotion ? 1 : invLerp(top() - innerHeight * 0.9, top() + innerHeight * 0.15, y);
    net.frame(dt);
    const now = performance.now();
    if (now - lastReadout > 200) {
      lastReadout = now;
      out.flight.textContent = String(net.stats.flight);
      out.reinforced.textContent = net.stats.reinforced.toLocaleString('en-US');
      out.events.textContent = String(net.stats.events);
    }
  });

  const local = (e: PointerEvent) => {
    const r = field.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, r] as const;
  };
  field.addEventListener('pointermove', (e) => {
    if (!net) return;
    const [x, y, r] = local(e);
    net.setPointer((x / r.width) * 2 - 1, (y / r.height) * 2 - 1);
    if (e.pointerType === 'mouse') net.hover(x, y);
  });
  field.addEventListener('pointerleave', () => net?.hover(-1, -1));
  field.addEventListener('click', (e) => {
    if (!net) return;
    const [x, y] = local(e);
    net.inject(x, y);
  });
}
