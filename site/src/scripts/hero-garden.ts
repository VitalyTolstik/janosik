// Decorative, independent task sprouts. They are never interactive and stay
// beneath the real hero content, including the product video.
const canvas = document.querySelector<HTMLCanvasElement>(".hero-garden");
const context = canvas?.getContext("2d");

if (canvas && context) {
  const surface = canvas;
  const ctx = context;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  type Sprout = {
    start: number;
    x: number;
    height: number;
    bend: number;
    leaf: number;
    leaves: number;
    width: number;
    tail: number;
    variant: number;
  };
  let sprouts: Sprout[] = [];
  let width = 0;
  let height = 0;
  let elapsed = 0;
  let previous = 0;
  let next = 0;
  let frame = 0;
  let visible = true;

  const random = (min: number, max: number) =>
    min + Math.random() * (max - min);
  function resize() {
    const bounds = surface.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    surface.width = Math.round(width * ratio);
    surface.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function rounded(
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    fill: string,
    stroke?: string,
  ) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  function draw(s: Sprout, dark: boolean) {
    const age = elapsed - s.start;
    const x = s.x * width,
      ground = height - 3;
    const growth = Math.max(0, Math.min(1, (age - 2) / 2.2));
    const fade = age < 9 ? 1 : Math.max(0, 1 - (age - 9) / 2);
    const smooth = growth * growth * (3 - 2 * growth);
    const top = ground - s.height * smooth,
      tip = x + s.bend * smooth;
    const blue = dark ? "#79c7f4" : "#559de0";
    const agents = dark
      ? ["#80bcfa", "#82d6e6", "#a5c6fa", "#81d3c6"]
      : ["#3b82d9", "#48a7cb", "#758fc6", "#4b9d9e"];
    if (age < 1.8) {
      const q = age / 1.8,
        sx = x + 150 * (1 - q),
        sy = ground - 210 * (1 - q);
      ctx.save();
      ctx.globalAlpha = (dark ? 0.3 : 0.42) * Math.sin(Math.PI * q);
      const gradient = ctx.createLinearGradient(
        sx,
        sy,
        sx + s.tail,
        sy - s.tail * 1.38,
      );
      gradient.addColorStop(0, blue);
      gradient.addColorStop(1, "transparent");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = s.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + s.tail, sy - s.tail * 1.38);
      ctx.stroke();
      ctx.restore();
    }
    if (growth <= 0 || fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = (dark ? 0.25 : 0.32) * fade;
    ctx.strokeStyle = dark ? "#88c9d5" : "#71a9b7";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, ground);
    ctx.bezierCurveTo(
      x - s.bend * 0.25,
      ground - s.height * 0.35 * smooth,
      tip + s.bend * 0.3,
      ground - s.height * 0.7 * smooth,
      tip,
      top,
    );
    ctx.stroke();
    if (growth > 0.35)
      for (let i = 0; i < s.leaves; i++) {
        const f = 0.28 + i * 0.2,
          side = i % 2 === 0 ? -1 : 1;
        const lx = x + s.bend * f * smooth,
          ly = ground - s.height * f * smooth,
          size = s.leaf * (1 - i * 0.12) * smooth;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.quadraticCurveTo(
          lx + side * size * 0.8,
          ly - size,
          lx + side * size,
          ly - size * 0.25,
        );
        ctx.quadraticCurveTo(lx + side * size * 0.8, ly + size * 0.2, lx, ly);
        ctx.fillStyle = dark
          ? "#8bc9ca"
          : ["#a6d0ce", "#a7cdd8", "#b0d7c7"][s.variant % 3];
        ctx.fill();
      }
    ctx.restore();
    const pickup = Math.max(0, Math.min(1, (age - 7) / 2)),
      ease = pickup * pickup * (3 - 2 * pickup);
    const cx = tip + ease * 65,
      cy = top - 19 - ease * 24;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = 0.32 * fade * Math.min(1, growth * 2);
    rounded(
      -34,
      -22,
      68,
      44,
      6,
      dark ? "#172b42" : "#fff",
      dark ? "#7fb1d0" : "#aacbe8",
    );
    rounded(
      -26,
      -14,
      [37, 45, 30, 41][s.variant],
      2.5,
      1,
      dark ? "#a4c8e8" : "#94b8d8",
    );
    rounded(
      -26,
      -7,
      [49, 33, 44, 38][s.variant],
      2.5,
      1,
      dark ? "#769ab8" : "#c2d8eb",
    );
    rounded(
      -26,
      1,
      [31, 45, 24, 41][s.variant],
      2.5,
      1,
      dark ? "#769ab8" : "#c2d8eb",
    );
    rounded(-26, 11, [16, 23, 12, 19][s.variant], 4, 2, blue);
    const avatar = Math.min(1, Math.max(0, (age - 5) / 1.3));
    if (avatar > 0) {
      ctx.globalAlpha *= avatar;
      ctx.beginPath();
      ctx.arc(25, 14, 7, 0, Math.PI * 2);
      ctx.fillStyle = agents[s.variant];
      ctx.fill();
      ctx.fillStyle = dark ? "#102236" : "#fff";
      ctx.textAlign = "center";
      ctx.font = "bold 7px sans-serif";
      ctx.fillText(["A", "M", "K", "S"][s.variant], 25, 16.5);
    }
    ctx.restore();
    if (age > 4.5 && age < 11) {
      const approach = Math.min(1, (age - 4.5) / 2);
      ctx.save();
      ctx.translate(
        tip - 60 + approach * 43 + ease * 65,
        top - 51 + approach * 20 - ease * 24,
      );
      ctx.globalAlpha = (dark ? 0.3 : 0.38) * fade;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(2, 15);
      ctx.lineTo(6, 11);
      ctx.lineTo(9, 17);
      ctx.lineTo(12, 15);
      ctx.lineTo(9, 9);
      ctx.lineTo(15, 9);
      ctx.closePath();
      ctx.fillStyle = agents[s.variant];
      ctx.fill();
      ctx.strokeStyle = dark ? "#102236" : "white";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }
  function atmosphere(dark: boolean) {
    ctx.save();
    const positions = [
      [0.08, 0.2, 7],
      [0.35, 0.12, 5],
      [0.58, 0.23, 6],
      [0.91, 0.12, 7],
    ];
    const time = elapsed / 2.88;
    if (dark) {
      positions.forEach(([x, y, size], index) => {
        ctx.save();
        ctx.translate(x * width, y * height);
        ctx.globalAlpha = 0.32 + 0.12 * Math.sin(time * 1.1 + index * 1.6);
        ctx.fillStyle = "#b7ddf5";
        ctx.shadowColor = "#75b9ed";
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(size * 0.18, -size * 0.18, size, 0);
        ctx.quadraticCurveTo(size * 0.18, size * 0.18, 0, size);
        ctx.quadraticCurveTo(-size * 0.18, size * 0.18, -size, 0);
        ctx.quadraticCurveTo(-size * 0.18, -size * 0.18, 0, -size);
        ctx.fill();
        ctx.restore();
      });
    } else {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = "#a7d0ee";
      positions.forEach(([x, y, size], index) => {
        ctx.save();
        const sway = Math.sin(time * 0.8 + index * 1.4);
        ctx.translate(x * width + sway * 5, y * height + sway * 3);
        ctx.rotate(sway * 0.11);
        const scale = size / 7;
        ctx.scale(scale, scale);
        ctx.beginPath();
        ctx.arc(-15, 0, 9, 0, Math.PI * 2);
        ctx.arc(-3, -6, 13, 0, Math.PI * 2);
        ctx.arc(12, -1, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }
    ctx.restore();
  }
  function tick(now: number) {
    if (!visible || motion.matches || document.hidden) {
      frame = 0;
      previous = 0;
      return;
    }
    if (previous) elapsed += Math.min((now - previous) / 1000, 0.05) * 2.88;
    previous = now;
    if (elapsed >= next) {
      const count = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++)
        sprouts.push({
          start: elapsed,
          x: random(0.05, 0.95),
          height: random(48, 98),
          bend: random(-17.5, 17.5),
          leaf: random(11, 24),
          leaves: 1 + Math.floor(Math.random() * 3),
          width: random(1.2, 3.2),
          tail: random(45, 85),
          variant: Math.floor(Math.random() * 4),
        });
      next = elapsed + random(1.2, 4.2);
    }
    sprouts = sprouts.filter((s) => elapsed - s.start < 11);
    ctx.clearRect(0, 0, width, height);
    const dark = document.documentElement.dataset.theme === "dark";
    atmosphere(dark);
    for (const sprout of sprouts) draw(sprout, dark);
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    if (motion.matches) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      sprouts = [];
      ctx.clearRect(0, 0, width, height);
    } else if (visible && !document.hidden && !frame)
      frame = requestAnimationFrame(tick);
  }
  resize();
  window.addEventListener("resize", resize);
  motion.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  if ("IntersectionObserver" in window)
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }).observe(surface);
  sync();
}
