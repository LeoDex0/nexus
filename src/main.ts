import '@fontsource-variable/mona-sans/wdth.css';
import '@fontsource-variable/martian-mono/wdth.css';
import '@fontsource-variable/newsreader/opsz.css';
import './styles/base.css';
import './styles/sections.css';
import './styles/caps.css';
import './styles/live.css';
import './styles/closing.css';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { detectProfile, trackPointer, updatePointer } from './core/env';
import { initScroll } from './core/scroll';
import { Stage } from './gl/stage';
import { createLoader, runIntro } from './sections/intro';
import { initNav } from './sections/nav';
import { fitWordmark, initHero } from './sections/hero';
import { initStory } from './sections/story';
import { initIntelligence } from './sections/intelligence';
import { initCapabilities } from './sections/capabilities';
import { initLive } from './live/live';
import { initVision } from './sections/vision';
import { initCta } from './sections/cta';
import { initReveals } from './sections/reveals';

gsap.registerPlugin(ScrollTrigger);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot() {
  const profile = detectProfile();
  const root = document.documentElement;
  root.classList.toggle('is-touch', profile.coarse);
  root.classList.toggle('is-reduced', profile.reducedMotion);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const startHash = location.hash;
  window.scrollTo(0, 0);

  trackPointer();
  const loader = createLoader();
  loader.set(0.12);
  const scroll = initScroll(profile);
  scroll.stop();

  const canvas = document.querySelector<HTMLCanvasElement>('.stage')!;
  let stage: Stage | null = null;
  const probe = document.createElement('canvas');
  const hasGL = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  try {
    if (hasGL) stage = new Stage(canvas, profile);
  } catch {
    stage = null;
  }
  if (!stage) {
    // the page still works without the 3D stage
    root.classList.add('no-webgl');
    canvas.remove();
  }
  loader.set(0.4);

  await Promise.race([document.fonts.ready, wait(2500)]);
  fitWordmark();
  loader.set(0.6);

  if (stage) {
    await stage.compile();
  }
  loader.set(0.85);

  initNav(scroll);
  const hero = stage ? initHero(stage, profile) : null;
  const story = stage ? initStory(stage, scroll) : null;
  initIntelligence(profile, scroll);
  initCapabilities(profile);
  initLive();
  initVision(profile);
  initCta(profile);
  initReveals(profile);

  gsap.ticker.add((_t, delta) => {
    const dt = Math.min(delta / 1000, 1 / 20);
    updatePointer(dt);
    if (stage && story) {
      story.update(dt);
      stage.update(dt);
      stage.render();
    }
  });

  await loader.set(1);
  ScrollTrigger.refresh();
  if (import.meta.env.DEV) Object.assign(window, { __nexus: { scroll, stage, story } });

  const interactive = () => {
    scroll.start();
    hero?.enableScrollExit();
    ScrollTrigger.refresh();
    story?.measure();
    if (startHash && startHash.length > 1 && document.querySelector(startHash)) {
      scroll.to(startHash, { immediate: true });
    }
  };
  if (stage) runIntro(stage, profile, interactive, () => story?.measure());
  else {
    document.body.classList.remove('is-loading');
    document.querySelector('.loader')?.remove();
    interactive();
  }
}

boot();
