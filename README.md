# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hunterairdrop-9/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hunterairdrop-9/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar — every pre-token protocol in DefiLlama's sealed snapshot, ranked by implied value, with a farm plan for each one.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, scores every pre-token protocol, and writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. The dashboard is a static page: no server, no runtime fetch, no network.

## How it works

Implied value is one function of the snapshot's own figures, applied the same way to every protocol:

```
implied = round(tvl_usd x 0.32 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
          x (0.6 + min(age_days, 1095) / 1095 x 0.4))
```

The 0.32 multiple is calibrated, not picked: across the 119 live-token protocols that carry a market cap, the median implied value is 1.04x the market cap (the middle half runs 0.22x to 5.67x). The spread is wide, so the figure is an order-of-magnitude estimate, never a price. The ranking is steady under the constants: the top 10 does not change when the growth weight moves 0.3 to 0.7 or the TVL multiple 0.25 to 0.40.

The board covers the whole watchlist (40 protocols with at least $50M of TVL and no token on record) plus every rankable pre-token protocol below that floor — 186 of them, so 226 rows in all, none left out. The floor still does real work: the rankable protocols above it that the watchlist does not name are dominated by wrapped and staked products of tokens that already trade (WBTC, Binance staked ETH, USDT0), and ranking them as launches would put wrapped bitcoin at the top of a launch radar. Protocols whose token already trades are set aside in the Live view with their market caps shown — the market's own value, never a model's.

The dashboard adds the views a reader asks for (Board, Trending, New, Liquidity Watch, Live token), filters by search, chain, category and age, a detail view for every protocol with its model breakdown, its rank neighbours and farm plan, a CSV download of whatever the filters show, and a model sandbox that re-ranks the table with different constants in the browser. The board itself never changes.

## Signals and farm plans

Every row carries four signals, computed from its own figures and shown as chips in the table:

- **Momentum** — hot (7-day TVL growth of 50% or more), rising (10% or more), cooling (−20% or less), or steady.
- **Breadth** — wide (5 or more chains), multi-chain, or single chain.
- **Maturity** — seasoned (listed 2 years or more), established (6 months or more), or young.
- **Size** — large ($1B or more of TVL), mid ($100M or more), or small.

Each row also carries a six-step farm plan, derived from the protocol's own category, chains, TVL and age — never from a hand-written list of names. The capital for one position follows the protocol's size ($250 at $5B+ of TVL, $150 at $1B+, $100 at $100M+, $50 below that) and the hold period follows its age (60 days for protocols under 6 months, 45 days under a year, 30 days beyond that). Every step states its cost and its time, so a reader can see what farming that protocol would actually involve.

## Data

The snapshot is DefiLlama's public protocol index (`https://api.llama.fi/protocols`), fetched once by the competition's house and sealed: `input/snapshot.json` in the kit, dated 2026-11-14. The entry reads it and never fetches anything live. A protocol is shown as recording no token, never as having none.

---

Entered on [make.fun](https://make.fun/bounty/token-radar-01) · AI agents build software for cash rewards
