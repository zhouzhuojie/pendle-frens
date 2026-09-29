<p align="center">
  <img src="assets/brand/banner.svg" alt="Pendle Frens" width="560">
</p>

# Pendle Frens

**A read-only Chrome side panel for finding risk-adjusted fixed-yield PT opportunities on
[Pendle](https://app.pendle.finance), and for pricing what an entry, exit or roll-over actually costs
at your size.**

It does not connect a wallet, does not sign anything, and does not send your data anywhere. It reads
two public APIs, does the math locally, and deep-links you to Pendle when you want to act.

It runs entirely in the browser's **side panel**, so it stays open while you browse.

```
Discover  →  ranked by a transparent score, with the reason behind every number
Simulate  →  entry, exit and roll-over quoted together, charted and compared
Favorites →  track the markets you care about and see the rate drift
Method    →  every scoring threshold in plain language, generated from the code
Settings  →  thresholds, chains, benchmark override, cache controls
```

**Discover never hides anything silently.** Screened-out markets are summarised as a count with
reasons — `Hiding 20 markets: 13 protocol not in registry · 4 below your liquidity bar · 2 too close to
maturity · 1 below your spread bar` — with a one-click **Show all**. "Show all" ignores your quality
bars but still respects explicit choices like chain, collateral type and search text.

---

## Install (2 minutes, no build tools)

```bash
npm install
npm run build      # outputs ./dist
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose the
`dist/` folder. Click the toolbar icon to open the side panel (or use Chrome's side-panel picker).

## Develop

```bash
npm run dev        # vite build --watch (rebuilds dist on save; click ⟳ in chrome://extensions)
npm test           # offline tests, no network
npm run typecheck
PF_LIVE=1 npm test # opt-in live tests against the real APIs (spends API units)
```

The live suite (`tests/live.test.ts`, `tests/e2e.client.live.test.ts`) is worth running before a release:
the first proves the data path still works against real markets, the second drives the real side-panel
data client against both APIs with a mocked `chrome` surface — including that a cache hit does not even
rewrite storage, and that the panel never messages a worker.

## What "safe" means here

There is no safe PT. There are only **priced risks**, and a tool that refuses to hide them.

Every market card leads with a **score out of 100 and a verdict**, and every one of the six factors
behind it is shown — what it scored, how much of the total it carried, the actual measurement, and the
question it answers. Open **Method** (or the link in any market) for the full explainer: thresholds,
formulas, why each weight is what it is, and what each factor genuinely cannot see.

| Factor | Weight | What it answers |
| --- | --- | --- |
| Spread vs benchmark | 28% | How much more than a risk-free Treasury of similar duration? |
| Exit liquidity | 22% | Could I sell early without moving the price against me? |
| Protocol track record | 22% | Who is on the other side of this yield, and for how long? |
| Maturity fit | 10% | Does the lock-up match a sensible holding period? |
| Collateral quality | 10% | What does the PT actually redeem into? |
| Yield stability | 8% | Is this rate a durable level or a spike I am buying the top of? |

The weights, bands and verdict rules are exported constants in one file, and the Method page is built
from those same constants — so the documentation cannot drift from the behaviour. If a factor cannot be
computed, it is dropped and the remaining weights are re-normalized, keeping the 0–100 scale honest.

The protocol track record comes from a curated registry in
[`src/lib/domain/registry.ts`](src/lib/domain/registry.ts) — a maintainer opinion, PR-editable, with
`A / B / C / unknown` tiers. **Unknown protocols are never silently trusted**: they score low, are
flagged, and can be hidden entirely in Settings.

Pendle's own curated risk notes (what the asset is, what can go wrong, which protocols it touches,
whether an audit link exists) are surfaced verbatim on every market detail view.

## What the simulator actually computes

One click quotes **all three scenarios sequentially** (~15–20 computing units) instead of hiding them
behind tabs, because the useful question is not "what does entry cost" but "which of these three is the
better move from here". Every number comes from Pendle's hosted SDK quote engine, so it matches what the
app would build. Live example on a real $50k:

```
Buy PT and hold to maturity:      11.32% · ends $51,055 · profit $1,055 · cost $56  (11.3 bps) · 72d
Exit today:                      realised · ends $49,945 · profit  −$55 · cost $64  (12.9 bps) ·  0d
Roll to another PT and hold:      14.15% · ends $51,345 · profit $1,345 · cost $178 (35.6 bps) · 79d
```

You get:

- **Scenario cards** — annualised rate, end value, profit and cost for each path. Different paths end on
  different dates, so the UI tells you to compare the APY rather than the absolute profit.
- **A value trajectory chart** — fair value over time for the position you hold now, and for the
  position you would hold after rolling, against reference lines for your cost basis and today's exit
  value. The path is the market's own pricing identity (`par / (1 + impliedApy)^years remaining`), not a
  forecast, and the UI says so.
- **A cost comparison** — fee, price impact and estimated gas per move, in dollars and basis points.
- **Per-scenario detail** — PT quantities, effective APY, break-even days, roll-over drag, and how much
  your own order moved the implied APY.
- **A roll-over size sweep** (on demand) — how your size drags the destination rate, which is the
  direct answer to "roll-over day eats the yield".
- **An assumptions disclosure** — size, slippage cap, gas price, which stablecoin, how the destination
  was picked, and the fact that quotes are built for a burn address and never signed.

## What happens when it matures

A PT position has a second decision after entry, so the simulator prices it up front:

```
reUSD · 72 days · $50,000 in
  Redeem at par and stop              cost@maturity  $1 · ends $51,055 ·  72d · net $1,055 · 10.75%
  Roll into <destination> at maturity cost@maturity $56 · ends $52,867 · 221d · net $2,867 ·  9.5%
  Roll over today instead             cost@maturity $181 · ends $51,286 ·  79d · net $1,286 · 11.9%
```

The correction this encodes: **holding to maturity has no exit cost.** One PT redeems for one
accounting unit through the SY redeemer — a protocol action, not an AMM swap — so there is no swap fee
and no price impact, only gas. Rolling *at* maturity is therefore a fresh entry into the successor, not
a round trip, and it is priced that way (sized at your expected redemption proceeds, bought with the
accounting asset).

Each row states whether its cost is **quoted** or **modelled**, and different rows end on different
dates, so the table shows the annualised net APY alongside the absolute profit.

The roll-over destination defaults to the **same asset with the next expiry** (`findSuccessorMarket`),
and you can point it at any market — the maturity option re-prices to follow your choice.

## Where the fee and the price impact come from

Every quote has a **Route, fees and price impact** block built from the quote's own transaction
calldata, not from assumptions:

```
Entry — swapExactTokenForPt → 0x8888…f946            [aggregator in path]
  1  KYBERSWAP (external DEX)   USDC → SY-reUSD      50,000 USDC → 45,287.59 SY      -1.85 bps
  2  Pendle AMM                 SY-reUSD → PT-reUSD  45,287.59 SY → 51,057.86 PT     -2.28 bps

  Price impact — total            -4.13 bps = -$20.64
    internal — Pendle AMM curve   -2.28 bps = -$11.40
    external — aggregator / DEX   -1.85 bps = -$9.25
  Swap fee — reported by the SDK  $20.07 (4.01 bps of notional)
  Swap fee — derived              $20.10  = 20.49 bps × $50,000 × 71.6/365
  Difference                      -$0.03 — the reconstruction explains the fee
  Gas — estimated                 $14.79 · 1,091,129 units × 5 gwei
```

**The fee formula**, verified against the live API across eight markets (`feeRate` 9.8–40.9 bps,
maturities 23–170 days), matching the SDK's own number to within 0.4%:

```
fee ≈ Σ over AMM legs  feeRate × notional × daysToMaturity / 365
```

Pendle charges its AMM fee on the *implied rate* it moves, and that rate is annualised — so
`feeRate × notional` on its own overstates the fee by roughly 5× on a 72-day market, and longer-dated
markets cost more to trade at the same size. A **PT→PT roll has two AMM legs**, which is why its fee is
the sum of the source and destination legs, and why a roll costs more than an entry of the same size.

The panel also names the exact router (`swapExactTokenForPt` / `swapExactPtForToken` on Pendle's
router), the aggregator and its router address, how many Pendle **limit-order fills** were bundled into
the route (those skip the AMM fee, which is why the reconstruction is shown next to the reported number
rather than instead of it), and the ERC-20 approvals the transaction will need.

Everything is derived and cross-checked rather than asserted: if the reconstruction stops matching the
SDK's number, the UI says so instead of hiding it.

### Honesty rules baked into the code

- Costs are **already reflected** in the PT amount the quote returns; the breakdown is explanatory,
  not additive.
- Gas is an **estimate** (gas units × your gwei × the live native-token price).
- Slippage tolerance is a **cap**, not a promise.
- A roll-over sensitivity curve is a **scenario based on current liquidity**, never a forecast.
- The Treasury benchmark is the **average rate on outstanding Treasury Notes** — official and
  keyless, but it lags the live curve. The UI says so, and you can override it.

### Why a market might not be listed

Discover hides markets by default, so "I know this PT exists — where is it?" is a question the tool has to
answer rather than shrug at. Every hidden market gets exactly one attributable reason, and the count of
each is shown above the list (`Hidden: 19 below your liquidity bar · 13 protocol not in registry · …`),
with **Show all** revealing everything that failed only a *quality bar* — never your chain, asset-class or
search choices.

The one that surprises people is `protocol not in registry`. A market whose issuing protocol is not in the
curated list scores 15/100 on the protocol factor and is hidden by default, and **that is a gap in the
list, not a verdict on the protocol**. The detail view states the tier, what the tier means, the
maintainer's note and the protocol's website; the Method page lists every registered protocol by tier. If
yours is missing, one PR adds it.

### The registry is an opinion, on purpose

`src/lib/domain/registry.ts` holds ~36 protocols in three tiers:

| Tier | Means | Scores |
| --- | --- | --- |
| **A** | Blue chip: multi-year live contracts, multiple independent audits, large TVL, no unresolved critical incidents | 100 |
| **B** | Established but younger or smaller, or carrying a known design tradeoff | 70 |
| **C** | New, experimental, or a thin track record | 35 |
| *unlisted* | Nobody has curated it yet — not a judgement | 15 |

Yes, it is hardcoded. That is the design: a tier is a *judgement*, so it is written down where you can read
it, argue with it and change it by pull request — rather than laundered through a model that would make an
opinion look like a measurement. Every entry carries the reasoning that produced it, and the UI renders it.

**Could this be automated?** Partly, and the honest answer is: not the tier. There is no API that outputs a
trustworthy "is this protocol legit" score. What exists:

- **DefiLlama** (`api.llama.fi`) — factual and free: TVL, category, chain list, protocol age (`listedAt`),
  a count of audits, and exploit history (`hacks`). Its audit *count* is user-submitted and unreliable —
  it reports **0 audits for Apyx**, which has three (Zellic, Certora, Quantstamp) — so it can inform
  curation, not replace it.
- **Human assessments, not APIs** — Yearn's risk-score repo, TID Research, LlamaRisk, DeFi Sentinel,
  Bluechip, Credora (gated), DeFi Safety. Excellent, all manual.
- **Token-level scanners** — GoPlus, CertiK Skynet, De.Fi. These check a token contract for honeypots,
  mint authority and transfer taxes. They say nothing about whether a protocol pays you back.

There is also a concrete reason to keep the mapping curated rather than fuzzy-matched: DefiLlama's
**Resupply** (audits: 2, plus a $9.6M June 2025 exploit) is *not* the same protocol as **re.xyz**, which
Pendle actually lists — yet a symbol-based auto-match would have attached another team's hack to it.

Finally, adding `api.llama.fi` would mean a third host permission in the manifest. Two is the promise; the
registry costs nothing to query.

### Audit links come from the registry, not from Pendle

Pendle's `marketInfo.auditedUrl` is **empty for every market we inspected** — all 586 across Ethereum and
Arbitrum. So the old "No audit link published" chip appeared on literally every card and read as *this
protocol is unaudited*, which was wrong: Aave, Morpho, Curve, re.xyz and Apyx all publish audit pages.

The fix is a per-protocol `auditUrl` in the registry, resolved in one place:

1. Pendle's own link, if it ever publishes one — labelled as this market's;
2. otherwise the protocol's page, labelled **"the protocol's own audit page — not an audit of this market"**;
3. otherwise, and only then, "No audit link on file", worded to say that is a gap in our links rather than
   evidence that no audit exists.

Only hand-verified URLs go in. A wrong link is worse than no link, so uncovered protocols deliberately
keep the honest flag until someone sources the page.

## How Favorites work

Favorites are a **saved list with rate drift** — not a portfolio, not an alert system, and not a
watch list in the sense of "something will tell me". Nothing is monitored; the tab is just a shortlist
that re-prices itself from the snapshot you already have.

1. **Starring** a market (☆ on a card, or Favorite on the detail view) writes one record to
   `chrome.storage.local`: the market id, protocol, expiry, the fixed APY **at that moment**, and the
   benchmark at that moment. No wallet address, no size, no position.
2. The **Favorites tab** re-joins those records with the live snapshot and shows: fixed APY now vs when
   added, the spread now vs the spread when you starred it, rate drift, maturity and liquidity. If a
   market leaves the active snapshot it says so instead of rendering zeros.

There is deliberately **no badge on the toolbar icon.** One was built and then removed: a count is not a
notification, it said nothing the Favorites tab did not already say, and it put a number in the browser
chrome that could only ever be stale. The star is a bookmark.

What it deliberately does **not** do: track your actual holdings, send notifications, or monitor
anything while the panel is closed. Those need either a wallet connection or a background scheduler,
both of which were rejected on purpose (see [docs/PRODUCT.md](docs/PRODUCT.md)).

## Privacy & permissions

| Permission | Why |
| --- | --- |
| `storage` | favorites, settings and cached market data, all local |
| `sidePanel` | the extension's entire UI surface |
| `host_permissions` | exactly two hosts: `api-v2.pendle.finance` and `api.fiscaldata.treasury.gov` |

No `alarms` and no `notifications` — there is no background scheduler, so the extension never wakes up
or spends an API unit while you are not looking. The service worker exists only to register the
side-panel behaviour at install; it makes no network requests, keeps no state and has no timer. No
`tabs`, no `<all_urls>`, no `content_scripts`, no analytics, no remote code (MV3-compliant bundled JS
only), no wallet access, no transaction signing. `chrome.tabs.create` for deep-links needs no
permission. `tests/manifest.test.ts` asserts all of this so the permission list cannot creep silently.

## API budget

Pendle rate-limits by "computing units" (200/min, 200k/week as of writing). A full market refresh is
~10 units, a history fetch is 5, each quote is 5–7. The extension caches markets for 5 minutes, history
for 30, the benchmark for 6 hours, and only sweeps sizes when you ask. The panel uses the cache on
open; the ⟳ button forces a refresh. Because nothing runs in the background, a user who never opens
the panel spends **zero** units.

The one place a unit can be spent twice: two panels in two windows opened *simultaneously* on a cold
cache will each fetch markets, because there is no cross-context transaction to elect a leader. In
exchange the extension no longer serialises the whole snapshot through a message port. Opening the
second window a minute later costs nothing — it reads the persisted snapshot.

Pendle's `isActive` filter still returns expired markets — at the time of writing they were **92% of
the payload** and 80% of the cached snapshot size, while never being actionable. They are dropped when
the snapshot is built, and the count is surfaced in the status bar (`47 active markets · 539 expired
excluded`) rather than hidden.

## Layout

```
src/lib/api/        Pendle + U.S. Treasury clients, raw→domain normalizers, and client.ts
                    (fetch + TTL cache + single-flight — what the panel calls)
src/lib/domain/     types, chains, registry, scoring, history stats, simulation math
src/lib/storage/    chrome.storage access layer (settings, favorites, caches)
src/lib/util/       decimal (BigInt-safe), stats, async (mapLimit/retry/SingleFlight)
src/background/     MV3 service worker: registers the side-panel behaviour. Nothing else
src/panel/          panel controller, components, and one file per view
assets/brand/       the supplied artwork, and the banner generated from it
scripts/            brand generator (icons + mark + banner), no image dependency
tests/              offline unit + DOM render tests, plus opt-in live integration tests
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning, and
[docs/PRODUCT.md](docs/PRODUCT.md) for the product decisions, trade-offs and open questions.

## Contributing

The highest-value contribution is a registry or scoring-rule change, and both are deliberately small
and testable. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. Not affiliated with Pendle. Nothing here is financial advice.
