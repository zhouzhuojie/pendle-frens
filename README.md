<p align="center">
  <img src="assets/brand/banner.svg" alt="Pendle Frens" width="520">
</p>

# Pendle Frens

[![CI](https://github.com/zhouzhuojie/pendle-frens/actions/workflows/ci.yml/badge.svg)](https://github.com/zhouzhuojie/pendle-frens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A read-only Chrome side panel for finding **risk-adjusted fixed-yield PT opportunities** on
[Pendle](https://app.pendle.finance), and for pricing what an entry, exit or roll-over *actually* costs
at your size.

No wallet, no signing, no telemetry, no background polling. It reads two public APIs, does the math
locally, and deep-links you to Pendle when you want to act.

> **Not affiliated with Pendle.** This is a research tool, not financial advice.

## Install

> **Chrome Web Store: coming soon.** The listing is being prepared for submission. Until it is
> approved, the link below is a **placeholder and is not live** — build from source in the meantime,
> which takes about a minute.

```
https://chromewebstore.google.com/detail/pendle-frens/coming-soon   ← placeholder, not live yet
```

### From source

```bash
git clone https://github.com/zhouzhuojie/pendle-frens.git
cd pendle-frens
npm install && npm run build
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the `dist/`
folder. Click the toolbar icon to open the side panel. Requires Chrome 120+.

## What each tab does

| Tab | Answers |
| --- | --- |
| **Discover** | Which PTs are worth a look — ranked by a score you can audit, with a stated reason for every market that is hidden |
| **Simulate** | Entry, exit and roll-over quoted together, plus a maturity plan and a value-over-time chart |
| **Favorites** | A shortlist with the rate drift since you starred it |
| **Method** | Every weight, threshold and formula, in plain language |
| **Settings** | Thresholds, chains, benchmark override, cache controls |

## The score

Every market leads with a score out of 100 and a verdict. All six factors — what each scored, how much
of the total it carried, and the measurement behind it — are on the card, and **Method** explains the
whole thing.

| Factor | Weight | Question it answers |
| --- | --- | --- |
| Spread vs benchmark | 28% | How much more than a risk-free Treasury of similar duration? |
| Exit liquidity | 22% | Could I sell early without moving the price against me? |
| Protocol track record | 22% | Who is on the other side of this yield, and for how long? |
| Maturity fit | 10% | Does the lock-up match a sensible holding period? |
| Collateral quality | 10% | What does the PT actually redeem into? |
| Yield stability | 8% | Is this a durable level, or a spike I am buying the top of? |

If a factor cannot be computed it is dropped and the remaining weights are re-normalised, so the 0–100
scale stays honest. The weights, bands and verdict rules are exported constants, and the Method page is
generated from those same constants — `tests/score.test.ts` fails if the prose stops matching the code.

Protocol track record comes from a curated registry in
[`src/lib/domain/registry.ts`](src/lib/domain/registry.ts): a maintainer opinion, PR-editable, in
`A / B / C / unlisted` tiers. An unlisted protocol is penalised, flagged, hidden by default, and
described as **a gap in the list, not a verdict**. See
[DESIGN.md](docs/DESIGN.md#the-registry-is-an-opinion-on-purpose).

## Cost forensics

Every quote carries a **Route, fees and price impact** block built from the quote's own transaction
calldata rather than from assumptions: the venues, each leg's impact, the router method and address,
any bundled limit-order fills, the approvals the transaction will need, and gas as
`units × gwei × live native price`.

Pendle charges its AMM fee on the *implied rate* it moves, and that rate is annualised, so:

```
fee ≈ Σ over AMM legs  feeRate × notional × daysToMaturity / 365
```

`feeRate × notional` on its own overstates the fee by roughly 5× on a 72-day market, and longer-dated
paper costs more to trade at the same size. A PT→PT roll has **two** AMM legs — `swapExactPtForToken`
on the source, then `swapExactTokenForPt` on the destination — which is why a roll costs more than an
entry of the same size. The formula was verified against the live API across eight markets
(`feeRate` 9.8–40.9 bps, maturities 23–170 days) to within 0.4%.

**The panel shows the SDK's number and its own derivation side by side, plus the difference.** A tool
that shows only its own arithmetic can hide a mistake; a tool that shows both cannot.

## The maturity plan

A PT position has a second decision after entry, so the simulator prices it up front — redeem at par,
roll into the successor at maturity, or roll over today:

```
reUSD · 72 days · $50,000 in
  Redeem at par and stop             cost   $1 · ends $51,055 ·  72d · net $1,055 · 10.75%
  Roll into the successor at maturity cost  $56 · ends $52,867 · 221d · net $2,867 ·  9.50%
  Roll over today instead            cost $181 · ends $51,286 ·  79d · net $1,286 · 11.90%
```

Holding to maturity has **no exit cost**: one PT redeems for one accounting unit through the SY
redeemer, which is a protocol action, not an AMM swap — so there is no swap fee and no price impact,
only gas. A maturity roll is therefore priced as a *fresh entry* into the successor sized at the
expected redemption proceeds, not as a round trip. Each row says whether its cost is **quoted** or
**modelled**, and rows end on different dates, so annualised net APY is shown next to absolute profit.

## Discover never hides anything silently

Screened-out markets are summarised as a count with reasons, with a one-click **Show all**:

```
Hiding 20 markets: 13 protocol not in registry · 4 below your liquidity bar
                 ·  2 too close to maturity   · 1 below your spread bar
```

*Show all* ignores your quality bars but never your explicit choices — chain, collateral type and
search text still apply. `src/lib/domain/screen.ts` returns exactly one attributable reason per hidden
market, so the UI can print a truthful histogram instead of dropping rows. Any filter that can remove a
row must be able to say why.

## Privacy & permissions

| Permission | Why |
| --- | --- |
| `storage` | favorites, settings and cached market data — all local |
| `sidePanel` | the extension's entire UI surface |
| `host_permissions` | exactly two hosts: `api-v2.pendle.finance` and `api.fiscaldata.treasury.gov` |

No `alarms`, no `notifications`, no `tabs`, no `<all_urls>`, no content scripts, no analytics, no remote
code, and no wallet access. The service worker exists only to register the side-panel behaviour at
install — 27 lines, no network, no state, no timer. Because nothing runs in the background, a user who
never opens the panel spends **zero** API units. `tests/manifest.test.ts` asserts all of this, so the
permission list cannot creep in unnoticed.

## Develop

```bash
npm run dev         # rebuild dist on save; click ⟳ in chrome://extensions to reload
npm test            # offline unit + jsdom render tests — no network
npm run typecheck
PF_LIVE=1 npm test  # opt-in: hits the real APIs and spends computing units
npm run brand       # regenerate the icons, header mark and banner
```

`PF_LIVE=1` is bash syntax — on Windows use Git Bash, or `$env:PF_LIVE=1; npm test` in PowerShell.

The live suite proves the data path against real markets and drives the real panel data client against
both APIs with a mocked `chrome` surface, including that a cache hit does not rewrite storage and that
the panel never messages a worker. Worth running before a release.

## Layout

```
src/lib/api/        Pendle + U.S. Treasury clients, raw→domain normalizers, and client.ts
                    (fetch + TTL cache + single-flight — the only thing the panel calls)
src/lib/domain/     pure logic: types, chains, registry, score, screen, history, simulate, route
src/lib/storage/    chrome.storage access layer
src/background/     the MV3 service worker: side-panel registration, nothing else
src/panel/          panel controller, components, and one file per view
scripts/            brand generator — no image dependency
tests/              offline unit + jsdom render tests, plus opt-in live tests
```

[docs/DESIGN.md](docs/DESIGN.md) covers how it works and why the odd-looking parts are deliberate.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the two changes people actually make.

## License

MIT — see [LICENSE](LICENSE). The brand artwork in `assets/brand/` is covered by the same licence.
