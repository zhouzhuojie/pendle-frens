# Design

How Pendle Frens works and why the odd-looking parts are deliberate. Product rules first:

1. **Never invent a number.** If the API does not return it, say "unavailable" or derive it in a
   documented, tested way.
2. **Label estimates as estimates.** Modelled gas is not a quoted price impact.
3. **Never hide data silently.** Any filter that can remove a row must say why.
4. **Show the SDK's number and our derivation side by side**, plus the difference.
5. **A UI element must carry information the text does not** — otherwise it is decoration.

## Shape and layers

```
panel (src/panel) ─► api/client.ts   fetch · TTL cache · single-flight
                     api/pendle.ts · api/treasury.ts   the fetch calls
                     api/normalize.ts   raw provider payloads → domain types
                     domain/*   pure, unit tested
background worker: 27 lines; only sidePanel.setPanelBehavior at install
```

`domain/*` is `types · chains · score · screen · protocol · decision · rewards · book · looping ·
simulate · route · successor`.

| Layer | May import | Must not |
| --- | --- | --- |
| `domain/*` | `util/*`, each other | `chrome`, `fetch`, DOM |
| `api/*` | `domain/types`, `util/*` | `chrome`, DOM |
| `storage/*` | `domain/types` | DOM |
| `panel/*` | `domain`, `storage`, `dom`, `api/client` | `api/pendle` / `api/treasury` directly — that bypasses cache policy |

`api/` and `domain/` never import `chrome`, so they run under plain Node in tests.

## Decisions

**The panel fetches; the worker does not.** Chrome grants cross-origin access to a foreground extension
page holding `host_permissions`, not only to the worker; there are no content scripts, and both APIs are
CORS-friendly. Routing through the worker only added an RPC layer, a second clone of the ~0.3 MB snapshot
on each refresh, and a "worker was killed" failure mode. The worker stays solely because
`sidePanel.setPanelBehavior` has to run from it at install.

**No registry: protocol depth is measured, not judged.** A curated tier list is a *gate* — an unlisted
protocol disappears however real it is — and it conflated "not reviewed" with "low quality". The
`protocol` factor blends snapshot facts: TVL 50%, active markets 20%, chains 10%, Pendle's Prime flag
20%, squeezed into 0.15–0.60 so size can never present itself as certainty. Consequences: no `Tier`, no
"unknown" state, **no audit-link feature** (Pendle publishes none), and grouping by Pendle's own
`protocol` string (normalised), never fuzzy symbols. The app makes **no protocol-level judgement** and
never calls a protocol safe.

**Screening never hides a row silently.** `domain/screen.ts` returns exactly one attributable reason per
hidden market; Discover prints the histogram with **Show all**, which bypasses quality bars but never
explicit choices (chain, collateral, search).

**The detail page answers the decision, not the dataset.** `domain/decision.ts` turns the snapshot +
score into a headline, a worked payout, an entry-cost estimate, a liquidity read, and two lists — *why it
could work* / *what to watch*. Metrics that do not drive a decision (TVL, volume, underlying/YT APY, the
raw fee rate, floating PT, history noise) move behind *Market data & contracts*. A metric with no decision
meaning never sits in the headline grid.

**The live-data panels say who each number belongs to.** These endpoints are all on the API host the app
already calls, so they add no permission and no dependency:

| Signal | Endpoint |
| --- | --- |
| Yield provenance, rewards & points | `/v2/markets/all` (already fetched) |
| Limit orders | `/v2/limit-orders/book/{chain}` |
| Leverage / looping | `/v1/pt-looping/loop/pts/{chain}/{pt}/looping` |
| Long-range history | `/v3/{chain}/markets/{addr}/historical-data?time_frame=day` |
| Live rate | `/v1/sdk/{chain}/markets/{addr}/swapping-prices` |

Three rules: **rewards state who receives them** (LP/YT groups and PENDLE emissions are not the PT
holder's); **the order book is rate-only** (the payload's sizes are on undocumented scales, so no dollar
depth is invented); **looping is Pendle's estimate**, re-stating its own identity
(`fixed × L − borrow × (L−1)`) with liquidation risk and Pendle's risk panel beside it. Daily history is
**not** fed to the stability factor — the score is calibrated on the recent hourly regime.

## The fee identity

`route.ts` reads the quote's own calldata to name the venues, split impact into internal/external, and
reconstruct the swap fee:

```
fee ≈ Σ over AMM legs  feeRate × notional × daysToMaturity / 365
```

Found by measurement: the fee was a flat 4.01 bps of notional at $5k/$50k/$500k, while `feeRate` is
20.49 bps — the ratio is `daysToMaturity/365`, i.e. Pendle charges on the annualised implied rate it
moves. So `feeRate × notional` overstates the fee ~5×. Verified against the API on eight markets
(9.8–40.9 bps, 23–170 days) to within 0.4%, and a `roll-over-pt` fee matched the sum of its two legs.
Bundled limit-order fills skip the AMM fee, which is why the UI shows both numbers.

## The maturity plan

`buildMaturityPlan()` prices the decision after entry: **redeem** (modelled, gas only),
**roll-at-maturity** (quoted, as a fresh entry sized at the redemption proceeds) and **roll-now**
(quoted). Holding to maturity has **no exit cost** — PT redeems at par through the SY redeemer, a protocol
action, not an AMM swap — so a maturity roll is not a round trip. Rows are labelled **quoted** or
**modelled**, and annualised net APY sits next to absolute profit because rows end on different dates.

## Caching

| Data | TTL | Where |
| --- | --- | --- |
| markets | 5 min | memory + `chrome.storage` |
| history | 30 min | `chrome.storage` (12 most recent) |
| benchmark | 6 h | `chrome.storage` |
| native token price | 10 min | `chrome.storage` |
| detail extras (book, looping, long history, live) | 1–30 min | memory |
| convert quotes | never | — (a quote is point-in-time; staleness is shown) |

`SingleFlight` de-duplicates and holds the in-memory TTL; `mapLimit(…, 3, …)` bounds chain concurrency.
**No scheduler:** no `alarms`, no polling — fetching starts when a human opens the panel or presses ⟳.
Pendle's `isActive` still returns expired markets, so they are dropped at the snapshot boundary with the
count surfaced rather than hidden.

## UI rules

`panel.css` is token-first (`--fs-*`, `--sp-*`, `--radius-*`, colours redefined for dark mode). The scale
is deliberate — pick the nearer step rather than inventing a new one. Four content rules:

- Anything identical on every row belongs above the list.
- Never draw a graphic that repeats a number already on screen.
- More than ~4 things worth reading → a lead plus `disclosure()` blocks, and every summary **carries a
  value** so collapsing never hides a number.
- Every control needs a visible label (a test fails on an unlabelled `<select>`/`<input>`).

Flat, single-purpose class names; no decorative borders, gradients, or colour without meaning. Brand
assets are generated (`npm run brand`), not hand-drawn.

## Docs that cannot drift

The **Method** view is generated from the same exported constants the scorer uses. `tests/score.test.ts`
asserts every factor has a doc block, the weights sum to 1, the prose quotes the real thresholds, and
every flag has an explanation. Changing a threshold without its explanation fails CI.

## Security model

MV3; `storage` + `sidePanel` and exactly two `host_permissions`. No remote code or `eval`; no wallet APIs
or signing (quotes go to a burn address). All persisted data is local.

## Error behaviour

`withRetry` backs off on 429/5xx but not 4xx. Partial data is fine — the v2 risk fetch may fail without
losing prices or liquidity. Gaps say "no usable history" / "not in the active snapshot" rather than
rendering a zero. Quote failures surface the API message verbatim.

## Extending

- Different chain → `CHAINS` in `domain/chains.ts` (the API layer is chain-agnostic).
- Different provider → implement `fetchMarkets` / `fetchHistory` / `convert`.
- Different scoring opinion → `SCORE_WEIGHTS` + `decideVerdict` in `domain/score.ts`.
- Different depth opinion → `PROTOCOL_DEPTH` in `domain/protocol.ts`.

Each is one file with tests next to it.

## Open questions

Recorded rather than silently decided:

1. **Should `safe` be reachable?** Few markets clear stable + ≥$5M + ≥60d + ≥1pp, so the top reads
   `balanced`. Loosen the bar, or rename the verdicts?
2. **Is the peg bar right for redemption-value assets?** Yield wrappers legitimately trade above $1, but a
   protocol that can redeem below par arguably needs a tighter bar.
3. **Benchmark choice.** The Treasury-Notes average is official and keyless but lags the live curve;
   should a keyed 10-year be an option?
4. **Can protocol depth be measured better than by size?** TVL and market count are lagging, gameable
   proxies.
5. **How much should points/airdrop programs be surfaced?** Shown as context, never scored as yield.
6. **Multi-chain default.** Only Ethereum is on by default; is Arbitrum's breadth worth the refresh cost?
