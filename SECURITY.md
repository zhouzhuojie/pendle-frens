# Security

## Reporting

Please **do not open a public issue**. Use
[private vulnerability reporting](https://github.com/zhouzhuojie/pendle-frens/security/advisories/new) or
the maintainer address in `package.json`. No bounty and no response-time promise, but reports are welcome
and credited unless you ask otherwise.

## Scope

An MV3 Chrome extension that reads two public APIs and renders numbers. No server, no accounts, no user
data. Worth reporting:

- a way to make it execute remote or injected code;
- a permission it does not need, or a request to a host outside `host_permissions`;
- data leaving the machine beyond the two documented API hosts. The off-by-default **Load market logos**
  setting (`storage.googleapis.com`) is the only thing that may — if a request escapes while it is off,
  report it;
- a compromised dependency or build step (it ships **zero** runtime dependencies);
- a quotation path that could mislead someone into signing. It never signs anything, and quotes are built
  against a burn address.

## Out of scope

- **Financial loss from a market or protocol.** A research tool: the score is a stated opinion, not a
  guarantee, and it does not tell you what to buy.
- **Wrong data at the source.** Prices, liquidity and yield come from Pendle's API — report those
  upstream.
- **A protocol we rank poorly.** There is no curated list to get onto; protocol depth is a size/breadth
  measurement, never a trust verdict.
