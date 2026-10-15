// Конфетти победы (§4.3): 1.2 с, затем оверлей; усиленное — на последнем уровне главы.
// Детерминированность не требуется (чисто визуально), но источник случайности — mulberry32,
// чтобы не тянуть Math.random в ядро.
import { mulberry32 } from './rng.js';

/**
 * createConfetti(w, h, t0, { strong, colors, seed }) → { draw(ctx, t) → boolean (ещё живо) }.
 * Частицы вылетают из середины поля вверх и падают под гравитацией; strong — вдвое больше и дольше.
 */
export function createConfetti(w, h, t0, { strong = false, colors = ['#fff'], seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const count = strong ? 160 : 80;
  const dur = strong ? 1800 : 1200;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (rng.next() - 0.5) * Math.PI * 0.9;
    const speed = (strong ? 0.9 : 0.7) * (0.5 + rng.next()) * Math.min(w, h) * 0.0022;
    parts.push({
      x: w / 2 + (rng.next() - 0.5) * w * 0.3,
      y: h * 0.55,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 4 + rng.next() * 5,
      color: colors[rng.int(colors.length)],
      spin: (rng.next() - 0.5) * 0.02,
      rot: rng.next() * Math.PI,
      drift: (rng.next() - 0.5) * 0.0006,
    });
  }
  const gravity = 0.0016;

  return {
    dur,
    draw(ctx, t) {
      const dt = t - t0;
      if (dt > dur) return false;
      const fade = dt > dur - 300 ? (dur - dt) / 300 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      for (const p of parts) {
        const x = p.x + p.vx * dt + p.drift * dt * dt;
        const y = p.y + p.vy * dt + 0.5 * gravity * dt * dt;
        if (y > h + 20) continue;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot + p.spin * dt);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      ctx.restore();
      return true;
    },
  };
}
