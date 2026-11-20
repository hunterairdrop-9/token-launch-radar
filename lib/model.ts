/**
 * lib/model.ts — the radar's scoring model, second version.
 *
 * What goes in is a sealed snapshot of the protocol universe; what comes
 * out is a ranked board. Two things changed since the first version, and
 * both come from measuring the snapshot rather than from taste:
 *
 * 1. Coverage. The board used to stop at 160 early rows, a round number
 *    with no meaning. It now carries every rankable pre-token protocol
 *    below the watchlist floor: 186 of them, so the board is 226 rows.
 *    Nothing the snapshot records as pre-token and rankable is left off.
 *    The floor still does real work: the 63 rankable protocols above it
 *    that the watchlist does not name are dominated by wrapped and
 *    staked products of tokens that already trade — WBTC at $7.9B of
 *    TVL, Binance staked ETH at $7.4B, USDT0 at $3.6B, the three the
 *    kit itself names as off the watchlist for exactly that reason.
 *    Ranking them as launches would put wrapped bitcoin at the top of
 *    a launch radar. The floor keeps them off, and the board says so.
 *
 * 2. Calibration. The TVL multiple is 0.32, not 0.25. It is the value
 *    that puts the median live-token protocol's implied value on its
 *    market cap: across the 119 live-token protocols that carry a
 *    market cap, the median implied/market-cap ratio is 1.04 at 0.32
 *    (it was 0.82 at 0.25). The spread is wide — the middle half of
 *    ratios runs 0.22 to 5.67 — so the model is an order-of-magnitude
 *    estimate and the dashboard says so, plainly. The multiple is a
 *    scale: it moves every dollar figure by the same factor and no
 *    rank at all. The ranking is also steady under the other
 *    constants: move the growth weight anywhere from 0.3 to 0.7 and
 *    the top 10 does not change; move the maturity range from 0.2 to
 *    0.6 and it changes by one name; the mean rank moves less than
 *    half a place across the top 50.
 *
 * The model itself is one function of the snapshot's own figures,
 * applied the same way to every protocol:
 *
 *   base      = tvl_usd * 0.32
 *   growth    = clamp(change_7d, -60, 120) percent
 *   growthMul = 1 + (growth / 100) * 0.5
 *   maturity  = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
 *   implied   = max(1, round(base * growthMul * maturity))
 *
 * No name is ever special-cased, and nothing here fetches, guesses,
 * or invents data.
 *
 * Revision notes (radar-2, second revision): the model is unchanged.
 * What changed is what the dashboard shows of it: each row now carries
 * its clamped growth_pct (the growth the model scores), and the
 * calibration ships as points (calibrationPoints) so the page can draw
 * the implied-vs-market-cap scatter. A per-category multiple was tested
 * leave-one-out and rejected: it widens the log error (1.06 vs 0.99 in
 * log10) and its small-category multiples run 0.004x to 662x.
 */

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.32,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-2';

/** Live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How the multiple was set: the live-token protocols it was measured on. */
export interface Calibration {
  live_count: number;
  median_ratio: number;
  p25_ratio: number;
  p75_ratio: number;
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  signals: string[];
}

export interface CalibrationPoint {
  slug: string;
  implied_value_usd: number;
  mcap_usd: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  /** The 7-day growth the model scores: change_7d clamped to [-60, +120]. */
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  signals: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  /** One point per live-token protocol the calibration is measured on: what
   *  the model would imply against the market cap it actually carries. The
   *  dashboard draws these as its calibration scatter; the board never
   *  ranks on them. */
  calibration_points: CalibrationPoint[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/* ------------------------------------------------------------------ */
/* Small numbers                                                        */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

/** Round to four decimals, for the multipliers the board prints. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Round to two decimals, for the calibration ratios the page prints. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A finite number, or the fallback when the value is missing or bad. */
function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A number held inside [low, high]. */
function clampTo(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** A YYYY-MM-DD date as a UTC midnight timestamp, or NaN when it is not one. */
function dayTimestamp(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = dayTimestamp(listedAt);
  const end = dayTimestamp(asOf);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** The middle value of a sorted list, or 0 when it is empty. */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/* ------------------------------------------------------------------ */
/* The implied-value model                                              */
/* ------------------------------------------------------------------ */

/** The growth the model trusts: the 7-day change, clamped to [-60, +120]. */
function growthUsed(change7d: number | null, model: ModelConstants): number {
  return clampTo(finiteNumber(change7d, 0), model.growth_floor, model.growth_cap);
}

/** The maturity multiplier: 0.6 for a brand-new protocol, 1.0 after 1095 days. */
function seasoning(age: number | null, model: ModelConstants): number {
  const days = clampTo(age ?? model.unknown_age_days, 0, model.maturity_days);
  return model.maturity_floor + (days / model.maturity_days) * model.maturity_range;
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = growthUsed(protocol.change_7d, model);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = seasoning(age, model);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/**
 * The calibration behind the 0.32 multiple: for every live-token
 * protocol that carries a market cap, the ratio of what the model
 * would imply to what the market actually says. A median near 1
 * means the multiple is set on the market's own scale; the
 * quartiles say how wide that scale is.
 */
export function calibrationOf(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const { implied } = impliedValue(p, snapshot.as_of, model);
    ratios.push(implied / p.mcap_usd);
  }
  ratios.sort((a, b) => a - b);
  return {
    live_count: ratios.length,
    median_ratio: round2(medianOf(ratios)),
    p25_ratio: round2(ratios[Math.floor(ratios.length / 4)] ?? 0),
    p75_ratio: round2(ratios[Math.floor((ratios.length * 3) / 4)] ?? 0),
  };
}

/**
 * The same live-token set as the calibration, as points: what the model
 * would imply for each protocol against the market cap it actually
 * carries. Sorted by market cap, largest first, so the order is stable.
 * The dashboard draws these as its calibration scatter — the visual
 * proof of the median and the quartiles calibrationOf reports.
 */
export function calibrationPoints(snapshot: Snapshot, model: ModelConstants = MODEL): CalibrationPoint[] {
  const points: CalibrationPoint[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const { implied } = impliedValue(p, snapshot.as_of, model);
    points.push({ slug: p.slug, implied_value_usd: implied, mcap_usd: p.mcap_usd });
  }
  points.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  return points;
}

/* ------------------------------------------------------------------ */
/* Which protocols can be ranked                                        */
/* ------------------------------------------------------------------ */

/** A name ending in a release marker (V2, v2, 2.0, ...) is a pool of another protocol. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** No token on record: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Rankable: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED_NAME.test(p.name);
}

/* ------------------------------------------------------------------ */
/* Signals: four short labels per row, so the table can say at a glance  */
/* what kind of protocol this is.                                        */
/* ------------------------------------------------------------------ */

export function signalsFor(p: SnapshotProtocol, age: number | null): string[] {
  const signals: string[] = [];

  const change = p.change_7d;
  if (change !== null && change >= 50) signals.push('momentum:hot');
  else if (change !== null && change >= 10) signals.push('momentum:rising');
  else if (change !== null && change <= -20) signals.push('momentum:cooling');
  else signals.push('momentum:steady');

  const chainCount = p.chains.length;
  if (chainCount >= 5) signals.push('breadth:wide');
  else if (chainCount >= 2) signals.push('breadth:multi');
  else signals.push('breadth:single');

  const days = age ?? MODEL.unknown_age_days;
  if (days >= 730) signals.push('maturity:seasoned');
  else if (days >= 180) signals.push('maturity:established');
  else signals.push('maturity:young');

  if (p.tvl_usd >= 1e9) signals.push('tvl:large');
  else if (p.tvl_usd >= 1e8) signals.push('tvl:mid');
  else signals.push('tvl:small');

  return signals;
}

/* ------------------------------------------------------------------ */
/* Farm plans: six concrete steps per row.                               */
/*                                                                     */
/* The capital and the hold period come from the protocol's own size     */
/* and age. The opening move comes from its category. Nothing here is a   */
/* recommendation — it is a plan shape, with a cost and a time, so a      */
/* reader can see what farming this protocol would actually involve.      */
/* ------------------------------------------------------------------ */

function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital for one farm position, from the protocol's own TVL. */
function stakeFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Hold length, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The category's opening move, looked up in a table rather than a chain
 * of special cases. Each entry matches a word in the category name and
 * builds the move from the protocol's name, capital and chain.
 */
type MoveFn = (name: string, capital: number, chain: string) => string;

const OPENING_MOVES: Array<{ test: RegExp; move: MoveFn }> = [
  { test: /lend|cdp|collateral/, move: (n, c, ch) => `Lend $${c} of USDC into ${n} on ${ch} and leave the position open.` },
  { test: /dex|yield|leveraged farm/, move: (n, c, ch) => `Add $${c} of liquidity to ${n}'s main pool on ${ch} and leave the position open.` },
  { test: /bridge/, move: (n, c, ch) => `Bridge $${c} of USDC to ${ch} with ${n} and put the bridged funds to work in its app.` },
  { test: /staking|restak/, move: (n, c, ch) => `Stake $${c} of the chain's staking asset through ${n} and hold the receipt.` },
  { test: /perpetual|derivative/, move: (n, c, ch) => `Put $${c} of USDC up as margin on ${n} and open one small hedge.` },
  { test: /prediction/, move: (n, c) => `Fund $${c} and take one market position on ${n}.` },
  { test: /curator|allocator/, move: (n, c, ch) => `Put $${c} into a ${n} vault on ${ch} and hold the shares.` },
  { test: /stable/, move: (n, c, ch) => `Mint or hold $${c} of the stable asset through ${n} on ${ch}.` },
  { test: /rwa/, move: (n, c, ch) => `Mint $${c} of the protocol's yield asset on ${ch} and hold it.` },
  { test: /insurance/, move: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy.` },
];

function openingMove(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const entry of OPENING_MOVES) {
    if (entry.test.test(category)) return entry.move(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and leave the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * Derived from the protocol's own record (category, chains, TVL, age) — never
 * from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = stakeFor(p);
  const hold = holdFor(age);
  return [
    {
      text: `Open a fresh wallet for this farm only, keep its seed phrase offline, and fund it with just the capital you plan to use.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: openingMove(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action each week — a deposit, a borrow, a swap, or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Leave the position in place for at least ${hold} days so it is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates, and every transaction in a farm log, so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** One farm step as a single string: action, then cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/* ------------------------------------------------------------------ */
/* Building the board and the live set                                   */
/* ------------------------------------------------------------------ */

interface Scored {
  p: SnapshotProtocol;
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
}

/** Compare two scored protocols by implied value, then by slug. */
function byValue(a: Scored, b: Scored): number {
  return b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
}

/**
 * The board: the whole watchlist, plus every rankable pre-token
 * protocol below the floor — strongest implied value first, ranks 1..n.
 * The early set is everything below the floor, not a cut at a round
 * number: 186 protocols on this snapshot, none left out.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols.filter(
    (p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd,
  );
  for (const p of early) chosen.set(p.slug, p);

  const scored: Scored[] = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort(byValue);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    signals: signalsFor(s.p, s.age),
  }));
}

/** The live-token protocols, by market cap: they already trade, so the board shows the market's own value. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    signals: row.signals,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration: calibrationOf(snapshot, model),
    calibration_points: calibrationPoints(snapshot, model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/* ------------------------------------------------------------------ */
/* Reading the snapshot: strict, because a wrong shape must fail loudly. */
/* ------------------------------------------------------------------ */

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' ? value : null;
}

function numberField(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One protocol out of a raw record, refusing anything that is not the shape the model scores. */
function readProtocol(value: unknown, index: number): SnapshotProtocol {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
  }
  const p = value as Record<string, unknown>;
  const slug = stringField(p, 'slug');
  const name = stringField(p, 'name');
  const tvl = numberField(p, 'tvl_usd');
  if (slug === null || name === null || tvl === null) {
    throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
  }
  const chains = Array.isArray(p.chains)
    ? p.chains.filter((c): c is string => typeof c === 'string')
    : [];
  return {
    slug,
    name,
    category: stringField(p, 'category'),
    chains,
    tvl_usd: tvl,
    change_7d: numberField(p, 'change_7d'),
    mcap_usd: numberField(p, 'mcap_usd'),
    listed_at: stringField(p, 'listed_at'),
    gecko_id: stringField(p, 'gecko_id'),
    symbol: stringField(p, 'symbol'),
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols: o.protocols.map((v, i) => readProtocol(v, i)),
    watchlist: o.watchlist as string[],
  };
}

/* ------------------------------------------------------------------ */
/* The board's self-check, and the dashboard's data file.                */
/* ------------------------------------------------------------------ */

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
