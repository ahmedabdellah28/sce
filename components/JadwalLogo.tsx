import React, { useEffect, useRef } from "react";

interface DotMetrics {
  /** Normalized X across the Arabic word bounding box (0 = left, 1 = right) */
  arFracX: number;
  /** Offset from the top of the Arabic word em-box in px / fontSize */
  arBaselineOffsetEm: number;
  /** Diameter ratio of the jeem dot relative to fontSize */
  arSizeEm: number;
}

const DEFAULT_DOT_METRICS: DotMetrics = {
  arFracX: 0.52,
  arBaselineOffsetEm: 0.96,
  arSizeEm: 0.19,
};

/**
 * Measures the exact visual center of the dot under 'ج' by diffing
 * "جدول" vs "حدول" rendered on an offscreen canvas with the active font.
 */
function measureJeemDotMetrics(arEl: HTMLElement): {
  x: number;
  y: number;
  sizePx: number;
} | null {
  try {
    const cs = getComputedStyle(arEl);
    const fontSize = parseFloat(cs.fontSize);
    if (!fontSize || Number.isNaN(fontSize)) return null;

    const tn = arEl.firstChild;
    const stageEl = arEl.parentElement;
    if (!tn || !stageEl) return null;

    const rAll = document.createRange();
    rAll.setStart(tn, 0);
    rAll.setEnd(tn, tn.textContent?.length || 4);
    const arRect = rAll.getBoundingClientRect();
    const sr = stageEl.getBoundingClientRect();
    if (!arRect.width || !arRect.height) return null;

    const scale = 2;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const fontSpec = `${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
    ctx.font = fontSpec;
    const tm = ctx.measureText("حدول");
    const ascent = tm.fontBoundingBoxAscent || fontSize * 0.85;
    const descent = tm.fontBoundingBoxDescent || fontSize * 0.35;
    const emH = ascent + descent;

    const pad = Math.ceil(fontSize * 0.4);
    const w = Math.ceil(Math.max(tm.width, arRect.width)) + pad * 2;
    const h = Math.ceil(emH) + pad * 2;
    canvas.width = w * scale;
    canvas.height = h * scale;

    const renderWord = (word: string) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = fontSpec;
      ctx.direction = "rtl";
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#000";
      ctx.fillText(word, w - pad, pad + ascent);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };

    const withDot = renderWord("جدول");
    const withoutDot = renderWord("حدول");

    let sumX = 0;
    let sumY = 0;
    let totalW = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const cw = canvas.width;
    const ch = canvas.height;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const idx = (y * cw + x) * 4 + 3;
        const diff = Math.abs(withDot[idx] - withoutDot[idx]);
        if (diff > 48) {
          const weight = diff * diff;
          sumX += (x / scale) * weight;
          sumY += (y / scale) * weight;
          totalW += weight;
          const lx = x / scale;
          const ly = y / scale;
          if (lx < minX) minX = lx;
          if (lx > maxX) maxX = lx;
          if (ly < minY) minY = ly;
          if (ly > maxY) maxY = ly;
        }
      }
    }

    if (totalW <= 0) return null;

    const cx = sumX / totalW;
    const cy = sumY / totalW;
    const leftEdgeInCanvas = w - pad - tm.width;
    const fracX = (cx - leftEdgeInCanvas) / tm.width;
    const topOfEmBoxInCanvas = pad;
    const halfLeading = (arRect.height - emH) / 2;

    const domX = arRect.left - sr.left + fracX * arRect.width;
    const domY = arRect.top - sr.top + halfLeading + (cy - topOfEmBoxInCanvas);
    const dotSize = Math.max(maxX - minX, maxY - minY, fontSize * 0.16);

    return { x: domX, y: domY, sizePx: dotSize };
  } catch {
    return null;
  }
}

export const JadwalLogo: React.FC = () => {
  const logoRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const arRef = useRef<HTMLDivElement>(null);
  const enRef = useRef<HTMLDivElement>(null);
  const iiRef = useRef<HTMLSpanElement>(null);
  const sxRef = useRef<HTMLDivElement>(null);
  const syRef = useRef<HTMLDivElement>(null);
  const starRef = useRef<SVGSVGElement>(null);
  const segRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const logo = logoRef.current;
    const stage = stageRef.current;
    const ar = arRef.current;
    const en = enRef.current;
    const ii = iiRef.current;
    const sx = sxRef.current;
    const sy = syRef.current;
    const star = starRef.current;
    const seg = segRef.current;
    if (!logo || !stage || !ar || !en || !ii || !sx || !sy || !star) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let state: "" | "ar" | "en" = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let initTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const fit = () => {
      en.style.fontSize = ".28em";
      const aw = ar.offsetWidth;
      const ew = en.offsetWidth;
      if (aw && ew) {
        en.style.fontSize = `${(0.28 * aw) / ew}em`;
      }
    };

    const getPos = (mode: "ar" | "en") => {
      if (mode === "ar") {
        const measured = measureJeemDotMetrics(ar);
        if (measured) return measured;

        const tn = ar.firstChild;
        if (tn) {
          const r = document.createRange();
          r.setStart(tn, 0);
          r.setEnd(tn, 1);
          const b = r.getBoundingClientRect();
          const sr = stage.getBoundingClientRect();
          const fs = parseFloat(getComputedStyle(ar).fontSize) || 32;
          return {
            x: b.left - sr.left + b.width * DEFAULT_DOT_METRICS.arFracX,
            y: b.top - sr.top + b.height * 0.68,
            sizePx: fs * DEFAULT_DOT_METRICS.arSizeEm,
          };
        }
      }
      const fs = parseFloat(getComputedStyle(ar).fontSize) || 32;
      return {
        x: en.offsetLeft + ii.offsetLeft + ii.offsetWidth * 0.5,
        y: en.offsetTop + ii.offsetTop + ii.offsetHeight * -0.15,
        sizePx: fs * 0.16,
      };
    };

    const place = (mode: "ar" | "en", instant: boolean) => {
      const p = getPos(mode);
      if (instant) {
        sx.style.transition = sy.style.transition = star.style.transition = "none";
      }
      sx.style.transform = `translateX(${p.x}px)`;
      sy.style.transform = `translateY(${p.y}px)`;
      star.style.setProperty("--jadwal-ss", `${p.sizePx}px`);
      if (instant) {
        void sx.offsetWidth;
        sx.style.transition = sy.style.transition = star.style.transition = "";
      }
    };

    const go = (nextState: "ar" | "en") => {
      if (cancelled || nextState === state) return;
      state = nextState;
      logo.dataset.s = nextState;
      place(nextState, false);
      if (!reduceMotion && star.animate) {
        star.animate([{ rotate: "0deg" }, { rotate: "360deg" }], {
          duration: 950,
          easing: "ease-in-out",
        });
      }
      if (!reduceMotion && seg && seg.animate) {
        seg.animate([{ scale: "1 1" }, { scale: "1 2.4" }, { scale: "1 1" }], {
          duration: 650,
          delay: 350,
        });
      }
    };

    const scheduleNext = () => {
      if (cancelled || reduceMotion) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        go(state === "ar" ? "en" : "ar");
        scheduleNext();
      }, 3600);
    };

    const start = () => {
      if (cancelled) return;
      fit();
      place("ar", true);
      initTimer = setTimeout(() => {
        go("ar");
        if (!reduceMotion) {
          timer = setTimeout(scheduleNext, 1200);
        }
      }, 120);
    };

    const handleResize = () => {
      if (!state) return;
      fit();
      place(state, true);
    };

    const fontsReady =
      typeof document !== "undefined" && document.fonts
        ? Promise.all([
            document.fonts.load('900 34px "Zain"', "حدولجدول"),
            document.fonts.load('700 14px "Space Grotesk"', "JADWAL AI"),
          ])
        : Promise.resolve();

    Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1800))]).then(start, start);
    window.addEventListener("resize", handleResize);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (initTimer) clearTimeout(initTimer);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div
      ref={logoRef}
      className="jadwal-logo select-none shrink-0"
      role="img"
      aria-label="جدول AI — JADWAL"
      title="جدول AI — نظام الجداول المدرسية الذكي"
    >
      <style>{`
        .jadwal-logo {
          --jl-s: 31px;
          --jl-ink: #0F766E;
          --jl-ai: #8B5CF6;
          --jl-day: #99D5CD;
          font-size: var(--jl-s);
          font-family: 'Zain', 'Cairo', sans-serif;
          position: relative;
          display: grid;
          width: max-content;
          padding: .06em .04em 0;
          line-height: 1;
        }
        @media (min-width: 640px) {
          .jadwal-logo { --jl-s: 35px; }
        }
        .jadwal-stage {
          position: relative;
          display: grid;
          align-items: center;
          justify-items: center;
        }
        .jadwal-ar, .jadwal-en {
          grid-area: 1 / 1;
          width: max-content;
          white-space: nowrap;
          position: relative;
        }
        .jadwal-ar {
          font-family: 'Zain', 'Cairo', sans-serif;
          font-weight: 900;
          line-height: 1.32;
          color: var(--jl-ink);
          opacity: 0;
          filter: blur(8px);
          clip-path: inset(-20% -6% -20% 106%);
          transition: opacity .55s, filter .55s, clip-path .75s cubic-bezier(.7,0,.2,1);
        }
        .jadwal-logo[data-s="ar"] .jadwal-ar {
          opacity: 1;
          filter: none;
          clip-path: inset(-20% -6% -20% -6%);
        }
        .jadwal-en {
          direction: ltr;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700;
          font-size: .28em;
          line-height: 1;
          color: var(--jl-ink);
          letter-spacing: .04em;
        }
        .jadwal-en span {
          display: inline-block;
          margin-right: .08em;
          opacity: 0;
          filter: blur(5px);
          transition: opacity .35s, filter .35s;
        }
        .jadwal-en .jl-sp { margin-right: .46em; }
        .jadwal-en .jl-ai { color: var(--jl-ai); }
        .jadwal-en span:last-child { margin-right: 0; }
        .jadwal-logo[data-s="en"] .jadwal-en span {
          opacity: 1;
          filter: none;
          transition: opacity .45s, filter .45s;
          transition-delay: calc(.28s + var(--jl-i) * .05s);
        }
        .jadwal-sx, .jadwal-sy {
          position: absolute;
          left: 0;
          top: 0;
          pointer-events: none;
        }
        .jadwal-sx { transition: transform .95s cubic-bezier(.65,0,.3,1); }
        .jadwal-sy { transition: transform .95s cubic-bezier(.35,1.55,.5,1); }
        .jadwal-star {
          position: absolute;
          left: 0;
          top: 0;
          width: var(--jadwal-ss, 6px);
          height: var(--jadwal-ss, 6px);
          translate: -50% -50%;
          fill: var(--jl-ink);
          scale: 0;
          overflow: visible;
          transition:
            fill .65s cubic-bezier(.4,0,.2,1),
            width .95s,
            height .95s,
            scale .5s .85s cubic-bezier(.2,.9,.3,1.4);
        }
        .jadwal-logo[data-s] .jadwal-star { scale: 1; }
        .jadwal-logo[data-s="ar"] .jadwal-star { fill: var(--jl-ink); }
        .jadwal-logo[data-s="en"] .jadwal-star { fill: var(--jl-ai); }
        .jadwal-star path {
          transform-box: fill-box;
          transform-origin: center;
          animation: jadwalTw 3.2s ease-in-out infinite;
        }
        .jadwal-days {
          display: flex;
          gap: .06em;
          margin-top: .04em;
          height: 3px;
        }
        .jadwal-days i {
          flex: 1;
          border-radius: 99px;
          background: var(--jl-day);
          transform: scaleX(0);
          transform-origin: right;
          transition: transform .35s;
        }
        .jadwal-days i.jl-ai-seg { background: var(--jl-ai); }
        .jadwal-logo[data-s] .jadwal-days i {
          transform: scaleX(1);
          transition: transform .45s cubic-bezier(.3,.8,.3,1);
          transition-delay: calc(.85s + var(--jl-k) * .09s);
        }
        @keyframes jadwalTw {
          0%, 100% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.14) rotate(15deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .jadwal-logo *, .jadwal-logo *::before, .jadwal-logo *::after {
            animation: none !important;
            transition-duration: .01ms !important;
            transition-delay: 0s !important;
          }
        }
      `}</style>
      <div ref={stageRef} className="jadwal-stage">
        <div ref={arRef} className="jadwal-ar" aria-hidden="true">
          حدول
        </div>
        <div ref={enRef} className="jadwal-en" aria-hidden="true">
          <span style={{ "--jl-i": 0 } as React.CSSProperties}>J</span>
          <span style={{ "--jl-i": 1 } as React.CSSProperties}>A</span>
          <span style={{ "--jl-i": 2 } as React.CSSProperties}>D</span>
          <span style={{ "--jl-i": 3 } as React.CSSProperties}>W</span>
          <span style={{ "--jl-i": 4 } as React.CSSProperties}>A</span>
          <span className="jl-sp" style={{ "--jl-i": 5 } as React.CSSProperties}>
            L
          </span>
          <span className="jl-ai" style={{ "--jl-i": 6 } as React.CSSProperties}>
            A
          </span>
          <span ref={iiRef} className="jl-ai" style={{ "--jl-i": 7 } as React.CSSProperties}>
            I
          </span>
        </div>
        <div ref={sxRef} className="jadwal-sx">
          <div ref={syRef} className="jadwal-sy">
            <svg ref={starRef} className="jadwal-star" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 0Q13.4 10.6 24 12Q13.4 13.4 12 24Q10.6 13.4 0 12Q10.6 10.6 12 0Z" />
            </svg>
          </div>
        </div>
      </div>
      <div className="jadwal-days" aria-hidden="true">
        <i style={{ "--jl-k": 0 } as React.CSSProperties} />
        <i style={{ "--jl-k": 1 } as React.CSSProperties} />
        <i style={{ "--jl-k": 2 } as React.CSSProperties} />
        <i style={{ "--jl-k": 3 } as React.CSSProperties} />
        <i ref={segRef} className="jl-ai-seg" style={{ "--jl-k": 4 } as React.CSSProperties} />
      </div>
    </div>
  );
};
