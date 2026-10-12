import { useRef, useEffect, useState } from "react";
import type { RoutePoint } from "../lib/geo";
import { fmtDistance, fmtElevation, type UnitMode } from "../lib/units";

export interface ProfilePoi {
  lat: number;
  lon: number;
  name: string;
  emoji: string;
  dist: number;
}

interface Props {
  points: RoutePoint[];
  units: UnitMode;
  pois: ProfilePoi[];
  onHoverDist: (dist: number | null) => void;
  onPoiRemove: (poi: ProfilePoi) => void;
}

export default function ElevationChart({ points, units, pois, onHoverDist, onPoiRemove }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ x: number; ele: number; dist: number } | null>(null);
  const hoverRef = useRef(onHoverDist);
  hoverRef.current = onHoverDist;
  const poiRemoveRef = useRef(onPoiRemove);
  poiRemoveRef.current = onPoiRemove;

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

    // distance axis: gridline + label every `stepM` meters
    const stepM = units === "imperial" ? 5 * 1609.344 : 5000;
    ctx.strokeStyle = "rgba(100, 116, 139, 0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    for (let d = stepM; d < total; d += stepM) {
      const px = x(d);
      ctx.beginPath();
      ctx.moveTo(px, 18);
      ctx.lineTo(px, H - 18);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.fillText(fmtDistance(d, units), px, H - 6);
    }
    ctx.setLineDash([]);
    ctx.textAlign = "left";

    // POI markers (stops added to the route)
    for (const poi of pois) {
      const px = x(poi.dist);
      ctx.strokeStyle = "rgba(217, 70, 239, 0.8)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px, 18);
      ctx.lineTo(px, H - 18);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(px, 18, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(217, 70, 239, 1)";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const label = `${poi.emoji} ${poi.name} · ${fmtDistance(poi.dist, units)}`;
      ctx.font = "10px system-ui";
      const tw = ctx.measureText(label).width;
      const labelX = Math.min(Math.max(px, tw / 2 + 4), W - tw / 2 - 4);
      ctx.fillStyle = "rgba(217, 70, 239, 0.92)";
      ctx.beginPath();
      const pad = 4;
      const bw = tw + pad * 2;
      const bx = labelX - bw / 2;
      const by = 4;
      const bh = 15;
      const rr = 4;
      ctx.moveTo(bx + rr, by);
      ctx.lineTo(bx + bw - rr, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + rr);
      ctx.lineTo(bx + bw, by + bh - rr);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rr, by + bh);
      ctx.lineTo(bx + rr, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - rr);
      ctx.lineTo(bx, by + rr);
      ctx.quadraticCurveTo(bx, by, bx + rr, by);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(label, labelX, by + 11);
      ctx.textAlign = "left";
    }

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
    const onClick = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      // hit-test POI flags (top strip of the chart)
      for (const poi of pois) {
        const poiX = x(poi.dist);
        if (Math.abs(px - poiX) <= 8 && py <= 24) {
          poiRemoveRef.current(poi);
          return;
        }
      }
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("click", onClick);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("click", onClick);
    };
  }, [points, pois, units]);

  return (
    <div className="elevation-wrap" title={pois.length ? "Click a POI flag to remove it" : undefined}>
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
