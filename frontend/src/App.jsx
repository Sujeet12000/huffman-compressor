import { useState, useRef, useCallback } from "react";
import axios from "axios";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:         "#0a0a0f",
  surface:    "#111118",
  surfaceAlt: "#16161f",
  border:     "#1e1e2e",
  borderHov:  "#2e2e4e",
  accent:     "#6ee7b7",   // emerald-300
  accentDim:  "#34d399",
  accentGlow: "rgba(110,231,183,0.15)",
  accentText: "#a7f3d0",
  red:        "#f87171",
  redDim:     "rgba(248,113,113,0.12)",
  muted:      "#4b5060",
  mutedLight: "#6b7280",
  text:       "#e2e8f0",
  textDim:    "#94a3b8",
};

const BASE = "https://huffman-backend-6zsc.onrender.com";
// ─── Global styles injected once ──────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Syne:wght@400;500;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: ${C.bg};
    color: ${C.text};
    font-family: 'Syne', sans-serif;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: ${C.bg}; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 ${C.accentGlow}; }
    50%       { box-shadow: 0 0 24px 6px ${C.accentGlow}; }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position:  400px 0; }
  }
  @keyframes scanline {
    0%   { background-position: 0 0; }
    100% { background-position: 0 100%; }
  }
`;

function injectGlobalCSS() {
  if (document.getElementById("hc-global")) return;
  const style = document.createElement("style");
  style.id = "hc-global";
  style.textContent = GLOBAL_CSS;
  document.head.appendChild(style);
}
injectGlobalCSS();

// ─── Small reusable atoms ──────────────────────────────────────────────────────

function Mono({ children, style }) {
  return (
    <span style={{ fontFamily: "'JetBrains Mono', monospace", ...style }}>
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 18,
        height: 18,
        border: `2px solid ${C.border}`,
        borderTopColor: C.accent,
        borderRadius: "50%",
        animation: "spin 0.75s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

function Badge({ children, color = C.accent }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color,
        background: `${color}18`,
        border: `1px solid ${color}30`,
        borderRadius: 4,
        padding: "3px 8px",
      }}
    >
      {children}
    </span>
  );
}

function StatRow({ label, value, accent = false }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 0",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <span style={{ fontSize: 12, color: C.mutedLight, letterSpacing: "0.05em" }}>
        {label}
      </span>
      <Mono
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: accent ? C.accent : C.text,
        }}
      >
        {value}
      </Mono>
    </div>
  );
}

function StatsPanel({ stats, type }) {
  const isCompress = type === "compress";
  return (
    <div
      style={{
        marginTop: 20,
        background: C.surfaceAlt,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "4px 16px 8px",
        animation: "fadeUp 0.35s ease both",
      }}
    >
      <div
        style={{
          padding: "10px 0 6px",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: C.muted,
          fontWeight: 600,
        }}
      >
        Statistics
      </div>

      {isCompress ? (
        <>
          <StatRow label="Original Size"    value={fmt(stats.originalSize)}    />
          <StatRow label="Compressed Size"  value={fmt(stats.compressedSize)}  />
          <StatRow
            label="Compression Ratio"
            value={`${stats.ratio}×`}
            accent
          />
          <StatRow
            label="Space Saved"
            value={pct(stats.originalSize, stats.compressedSize)}
            accent
          />
        </>
      ) : (
        <>
          <StatRow label="Compressed Size"   value={fmt(stats.compressedSize)}   />
          <StatRow label="Decompressed Size" value={fmt(stats.decompressedSize)} />
          <StatRow
            label="Expansion Ratio"
            value={`${stats.ratio}×`}
            accent
          />
        </>
      )}
    </div>
  );
}

function fmt(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function pct(orig, comp) {
  if (!orig || !comp) return "—";
  return `${((1 - comp / orig) * 100).toFixed(1)}%`;
}

// ─── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({ accept, file, onFile, label, ext }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handle = useCallback(
    (f) => {
      if (!f) return;
      if (!f.name.endsWith(ext)) return;
      console.log("Selected:",
      f.name);
      onFile(f);
    },
    [ext, onFile]
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handle(e.dataTransfer.files[0]);
  };

  const border = dragging
    ? `1.5px dashed ${C.accent}`
    : file
    ? `1.5px dashed ${C.accentDim}`
    : `1.5px dashed ${C.border}`;

  const bg = dragging ? C.accentGlow : file ? `${C.accent}08` : C.surfaceAlt;

  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        cursor: "pointer",
        border,
        background: bg,
        borderRadius: 10,
        padding: "28px 20px",
        textAlign: "center",
        transition: "all 0.2s ease",
        userSelect: "none",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => handle(e.target.files[0])}
      />

      {/* Icon */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: file ? C.accentGlow : `${C.muted}22`,
          border: `1px solid ${file ? C.accent + "40" : C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 14px",
          fontSize: 20,
        }}
      >
        {file ? "✓" : "↑"}
      </div>

      {file ? (
        <>
          <div style={{ color: C.accent, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            {file.name}
          </div>
          <div style={{ color: C.mutedLight, fontSize: 11 }}>{fmt(file.size)}</div>
        </>
      ) : (
        <>
          <div style={{ color: C.textDim, fontSize: 13, marginBottom: 4 }}>{label}</div>
          <div style={{ color: C.muted, fontSize: 11 }}>
            Drag & drop or click — <Mono style={{ fontSize: 11 }}>{ext}</Mono> only
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main card ─────────────────────────────────────────────────────────────────

function Card({ type }) {
  const isCompress = type === "compress";
  const [file, setFile]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats]     = useState(null);
  const [error, setError]     = useState(null);
  const [done, setDone]       = useState(false);
  const [hover, setHover]     = useState(false);

  const reset = () => {
    setFile(null); setStats(null);
    setError(null); setDone(false);
  };

  const run = async () => {
    if (!file) return;
    setLoading(true); setError(null); setStats(null); setDone(false);

    const form = new FormData();
    form.append("file", file);

    const endpoint = isCompress ? "/compress" : "/decompress";

    try {
      const res = await axios.post(`${BASE}${endpoint}`, form, {
        responseType: "blob",
        headers: { "Content-Type": "multipart/form-data" },
      });

      // ── Parse stats from headers ─────────────────────────────────────────
      const h = res.headers;
      let parsedStats;

      if (isCompress) {
        parsedStats = {
          originalSize:   parseInt(h["x-original-size"]    || "0"),
          compressedSize: parseInt(h["x-compressed-size"]  || "0"),
          ratio:          parseFloat(h["x-compression-ratio"] || "0"),
        };
      } else {
        parsedStats = {
          compressedSize:   parseInt(h["x-compressed-size"]   || "0"),
          decompressedSize: parseInt(h["x-decompressed-size"] || "0"),
          ratio:            parseFloat(h["x-compression-ratio"] || "0"),
        };
      }

      // ── Trigger download ─────────────────────────────────────────────────
      const stem = file.name.replace(/\.[^.]+$/, "");
      const outName = isCompress ? `${stem}.bin` : `${stem}.txt`;
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement("a");
      a.href = url; a.download = outName;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStats(parsedStats);
      setDone(true);
    } catch (err) {
      const text = await err.response?.data?.text?.();
      let msg = "An unexpected error occurred.";
      try { msg = JSON.parse(text)?.detail || msg; } catch {}
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const accent   = isCompress ? C.accent : "#93c5fd";   // emerald vs sky
  const accentGl = isCompress ? C.accentGlow : "rgba(147,197,253,0.12)";
  const icon     = isCompress ? "⬇" : "⬆";
  const ext      = isCompress ? ".txt" : ".bin";
  const btnLabel = isCompress ? "Compress" : "Decompress";
  const title    = isCompress ? "Compress" : "Decompress";
  const subtitle = isCompress
    ? "Huffman-encode a .txt file"
    : "Rebuild original text from .bin";

  const btnActive = file && !loading;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.surface,
        border: `1px solid ${hover ? C.borderHov : C.border}`,
        borderRadius: 16,
        padding: "28px 26px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        transition: "border-color 0.25s ease, box-shadow 0.25s ease",
        boxShadow: hover ? `0 0 40px 0 ${accentGl}` : "none",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Corner accent line */}
      <div style={{
        position: "absolute", top: 0, left: 28, right: 28, height: 1,
        background: `linear-gradient(90deg, transparent, ${accent}50, transparent)`,
      }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: `${accent}18`,
                border: `1px solid ${accent}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, color: accent,
              }}
            >
              {icon}
            </span>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>
              {title}
            </h2>
          </div>
          <p style={{ fontSize: 12, color: C.mutedLight, marginLeft: 42 }}>{subtitle}</p>
        </div>
        <Badge color={accent}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: accent, display: "inline-block" }} />
          Huffman v2
        </Badge>
      </div>

      {/* Drop zone */}
      <DropZone
        accept={ext}
        file={file}
        onFile={setFile}
        label={`Drop your ${ext} file here`}
        ext={ext}
      />

      {/* Action row */}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button
          onClick={run}
          disabled={!btnActive}
          style={{
            flex: 1,
            height: 42,
            borderRadius: 8,
            border: "none",
            cursor: btnActive ? "pointer" : "not-allowed",
            background: btnActive
              ? `linear-gradient(135deg, ${accent}, ${accent}bb)`
              : C.surfaceAlt,
            color: btnActive ? "#0a0a0f" : C.muted,
            fontFamily: "'Syne', sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.04em",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            transition: "all 0.2s ease",
            animation: done ? "pulse-glow 1.4s ease 1" : "none",
          }}
        >
          {loading ? <><Spinner /> Processing…</> : btnLabel}
        </button>

        {file && (
          <button
            onClick={reset}
            style={{
              height: 42, padding: "0 14px", borderRadius: 8,
              border: `1px solid ${C.border}`, background: "transparent",
              color: C.mutedLight, cursor: "pointer",
              fontFamily: "'Syne', sans-serif", fontSize: 12,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.red}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
          >
            Clear
          </button>
        )}
      </div>

      {/* Success message */}
      {done && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: `${accent}10`,
            border: `1px solid ${accent}25`,
            borderRadius: 8,
            fontSize: 12,
            color: accent,
            display: "flex",
            alignItems: "center",
            gap: 8,
            animation: "fadeUp 0.3s ease both",
          }}
        >
          <span>✓</span>
          <span>File downloaded successfully.</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: C.redDim,
            border: `1px solid ${C.red}30`,
            borderRadius: 8,
            fontSize: 12,
            color: C.red,
            animation: "fadeUp 0.3s ease both",
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Stats */}
      {stats && <StatsPanel stats={stats} type={type} />}
    </div>
  );
}

// ─── Decorative grid background ───────────────────────────────────────────────

function GridBg() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: `
          linear-gradient(${C.border}44 1px, transparent 1px),
          linear-gradient(90deg, ${C.border}44 1px, transparent 1px)
        `,
        backgroundSize: "48px 48px",
        maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
      }}
    />
  );
}

// ─── Root app ──────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <GridBg />

      {/* Ambient glow */}
      <div aria-hidden style={{
        position: "fixed", top: -200, left: "50%", transform: "translateX(-50%)",
        width: 600, height: 400, borderRadius: "50%",
        background: `radial-gradient(ellipse, ${C.accentGlow} 0%, transparent 70%)`,
        pointerEvents: "none", zIndex: 0,
      }} />

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* ── Navbar ──────────────────────────────────────────────────────── */}
        <header
          style={{
            borderBottom: `1px solid ${C.border}`,
            padding: "0 clamp(20px, 5vw, 60px)",
            height: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backdropFilter: "blur(10px)",
            background: `${C.bg}cc`,
            position: "sticky", top: 0, zIndex: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: `linear-gradient(135deg, ${C.accent}, ${C.accentDim}88)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 800, color: "#0a0a0f",
            }}>
              H
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
              HuffPress
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <Mono style={{ fontSize: 11, color: C.muted }}>
              API: 127.0.0.1:8000
            </Mono>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: C.accent,
              boxShadow: `0 0 6px ${C.accent}`,
            }} />
          </div>
        </header>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section
          style={{
            textAlign: "center",
            padding: "clamp(48px, 8vw, 80px) 20px 48px",
            animation: "fadeUp 0.6s ease both",
          }}
        >
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: C.surfaceAlt, border: `1px solid ${C.border}`,
            borderRadius: 99, padding: "5px 14px", marginBottom: 24,
          }}>
            <Mono style={{ fontSize: 10, color: C.mutedLight, letterSpacing: "0.1em" }}>
              HUFFMAN CODING  ·  LOSSLESS  ·  PYTHON BACKEND
            </Mono>
          </div>

          <h1
            style={{
              fontSize: "clamp(36px, 6vw, 64px)",
              fontWeight: 800,
              letterSpacing: "-0.04em",
              lineHeight: 1.1,
              marginBottom: 16,
              background: `linear-gradient(135deg, ${C.text} 40%, ${C.accent})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Compress anything.<br />
            Reconstruct perfectly.
          </h1>

          <p style={{ fontSize: 15, color: C.textDim, maxWidth: 460, margin: "0 auto" }}>
            Entropy-based lossless compression using frequency-optimal
            prefix-free codes — built from scratch, no external libraries.
          </p>
        </section>

        {/* ── Cards ───────────────────────────────────────────────────────── */}
        <main
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 20,
            maxWidth: 860,
            margin: "0 auto",
            padding: "0 clamp(16px, 4vw, 40px) 80px",
            animation: "fadeUp 0.7s 0.15s ease both",
          }}
        >
          <Card type="compress" />
          <Card type="decompress" />
        </main>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer
          style={{
            borderTop: `1px solid ${C.border}`,
            padding: "20px clamp(20px, 5vw, 60px)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Mono style={{ fontSize: 11, color: C.muted }}>
            huffman.py · compressor.py · main.py · App.jsx
          </Mono>
          <Mono style={{ fontSize: 11, color: C.muted }}>
            FastAPI · React · Vite
          </Mono>
        </footer>
      </div>
    </div>
  );
}
