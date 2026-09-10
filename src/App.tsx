import { Scope } from "./components/Scope";
import { useHearslot } from "./hooks/useHearslot";
import type { BandId } from "./types";
import "./App.css";

const BANDS: { id: BandId; label: string; hint: string }[] = [
  { id: "fee", label: "FEE", hint: "pitch / brightness" },
  { id: "cu", label: "CU / LOAD", hint: "amp / cutoff" },
  { id: "timing", label: "SLOT", hint: "pulse / grit" },
];

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(digits)}k`;
  return n.toFixed(digits);
}

export default function App() {
  const h = useHearslot();
  const live = h.scrubFrac === null;
  const spanMs =
    h.history.length >= 2 ? h.history[h.history.length - 1].t - h.history[0].t : 0;
  const scrubAge =
    !live && h.history.length
      ? Math.round((1 - (h.scrubFrac ?? 1)) * (spanMs / 1000))
      : 0;

  return (
    <div className="bench">
      <header className="mast">
        <div>
          <p className="kicker">bench · mainnet-beta</p>
          <h1>HEARSLOT</h1>
        </div>
        <p className="mast-note">
          fees, compute load, slot timing — wired into oscillators.
          no wallet. no trade. just the chain making a racket.
        </p>
      </header>

      <section className="arm-row">
        <button
          type="button"
          className={`arm ${h.armed ? "on" : ""}`}
          onClick={h.toggleArm}
        >
          <span className="arm-lamp" />
          <span className="arm-text">{h.armed ? "ARMED" : "ARM / LISTEN"}</span>
        </button>
        <div className="status">
          <span className={`pill ${h.health}`}>{h.health}</span>
          <span className="status-note">{h.note}</span>
        </div>
      </section>

      <section className="main-grid">
        <div className="scope-panel">
          <div className="panel-label">
            <span>scope</span>
            <span>{h.armed ? "time domain + band meters" : "dark until you arm"}</span>
          </div>
          <div className="scope-frame">
            <Scope
              analyser={h.analyser}
              params={h.params}
              mutes={h.mutes}
              armed={h.armed}
            />
            {!h.armed && (
              <div className="scope-empty">click Arm to hear the chain</div>
            )}
          </div>
        </div>

        <aside className="side">
          <div className="readout">
            <Readout k="slot" v={h.sample ? String(h.sample.slot) : "—"} />
            <Readout k="tps" v={h.sample ? fmt(h.sample.tps, 0) : "—"} />
            <Readout k="tx/slot" v={h.sample ? fmt(h.sample.txPerSlot, 0) : "—"} />
            <Readout k="fee p90" v={h.sample ? `${fmt(h.sample.feeP90, 0)} µL` : "—"} />
            <Readout
              k="slots/s"
              v={h.sample ? h.sample.slotsPerSec.toFixed(2) : "—"}
            />
            <Readout k="poll lag" v={h.sample ? `${Math.round(h.sample.lagMs)}ms` : "—"} />
          </div>

          <div className="bands">
            {BANDS.map((band) => (
              <div key={band.id} className={`band ${h.mutes[band.id] ? "muted" : ""}`}>
                <div>
                  <strong>{band.label}</strong>
                  <em>{band.hint}</em>
                  <BandValue id={band.id} params={h.params} />
                </div>
                <button type="button" onClick={() => h.toggleMute(band.id)}>
                  {h.mutes[band.id] ? "muted" : "mute"}
                </button>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="transport">
        <div className="scrub-head">
          <span>history</span>
          <span>{live ? "live" : `replay −${scrubAge}s`}</span>
        </div>
        <input
          className="scrub"
          type="range"
          min={0}
          max={1000}
          value={live ? 1000 : Math.round((h.scrubFrac ?? 1) * 1000)}
          disabled={!h.armed || h.history.length < 2}
          onChange={(e) => {
            const frac = Number(e.target.value) / 1000;
            h.scrubTo(frac >= 0.995 ? null : frac);
          }}
        />
        <div className="scrub-legend">
          <span>−{Math.round(spanMs / 1000) || 50}s</span>
          <button type="button" className="texty" onClick={() => h.scrubTo(null)} disabled={live}>
            jump live
          </button>
        </div>
      </section>

      <section className="export-row">
        <button
          type="button"
          className="export"
          onClick={() => void h.exportClip()}
          disabled={!h.armed || h.exporting || h.history.length === 0}
        >
          {h.exporting ? "rendering 10s…" : "export 10s .wav"}
        </button>
        {h.exportErr && <p className="err">{h.exportErr}</p>}
        <p className="rpc">
          rpc {h.rpcHost} · set <code>VITE_RPC_URL</code> if the public one gets snippy
        </p>
      </section>
    </div>
  );
}

function Readout({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span>{k}</span>
      <strong>{v}</strong>
    </div>
  );
}

function BandValue({
  id,
  params,
}: {
  id: BandId;
  params: ReturnType<typeof useHearslot>["params"];
}) {
  if (!params) return <small>—</small>;
  if (id === "fee") return <small>{Math.round(params.feeHz)} Hz</small>;
  if (id === "cu") return <small>{Math.round(params.cuCutoffHz)} Hz cut</small>;
  return <small>{params.pulseHz.toFixed(1)} Hz pulse</small>;
}
