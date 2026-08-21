import { useEffect, useRef } from "react";

/** Live squash-and-stretch ball for the landing — same motion as the sample project. */
export function HeroStage() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const start = performance.now();
    const ghosts: { x: number; y: number; rx: number; ry: number }[] = [];

    const draw = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      const t = ((now - start) / 1000) % 2;
      const phase = t * Math.PI * 2;
      const c = Math.cos(phase);
      const absC = Math.abs(c);
      const speed = Math.abs(Math.sin(phase));
      const ground = h - 28;
      const ballR = 18;
      const bounceH = ground - 40 - ballR * 2;
      const x = w * 0.5;
      const y = ground - ballR - bounceH * absC;
      let rx = ballR;
      let ry = ballR;
      if (absC < 0.18) {
        const k = 1 - absC / 0.18;
        rx = ballR * (1 + 0.42 * k);
        ry = ballR * (1 - 0.38 * k);
      } else {
        rx = ballR * (1 - 0.22 * speed);
        ry = ballR * (1 + 0.28 * speed);
      }
      ghosts.push({ x, y, rx, ry });
      if (ghosts.length > 8) ghosts.shift();

      ctx.fillStyle = "#101012";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#2c2c34";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(16, ground);
      ctx.lineTo(w - 16, ground);
      ctx.stroke();

      ghosts.forEach((g, i) => {
        const a = ((i + 1) / ghosts.length) * 0.28;
        ctx.beginPath();
        ctx.fillStyle = `rgba(200,204,212,${a})`;
        ctx.ellipse(g.x, g.y, g.rx, g.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.beginPath();
      ctx.fillStyle = "rgba(8,8,10,0.55)";
      ctx.ellipse(x, ground + 2, rx * (0.5 + (1 - absC) * 0.6), 4, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "#d6d8dc";
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "#f4f4f5";
      ctx.ellipse(x - rx * 0.28, y - ry * 0.32, rx * 0.3, ry * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      width={520}
      height={300}
      className="h-auto w-full rounded-[var(--radius-md)] border border-border bg-subtle"
      aria-label="洋蔥皮彈跳球"
    />
  );
}
