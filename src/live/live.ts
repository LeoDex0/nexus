import { gsap } from 'gsap';
import { PlaceEngine, RouteEngine, type Engine, type LogKind, type View } from './engines';
import { BalanceEngine } from './balance';

/**
 * Live system console. Three real optimisers run in the browser; the UI
 * only displays what they compute.
 */
export function initLive() {
  const root = document.querySelector<HTMLElement>('[data-console]')!;
  const canvas = root.querySelector<HTMLCanvasElement>('[data-live-canvas]')!;
  const chart = root.querySelector<HTMLCanvasElement>('[data-chart]')!;
  const ctx = canvas.getContext('2d')!;
  const cctx = chart.getContext('2d')!;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const ui = {
    desc: $('[data-desc]'),
    how: $('[data-how]'),
    p1: $<HTMLInputElement>('[data-p1]'),
    p2: $<HTMLInputElement>('[data-p2]'),
    p1Label: $('[data-p1-label]'),
    p2Label: $('[data-p2-label]'),
    p1Out: $('[data-p1-out]'),
    p2Out: $('[data-p2-out]'),
    run: $<HTMLButtonElement>('[data-act="run"]'),
    status: $('[data-status]'),
    objLabel: $('[data-obj-label]'),
    obj: $('[data-obj]'),
    imp: $('[data-imp]'),
    iter: $('[data-iter]'),
    ms: $('[data-ms]'),
    log: $('[data-log]'),
  };
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-mode]')];

  const engines: Record<string, Engine> = {
    route: new RouteEngine(),
    balance: new BalanceEngine(),
    place: new PlaceEngine(),
  };
  let engine: Engine = engines.route;
  let paused = false;
  let computeMs = 0;
  let started = performance.now();
  let history: number[] = [];
  let lastSample = 0;
  let lastUi = 0;
  let visible = false;
  let seed = 7;
  let wasConverged = false;
  const view: View = { w: 1, h: 1, pad: 28, scale: 1, ox: 0, oy: 0 };
  let dpr = 1;

  const log = (text: string, kind: LogKind = 'info') => {
    const li = document.createElement('li');
    li.className = `is-new${kind !== 'info' ? ` is-${kind}` : ''}`;
    const s = (performance.now() - started) / 1000;
    const mm = Math.floor(s / 60);
    const ss = (s % 60).toFixed(2).padStart(5, '0');
    li.innerHTML = `<time>${String(mm).padStart(2, '0')}:${ss}</time><span></span>`;
    li.querySelector('span')!.textContent = text;
    ui.log.prepend(li);
    while (ui.log.children.length > 24) ui.log.lastElementChild!.remove();
  };
  Object.values(engines).forEach((e) => (e.onLog = log));

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    view.w = r.width;
    view.h = r.height;
    const pad = r.width < 500 ? 18 : 34;
    view.pad = pad;
    view.scale = r.height - pad * 2;
    view.ox = pad;
    view.oy = pad;
    const aspect = (r.width - pad * 2) / view.scale;
    engine.setAspect(aspect);
    const cr = chart.getBoundingClientRect();
    chart.width = Math.round(cr.width * dpr);
    chart.height = Math.round(cr.height * dpr);
  };
  const aspect = () => (view.w - view.pad * 2) / Math.max(1, view.scale);

  const syncControls = () => {
    const e = engine;
    ui.desc.textContent = e.description;
    ui.how.textContent = e.how;
    ui.objLabel.textContent = e.objectiveLabel;
    for (const [inp, p, label, out] of [
      [ui.p1, e.p1, ui.p1Label, ui.p1Out],
      [ui.p2, e.p2, ui.p2Label, ui.p2Out],
    ] as const) {
      inp.min = String(p.min);
      inp.max = String(p.max);
      inp.value = String(p.value);
      label.textContent = p.label;
      out.textContent = p.fmt(p.value);
      inp.setAttribute('aria-label', p.label);
      inp.style.setProperty('--fill', `${((p.value - p.min) / (p.max - p.min)) * 100}%`);
    }
  };

  const select = (id: string) => {
    engine = engines[id];
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === id)));
    resize();
    restart();
    syncControls();
    gsap.fromTo(canvas, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' });
  };

  const restart = () => {
    started = performance.now();
    computeMs = 0;
    history = [];
    ui.log.innerHTML = '';
    engine.reset(seed++, aspect());
    wasConverged = false;
  };

  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.mode!)));
  // arrow keys between tabs
  root.querySelector('[role="tablist"]')!.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'ArrowDown' && k !== 'ArrowUp') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const n = (i + (k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[n].focus();
    select(tabs[n].dataset.mode!);
  });

  const viewEl = root.querySelector<HTMLElement>('.console__view')!;
  const flash = () => {
    viewEl.classList.remove('is-flash');
    void viewEl.offsetWidth;
    viewEl.classList.add('is-flash');
    wasConverged = engine.converged ? false : wasConverged;
  };
  ui.p1.addEventListener('input', () => {
    engine.setP1(Number(ui.p1.value));
    syncControls();
    flash();
  });
  ui.p2.addEventListener('input', () => {
    engine.setP2(Number(ui.p2.value));
    syncControls();
    flash();
  });
  ui.p1.addEventListener('change', () => log(`${engine.p1.label} set to ${engine.p1.fmt(engine.p1.value)}`));
  ui.p2.addEventListener('change', () => log(`${engine.p2.label} set to ${engine.p2.fmt(engine.p2.value)}`));

  root.querySelector('[data-act="run"]')!.addEventListener('click', () => {
    paused = !paused;
    ui.run.querySelector('span')!.textContent = paused ? 'Run' : 'Pause';
    root.classList.toggle('is-paused', paused);
    log(paused ? 'Paused' : 'Resumed');
  });
  root.querySelector('[data-act="perturb"]')!.addEventListener('click', () => {
    engine.perturb();
    syncControls();
    wasConverged = false;
    flash();
  });
  root.querySelector('[data-act="reset"]')!.addEventListener('click', () => {
    restart();
    syncControls();
  });

  // pointer on the canvas
  let downX = 0;
  let downY = 0;
  let dragging = false;
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    downX = x;
    downY = y;
    dragging = engine.pointerDown(x, y, view);
    if (dragging) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const [x, y] = local(e);
    engine.pointerMove(x, y, view);
  });
  canvas.addEventListener('pointerup', (e) => {
    const [x, y] = local(e);
    if (dragging) {
      engine.pointerUp();
      dragging = false;
      return;
    }
    if (Math.hypot(x - downX, y - downY) < 6) {
      engine.click(x, y, view);
      syncControls();
      wasConverged = false;
      flash();
    }
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      engine.click(view.ox + Math.random() * (view.w - view.pad * 2), view.oy + Math.random() * view.scale, view);
      syncControls();
    }
  });

  const drawChart = () => {
    const w = chart.width;
    const h = chart.height;
    cctx.clearRect(0, 0, w, h);
    if (history.length < 2) return;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of history) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (hi - lo < 1e-9) hi = lo + 1;
    cctx.strokeStyle = 'rgba(214,226,236,0.12)';
    cctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      const y = Math.round((h * k) / 4) + 0.5;
      cctx.beginPath();
      cctx.moveTo(0, y);
      cctx.lineTo(w, y);
      cctx.stroke();
    }
    cctx.strokeStyle = '#4fe6ff';
    cctx.lineWidth = 1.25 * dpr;
    cctx.beginPath();
    history.forEach((v, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = 4 * dpr + (1 - (v - lo) / (hi - lo)) * (h - 8 * dpr);
      if (i) cctx.lineTo(x, y);
      else cctx.moveTo(x, y);
    });
    cctx.stroke();
  };

  const tick = (_time: number, deltaMs: number) => {
    if (!visible) return;
    const now = performance.now();
    if (!paused) {
      const t0 = performance.now();
      engine.step(Math.min(6, Math.max(2, deltaMs * 0.3)));
      computeMs += performance.now() - t0;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    engine.draw(ctx, view, now / 1000);

    if (now - lastSample > 90 && !paused) {
      lastSample = now;
      history.push(engine.objective());
      if (history.length > 140) history.shift();
    }
    if (now - lastUi > 120) {
      lastUi = now;
      const obj = engine.objective();
      ui.obj.textContent = engine.format(obj);
      const imp = engine.baseline > 0 ? (1 - obj / engine.baseline) * 100 : 0;
      ui.imp.textContent = `${imp >= 0 ? '−' : '+'}${Math.abs(imp).toFixed(1)}%`;
      ui.imp.classList.toggle('is-good', imp > 0.5);
      ui.iter.textContent = engine.iterations.toLocaleString('en-US');
      ui.ms.textContent = `${computeMs.toFixed(0)} ms`;
      const conv = engine.converged;
      ui.status.textContent = paused ? 'Paused' : conv ? 'Converged' : wasConverged ? 'Adapting' : 'Computing';
      root.classList.toggle('is-converged', conv && !paused);
      if (conv) wasConverged = true;
      drawChart();
    }
  };

  new ResizeObserver(() => resize()).observe(canvas);
  new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '100px' }).observe(canvas);
  resize();
  restart();
  syncControls();
  gsap.ticker.add(tick);
}
