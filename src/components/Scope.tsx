import { useEffect, useRef } from "react";
import type { AudioParams, MuteState } from "../types";

type Props = {
  analyser: AnalyserNode | null;
  params: AudioParams | null;
  mutes: MuteState;
  armed: boolean;
};

export function Scope({ analyser, params, mutes, armed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const wave = new Uint8Array(analyser?.fftSize ?? 2048);

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.fillStyle = "#070806";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(214, 255, 62, 0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 28) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
      }
      for (let y = 0; y <= height; y += 22) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(214, 255, 62, 0.28)";
      ctx.beginPath();
      ctx.moveTo(0, height / 2 + 0.5);
      ctx.lineTo(width, height / 2 + 0.5);
      ctx.stroke();

      if (analyser && armed) {
        analyser.getByteTimeDomainData(wave);
        ctx.strokeStyle = "#d6ff3e";
        ctx.shadowColor = "#d6ff3e";
        ctx.shadowBlur = 8;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const n = analyser.fftSize;
        for (let i = 0; i < n; i += 1) {
          const x = (i / (n - 1)) * width;
          const y = (wave[i] / 255) * height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      const meterW = 14;
      const gap = 8;
      const baseX = width - (meterW + gap) * 3 - 10;
      const bands: { key: keyof MuteState; color: string; value: number }[] = [
        {
          key: "fee",
          color: "#ff9f1c",
          value: params ? (params.feeHz - 64) / (640 - 64) : 0,
        },
        {
          key: "cu",
          color: "#d6ff3e",
          value: params ? (params.cuCutoffHz - 160) / (2600 - 160) : 0,
        },
        {
          key: "timing",
          color: "#ff5a3c",
          value: params ? params.noiseDensity : 0,
        },
      ];
      bands.forEach((band, i) => {
        const x = baseX + i * (meterW + gap);
        const h = Math.max(2, band.value * (height - 16));
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(x, 8, meterW, height - 16);
        ctx.fillStyle = mutes[band.key] ? "rgba(120,120,110,0.45)" : band.color;
        ctx.fillRect(x, height - 8 - h, meterW, h);
      });

      raf = requestAnimationFrame(draw);
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [analyser, armed, mutes, params]);

  return <canvas ref={canvasRef} className="scope-canvas" />;
}
