# Product grilling — Pendle Frens

The brief asked to be grilled on product features. This is that grilling, done honestly and written
down so it can be argued with later. Every section ends with **what shipped**, which is the decision
that is actually in the code today.

---

## 0. The premise

> "Chrome extension that helps navigate the best opportunities on Pendle."

**Challenge: why an extension at all?** Pendle's own UI already lists markets, sorts by fixed APY and
shows an execution preview. A thin wrapper adds nothing.

**What an extension can uniquely do:**

1. Live in the browser you already have open, with **one click**, no tab switch — and in the
   **side panel** it stays visible while you read a protocol's docs or a governance forum.
2. Hold **durable state** — a favorites, thresholds, a benchmark — across sessions and across the web.
3. ~~Show a **badge** so the signal reaches you without opening anything.~~ Built, then removed — see
   §20. It turned out that a count is not a notification.
4. Be **forked and modified** by anyone in an afternoon (unlike a hosted dashboard).

**What it cannot do:** beat Pendle at execution. So Pendle Frens does not try. It is a **decision-support
and cost-analysis layer** that hands you to Pendle when you're ready.

**Shipped:** read-only research tool. No wallet connection, no transaction signing, no private keys.
Deep-links into `app.pendle.finance/trade/markets/{addr}/swap?chain=…&view=pt`.

---

## 1. "Find the safe and secure PT yield" — can a model deliver that?

**No.** "Safe" is not a property a scoring function can output. Any single opaque safety score is
either a false comfort or a black box with a lawsuit attached.

**What is honest instead:** expose the *ingredients* of risk and show the arithmetic. A user who
disagrees with the weights can see exactly which factor drove the result, and a fork can re-weight
everything in one file.

**Shipped:** a 0–100 composite that is a weighted sum of six named factors, each rendered with its
value, weight and a human-readable reason. Weights are re-normalized and disclosed when a factor is
unavailable (e.g. no history yet). The verdict chip carries the exact rule it cleared as a tooltip.

---

## 2. Where does "strong team" come from? It isn't in any API.

**Brutal answer:** team quality is not machine-verifiable, and pretending otherwise is how tools
launder bad decisions.

**Options considered:**

- Scrape GitHub/Twitter/funding announcements → brittle, unverifiable, and easy to game.
- Use TVL as a proxy → TVL is a *consequence* of trust, and it is reflexive.
- Curate a registry and let the community PR it.

**Shipped:** a small curated registry (`A / B / C / unknown`) with optional notes and website links,
plus Pendle's own `utilizedProtocols` and `auditedUrl` fields where present. Missing audit link is an
explicit flag (`no-audit-link`), not a silent pass. **Unknown = penalised and flagged**, never
defaulted to safe.

**Open:** should the registry live in a JSON file (easier for non-devs) or stay in TypeScript (typed,
testable)? Currently TypeScript, with tests. A JSON + schema is a reasonable v2.

---

## 3. The user wants "above the market rate vs US long-term treasury". Which benchmark?

**Challenge:** the 10-year Treasury yield is the intuitive benchmark, but it needs a keyed provider
(FRED) or scraping. The official keyless Fiscal Data API exposes the **average interest rate on
outstanding Treasury Notes** — real, stable, no key, no CORS.

**The catch:** it lags the live curve (it is a blended coupon of everything outstanding). Quoting it
as "the risk-free rate" would be subtly dishonest.

**Shipped:** Treasury Notes average is the default, clearly labelled with its as-of date and
definition, plus a manual override in Settings for anyone who tracks the 10-year themselves. The
fallback value is labelled `fallback — verify before acting`, never presented as live.

**Open:** add Bills (short end) and Bonds (long end) as selectable benchmarks — the data is already
fetched. Deferred to keep the first version small.

---

## 4. "Simulate the exact cost" — is the API number exact?

**No.** `fee.usd` and `priceImpact` are the SDK's own estimates. They exclude:

- gas (we estimate it),
- token approval gas,
- the gap between quoted slippage and realised fill,
- quote staleness between fetch and signature.

**Shipped:** each component is separated and labelled by confidence. The UI states that costs are
already baked into the quoted PT amount. Slippage is described as a cap. A quote timestamp is shown.

**Deliberately not shipped:** a fake "total cost" single number with no breakdown.

---

## 5. Round-trip vs hold-to-maturity — is the exit simulation even meaningful?

**Sharp edge:** PT redeems 1:1 at maturity, so a hold-to-maturity investor never pays the exit leg.
Optimising for round-trip cost can make the tool steer people into worse decisions.

**Shipped:** entry shows **value at maturity** and **profit at maturity** as the primary economics,
with break-even days explicitly labelled "entry cost only; excludes exit leg". Exit is a separate
mode for people who intend to leave early, and its numbers are never mixed into the entry verdict.

---

## 6. The roll-over-day problem — can future roll cost be predicted?

**It cannot.** Roll-day liquidity depends on who else is rolling, when, and at what size. Anyone
claiming to forecast it is guessing.

**What *can* be measured now:** the *current* cost and the *current* impact of your own size.

**Shipped:** a live quote for the roll, split into headline APY vs effective APY (the difference is
the drag), plus an on-demand size sweep (0.25× → 5×) that shows the drag growing with size. The
sweep is explicitly framed as a scenario from current liquidity, not a forecast.

**Honest gap discovered during live testing:** Pendle's `roll-over-pt` quote returns `effectiveApy`
but **not** `impliedApy.before/after`. Rather than fabricate an after-rate, the drag is derived from
the two numbers the API *does* return. The code comments say so.

---

## 7. Data freshness vs API budget

**Constraint:** 200 computing units/minute. A naive "refresh everything on open" burns budget fast
and earns a 429.

**Shipped:** tiered caching (markets 5 min, history 30 min, benchmark 6 h, native price 10 min),
single-flight de-duplication, a persisted snapshot so the panel paints instantly, cache-on-open with
force only on the ⟳ button, sequential (not parallel) size sweeps, bounded history cache (12 markets),
and **no background polling at all** — a user who never opens the panel spends zero units.

---

## 8. History: Pendle caps it, so what is the "track history" feature really worth?

**Discovery:** `timeFrame` is ignored by the historical endpoint; it returns ~1440 hourly points
(about 2 months) regardless. Cost is 5 units.

**Consequence:** "track history" cannot mean "since inception". Two months is enough to judge
*stability* (σ, coverage above benchmark, drift) but not to judge a full credit cycle.

**Shipped:** a 2-month hourly sparkline plus mean / min / max / σ / % above benchmark / trend per day,
with the window limitation stated in the UI. History contributes only 8% of the score and is fetched
lazily for one market at a time.

---

## 9. Scope: what did I refuse to build?

| Not built | Why |
| --- | --- |
| Wallet connect / portfolio scan | Needs balances, RPC or an indexer, plus signing — a different risk class and a much bigger permission surface. Breaks "clean and minimal". |
| Notifications / alerts | Requires more permissions, a background lifecycle, and a defensible notification policy. Rejected outright — see the next row. |
| Background polling (`alarms`) | **Removed after review.** Its only consumer was one toolbar badge integer, and it cost ~13 computing units every 15 minutes (~8.7k/week) plus a service-worker wakeup every 15 minutes, forever, whether or not anyone was looking. The badge is now event-driven (recomputed when the favorites changes or a snapshot is served) and the permission is gone. Trade-off accepted: the badge reads "as of the last refresh" instead of being live. |
| Content script that injects into app.pendle.finance | Meaningful only once there is an execution feature; adds permissions and review friction for nothing today. |
| Auto-rolling strategies | The riskiest possible feature to ship to strangers. |
| Points/airdrop APY in the headline | Speculative value scored as if it were yield. Kept out of the score entirely. |
| Multi-provider abstraction for other yield protocols | YAGNI until the Pendle path is proven. The provider seam exists (one module + one normalizer). |

---

## 10. Generalising for OSS — what makes this actually forkable?

1. **No personal state in the repo.** Thresholds live in `chrome.storage`, defaults in one file.
2. **The opinionated part is small and isolated.** `registry.ts` (tiers) and the weight table in
   `score.ts` are the only places a maintainer's judgement lives — both tiny, both tested.
3. **The provider seam.** Raw API shapes are confined to `api/normalize.ts`; a breaking API rename
   touches one file. A different data source would implement `fetchMarkets`/`fetchHistory`/`convert`.
4. **Tests for the logic, an opt-in test for the network.** 70 offline tests cover the maths; one
   `PF_LIVE=1` test proves the integration still works and doubles as executable documentation of the
   real response shapes.
5. **No telemetry, minimal permissions, no remote code.** Fork-friendly and store-friendly.
6. **The reasoning is written down** (this file, plus `ARCHITECTURE.md`), so a future maintainer can
   tell a deliberate decision from an accident.

---

## 11. Open questions for the owner (unresolved on purpose)

1. **Should `safe` be reachable at all right now?** With today's listings, almost nothing clears the
   tier-A + stable + ≥$5M + ≥60d + ≥1pp bar, so the top of the list is `balanced`. That is arguably
   correct and honest — but it may read as "broken" to a first-time user. Options: loosen the bar,
   rename the tiers (`Conservative / Standard / Speculative`), or add a "closest to safe" section.
2. **Is `Treasury Notes` the right default benchmark, or should the 10-year yield be worth a keyed
   provider?**
3. **Should the registry be JSON + schema instead of TypeScript** so non-developers can PR it?
4. **How much should points/airdrop programs be surfaced** (displayed but never scored)? Currently
   they are not shown at all.
5. **Should roll-over sensitivity default to 5 quotes (≈30 units)** or stay click-to-run? Currently
   click-to-run.
6. **Multi-chain default.** Only Ethereum is enabled by default today; Arbitrum is available. Is
   breadth worth the extra refresh cost for the first user?

---

## 12. Defects found in the field (and fixed)

These are recorded because the fixes encode product opinions that a future maintainer will otherwise
mistake for arbitrary code.

**A. Silent filtering (the worst one).** The first real user asked "why isn't USDai in the list?" The
market was in the data — `$50.4M` of liquidity, `10.08%` fixed, Arbitrum — but three compounding
causes hid it with **zero explanation**:

1. it is `USD.AI`/`USD.ai` in the API and was missing from the registry, so `hideUnknownProtocols`
   removed it;
2. it matures in 16 days, under the old 30-day maturity default;
3. the UI said nothing while dropping 578 of 586 rows.

Fixes: screening was extracted into a pure, tested module (`domain/screen.ts`) that returns one
attributable reason per hidden market; Discover now prints the reason histogram with a **Show all**
toggle; `USD.AI` was added to the registry (tier B, with the LlamaRisk objection in its note); and the
maturity default dropped to 14 days, since the score's maturity factor already penalises short paper
and a hard filter was doing the hiding.

**Lesson recorded:** any filter that can remove a row must be able to say why. "It just doesn't show"
is a bug, even when the underlying rule is deliberate.

**B. Registry completeness is a correctness surface.** The registry is not decoration: an unlisted
protocol is *invisible by default*. That makes "add a protocol" a behaviour-changing PR, which is why
`CONTRIBUTING.md` asks for evidence and for aliases (the API spells the same protocol `USD.AI` and
`USD.ai`).

**C. 92% of the payload was dead weight.** Pendle's `isActive` filter still returns expired markets:
539 of 586 rows, and 1.25 MB of a 1.54 MB cached snapshot. They are now dropped at the snapshot
boundary with the count surfaced in the status bar, cutting the cache to ~0.29 MB. The favorites
already handled a market vanishing from the snapshot, so nothing was lost.

**D. A set of assumptions the live tests caught before any user did:**

- `roll-over-pt` quotes return `effectiveApy` but **not** `impliedApy` before/after, so the roll-over
  drag has to be derived from the two fields the API does return (§6);
- the historical endpoint ignores `timeFrame` and always returns ~1440 hourly points (§8);
- the Treasury benchmark must come from a keyless source, and its definition matters (§3);
- a stable market's *accounting* asset is the peg that matters, not the underlying — yield-bearing
  wrappers legitimately trade above $1, so flagging upward drift would mark every sUSDe market as
  broken.

## 13. Later changes: making the score legible and the simulation one screen

Three requests, all of which turned out to have a design answer rather than a styling answer.

**"Make the risk score more obvious."** It was a chip reading `90/100` with a thin bar — informative
and easy to ignore. It is now a large number with the verdict spelled out in the verdict's own colour,
and the same block appears on Discover cards, the market detail and the favorites. The score is the
product's opinion, so it should be the first thing you see and the easiest thing to argue with.

**"Simulate enter / exit / roll-over together with good defaults."** They were behind three tabs, which
framed the question as "what does entry cost?" when the real question is "which of these three moves is
better from here?". Now one click quotes all three sequentially (~15–20 units instead of ~5) and the
panel renders:

- a scenario table where every path is expressed as an **annualised rate as well as absolute profit**,
  because the paths end on different dates and comparing profits across them would be misleading;
- a **value trajectory chart**: fair value over time for the position held now and for the position
  after rolling, against reference lines for cost basis and today's exit value. The curve is the PT
  pricing identity (`par / (1 + impliedApy)^years remaining`) — the market's own relationship, not a
  forecast, which is why the caption says so;
- a cost comparison in dollars and basis points, and an explicit **assumptions disclosure** (size,
  slippage cap, gas price, which stablecoin, how the destination was chosen, and that nothing is
  signed).

Sequencing matters: entry runs first because the exit and roll quotes reuse the PT amount it returns, so
all three numbers describe the *same position* rather than three unrelated sizes.

**"Explain each dimension so people trust it."** A new **Method** view explains all six factors: the
question each answers, how the 0–100 sub-score is computed, why it carries that weight, and what it
*cannot* see. The important design choice: the page is **generated from the scoring constants**, and
`tests/score.test.ts` fails if the prose stops matching the thresholds or if the scorer emits a flag
that has no explanation. Documentation that can silently go stale is worse than none.

A side effect worth noting: writing the explainer exposed two undocumented assumptions — that a stable
market's *accounting* asset is the peg that matters (not the underlying, since yield-bearing wrappers
legitimately trade above $1), and that the stability factor measures only ~2 months because that is all
the API returns.

## 14. Cost forensics: the maturity decision and the fee identity

Two requests, one theme: stop asking for trust.

**"At entry time, what is the cost — and at maturity, what will exit or a roll to the same PT with a
longer expiry cost?"** The simulator already quoted entry/exit/roll, but a PT position has a second
decision after entry, and it was invisible. It is now a **maturity plan** priced at entry time:

- **Redeem at par and stop** — modelled, gas only.
- **Roll at maturity into the successor** — quoted, as a *fresh entry* sized at the expected redemption
  proceeds.
- **Roll over today instead** — quoted, for comparison.

**The correction that mattered:** holding to maturity has **no exit cost**. One PT redeems for one
accounting unit through the SY redeemer — a protocol action, not an AMM swap — so there is no swap fee
and no price impact. A "maturity roll" is therefore a fresh entry, not a round trip, and modelling it
as a round trip would have overstated the cost of the most common path by the entire exit leg.

Each row is labelled **quoted** or **modelled**, and because the rows end on different dates the table
shows annualised net APY next to absolute profit (comparing absolute profits across different horizons
would be misleading). The destination defaults to `findSuccessorMarket` — same underlying, next expiry,
preferring liquid candidates — and the maturity option re-prices when you point it elsewhere.

**"Be precise about how you got the swap fee and price impact, and show the exact route."** This one
required reverse-engineering, and the result is a formula rather than a hand-wave:

```
fee ≈ Σ over AMM legs  feeRate × notional × daysToMaturity / 365
```

Discovered by measuring: the fee was a flat 4.01 bps of notional at $5k, $50k and $500k, while the
market's `feeRate` is 20.49 bps. The ratio to `feeRate` turned out to equal `daysToMaturity/365`
(0.196 for a 72-day market). Pendle charges its AMM fee on the *implied rate* it moves, and that rate is
annualised — so `feeRate × notional` overstates the fee by ~5x here, and longer-dated paper costs more
to trade at the same size.

Two confirmations, both from the API rather than from documentation:

- across eight markets (`feeRate` 9.8–40.9 bps, maturities 23–170 days) the reconstruction matched the
  SDK's reported fee to within 0.4%;
- a `roll-over-pt` quote's fee matched the *sum* of the source and destination legs (predicted $25.44 vs
  reported $25.28), because a roll is composed of `swapExactPtForToken` on the source market followed by
  `swapExactTokenForPt` on the destination — the two 4-byte selectors are visible in the composed
  calldata, and were verified against simple entry and exit quotes.

The panel now shows the legs (venue, amounts, per-leg impact), the price impact split into
`internalPriceImpact` (Pendle AMM curve) and `externalPriceImpact` (the aggregator leg) with USD values,
the router method and address, the aggregator and its router, bundled **limit-order fills** (which skip
the AMM fee and are the main reason a reconstruction can drift), required ERC-20 approvals, and gas as
units × gwei × native price.

**Design rule that fell out of this:** report the SDK's number *and* the derivation next to each other,
plus the difference. If the two stop agreeing, the UI says so. A tool that shows only its own arithmetic
can hide a mistake; a tool that shows both cannot.

## 15. Later change: the score bar was duplication

Each Discover card drew a horizontal bar whose width was `score.score / 100`, coloured by verdict,
underneath a large `90 /100` that said the same thing. Asked what it meant, the honest answer was
"it repeats the number above it" — so it is gone, along with its component and CSS. The card now shows
the score once, as the big colour-coded figure, and gives the space to the flags instead.

The general rule this is another instance of: **a visual element has to carry information the text
already on screen does not.** A bar that encodes the same integer twice is decoration, and decoration
in a risk tool is a liability — it invites people to read a graphic that adds nothing.

`tests/panel.render.test.ts` now asserts one score block per card and no `scorebar`, so it cannot
creep back in by accident.

## 16. Debugging a missing market: a registry gap that looked like a bug

"Why isn't the apxUSD PT there?" took four steps to answer, and two of them were real defects.

**1. Not the data path.** apxUSD markets exist on chains 1, 56 and 8453. Two of the Ethereum matches are
genuinely expired (the `27AUG` and `18JUN` vintages), the BNB and Base ones are on chains outside the
default enabled set, and the fetch/normalize path carried the live `5NOV2026` markets through with no
loss. Running the *actual* scoring and screening pipeline over live data printed the reason directly:

```
APYX  apxUSD  15.34%  $2,771,289   37d  score 63 degen   -> hidden: unknown-protocol
APYX  apyUSD  15.66%  $19,796,468  37d  score 70 degen   -> hidden: unknown-protocol
```

**2. The cause.** `APYX` (Apyx) was simply not in the curated registry, and `hideUnknownProtocols` is on
by default. The apxUSD market passed every other bar — $2.77M liquidity against a $1M floor, 15.34%
implied, 37 days out, not off-peg, not an automatic avoid. One unlisted protocol name was the whole
story.

**3. The real bug underneath.** Researching Apyx to assign a tier exposed something worse than the
missing entry: `ProtocolEntry.note` was **never rendered anywhere in the app**. The registry — the module
whose own header says it "exists so that the extension can explain itself" — could hide a market and show
a `young-protocol` chip, while the maintainer's reasoning sat unread in the source. Curated objections,
including the LlamaRisk one already written for USD.AI, were invisible. That is the exact failure the
screen module was built to prevent, one layer down.

Fixed: the detail view now renders the tier, what the tier *means*, the maintainer's note and the
protocol's website, and `TIER_DOCS` is exported so the tier meanings live in one place. The Method page
lists every registered protocol by tier, generated from `PROTOCOL_REGISTRY`. A test asserts both, and
another asserts that every tier has a description — a letter in a chip must never be unexplained again.

**4. What the research found.** Apyx was added at **tier C**, and the note is deliberately blunt, because
the facts are: apxUSD has traded below par continuously since June 2026 (a low of ~$0.75, and $0.881 on
1 August, −11.9%); Apyx's "2.0" model prices redemptions off protocol-computed *redemption value*, so
**$1 is explicitly not a floor**; minting is permissioned and the apyUSD exit can take up to 20 days;
Accountable's proof-of-solvency feed showed ~92% asset-reserve coverage against circulating supply; only
~16–19% of reserves are verifiable onchain; the cash buffer's custodian is unnamed; and Certora's M-01
flagged the backing model as entirely trust-based with no onchain verification. It is audited (Zellic,
Certora, Quantstamp) and attested monthly by Wolf & Company — but the attestations cover assets, not
liabilities or collateral coverage.

Tier C is the honest ceiling for that: the markets are now visible, capped below `balanced` by the verdict
rules, and flagged `young-protocol`, `no-audit-link` and `has-risk-notes`. The tool's job is to show that
and let the rate speak, not to make the call for you.

**A related judgement left open.** apxUSD prints at $0.9881 — 1.19% below par, inside the 2% threshold
that raises the off-peg flag, so the tool shows *no* peg warning on an asset whose peg broke in June and
has not recovered. That is consistent, and consistency in thresholds is worth more than a special case.
But it is worth asking whether a redemption-value model — where the issuer itself may pay below par —
should be measured against a tighter peg bar than a naive $1 stablecoin. That is a product decision, not
a bug, so it is recorded here rather than silently applied.

**Still hidden, for the same reason.** 11 other markets pass every quality bar and are hidden only because
their protocol is not registered: Tori (`strUSD` $7.2M, `trUSD` $2.6M), 3Jane (`USD3` $7.0M, `sUSD3`
$1.1M), USDD (`sUSDD` $5.1M), Strata (`srUSDe` $4.2M), Midas (`mAPOLLO` $2.9M), Saturn (`USDat`,
`sUSDat`), f(x) Protocol (`fxSAVE`), xStocks (`STRCx`). Registering each is a judgement that needs its own
research, so none were added blind.

## 17. Design tokens, and a card that stopped repeating itself

Three complaints in one: filters without labels, cards that were hard to read, and "some info is
redundant, like the tiny words 'risk-adjusted'."

**The CSS had drifted.** Fifteen distinct font sizes (9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14,
15, 20, 27, 36) and gaps of 1, 2, 3, 4, 5, 6, 7, 8, 10 and 12px. Values half a pixel apart are not design
decisions, they are accidents. There are now:

- eight type steps (`--fs-2xs` … `--fs-3xl`), three weights, two line heights;
- a 2px-based space scale (`--sp-1` … `--sp-10`) used by every gap, padding and margin;
- radius tokens, and a `--tap` minimum pointer target;
- `font-variant-numeric: tabular-nums` on the body, so figures line up column to column instead of
  shifting with digit width.

57 `font-size`, 63 `gap` and 22 `padding` declarations were snapped to the scale; the only raw values left
are zero. Snapping `5px` to `4px` and `3px` to `2px` is a visual change for the better: consistent rhythm
reads as intentional, and near-miss spacing reads as sloppy.

**Every filter is now labelled.** Sort, chain, collateral and minimum spread had no visible label — only a
placeholder or a `title` tooltip, which is invisible on touch and to anyone not hovering. They are wrapped
in `.field` with a `.field-label`, matching the `.stat-label` style, and a new results line says exactly
what you are looking at (`Showing 2 of 3 markets`) instead of leaving it to be inferred.

**The cards were repeating themselves.** Each one carried:

| Removed | Why |
| --- | --- |
| `risk-adjusted` under every score | The score *is* risk-adjusted; the Method page explains it properly, once |
| `locked at entry` under every APY | True of every fixed-rate coupon in existence |
| the benchmark under every spread | The same constant on every card, now stated once above the list |
| `TVL …` under liquidity | A second number that invites comparing apples to oranges; it belongs on detail |
| the maturity date under `72d` | Same fact twice; the date is on the detail view |

That is twelve text fragments per card reduced to four values and a label each, with the card grid changed
from `auto-fit` (which produced three-plus-one rows that read as a mistake) to two even columns, four when
the panel is wide enough. The global explanation — what the score weighs, what the benchmark is, that it is
editable — is stated once, above the list.

The general rule, consistent with §15: **anything identical on every row is not information, it is noise.**

## 18. Tier criteria, and the audit link that lied

"What criteria did you use, are you just hardcoding it, and what about new protocols?" — and "the 'no audit
link' is not true, reUSD has audits."

The second complaint was a real bug. `marketInfo.auditedUrl` is **empty for all 586 markets** we scanned
across Ethereum and Arbitrum: the field exists in Pendle's schema and is never populated. So the
`no-audit-link` flag fired on **100% of markets**, and its text — "Pendle publishes no audit or review link
for this market" — read to a user as *this protocol is unaudited*. It appeared on Aave. It appeared on
Curve. It was on the reUSD card, whose protocol publishes a dedicated audits page listing Sherlock,
Certora and Hacken engagements.

A flag that fires on everything carries no information, and this one actively misinformed. Two fixes:

- **`auditUrl` per registry entry**, resolved in one place (`auditLink`): Pendle's link if it exists, else
the protocol's page labelled as *the protocol's* audit and explicitly not an audit of this Pendle market,
else — only then — a flag reworded to say that this is a gap in *our links*, not evidence that no audit
exists. Five were verified by hand in this pass (Aave, Morpho, Curve, re.xyz, Apyx); the rest deliberately
keep the honest flag rather than a guessed URL, because a wrong link is worse than a missing one.
- **A test that the flag cannot come back.** `tests/score.test.ts` asserts an Aave market carries no
  `no-audit-link`, that an unlisted protocol with no link does, and that the documented text says "gap in
  our links" rather than implying the protocol is unaudited.

On the tier questions, the answers are: the criteria are stated in the registry header and exported as
`TIER_DOCS`; **yes, it is a hardcoded list, deliberately**, because a tier is a judgement and this file is
where judgement is supposed to live; a new Pendle protocol arrives as `unknown`, scores 15/100, is counted
in the "protocol not in registry" line, is revealable with Show all, and appears in the Method page's list
of what is *not* covered — so the gap is visible rather than silent.

On automation, see the README's registry section: no API produces a trustworthy legitimacy score. DefiLlama
is the closest (free, factual: TVL, `listedAt`, `hacks`, an audit count that is wrong often enough to matter
— it says Apyx has 0 audits and Apyx has 3), everything else is manual research, and a fuzzy match would
have mapped DefiLlama's *Resupply* — with its $9.6M June 2025 exploit — onto the unrelated *re.xyz*.

## 19. The service worker was doing a job it did not need

"Do we really need a service worker? Can we just cache with a TTL and invalidate on refresh?"

The caching half was already true — that is exactly what the extension did, with a 5-minute markets TTL,
a 30-minute history TTL and a ⟳ button that forces a refresh. The interesting half was the worker, and
the answer turned out to be: **it was not needed for the network, and it cannot be removed entirely.**

The assumption being tested was written into `src/lib/rpc.ts`: "All network I/O goes through the
background so that host_permissions apply consistently (including the Treasury API, which sends no CORS
headers)." Both halves of that sentence were wrong. Chrome's documentation is explicit that cross-origin
access is granted to "an extension service worker **or foreground tab**" holding `host_permissions`, and
that "cross-origin requests are always treated as such in **content scripts**" — the same page lists
"your offscreen document, side panel or popup" as the contexts that fetch. This extension has no content
scripts, so nothing needed the indirection. And the Treasury API very much does send a CORS header
(`Access-Control-Allow-Origin: *`); Pendle echoes the caller's origin, so it would work even without
`host_permissions`.

What the message-passing hop cost: a typed RPC protocol whose only peer was a process Chrome may kill at
any moment; a second structured-clone of the ~0.3 MB snapshot on every refresh; and a failure mode where
an idle worker answers nothing. Deleted: `src/lib/rpc.ts`, the routing switch, the `sendMessage` path,
and the 10 kB `background.js` chunk that went with it.

What the worker actually provided is now covered by the layer below. Every cache already lived in
`chrome.storage.local`, which is shared by all contexts:

| Was | Is |
| --- | --- |
| the worker finished a fetch after the panel closed | the panel refetches next time. Nothing was watching, so that work was wasted |
| one in-flight markets request shared by two windows' panels | the second panel reads the fresh persisted snapshot; only two *simultaneous* cold opens duplicate |
| one writer to `chrome.storage` | single-flight serialises callers within a context; a cross-window race on the native-price map is possible and harmless, because it is a cache |

But the worker stays, because the platform requires one for two things nothing else can do:

1. `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` — only settable from the worker, and
   only meaningful if it runs at install/startup. Remove the worker and the toolbar button stops opening
   the panel, with no way for the user to fix it;
2. the toolbar badge.

So the worker was ~45 lines, touched no network, and owned no timer. The badge moved into
`src/lib/badge.ts` so either context could compute it, and the worker listened for changes to
`pf.snapshot.v1` as well as the favorites key — so a panel in one window kept the badge current in every
window, with no RPC call at all.

*(The badge did not survive the same session — see §20. §19 is left as written because the reasoning it
records is about the RPC layer, which did survive.)*

The general lesson, and the reason this is recorded rather than just shipped: an architectural rule that
has never been tested against the platform is a guess. This one had a confident comment explaining a
constraint that did not exist, and it had survived several reviews because it sounded careful.

Guarded by the rewritten `tests/e2e.client.live.test.ts`, which drives the real data client against both
live APIs and asserts that a cache hit does not even rewrite storage, and that the panel never calls
`chrome.runtime.sendMessage` — the mock throws if it does.

## 20. The badge was not a notification, and "Watch" was the wrong word

Two corrections, both about saying what a thing actually is.

**The toolbar badge is gone.** It showed a count of favorited markets currently paying above the
benchmark. The brief in §0 listed a badge as one of the four things an extension can uniquely do — "so
the signal reaches you without opening anything" — and that rationale does not survive contact with what
the badge actually was: a **count**. A notification says *something happened*. A count says *here is a
number*, sitting permanently in browser chrome, going stale the moment the snapshot expires, competing
for attention with every other extension's badge. The Favorites tab already says the same thing, with
the spread, the drift and the maturity next to it, and it is only on screen when you asked for it.

Removing it deleted the last piece of the worker that did anything at all. `src/lib/badge.ts` is gone,
the `storage.onChanged` listener is gone, and `src/background/service-worker.ts` is now **27 lines whose
only job is to call `sidePanel.setPanelBehavior` at install** so the toolbar button opens the panel. It
touches no network, keeps no state and owns no timer.

This also tidies up the previous section honestly: §19 noted that moving the badge out of the worker
made it strictly better, because a panel in one window could refresh the badge in all of them. True, and
now moot. §19 is left as written because its actual subject — the RPC layer — did survive.

**"Watch" is now "Favorites".** The old name implied the thing people expect a watch list to be: a
monitor that will tell them when something changes. It never did. There is no notification, no
threshold, no background check — it is a shortlist that re-prices itself from the snapshot you already
fetched, which is exactly what a **favorite** is and exactly what a watchful "watch list" is not.
Naming it Watch set an expectation the design deliberately refuses to meet (see §9 on why there is no
`alarms`), and the badge existed partly to paper over that gap.

Renamed end to end: `FavoriteItem` in the type layer, `getFavorites` / `addFavorite` / `removeFavorite`
in storage, `state.favorites` in the app, `toggleFavorite` / `isFavorite`, `views/favorites.ts`, the
`view-favorites` styles, and the tab label. One cosmetic casualty worth recording: a naive
`watch` → `favorite` replacement would also have hit `chart-swatch` (the little coloured line in the
chart legend), which is why the rename was done on identifiers rather than on the substring.

**The storage key moved, and that is a data-loss risk.** `pf.watchlist.v1` became `pf.favorites.v1`, and
a rename that orphans a persisted list loses a user's data silently — the worst kind of bug, because it
looks like it worked. `getFavorites()` now adopts the legacy key once and deletes it, and the new
`tests/store.test.ts` covers that path specifically, along with the case where both keys exist (the new
one wins, the old one is left untouched rather than destroyed) and the empty-legacy case. The shim is
four lines and clearly marked as removable once the extension leaves 0.x.

The pattern in both halves is the one that produced §15 and §17: **a name or a UI element that promises
something the system does not do is a defect**, even when nothing is technically broken. A badge implies
notification. "Watch" implies watching. Neither was true, and both were cheap to fix once stated
plainly.

## 21. The simulation page was a wall

The complaint: "I like the data intense and be able to see all the numbers, but it does seem
overwhelming." That is a precise diagnosis, and it is not a request to remove numbers.

After a run, the page rendered **fourteen blocks**: the scenario grid, the maturity plan, the route
forensics, the trajectory chart, a cost bar chart, three per-move detail panels (each an eight-cell stat
grid plus a cost table), a size-sensitivity table, and an assumptions disclosure. Four of them carried an
`<h3>` at the same visual weight, so nothing led. Two `hint` paragraphs followed the scenario grid, and
**six** followed the maturity table. The same cost figures appeared in the grid rows, the bar chart, the
maturity plan and three cost tables.

The fix is structure, not deletion. The page now reads:

| | |
| --- | --- |
| **Open** | the setup, then **Three ways to play** (one LEDE sentence, three cards), **What happens when it matures** (one line plus a table), and **Value of the position over time** (the chart) |
| **One click away** | *Assumptions behind these quotes*, *How these options are calculated*, *Full cost breakdown*, *Where the fee and the price impact come from*, *Roll-over size sensitivity* |

Five `<details>` disclosures, one shared `disclosure()` primitive, and everything that was there before
is still there — the route legs, the fee derivation, the per-leg impact split, the three cost tables, the
size sweep. Nothing was deleted to make room; it was *sorted*.

Three decisions made that possible:

1. **A collapsed block must say what is inside it.** Every disclosure carries a value on its summary
   row — `$55.90 – $183.40 all in`, `11.2 bps to enter`, `0.25×–5×`. Collapsing must never mean hiding a
   number behind a click with no visible reason to click. That is the same rule as §15 and §17 applied to
   progressive disclosure.
2. **Answer first, derivation second.** The route forensics — the deepest, most technical block — used to
   sit *above* the chart, interrupting the flow of the page. It is now the fourth drawer.
3. **One opening sentence.** A `lede` above the scenario cards names the highest annualised net rate and
   its total cost: *"Buy PT and hold to maturity has the highest annualised net rate at 11.32%, for $55.90
   in total costs."* That is arithmetic on the three quotes directly below it, not a recommendation and
   not a new number — but it saves a reader from having to diff three cards to find the headline.

Two duplications were removed rather than relocated, because the disclosure *was* the duplication:
the cost bar chart moved inside *Full cost breakdown* (the cards already show each cost), and the six
paragraphs around the maturity table were cut to one line plus a footnote drawer. The per-scenario
`note` prose stays, because each card explaining itself is exactly what a first-time reader needs.

A test asserts the structure, not just the presence of text: the five disclosure titles, that all five
are **collapsed by default**, that the route forensics and the cost bars are inside a disclosure, that
the scenario grid, the maturity table and the chart are *not*, and that each scenario card carries one
answer rather than a paragraph.

## 22. Roadmap candidates (in rough value order)

1. Balances-aware portfolio view (opt-in, read-only RPC) — biggest jump in usefulness.
2. Favorite alerts on spread crossing a threshold. This would need `chrome.alarms` + `chrome.notifications`
   back, so it is only worth doing if the user explicitly wants monitoring — not as a default.
3. Benchmark selector (Bills / Notes / Bonds) now that the data is already fetched.
4. "Closest to safe" explainer panel on Discover, driven by the flags.
5. A JSON protocol registry with a schema and CI validation.
6. Post-expiry roll planner: given a holding, rank destination markets by *net* effective APY after
   the estimated roll drag.
