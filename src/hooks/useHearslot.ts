import { useCallback, useMemo, useRef, useState } from "react";
import { HearslotEngine } from "../audio/engine";
import { renderHistoryWav } from "../audio/exportClip";
import { sampleToParams } from "../audio/mapping";
import { TimeRing } from "../buffer/ring";
import { ChainPoller, DEFAULT_RPC } from "../solana/poller";
import type { AudioParams, BandId, ChainSample, MuteState, PollHealth } from "../types";

const HISTORY_MS = 50_000;

export function useHearslot() {
  const engineRef = useRef<HearslotEngine | null>(null);
  const pollerRef = useRef<ChainPoller | null>(null);
  const ringRef = useRef(new TimeRing<ChainSample>(HISTORY_MS));

  const [armed, setArmed] = useState(false);
  const [health, setHealth] = useState<PollHealth>("idle");
  const [note, setNote] = useState("click Arm to hear the chain");
  const [sample, setSample] = useState<ChainSample | null>(null);
  const [params, setParams] = useState<AudioParams | null>(null);
  const [history, setHistory] = useState<ChainSample[]>([]);
  const [mutes, setMutes] = useState<MuteState>({ fee: false, cu: false, timing: false });
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const mutesRef = useRef(mutes);
  mutesRef.current = mutes;
  const scrubRef = useRef(scrubFrac);
  scrubRef.current = scrubFrac;

  const applyLive = useCallback((next: ChainSample) => {
    const mapped = sampleToParams(next);
    setSample(next);
    if (scrubRef.current === null) {
      setParams(mapped);
      engineRef.current?.applyParams(mapped);
      if (next.slotDelta > 0) {
        engineRef.current?.tick(next.slotDelta, mapped.tickGain);
      }
    }
  }, []);

  const arm = useCallback(async () => {
    if (engineRef.current) {
      await engineRef.current.resume();
      return;
    }
    const engine = new HearslotEngine();
    engineRef.current = engine;
    setAnalyser(engine.analyser);
    await engine.resume();
    engine.setMutes(mutesRef.current);

    const poller = new ChainPoller(DEFAULT_RPC, {
      onSample: (next) => {
        const snap = ringRef.current.push(next);
        setHistory(snap);
        applyLive(next);
      },
      onHealth: (h, text) => {
        setHealth(h);
        setNote(text);
      },
    });
    pollerRef.current = poller;
    poller.start();
    setArmed(true);
    setNote("listening…");
  }, [applyLive]);

  const disarm = useCallback(() => {
    pollerRef.current?.stop();
    pollerRef.current = null;
    engineRef.current?.dispose();
    engineRef.current = null;
    setAnalyser(null);
    ringRef.current = new TimeRing<ChainSample>(HISTORY_MS);
    setArmed(false);
    setHealth("idle");
    setNote("click Arm to hear the chain");
    setSample(null);
    setParams(null);
    setHistory([]);
    setScrubFrac(null);
    setExportErr(null);
  }, []);

  const toggleArm = useCallback(() => {
    if (armed) disarm();
    else void arm();
  }, [arm, armed, disarm]);

  const toggleMute = useCallback((band: BandId) => {
    setMutes((prev) => {
      const next = { ...prev, [band]: !prev[band] };
      engineRef.current?.setMutes(next);
      return next;
    });
  }, []);

  const scrubTo = useCallback((fraction: number | null) => {
    setScrubFrac(fraction);
    if (fraction === null) {
      const latest = ringRef.current.snapshot().at(-1);
      if (latest) {
        const mapped = sampleToParams(latest);
        setSample(latest);
        setParams(mapped);
        engineRef.current?.applyParams(mapped, 0.04);
      }
      return;
    }
    const picked = ringRef.current.atFraction(fraction);
    if (!picked) return;
    const mapped = sampleToParams(picked);
    setSample(picked);
    setParams(mapped);
    engineRef.current?.applyParams(mapped, 0.03);
  }, []);

  const exportClip = useCallback(async () => {
    const rows = ringRef.current.snapshot();
    setExportErr(null);
    setExporting(true);
    try {
      await renderHistoryWav(rows, mutesRef.current, rows.at(-1)?.slot);
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, []);

  const rpcHost = useMemo(() => {
    try {
      return new URL(DEFAULT_RPC).host;
    } catch {
      return DEFAULT_RPC;
    }
  }, []);

  return {
    armed,
    health,
    note,
    sample,
    params,
    history,
    mutes,
    scrubFrac,
    exporting,
    exportErr,
    rpcHost,
    analyser,
    toggleArm,
    toggleMute,
    scrubTo,
    exportClip,
  };
}
