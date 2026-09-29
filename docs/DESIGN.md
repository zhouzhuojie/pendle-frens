# Design

How Pendle Frens works, and why the parts that look odd are deliberate. If you are about to change
something here, read the relevant section first — several of these decisions were corrections, and the
reasoning is cheaper to read than to rediscover.

The product rules are short enough to state up front:

1. **Never invent a number.** If the API does not return something, say "unavailable" or derive it in a
   documented, tested way.
2. **Label estimates as estimates.** Modelled gas and quoted price impact are not the same kind of fact.
3. **Never hide data silently.** Any filter that can remove a row must be able to say why.
4. **Show the SDK's number and our derivation next to each other**, plus the difference.
5. **A UI element must carry information the text on screen does not** — otherwise it is decoration, and
   decoration in a risk tool invites people to read a graphic that means nothing.

## Shape

```
┌─────────────────────── side panel (src/panel) ─────────────────────────────┐
│ main.ts → App (app.ts)                                                      │
│   state: settings, favorites, snapshot, benchmark, scores, history, sim      │
│   views: discover · detail · simulate · favorites · method · settings        │
│   renders via src/panel/dom.ts — no framework, no innerHTML for dynamic      │
│   data (everything user-facing goes through textContent)                     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ src/lib/api/client.ts
                                │ fetch · TTL cache · single-flight
                                ▼
                    ┌──────────────────────────┐
                    │ src/lib/api/pendle.ts    │
                    │ src/lib/api/treasury.ts  │
                    │  (all the fetch calls)   │
                    └───────────┬──────────────┘
                                ▼
                      src/lib/api/normalize.ts
                  raw provider payloads → domain types
                                │
                                ▼
                  src/lib/domain/*  (pure, fully unit tested)
        types · chains · registry · score · screen · history · simulate · route

┌───────────────── background service worker (src/background) ────────────────┐
│ 27 lines, 9 of them code. One job: `setPanelBehavior` at install, so the    │
│ toolbar button opens the panel. No network, no state, no timers.            │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Layers and the rules between them

| Layer | May import | Must not |
| --- | --- | --- |
| `domain/*` | `util/*`, each other | `chrome`, `fetch`, DOM |
| `api/pendle.ts`, `api/treasury.ts`, `api/http.ts` | `domain/types`, `util/*` | `chrome`, DOM |
| `api/client.ts` | `api/*`, `storage`, `util/*` | DOM |
| `storage/*` | `domain/types` | DOM |
| `background/*` | `chrome.sidePanel` | network, storage, DOM — it configures one setting and stops |
| `panel/*` | `domain`, `storage`, `dom`, `api/client` | `api/pendle` / `api/treasury` directly — go through `client` so cache policy cannot be bypassed |
| `panel/chart.ts` | `dom` only | `domain` (charts are dumb: they take numbers, not markets) |
| `panel/views/simulate-detail.ts` | `domain`, `dom`, `components` | `api/client` (it renders numbers, it does not fetch them) |

`api/` and `domain/` never import `chrome`, so they run under plain Node in tests.

## Why the panel fetches, and the worker does not

This was the other way round until it was measured. Chrome grants cross-origin access to "an extension
service worker **or foreground tab**" holding `host_permissions`; only *content scripts* are pinned to
their page's origin, and the same documentation lists the side panel as a context that fetches. This
extension has no content scripts, and both upstream APIs are CORS-friendly anyway (Treasury sends
`Access-Control-Allow-Origin: *`, Pendle echoes the caller's origin).

So the hop through the worker bought nothing and cost an RPC protocol whose only peer was a process
Chrome may kill at any moment, a second structured-clone of the ~0.3 MB snapshot on every refresh, and a
failure mode where an idle worker answers nothing.

What the worker genuinely provided is now covered by `chrome.storage.local`, which every context shares:

| Was | Is |
| --- | --- |
| the worker finished a fetch after the panel closed | the panel refetches next time it opens. Nothing was watching, so that work was wasted |
| one in-flight request shared by two windows' panels | the second panel reads the fresh persisted snapshot. Only two *simultaneous* cold opens duplicate — one extra markets request |
| one writer to `chrome.storage` | single-flight in `api/client.ts` serialises callers within a context. `storage.local` has no compare-and-swap, so a cross-window write race on the native-price map is possible and harmless — it is a cache |

The worker stays regardless, because the platform requires one for exactly one thing:
`sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` can only be set from the worker, and must
run at install/startup or the toolbar button does nothing.

**The lesson worth keeping:** an architectural rule that has never been tested against the platform is a
guess. This one had a confident comment explaining a constraint that did not exist, and it survived
several reviews because it sounded careful.

## The registry is an opinion, on purpose

`src/lib/domain/registry.ts` holds ~36 protocols in tiers, and it is hardcoded. That is the design: a
tier is a *judgement*, so it is written down where you can read it, argue with it and change it by pull
request — rather than laundered through a model that would make an opinion look like a measurement.
Every entry carries the reasoning that produced it, and the UI renders that reasoning on the detail view.

| Tier | Means | Scores |
| --- | --- | --- |
| **A** | Blue chip: multi-year live contracts, multiple independent audits, large TVL, no unresolved critical incidents | 100 |
| **B** | Established but younger or smaller, or carrying a known design tradeoff | 70 |
| **C** | New, experimental, or a thin track record | 35 |
| *unlisted* | Nobody has curated it yet — not a judgement | 15 |

**Can this be automated?** Not the tier. There is no API that outputs a trustworthy "is this protocol
legit" score:

- **DefiLlama** (`api.llama.fi`) is the closest — free and factual (TVL, category, `listedAt`, `hacks`,
  an audit count). But that audit count is user-submitted and wrong often enough to matter: it reports
  **0 audits for Apyx**, which has three. It can inform curation; it cannot replace it.
- **Yearn's risk-score repo, TID Research, LlamaRisk, Bluechip, Credora, DeFi Safety** are human
  assessments, not APIs.
- **GoPlus, CertiK Skynet, De.Fi** are token-contract scanners. They say nothing about whether a
  protocol pays you back.

There is also a concrete reason to keep the mapping curated rather than fuzzy-matched: DefiLlama's
**Resupply** (plus a $9.6M June 2025 exploit) is *not* **re.xyz**, which Pendle actually lists — yet a
symbol-based auto-match would have attached another team's hack to it. And adding `api.llama.fi` would
mean a third `host_permissions` entry. Two is the promise.

### Audit links come from the registry, not from Pendle

Pendle's `marketInfo.auditedUrl` is **empty for all 586 markets** we scanned across Ethereum and
Arbitrum. The field exists in the schema and is never populated, so a flag based on it fired on 100% of
markets and read to users as *this protocol is unaudited*. It appeared on Aave. It appeared on Curve.

The fix is a per-protocol `auditUrl`, resolved in one place (`auditLink`):

1. Pendle's own link, if it ever publishes one — labelled as this market's;
2. otherwise the protocol's page, labelled **"the protocol's own audit page — not an audit of this
   market"**;
3. otherwise, and only then, "No audit link on file", worded to say this is a gap in *our links*, not
   evidence that no audit exists.

Only hand-verified URLs go in. A wrong link is worse than no link, so uncovered protocols deliberately
keep the honest flag until someone sources the page. `tests/score.test.ts` asserts the flag cannot
regress into implying a protocol is unaudited.

## Screening never hides a row silently

The first real user asked why a $50M market was missing. It was in the data but hidden by three
compounding causes with **zero explanation**: an unlisted protocol name, a maturity filter, and a UI
that said nothing while dropping 578 of 586 rows.

`domain/screen.ts` is now a pure, tested module returning exactly **one attributable reason** per hidden
market, and Discover prints the histogram with a **Show all** toggle. Explicit choices (chain, collateral
type, search text) are never bypassed by *Show all*; quality bars are.

Note that the registry is a correctness surface, not decoration: "protocol X is unlisted" and "protocol
X is hidden" are the same statement while `hideUnknownProtocols` is on.

## The domain math

- **`decimal.ts`** — exact `string ↔ BigInt` base-unit conversion. 18-decimal token amounts exceed
  `Number.MAX_SAFE_INTEGER`, so user input never round-trips through a float.
- **`score.ts`** — the opinionated module. `SCORE_WEIGHTS` plus `decideVerdict`, both small and both
  covered by tests. Weights are re-normalised when a factor is unavailable and the sum-to-one invariant
  is asserted. Every threshold is an exported constant, because the Method view is generated from them.
- **`screen.ts`** — which markets Discover shows, and one attributable reason for each hidden one.
- **`history.ts`** — σ, coverage above benchmark and drift over the available window, collapsed into one
  0–1 stability factor (`STABILITY` holds the weights).
- **`simulate.ts`** — pure functions taking an API quote and returning structured results, with request
  builders separated from interpretation so both are testable without network. Owns `fairValuePath` (the
  PT pricing identity), `buildTrajectories`, `compareScenarios` and `buildMaturityPlan`.
- **`route.ts`** — route and fee forensics; see below.
- **`successor.ts`** — the "same asset, next expiry" match used to default the roll destination.
  Deliberately separate from the Discover ranking: for a roll you want continuity of exposure, not the
  best score.
- **`registry.ts`** — the curated tiers.

## The fee identity

`route.ts` reads the quote's own transaction calldata (`contractParamInfo`) to name the venues, split
price impact into internal (Pendle AMM curve) and external (aggregator leg), and reconstruct the swap
fee:

```
fee ≈ Σ over AMM legs  feeRate × notional × daysToMaturity / 365
```

Found by measuring: the fee was a flat 4.01 bps of notional at $5k, $50k and $500k, while the market's
`feeRate` is 20.49 bps. The ratio to `feeRate` turned out to be `daysToMaturity/365` (0.196 for a
72-day market). Pendle charges its AMM fee on the *implied rate* it moves, and that rate is annualised —
so `feeRate × notional` overstates the fee by ~5× here, and longer-dated paper costs more to trade at
the same size.

Two confirmations, both from the API rather than from documentation:

- across eight markets (`feeRate` 9.8–40.9 bps, maturities 23–170 days) the reconstruction matched the
  SDK's reported fee to within 0.4%;
- a `roll-over-pt` quote's fee matched the **sum** of the source and destination legs (predicted $25.44
  vs reported $25.28), because a roll composes `swapExactPtForToken` on the source market followed by
  `swapExactTokenForPt` on the destination. The two 4-byte selectors are visible in the calldata and
  were verified against simple entry and exit quotes.

This file contains the only hardcoded ABI selectors in the codebase, and degrades to raw hex for
anything unknown. Bundled **limit-order fills** skip the AMM fee and are the main reason a
reconstruction can drift, which is exactly why the UI shows both numbers rather than only ours.

## The maturity plan

`buildMaturityPlan()` prices the decision that comes *after* entry:

- **redeem** — modelled, gas only;
- **roll-at-maturity** — quoted, as a *fresh entry* into the successor, sized at the expected redemption
  proceeds and bought with the accounting asset;
- **roll-now** — quoted, for comparison.

**The correction that mattered:** holding to maturity has **no exit cost**. One PT redeems for one
accounting unit through the SY redeemer — a protocol action, not an AMM swap — so there is no swap fee
and no price impact. Modelling a maturity roll as a round trip would have overstated the most common
path by the entire exit leg.

Each row is labelled **quoted** or **modelled**, and because rows end on different dates the table shows
annualised net APY next to absolute profit.

Two related API facts discovered by live testing, both of which the code comments record:

- `roll-over-pt` returns `effectiveApy` but **not** `impliedApy.before/after`, so the roll drag is
  derived from `effectiveApy − headlineApy` rather than fabricated;
- the historical endpoint ignores `timeFrame` and always returns ~1440 hourly points (about two months),
  so "track history" cannot mean "since inception" and the UI states the window.

## Caching

| Data | TTL | Where | Notes |
| --- | --- | --- | --- |
| markets | 5 min | memory + `chrome.storage` | ~10 computing units per full refresh |
| history | 30 min | `chrome.storage` (12 most recent) | 5 units; endpoint always returns ~1440 points |
| benchmark | 6 h | `chrome.storage` | a monthly official series |
| native token price | 10 min | `chrome.storage` | used to price gas |
| convert quotes | never | — | every quote is a point-in-time estimate; staleness is shown |

`SingleFlight` gives both de-duplication and the in-memory TTL layer. `mapLimit(…, 3, …)` bounds
concurrency across chains, and the size sweep is deliberately sequential. The in-memory layer is
per-context and the persisted layer is shared, which is why a second window's panel normally does not
refetch.

**There is no scheduler.** No `alarms`, no background polling; the worker runs only on `onInstalled` and
`onStartup`. All fetching is instigated by a human opening the panel or pressing ⟳. Pendle's `isActive`
filter still returns expired markets — at one point 92% of the payload and 80% of the cached snapshot —
so they are dropped at the snapshot boundary with the count surfaced (`47 active · 539 expired excluded`)
rather than hidden.

## UI rules

`src/panel/panel.css` is the only stylesheet and it is token-first: everything visual comes from custom
properties in `:root`.

| Group | Tokens | Rule |
| --- | --- | --- |
| Type | `--fs-2xs` … `--fs-3xl` | eight steps; pick the nearer one, never invent a ninth |
| Weight | `--fw-normal`, `--fw-medium`, `--fw-bold` | three, matching the font stack's real weights |
| Space | `--sp-1` … `--sp-10`, 2px base | every `gap`, `padding` and `margin` |
| Radius | `--radius-xs` … `--radius-pill` | |
| Colour | `--bg`, `--panel`, `--text`, `--muted`, `--border`, `--accent`, `--good`, `--warn`, `--bad` | redefined once for dark mode |
| Target | `--tap` | minimum size for anything clickable |

This exists because the sheet had drifted to fifteen font sizes and ten gap sizes, several within half a
pixel of each other. If a change seems to need a value between two steps, either the scale is wrong or
the change is — argue for it in the PR instead of adding a sixteenth size.

Four content rules, each of which came from removing something that failed it:

- **Anything identical on every row belongs above the list.** `risk-adjusted`, `locked at entry`, the
  per-card benchmark and a duplicate maturity date were all deleted from Discover cards.
- **Never draw a graphic that repeats a number already on screen.** A score bar was removed for encoding
  the same integer the big figure next to it already showed.
- **Density is fine, flatness is not.** When a view accumulates more than ~4 things worth reading, sort
  it into a lead plus collapsible `disclosure()` blocks. Every disclosure summary **must carry a value**,
  so collapsing never hides a number without saying so.
- **Every control needs a visible label**, not a placeholder or a `title` — both are invisible on touch
  and to anyone not hovering. A test walks every view and fails on an unlabelled `<select>`/`<input>`.

Class names are flat and single-purpose (`.card`, `.stat`, `.chip`, `.field`, `.disclosure`); no
decorative borders or gradients, and no colour that does not carry meaning.

Brand assets are generated rather than hand-drawn — `npm run brand` writes the PNG icons, the header
mark and the README banner from one geometry definition in `scripts/brand.mjs`. The header logo is the
ink tile rather than an accent chip on purpose: the mark's colours are fixed, so it has to carry its own
background to work in both themes.

## Documentation that cannot drift

The **Method** view is not prose sitting next to the code — it is generated from the same exported
constants the scorer uses (`SCORE_WEIGHTS`, `SPREAD_SCORE_RANGE`, `LIQUIDITY_SCORE_RANGE`,
`MATURITY_BANDS`, `STABILITY`, `VERDICT_RULES`, `FACTOR_DOCS`, `FLAG_DOCS`), and the protocol list is
generated from `PROTOCOL_REGISTRY`. `tests/score.test.ts` asserts that every factor has a full doc
block, that the weights still sum to 1, that the prose quotes the real thresholds, and that every flag
the scorer can emit has an explanation. Changing a threshold without updating its explanation fails CI.
Documentation that can silently go stale is worse than none.

## Extension security model

- MV3, `storage` + `sidePanel` only, and exactly two `host_permissions`.
- No remote code, no `eval`, no inline scripts — Vite emits bundled, local JS.
- No wallet APIs and no transaction signing. Quotes are built against a burn address purely to read back
  expected amounts and price impact.
- All persisted data is local; nothing is transmitted anywhere except the two public APIs.

## Error and failure behaviour

- Network: `withRetry` with backoff; 429 and 5xx are retryable, 4xx are not.
- Partial data: the v2 risk-info fetch is allowed to fail — prices and liquidity are still useful.
- Data gaps: the UI says "no usable history" or "not in the active snapshot" rather than rendering a zero.
- Quotes: failures surface the API message verbatim (for example the $100M input-valuation cap).

## Extending

- **Different chain:** add it to `CHAINS` in `domain/chains.ts`; the API layer is chain-agnostic.
- **Different data provider:** implement `fetchMarkets` / `fetchHistory` / `convert` and reuse everything
  downstream.
- **Different scoring opinion:** edit `BASE_WEIGHTS` and `decideVerdict` in `domain/score.ts`.
- **Different protocol-trust opinion:** edit `PROTOCOL_REGISTRY` in `domain/registry.ts`.

Each of those is a single file with tests next to it, which is the point.

## Open questions

Recorded rather than silently decided. None of these are bugs.

1. **Should `safe` be reachable at all?** With today's listings almost nothing clears the tier-A +
   stable + ≥$5M + ≥60d + ≥1pp bar, so the top of the list is `balanced`. That may be correct and still
   read as broken to a first-time user. Options: loosen the bar, or rename the tiers
   (`Conservative / Standard / Speculative`).
2. **Is the peg threshold right for redemption-value assets?** A stable market's *accounting* asset is
   the peg that matters — yield-bearing wrappers legitimately trade above $1, so flagging upward drift
   would mark every sUSDe market as broken. But a protocol that may itself redeem below par (Apyx)
   arguably deserves a tighter bar than a naive $1 stablecoin.
3. **Benchmark choice.** The default is the average interest rate on outstanding Treasury Notes: official
   and keyless, but it lags the live curve, so the UI says so and Settings allows an override. Should the
   10-year be worth a keyed provider? Bills and Bonds are already fetched and could be selectable.
4. **Should the registry be JSON + schema** so non-developers can PR it?
5. **How much should points/airdrop programs be surfaced?** Currently not shown at all — speculative
   value scored as yield was rejected outright.
6. **Multi-chain default.** Only Ethereum is on by default; Arbitrum is available. Is the breadth worth
   the extra refresh cost?
