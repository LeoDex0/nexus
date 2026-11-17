import { surface, type Surface } from '../util/canvas';
import { clamp, rng, smoothstep } from '../util/math';

/**
 * NEXUS Signal: eighteen sensor channels scroll by. One develops a faint
 * precursor; it is flagged early and isolated before it can cascade.
 */
export function signalViz(canvas: HTMLCanvasElement, mobile: boolean, reduced: boolean) {
  const CH = mobile ? 12 : 18;
  const BAD = mobile ? 7 : 11;
  const r = rng(31);
  const chans = Array.from({ length: CH }, (_, i) => ({
    f1: 0.6 + r() * 1.4,
    f2: 2 + r() * 3,
    ph: r() * 10,
    amp: 0.35 + r() * 0.3,
    neighbour: Math.abs(i - BAD) === 1,
  }));
  const LOOP = 13;
  let mx = -1;

  // value of channel c at absolute time t (seconds)
  const value = (c: number, t: number) => {
    const ch = chans[c];
    let v = ch.amp * (Math.sin(t * ch.f1 + ch.ph) * 0.6 + Math.sin(t * ch.f2 * 1.7 + ch.ph * 2) * 0.25 + Math.sin(t * 9.3 + c) * 0.08);
    const lt = ((t % LOOP) + LOOP) % LOOP;
    if (c === BAD) {
      // precursor: a growing high-frequency tremor, then isolation flattens it
      const grow = smoothstep(2, 7.5, lt) * (1 - smoothstep(7.6, 8.2, lt));
      v += Math.sin(t * 31) * grow * 0.55;
      const iso = smoothstep(7.6, 8.2, lt) * (1 - smoothstep(12.2, 12.9, lt));
      v *= 1 - iso * 0.85;
    }
    return v;
  };

  const frame = (s: Surface, _dt: number, time: number) => {
    const ctx = s.ctx;
    const t = reduced ? time * 0.4 : time;
    const lt = t % LOOP;
    const W = s.w;
    const H = s.h;
    const left = mobile ? 52 : 74;
    const right = W - (mobile ? 12 : 150);
    const rowH = H / (CH + 1);
    const span = 6; // seconds visible
    ctx.clearRect(0, 0, W, H);
    ctx.font = '9px "Martian Mono Variable", monospace';
    ctx.textBaseline = 'middle';

    const detected = lt > 4.1 && lt < 12.9;
    const isolated = lt > 7.8 && lt < 12.9;

    for (let c = 0; c < CH; c++) {
      const y0 = rowH * (c + 1);
      const bad = c === BAD;
      ctx.fillStyle = bad && detected ? 'rgba(79,230,255,0.95)' : 'rgba(214,226,236,0.35)';
      ctx.fillText(`CH ${String(c + 1).padStart(2, '0')}`, 0, y0);
      ctx.strokeStyle = 'rgba(214,226,236,0.06)';
      ctx.beginPath();
      ctx.moveTo(left, y0);
      ctx.lineTo(right, y0);
      ctx.stroke();

      ctx.beginPath();
      const step = 2;
      for (let x = left; x <= right; x += step) {
        const tt = t - span * (1 - (x - left) / (right - left));
        const v = value(c, tt);
        const y = y0 - v * rowH * 0.9;
        if (x === left) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // a soft phosphor trace under a crisp one
      ctx.lineWidth = 3;
      ctx.strokeStyle = bad && detected ? 'rgba(79,230,255,0.12)' : 'rgba(226,236,244,0.05)';
      ctx.stroke();
      ctx.lineWidth = bad && detected ? 1.4 : 1;
      ctx.strokeStyle = bad && isolated ? 'rgba(79,230,255,0.55)' : bad && detected ? 'rgba(79,230,255,0.95)' : 'rgba(226,236,244,0.55)';
      ctx.stroke();

      // light pulses carried along the channel to the receiver
      const pulses = mobile ? 2 : 3;
      for (let q = 0; q < pulses; q++) {
        const speed = 0.11 + ((c * 37 + q * 13) % 7) * 0.012;
        const f = (t * speed + q / pulses + c * 0.137) % 1;
        if (bad && isolated) continue; // an isolated channel carries nothing
        const x = left + (right - left) * f;
        const tt = t - span * (1 - f);
        const y = y0 - value(c, tt) * rowH * 0.9;
        for (let k = 0; k < 5; k++) {
          const xx = x - k * 5;
          if (xx < left) break;
          ctx.fillStyle = bad && detected ? `rgba(79,230,255,${0.9 - k * 0.17})` : `rgba(232,240,246,${0.85 - k * 0.16})`;
          ctx.fillRect(xx - 1.5, y - 1.5 + 0, k === 0 ? 3 : 2, k === 0 ? 3 : 2);
        }
      }

      // receiver: one photodiode per channel, brightness = current amplitude
      const amp = Math.abs(value(c, t));
      const rx = right + 6;
      ctx.fillStyle = bad && isolated ? 'rgba(255,179,71,0.25)' : `rgba(${bad && detected ? '79,230,255' : '226,236,244'},${0.15 + Math.min(1, amp * 1.6) * 0.75})`;
      ctx.fillRect(rx, y0 - 3, 6, 6);

      if (!mobile) {
        ctx.fillStyle = bad && detected ? 'rgba(79,230,255,0.95)' : 'rgba(214,226,236,0.3)';
        const label = bad ? (isolated ? 'ISOLATED' : detected ? 'PRECURSOR' : 'NOMINAL') : 'NOMINAL';
        ctx.fillText(label, right + 22, y0);
      }
    }

    // detection bracket around the bad channel
    if (detected) {
      const y0 = rowH * (BAD + 1);
      const k = clamp((lt - 4.1) / 0.5);
      const x1 = left + (right - left) * 0.45;
      const x2 = right;
      const h = rowH * 0.95;
      ctx.strokeStyle = `rgba(79,230,255,${0.8 * k})`;
      ctx.lineWidth = 1;
      const br = (x: number, dir: number) => {
        ctx.beginPath();
        ctx.moveTo(x + dir * 8, y0 - h);
        ctx.lineTo(x, y0 - h);
        ctx.lineTo(x, y0 + h);
        ctx.lineTo(x + dir * 8, y0 + h);
        ctx.stroke();
      };
      br(x1, 1);
      br(x2 + 4, -1);
      ctx.fillStyle = `rgba(79,230,255,${k})`;
      const msg = isolated ? 'Isolated · cascade prevented' : `Precursor · ${(11 - (lt - 4.1) * 0.6).toFixed(1)} min to failure`;
      ctx.fillText(msg.toUpperCase(), x1 + 10, y0 - h - 10);
    }

    // scan line under the pointer
    if (mx > left && mx < right) {
      ctx.strokeStyle = 'rgba(232,237,241,0.4)';
      ctx.beginPath();
      ctx.moveTo(mx, 6);
      ctx.lineTo(mx, H - 6);
      ctx.stroke();
      const tt = t - span * (1 - (mx - left) / (right - left));
      for (let c = 0; c < CH; c++) {
        const y = rowH * (c + 1) - value(c, tt) * rowH * 0.9;
        ctx.fillStyle = c === BAD ? '#4fe6ff' : '#e8edf1';
        ctx.fillRect(mx - 2, y - 2, 4, 4);
      }
      ctx.fillStyle = 'rgba(232,237,241,0.8)';
      ctx.fillText(`T−${((right - mx) / (right - left) * span).toFixed(2)} s`, mx + 8, 10);
    }
  };

  surface(canvas, frame);
  canvas.addEventListener('pointermove', (e) => {
    mx = e.clientX - canvas.getBoundingClientRect().left;
  });
  canvas.addEventListener('pointerleave', () => (mx = -1));
}
