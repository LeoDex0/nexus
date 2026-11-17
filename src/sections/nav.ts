import { gsap } from 'gsap';
import type { Scroller } from '../core/scroll';

/** Nav: anchor scrolling, current-section tracking, progress line, mobile menu. */
export function initNav(scroll: Scroller) {
  const nav = document.querySelector<HTMLElement>('[data-nav]')!;
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('[data-link]')];
  const track = nav.querySelector<HTMLElement>('.nav__section-track')!;
  const progress = nav.querySelector<HTMLElement>('.nav__progress span')!;
  const menuBtn = nav.querySelector<HTMLButtonElement>('.nav__menu')!;
  const menu = document.getElementById('menu')!;

  // anchor links go through the smooth scroller
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href')!;
    const el = id === '#top' ? document.body : document.querySelector<HTMLElement>(id);
    if (!el) return;
    e.preventDefault();
    if (!menu.hidden) closeMenu();
    // pinned sections: land where their story starts
    scroll.to(id === '#top' ? 0 : el, { offset: id === '#cta' ? 0 : 0 });
    history.replaceState(null, '', id === '#top' ? location.pathname : id);
  });

  // section names in the compact ticker
  const sections = [...document.querySelectorAll<HTMLElement>('[data-section]')];
  const names = [...new Set(sections.map((s) => s.dataset.section!))];
  track.innerHTML = names.map((n) => `<span>${n}</span>`).join('');
  let current = '';
  const setCurrent = (name: string) => {
    if (name === current) return;
    current = name;
    const i = names.indexOf(name);
    track.style.transform = `translateY(${-i * 16}px)`;
    const key = name.split(' ')[0];
    links.forEach((l) => l.classList.toggle('is-current', l.dataset.link === key));
  };
  setCurrent('index');

  // section rail: number, name and progress through the current section
  const rail = document.querySelector<HTMLElement>('.rail')!;
  const railTrack = rail.querySelector<HTMLElement>('.rail__num-track')!;
  const railName = rail.querySelector<HTMLElement>('.rail__name')!;
  const railLine = rail.querySelector<HTMLElement>('.rail__line')!;
  const numbered = ['core', 'intelligence', 'architecture', 'capabilities', 'live system', 'vision'];
  railTrack.innerHTML = numbered.map((_, i) => `<span>${String(i + 1).padStart(2, '0')}</span>`).join('');
  let railIdx = -1;

  const update = () => {
    const mid = innerHeight * 0.45;
    let name = 'index';
    let sectionP = 0;
    for (const s of sections) {
      const r = s.getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) {
        name = s.dataset.section!;
        sectionP = Math.min(1, Math.max(0, (mid - r.top) / Math.max(1, r.height)));
        break;
      }
    }
    setCurrent(name);
    const idx = numbered.indexOf(name);
    rail.classList.toggle('is-on', idx >= 0);
    if (idx >= 0) {
      if (idx !== railIdx) {
        railIdx = idx;
        railTrack.style.transform = `translateY(${-idx * 14}px)`;
        railName.textContent = name;
      }
      railLine.style.setProperty('--p', sectionP.toFixed(3));
    }
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? scroll.y() / max : 0})`;
  };
  gsap.ticker.add(update);

  // menu
  const openMenu = () => {
    menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.querySelector('.nav__menu-label')!.textContent = 'Close';
    scroll.stop();
    gsap.fromTo(menu, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 0.8, ease: 'expo.out' });
    gsap.fromTo(menu.querySelectorAll('.menu__links a'), { yPercent: 40, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.8, stagger: 0.05, ease: 'expo.out', delay: 0.1 });
    menu.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
  };
  const closeMenu = () => {
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.querySelector('.nav__menu-label')!.textContent = 'Menu';
    scroll.start();
    gsap.to(menu, {
      clipPath: 'inset(0 0 100% 0)',
      duration: 0.6,
      ease: 'expo.inOut',
      onComplete: () => {
        menu.hidden = true;
      },
    });
  };
  menuBtn.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      closeMenu();
      menuBtn.focus();
    }
  });
}
