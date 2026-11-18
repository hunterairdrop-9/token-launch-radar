/**
 * lib/model.ts — the radar's model, written for this entry.
 *
 * A sealed snapshot of the protocol universe goes in; a ranked board comes
 * out. The board covers every slug on the snapshot's watchlist — the floor,
 * never the ceiling — and adds the pre-token protocols below that floor the
 * radar exists to find. A protocol counts as pre-token when its record
 * carries no token at all: no market cap, no CoinGecko id, no symbol.
 *
 * Implied value is one function of the snapshot's own figures, applied the
 * same way to every protocol. No name is ever special-cased:
 *
 *   base      = tvl_usd * 0.25
 *   growth    = clamp(change_7d, -60, 120) percent
 *   growthMul = 1 + (growth / 100) * 0.5
 *   maturity  = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
 *   implied   = max(1, round(base * growthMul * maturity))
 *
 * The dashboard states these constants and lets the reader re-run them in
 * a what-if sandbox; the board itself is always scored with the constants
 * here. Nothing in this file fetches, guesses, or invents data.
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
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-1';

/** Pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** Live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

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
/* Small numeric helpers                                               */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A finite number, or the fallback when the value is missing or bad. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp a number into [low, high]. */
function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Parse a YYYY-MM-DD date to a UTC midnight timestamp, or NaN. */
function parseDay(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = parseDay(listedAt);
  const end = parseDay(asOf);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/* ------------------------------------------------------------------ */
/* The implied-value model                                             */
/* ------------------------------------------------------------------ */

/** The growth the model trusts: the 7-day change, clamped to [-60, +120]. */
function trustedGrowth(change7d: number | null, model: ModelConstants): number {
  return clamp(finiteOr(change7d, 0), model.growth_floor, model.growth_cap);
}

/** The maturity multiplier: 0.6 for a brand-new protocol, 1.0 after 1095 days. */
function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = clamp(age ?? model.unknown_age_days, 0, model.maturity_days);
  return model.maturity_floor + (days / model.maturity_days) * model.maturity_range;
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = trustedGrowth(protocol.change_7d, model);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = maturityMultiplier(age, model);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/* ------------------------------------------------------------------ */
/* Which protocols can be ranked                                       */
/* ------------------------------------------------------------------ */

/** A name ending in a release marker (V2, v2, 2.0, ...) is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** No token on record: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Rankable: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
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

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital for one farm position, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Hold length, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
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
type MoveBuilder = (name: string, capital: number, chain: string) => string;

const OPENING_MOVES: Array<{ test: RegExp; move: MoveBuilder }> = [
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
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
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

/** Compare two protocols by TVL, then by slug, so the order is stable. */
function byTvlThenSlug(a: SnapshotProtocol, b: SnapshotProtocol): number {
  return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

interface Scored {
  p: SnapshotProtocol;
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
}

/** Compare two scored protocols by implied value, then by slug. */
function byImpliedThenSlug(a: Scored, b: Scored): number {
  return b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
}

/** The board: the whole watchlist plus the early rows, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort(byTvlThenSlug)
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored: Scored[] = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort(byImpliedThenSlug);
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

function readStringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' ? value : null;
}

function readNumberField(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One protocol out of a raw record, refusing anything that is not the shape the model scores. */
function readProtocol(value: unknown, index: number): SnapshotProtocol {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
  }
  const p = value as Record<string, unknown>;
  const slug = readStringField(p, 'slug');
  const name = readStringField(p, 'name');
  const tvl = readNumberField(p, 'tvl_usd');
  if (slug === null || name === null || tvl === null) {
    throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
  }
  const chains = Array.isArray(p.chains)
    ? p.chains.filter((c): c is string => typeof c === 'string')
    : [];
  return {
    slug,
    name,
    category: readStringField(p, 'category'),
    chains,
    tvl_usd: tvl,
    change_7d: readNumberField(p, 'change_7d'),
    mcap_usd: readNumberField(p, 'mcap_usd'),
    listed_at: readStringField(p, 'listed_at'),
    gecko_id: readStringField(p, 'gecko_id'),
    symbol: readStringField(p, 'symbol'),
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
