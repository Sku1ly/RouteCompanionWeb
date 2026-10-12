import { useRef, useEffect, useState } from "react";
import type { RoutePoint } from "../lib/geo";
import { fmtDistance, fmtElevation, M_PER_FT, M_PER_MI, type UnitMode } from "../lib/units";

interface Props {
  points: RoutePoint[];
  units: UnitMode;
  onHoverDist: (dist: number | null) => void;
}

export default function ElevationChart({ points, units, onHoverDist }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ x: number; ele: number; dist: number } | null>(null);
  const hoverRef = useRef(onHoverDist);
  hoverRef.current = onHoverDist;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const parent = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const W = parent.clientWidth;
    const H = 160;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const total = points[points.length - 1].dist || 1;
    const eles = points.map((p) => p.ele);
    const minE = Math.min(...eles);
    const maxE = Math.max(...eles);
    const eSpan = Math.max(maxE - minE, 10);

    const x = (d: number) => (d / total) * (W - 8) + 4;
    const y = (e: number) => H - 8 - ((e - minE) / eSpan) * (H - 26);

    ctx.beginPath();
    points.forEach((p, i) => {
      const px = x(p.dist);
      const py = y(p.ele);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(x(total), H - 8);
    ctx.lineTo(x(0), H - 8);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(8,145,178,0.45)");
    grad.addColorStop(1, "rgba(8,145,178,0.05)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    points.forEach((p, i) => {
      const px = x(p.dist);
      const py = y(p.ele);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = "#0891b2";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#64748b";
    ctx.font = "11px system-ui";
    ctx.fillText(fmtElevation(minE, units), 6, H - 12);
    ctx.fillText(fmtElevation(maxE, units), 6, 14);

    const onMove = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const d = ((px - 4) / (W - 8)) * total;
      if (d < 0 || d > total) {
        setHover(null);
        hoverRef.current(null);
        return;
      }
      let lo = 0;
      let hi = points.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].dist < d) lo = mid + 1;
        else hi = mid;
      }
      const p = points[lo];
      setHover({ x: px, ele: p.ele, dist: d });
      hoverRef.current(d);
    };
    const onLeave = () => {
      setHover(null);
      hoverRef.current(null);
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [points]);

  return (
    <div className="elevation-wrap">
      {points.length < 2 ? (
        <div className="elevation-empty">No route yet</div>
      ) : (
        <canvas ref={canvasRef} />
      )}
      {hover && (
        <div className="elevation-tip" style={{ left: hover.x }}>
          {fmtElevation(hover.ele, units)} · {fmtDistance(hover.dist, units)}
        </div>
      )}
    </div>
  );
}
