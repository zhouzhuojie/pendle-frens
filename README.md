<p align="center">
  <img src="docs/brand/banner.svg" alt="Pendle Frens" width="520">
</p>

# Pendle Frens

[![CI](https://github.com/zhouzhuojie/pendle-frens/actions/workflows/ci.yml/badge.svg)](https://github.com/zhouzhuojie/pendle-frens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A read-only Chrome side panel for finding **fixed-yield PT opportunities** on
[Pendle](https://app.pendle.finance) and pricing what entry, exit or roll-over *actually* costs at your
size. No wallet, no signing, no telemetry, no background polling: it reads two public APIs, does the
math locally, and deep-links to Pendle when you want to act.

> **Not affiliated with Pendle.** A research tool, not financial advice.

## Install

Build from source — the Chrome Web Store listing is not live yet.

```bash
git clone https://github.com/zhouzhuojie/pendle-frens.git
cd pendle-frens && npm install && npm run build
```

Then chrome://extensions → **Developer mode** → **Load unpacked** → `dist/`. Click the toolbar icon to
open the side panel. Requires Chrome 120+.

## What it does

| Tab | Answers |
| --- | --- |
| **Discover** | Which PTs are worth a look — a score you can audit, and a stated reason for every hidden market |
| **Simulate** | Entry, exit and roll-over quoted together, a maturity plan, and a value-over-time chart |
| **Favorites** | A shortlist with the rate drift since you starred it |
| **Settings** | Thresholds, chains, benchmark override, cache controls, logo opt-in |

**Method** opens from any score and explains every weight, threshold and formula.

## Screenshots

| Discover | Simulate — the three paths | Simulate — cost detail |
| :---: | :---: | :---: |
| <img src="docs/screenshots/discover.png" width="260" alt="Discover: ranked market cards with a score and the hidden-market summary"> | <img src="docs/screenshots/simulate-scenarios.png" width="260" alt="Simulate: three paths compared, the maturity plan, and the value-over-time chart"> | <img src="docs/screenshots/simulate-costs.png" width="260" alt="Simulate: full cost breakdown and per-scenario detail"> |

## The score

| Factor | Weight | Question |
| --- | --- | --- |
| Spread vs benchmark | 28% | How much more than a risk-free Treasury of similar duration? |
| Exit liquidity | 22% | Could I sell early without moving the price against me? |
| Protocol depth | 22% | How substantial is the protocol you are lending to? |
| Maturity fit | 10% | Does the lock-up match a sensible holding period? |
| Collateral quality | 10% | What does the PT actually redeem into? |
| Yield stability | 8% | A durable level, or a spike I am buying the top of? |

A factor that cannot be computed is dropped and the rest re-normalised, so the 0–100 scale stays honest.
The weights, bands and verdict rules are exported constants, and the Method page is generated from them —
`tests/score.test.ts` fails if the prose drifts from the code.

**No registry, no curation.** Protocol depth is *measured* from the snapshot (TVL, active markets,
chains, Pendle's Prime flag), capped at 0.60 — size and breadth, never trust. The app makes no
protocol-level judgement anywhere and never calls a protocol "safe". See [DESIGN.md](docs/DESIGN.md).

## What else the detail page shows

Pendle publishes more than the score uses. The detail page shows it, always labelled with **who it
belongs to**:

- **Yield provenance** — the per-asset split of a market's yield;
- **Rewards & points** — programmes and PENDLE emissions (emissions go to LPs, not PT);
- **Limit orders** — resting rates and the maker incentive (rates only, never an invented dollar depth);
- **Leverage (PT looping)** — venues, max leverage, borrow rate and Pendle's own risk panel;
- **Long-range daily history**, and a **live** spot rate when it differs from the snapshot.

None of it feeds the score, so new data cannot silently change a verdict.

## Costs and the maturity plan

Pendle charges its AMM fee on the annualised implied rate it moves:

```
fee ≈ Σ over AMM legs  feeRate × notional × daysToMaturity / 365
```

`feeRate × notional` alone overstates it ~5× on a 72-day market. The panel shows the SDK's number and our
derivation **side by side**, plus the difference — a tool that shows only its own arithmetic can hide a
mistake.

Holding to maturity has **no exit cost** (PT redeems at par through the SY redeemer, not an AMM swap), so
a maturity roll is priced as a fresh entry into the successor. Every row is labelled **quoted** or
**modelled**, and annualised net APY sits next to absolute profit.

## Discover never hides anything silently

Hidden markets are a count with reasons and a one-click **Show all**:

```
Hiding 20 markets: 13 below your liquidity bar · 4 too close to maturity
                 ·  2 below your spread bar     · 1 model would avoid
```

*Show all* ignores quality bars but never your explicit choices (chain, collateral, search text).
`domain/screen.ts` returns exactly one attributable reason per hidden market.

## Privacy & permissions

| Permission | Why |
| --- | --- |
| `storage` | favorites, settings and cached data — all local |
| `sidePanel` | the extension's entire UI |
| `host_permissions` | exactly two hosts: `api-v2.pendle.finance` and `api.fiscaldata.treasury.gov` |

No alarms, notifications, tabs, `<all_urls>`, content scripts, analytics, remote code or wallet access.
The worker only registers the side panel at install, so a user who never opens it spends **zero** API
units. `tests/manifest.test.ts` locks the permission list. The only request that can leave those two
hosts is the off-by-default **Load market logos** setting (`storage.googleapis.com`); the default is a
local monogram.

## Develop

```bash
npm run dev         # rebuild dist on save
npm test            # offline unit + jsdom render tests
npm run typecheck
PF_LIVE=1 npm test  # opt-in: real APIs (spends computing units)
npm run brand       # regenerate icons, header mark, banner
```

`PF_LIVE=1` is bash syntax; on Windows use Git Bash or `$env:PF_LIVE=1; npm test`.

## Layout

```
src/lib/api/        Pendle + Treasury clients, normalizers, and client.ts (fetch + TTL cache + single-flight)
src/lib/domain/     pure logic: score, screen, protocol, decision, rewards, book, looping, simulate, route
src/lib/storage/    chrome.storage layer
src/background/     MV3 worker — side-panel registration only
src/panel/          controller, components, one file per view
scripts/            brand generator
tests/              offline unit + jsdom render tests, opt-in live tests
```

[docs/DESIGN.md](docs/DESIGN.md) covers how it works and why. [CONTRIBUTING.md](CONTRIBUTING.md) covers
setup and ground rules. Releases are in [CHANGELOG.md](CHANGELOG.md).

## Contributing & license

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies to every project space. Report vulnerabilities through
[SECURITY.md](SECURITY.md), never a public issue. MIT — see [LICENSE](LICENSE); the brand artwork in
`docs/brand/` is under the same licence.
