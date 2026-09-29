# Security

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's
[private vulnerability reporting](https://github.com/zhouzhuojie/pendle-frens/security/advisories/new),
or email the maintainer at the address in `package.json`.

This is a small, read-only project maintained in spare time, so there is no bounty and no response-time
promise — but reports are genuinely welcome and will be credited unless you ask otherwise.

## Scope

Pendle Frens is an MV3 Chrome extension that reads two public APIs and renders numbers. It has no
server, no accounts and no user data. Worth reporting:

- a way to make the extension execute remote or injected code;
- a permission it requests that it does not need, or a request to a host outside `host_permissions`;
- anything that moves data off the machine beyond the two documented API hosts;
- a compromised dependency or build step — the extension ships **zero** runtime dependencies, so this
  should stay a short list;
- a quotation path that could mislead a user into signing something they did not intend. Note that the
  extension never signs anything, and all quotes are built against a burn address.

## Out of scope

- **Financial loss from a market or protocol.** This is a research tool. Its score is a stated opinion,
  not a guarantee, and it deliberately does not tell you what to buy.
- **Wrong data at the source.** Prices, liquidity and yield come from Pendle's API; report those
  upstream.
- **A missing protocol in the curated registry.** That is a documentation gap, and a pull request is the
  fix — see [CONTRIBUTING.md](CONTRIBUTING.md).
