# Hearslot

I wired live Solana mainnet into the Web Audio API and an oscilloscope.

Click **Arm / Listen** first. Browsers will not make a peep until a gesture unlocks audio. After that it polls public RPC, maps recent fees / load / slot timing onto three voices, and draws the mix on a scope.

Live: https://robertkodes.github.io/hearslot/

This is a sound experiment, not an explorer.

## What you are hearing

- **FEE** — prioritization fees on a few busy programs (system, token, compute budget, USDC, Jupiter, Raydium). Pitch + brightness.
- **CU / LOAD** — non-vote TPS and tx/slot from `getRecentPerformanceSamples`. Amplitude + filter cutoff. Public RPC will not cheaply give a per-slot CU total, so load is the stand-in.
- **SLOT** — how fast slots are moving and how late the poll is. Pulse rate + noise grit, plus a click when the slot jumps.

A ~50s ring sits under the scrub bar. Drag left to replay the last half-minute of mapped params. Mute a band if one voice is being a pest. **export 10s .wav** renders the recent history offline.

## Run it

```bash
npm i
npm run dev
```

Open the `/hearslot/` path Vite prints (base is set for GitHub Pages).

```bash
npm run build
npm run preview
```

`npm test` covers the mapping + ring math.

## RPC

Default is the public endpoint: `https://api.mainnet-beta.solana.com`.

It rate-limits. The bench backs off and says so. If you have a free Helius / Triton / etc URL, drop it in:

```bash
cp .env.example .env
# edit VITE_RPC_URL
```

No wallets. No seeds. No trading.

## Pages

`vite.config.ts` has `base: '/hearslot/'`. The `gh-pages` branch is the built `dist/`. Repo Settings → Pages → Deploy from branch → `gh-pages` / root.
