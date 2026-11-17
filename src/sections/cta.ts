import { gsap } from 'gsap';
import type { Profile } from '../core/env';

export function initCta(profile: Profile) {
  const section = document.getElementById('cta')!;
  const form = section.querySelector<HTMLFormElement>('[data-form]')!;
  const input = form.querySelector<HTMLInputElement>('input')!;
  const msg = form.querySelector<HTMLElement>('[data-form-msg]')!;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value.trim());
    input.setAttribute('aria-invalid', String(!ok));
    msg.classList.toggle('is-err', !ok);
    msg.classList.toggle('is-ok', ok);
    if (!ok) {
      msg.textContent = 'That address does not look complete.';
      input.focus();
      return;
    }
    msg.textContent = 'Request computed. This is a concept site, so nothing left your browser.';
    form.querySelector('button span')!.textContent = 'Requested';
    input.value = '';
  });

  // local time in the footer
  const clock = document.querySelector<HTMLElement>('[data-local-clock]');
  const tick = () => {
    if (clock) clock.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 15000);

  if (profile.reducedMotion) return;
  const lines = section.querySelectorAll('.cta__title .mask > span');
  gsap.from(lines, {
    yPercent: 110,
    duration: 1.6,
    stagger: 0.12,
    ease: 'expo.out',
    scrollTrigger: { trigger: section, start: 'top 60%', once: true },
  });
  gsap.from(form, {
    opacity: 0,
    y: 20,
    duration: 1.2,
    ease: 'expo.out',
    scrollTrigger: { trigger: form, start: 'top 92%', once: true },
  });
}
