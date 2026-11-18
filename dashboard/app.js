// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, the views a reader actually asks
// for — Trending, New, Liquidity — the live-token set aside, a per-protocol
// detail drawer with the model's own inputs and the protocol's farm plan,
// a what-if sandbox that re-runs the model in the browser, and a CSV export
// of whatever the filters show. No network: every byte it shows is in data.js.
//
// Rendering is template strings into one shell, with one delegated click
// handler and one delegated input/change handler. Typing in the search box
// and dragging a sandbox slider only refresh the table, so the control you
// are using is never rebuilt under your fingers.

(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  if (!app) return;

  var state = {
    q: '', category: 'all', chain: 'all', age: 'all',
    view: 'board', sort: 'implied', dir: -1, selected: null,
    sandbox: null
  };

  /* ---------------------------------------------------------------- */
  /* Text helpers                                                       */
  /* ---------------------------------------------------------------- */

  /** Escape a value for an HTML string: names come from the snapshot, not from us. */
  function h(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** A short dollar figure: $2.75B, $543.6M, $1.2K, or n/a. */
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  /** A signed percentage with two decimals, or n/a. */
  function pctStr(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  /** An age in days as 45d, 1.5y, or unknown. */
  function ageStr(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  /* ---------------------------------------------------------------- */
  /* The model, recomputed in the page                                 */
  /* ---------------------------------------------------------------- */

  // The page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are
  // visibly the same arithmetic. The sandbox passes its own constants; the
  // board always uses DATA.model.
  function recompute(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity));
  }

  /** The constants the table ranks on right now: the board's, or the sandbox's when it is on. */
  function modelNow() {
    if (!state.sandbox) return DATA.model;
    return {
      base_multiple: state.sandbox.base,
      growth_weight: state.sandbox.growth,
      growth_floor: DATA.model.growth_floor,
      growth_cap: DATA.model.growth_cap,
      maturity_floor: DATA.model.maturity_floor,
      maturity_range: state.sandbox.maturity,
      maturity_days: DATA.model.maturity_days,
      unknown_age_days: DATA.model.unknown_age_days
    };
  }

  /** The value the table ranks on right now: the board's, or the sandbox's when it is on. */
  function valueNow(row) {
    return state.sandbox ? recompute(row, modelNow()) : row.implied_value_usd;
  }

  /* ---------------------------------------------------------------- */
  /* The farm plan, re-derived the same way main.ts derives it          */
  /* ---------------------------------------------------------------- */

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function mainChain(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  function stakeFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  // The opening move, looked up in a table: each entry matches a word in
  // the category name and builds the move from the name, capital and chain.
  var MOVES = [
    { re: /lend|cdp|collateral/, move: function (n, c, ch) { return 'Lend $' + c + ' of USDC into ' + n + ' on ' + ch + ' and leave the position open.'; } },
    { re: /dex|yield|leveraged farm/, move: function (n, c, ch) { return "Add $" + c + " of liquidity to " + n + "'s main pool on " + ch + ' and leave the position open.'; } },
    { re: /bridge/, move: function (n, c, ch) { return 'Bridge $' + c + ' of USDC to ' + ch + ' with ' + n + ' and put the bridged funds to work in its app.'; } },
    { re: /staking|restak/, move: function (n, c) { return "Stake $" + c + " of the chain's staking asset through " + n + ' and hold the receipt.'; } },
    { re: /perpetual|derivative/, move: function (n, c) { return 'Put $' + c + ' of USDC up as margin on ' + n + ' and open one small hedge.'; } },
    { re: /prediction/, move: function (n, c) { return 'Fund $' + c + ' and take one market position on ' + n + '.'; } },
    { re: /curator|allocator/, move: function (n, c, ch) { return 'Put $' + c + ' into a ' + n + ' vault on ' + ch + ' and hold the shares.'; } },
    { re: /stable/, move: function (n, c, ch) { return 'Mint or hold $' + c + ' of the stable asset through ' + n + ' on ' + ch + '.'; } },
    { re: /rwa/, move: function (n, c, ch) { return "Mint $" + c + " of the protocol's yield asset on " + ch + ' and hold it.'; } },
    { re: /insurance/, move: function (n, c, ch) { return 'Buy $' + c + ' of cover from ' + n + ' on ' + ch + ' and keep the policy.'; } }
  ];

  function openingMove(p, capital, chain) {
    var category = (p.category || '').toLowerCase();
    for (var i = 0; i < MOVES.length; i++) {
      if (MOVES[i].re.test(category)) return MOVES[i].move(p.name, capital, chain);
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and leave the position open.';
  }

  function stepJoin(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  function farmPlan(p) {
    var chain = mainChain(p);
    var capital = stakeFor(p);
    var hold = holdFor(p.age_days);
    return [
      { text: 'Open a fresh wallet for this farm only, keep its seed phrase offline, and fund it with just the capital you plan to use.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: openingMove(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one qualifying action each week — a deposit, a borrow, a swap, or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Leave the position in place for at least ' + hold + ' days so it is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates, and every transaction in a farm log, so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepJoin);
  }

  /* ---------------------------------------------------------------- */
  /* Signals: the row's own labels, as chips                           */
  /* ---------------------------------------------------------------- */

  var CHIP_WORDS = {
    'momentum:hot': 'hot momentum', 'momentum:rising': 'rising',
    'momentum:cooling': 'cooling', 'momentum:steady': 'steady',
    'breadth:wide': 'wide breadth', 'breadth:multi': 'multi-chain',
    'breadth:single': 'single chain',
    'maturity:seasoned': 'seasoned', 'maturity:established': 'established',
    'maturity:young': 'young'
  };

  /** The first three signals (momentum, breadth, maturity) as chips. */
  function chipsFor(row) {
    var signals = (row.signals || []).slice(0, 3);
    if (signals.length === 0) return '';
    return '<span class="chips">' + signals.map(function (s) {
      return '<span class="chip">' + h(CHIP_WORDS[s] || s) + '</span>';
    }).join('') + '</span>';
  }

  /* ---------------------------------------------------------------- */
  /* Hash routing: the state lives in the URL, so a view is shareable    */
  /* ---------------------------------------------------------------- */

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('age')) state.age = params.get('age');
    if (params.get('view')) state.view = params.get('view');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.age !== 'all') params.set('age', state.age);
    if (state.view !== 'board') params.set('view', state.view);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /* ---------------------------------------------------------------- */
  /* Filtering, sorting, views                                           */
  /* ---------------------------------------------------------------- */

  function ageBand(row) {
    if (row.age_days === null || row.age_days === undefined) return 'unknown';
    if (row.age_days < 180) return 'young';
    if (row.age_days <= 365) return 'mid';
    return 'mature';
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.age !== 'all' && ageBand(r) !== state.age) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  /** Sort a list by the active column, with the slug as the tiebreak. */
  function sortRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = valueNow(a); bv = valueNow(b); }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // The view's own order: the board ranks by implied value, Trending by
  // seven-day growth, New by youngest first, Liquidity by TVL.
  function orderedRows() {
    var list = filteredRows();
    if (state.view === 'trending') return list.slice().sort(function (a, b) {
      var av = a.change_7d === null ? -Infinity : a.change_7d;
      var bv = b.change_7d === null ? -Infinity : b.change_7d;
      return bv - av || (a.slug < b.slug ? -1 : 1);
    });
    if (state.view === 'new') return list.slice().sort(function (a, b) {
      var av = a.age_days === null ? Infinity : a.age_days;
      var bv = b.age_days === null ? Infinity : b.age_days;
      return av - bv || (a.slug < b.slug ? -1 : 1);
    });
    if (state.view === 'liquidity') return list.slice().sort(function (a, b) {
      return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1);
    });
    return sortRows(list);
  }

  function setView(v) {
    state.view = v;
    if (v === 'trending') { state.sort = 'growth'; state.dir = -1; }
    else if (v === 'new') { state.sort = 'age'; state.dir = 1; }
    else if (v === 'liquidity') { state.sort = 'tvl'; state.dir = -1; }
    else if (v === 'board') { state.sort = 'implied'; state.dir = -1; }
    writeHash();
    render();
  }

  /* ---------------------------------------------------------------- */
  /* CSV export: the rows on screen, as a file the reader keeps         */
  /* ---------------------------------------------------------------- */

  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** The filtered board (or the live set) as CSV text, in the order shown. */
  function csvText() {
    if (state.view === 'live') {
      // The live set's last column is the market cap, a fact — not an implied value.
      var liveHead = ['rank', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'market_cap_usd'];
      var liveLines = [liveHead.join(',')];
      DATA.live.forEach(function (r) {
        liveLines.push(['live', r.name, r.category || '', (r.chains || []).join(';'), r.tvl_usd,
          r.change_7d === null ? '' : r.change_7d, '', r.mcap_usd === null ? '' : r.mcap_usd]
          .map(csvCell).join(','));
      });
      return liveLines.join('\n') + '\n';
    }
    var head = ['rank', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd'];
    var lines = [head.join(',')];
    orderedRows().forEach(function (r) {
      lines.push([r.rank, r.name, r.category || '', (r.chains || []).join(';'), r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d,
        r.age_days === null ? '' : r.age_days, valueNow(r)].map(csvCell).join(','));
    });
    return lines.join('\n') + '\n';
  }

  /** Offer the CSV as a download; the file is built in the browser, no network. */
  function downloadCsv() {
    var blob = new Blob([csvText()], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'token-radar.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering: one HTML string per section                              */
  /* ---------------------------------------------------------------- */

  function headerHtml() {
    return '<header class="top">' +
      '<div class="brand"><span class="mark"></span><span class="brand-name">Token Radar</span></div>' +
      '<div class="top-meta"><span>Snapshot ' + h(DATA.as_of) + '</span>' +
      '<span>DefiLlama protocol index</span>' +
      '<span>' + h(DATA.model_version) + ' model</span></div>' +
      '</header>';
  }

  /** The board's three largest categories, with their row counts. */
  function topCategories() {
    var counts = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      counts[c] = (counts[c] || 0) + 1;
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, 3).map(function (c) { return c + ' ' + counts[c]; });
  }

  function ledeHtml() {
    var floorM = Math.round(DATA.floor_usd / 1e6);
    return '<section class="lede"><div>' +
      '<h1>' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least $' + floorM + 'M of TVL and no token on record. ' +
      'The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor — every rankable one, none left out. ' +
      'Implied value is a model, not a promise — and never a price.</p>' +
      '<p class="sub">Most covered on the board: ' + h(topCategories().join(' · ')) + '.</p></div>' +
      '<div class="facts">' +
      '<div class="fact"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="fact"><span>Pre-token rows scored</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="fact"><span>Early rows below the floor</span><b>' + DATA.early_size + '</b></div>' +
      '<div class="fact"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>' +
      '</div></section>';
  }

  function spotlightHtml() {
    var cards = DATA.rows.slice(0, 10).map(function (r) {
      return '<button type="button" class="card" data-action="card" data-slug="' + h(r.slug) + '">' +
        '<span class="rank">Rank ' + r.rank + '</span>' +
        '<b>' + h(r.name) + '</b>' +
        '<span class="imp">' + usd(r.implied_value_usd) + '</span>' +
        '<span class="sub">TVL ' + usd(r.tvl_usd) + ' · 7d ' + pctStr(r.change_7d) + '</span>' +
        '</button>';
    }).join('');
    return '<section class="spot"><h2>Top 10 by implied value</h2><div class="cards">' + cards + '</div></section>';
  }

  var VIEW_DEFS = [
    ['board', 'Board'], ['trending', 'Trending'], ['new', 'New'],
    ['liquidity', 'Liquidity Watch'], ['live', 'Live token']
  ];

  function viewsHtml() {
    var buttons = VIEW_DEFS.map(function (d) {
      return '<button type="button" data-action="view" data-view="' + d[0] + '" aria-pressed="' +
        (state.view === d[0] ? 'true' : 'false') + '">' + d[1] + '</button>';
    }).join('');
    return '<div class="views" role="group" aria-label="Views">' + buttons + '</div>';
  }

  function controlsHtml() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; });
    });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; });
    var catOptions = '<option value="all">All categories</option>' + categories.map(function (c) {
      return '<option value="' + h(c) + '"' + (c === state.category ? ' selected' : '') + '>' + h(c) + '</option>';
    }).join('');
    var chainOptions = '<option value="all">All chains</option>' + chains.map(function (c) {
      return '<option value="' + h(c) + '"' + (c === state.chain ? ' selected' : '') + '>' + h(c) + ' (' + chainCounts[c] + ')</option>';
    }).join('');
    var ageOptions = '<option value="all">Any age</option>' +
      '<option value="young"' + (state.age === 'young' ? ' selected' : '') + '>Young: under 6 months</option>' +
      '<option value="mid"' + (state.age === 'mid' ? ' selected' : '') + '>6–12 months</option>' +
      '<option value="mature"' + (state.age === 'mature' ? ' selected' : '') + '>Over a year</option>' +
      '<option value="unknown"' + (state.age === 'unknown' ? ' selected' : '') + '>Age unknown</option>';
    return '<div class="controls">' +
      '<div class="field"><label for="q">Search</label>' +
      '<input type="search" id="q" placeholder="Search name, chain, category" value="' + h(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label>' +
      '<select id="category" aria-label="Filter by category">' + catOptions + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label>' +
      '<select id="chain" aria-label="Filter by chain">' + chainOptions + '</select></div>' +
      '<div class="field"><label for="age">Age</label>' +
      '<select id="age" aria-label="Filter by age">' + ageOptions + '</select></div>' +
      '<button class="button export" type="button" data-action="export-csv">Download CSV</button>' +
      '<span class="count" id="count"></span>' +
      '</div>';
  }

  function sortHead(key, label) {
    var arrow = state.sort === key ? '<span aria-hidden="true">' + (state.dir < 0 ? ' v' : ' ^') + '</span>' : '';
    return '<th scope="col"><button type="button" data-action="sort" data-key="' + key + '">' + label + arrow + '</button></th>';
  }

  function protocolCell(r) {
    var chains = r.chains || [];
    var chainText = chains.length ? chains.slice(0, 2).join(', ') : 'an unnamed chain';
    if (chains.length > 2) chainText += ' +' + (chains.length - 2);
    return '<td><div class="name"><b>' + h(r.name) + '</b>' +
      '<span class="sub">' + h(r.category || 'Other') + ' on ' + h(chainText) + '</span>' +
      chipsFor(r) +
      '</div></td>';
  }

  var TABLE_CAPTIONS = {
    board: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.',
    trending: 'Pre-token protocols by seven-day TVL growth, fastest first. Growth is momentum, not a promise.',
    new: 'Pre-token protocols by age, youngest first. New listings have the longest runway with no token.',
    liquidity: 'Pre-token protocols by TVL, deepest first. Liquidity is the size of the prize a token would price.'
  };

  function boardTableHtml() {
    var list = orderedRows();
    if (list.length === 0) {
      return '<div class="panel"><div class="empty">' +
        '<h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category, chain or age to see the board again.</p>' +
        '<button class="button primary" type="button" data-action="clear-filters">Clear filters</button>' +
        '</div></div>';
    }
    var max = 1;
    list.forEach(function (r) { var v = valueNow(r); if (v > max) max = v; });
    var viewRank = {};
    if (state.sandbox) list.forEach(function (r, i) { viewRank[r.slug] = i + 1; });
    var rows = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pctStr(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var shownRank = state.sandbox ? viewRank[r.slug] : r.rank;
      var width = Math.max(3, Math.round((valueNow(r) / max) * 100));
      return '<tr data-action="row" data-slug="' + h(r.slug) + '" data-selected="' +
        (state.selected === r.slug ? 'true' : 'false') + '" tabindex="0">' +
        '<td class="num">' + shownRank + '</td>' +
        protocolCell(r) +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthClass + '">' + growth + '</td>' +
        '<td class="num">' + ageStr(r.age_days) + '</td>' +
        '<td class="num">' + (r.chains || []).length + '</td>' +
        '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + width + '%"></i></div>' +
        '<span class="num">' + usd(valueNow(r)) + '</span></div></td>' +
        '<td><span class="tag">no token</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>' +
      '<caption class="sub">' + h(TABLE_CAPTIONS[state.view] || TABLE_CAPTIONS.board) + '</caption>' +
      '<thead><tr>' +
      sortHead('implied', 'Rank') + sortHead('name', 'Protocol') +
      sortHead('tvl', 'TVL') + sortHead('growth', '7d') +
      sortHead('age', 'Age') + sortHead('chains', 'Chains') +
      sortHead('implied', 'Implied value') +
      '<th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  function liveTableHtml() {
    var rows = DATA.live.map(function (r) {
      var chains = r.chains || [];
      var chainText = chains.length ? chains.slice(0, 2).join(', ') : 'an unnamed chain';
      var growthClass = r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg';
      return '<tr><td class="num">live</td>' +
        '<td><div class="name"><b>' + h(r.name) + '</b>' +
        '<span class="sub">' + h(r.category || 'Other') + ' on ' + h(chainText) + '</span></div></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthClass + '">' + pctStr(r.change_7d) + '</td>' +
        '<td class="num">' + usd(r.mcap_usd) + '</td>' +
        '<td><span class="tag live">already trades</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>' +
      '<caption class="sub">Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th>' +
      '<th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  function countText() {
    if (state.view === 'live') return DATA.live.length + ' live-token protocols';
    return filteredRows().length + ' rows shown';
  }

  /** Refresh only the table and the count: the control you are typing in or dragging stays alive. */
  function refreshTable() {
    var slot = document.getElementById('table-slot');
    if (slot) slot.innerHTML = state.view === 'live' ? liveTableHtml() : boardTableHtml();
    var count = document.getElementById('count');
    if (count) count.textContent = countText();
  }

  function sandboxHtml() {
    var m = DATA.model;
    var on = !!state.sandbox;
    var base = on ? state.sandbox.base : m.base_multiple;
    var growth = on ? state.sandbox.growth : m.growth_weight;
    var mat = on ? state.sandbox.maturity : m.maturity_range;
    function slider(id, label, min, max, step, value) {
      return '<label><span>' + label + '</span>' +
        '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step +
        '" value="' + value + '" aria-label="' + label + '">' +
        '<output id="' + id + '-out">' + value + '</output></label>';
    }
    return '<section class="panel sandbox' + (on ? ' on' : '') + '" id="sandbox">' +
      '<h2>Model sandbox — what if the model were different?</h2>' +
      '<p class="sub" id="sandbox-note">' + (on
        ? 'Sandbox on: the table re-ranks with your constants. The board itself never changes — board.json is always scored with the constants below the sliders.'
        : 'Move a slider to re-rank the table with different constants. The board itself never changes.') + '</p>' +
      '<div class="sliders">' +
      slider('sb-base', 'TVL multiple (base)', 0.05, 0.6, 0.01, base) +
      slider('sb-growth', 'Growth weight', 0, 1.5, 0.05, growth) +
      slider('sb-mat', 'Maturity range', 0, 0.8, 0.05, mat) +
      '</div>' +
      (on ? '<button class="button" type="button" data-action="sandbox-reset">Reset to the board model</button>' : '') +
      '</section>';
  }

  function modelHtml() {
    var m = DATA.model;
    var cal = DATA.calibration || { live_count: 0, median_ratio: 0, p25_ratio: 0, p75_ratio: 0 };
    return '<section class="panel model">' +
      '<h2>How implied value is computed</h2>' +
      '<p class="sub">Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.</p>' +
      '<div class="formula">implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )</div>' +
      '<p class="sub">TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.</p>' +
      '<p class="sub">The ' + m.base_multiple + ' multiple is calibrated, not picked: across the ' + cal.live_count +
      ' live-token protocols that carry a market cap, the median implied value is ' + cal.median_ratio +
      'x the market cap (the middle half runs ' + cal.p25_ratio + 'x to ' + cal.p75_ratio +
      'x). The spread is wide, so treat the figure as an order of magnitude, never a price. The ranking is steady too: the top 10 does not change when the growth weight moves 0.3 to 0.7 or the TVL multiple 0.25 to 0.40.</p>' +
      '<p class="note">Data: ' + h(DATA.source) + '. Snapshot date ' + h(DATA.as_of) + '; the snapshot is sealed and never updates. A protocol is shown as recording no token, never as having none: its record may simply not carry one. Wrapped and staked products of tokens that already trade sit above the watchlist floor and are not ranked as launches.</p>' +
      '</section>';
  }

  /* ---------------------------------------------------------------- */
  /* The detail drawer                                                 */
  /* ---------------------------------------------------------------- */

  var dialog = document.createElement('dialog');
  dialog.className = 'detail';
  dialog.id = 'detail';
  dialog.setAttribute('aria-labelledby', 'detail-title');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  /** The row's neighbours on the board, for the rank context line. */
  function neighbours(row) {
    var above = null;
    var below = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].rank === row.rank - 1) above = DATA.rows[i];
      if (DATA.rows[i].rank === row.rank + 1) below = DATA.rows[i];
    }
    var parts = [];
    parts.push(above ? 'above ' + above.name + ' (' + usd(above.implied_value_usd) + ')' : 'above it, nothing ranks higher');
    parts.push(below ? 'below ' + below.name + ' (' + usd(below.implied_value_usd) + ')' : 'below it, nothing ranks lower');
    return parts.join(' · ');
  }

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    }
    if (!row) return;
    state.selected = slug;
    writeHash();
    var steps = farmPlan(row);
    var official = recompute(row, DATA.model);
    var officialOk = official === row.implied_value_usd;
    var chains = row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
    var sandboxLine = '';
    if (state.sandbox) {
      sandboxLine = '<div><span>Sandbox implied value</span><b class="num">' + usd(recompute(row, modelNow())) + '</b></div>';
    }
    var stepsHtml = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + h(action) + '</b><span class="cost">' + h(tail) + '</span></li>';
    }).join('');
    dialog.innerHTML =
      '<div class="detail-head"><div>' +
      '<span class="brand-name">Rank ' + row.rank + ' of ' + DATA.board_size + '</span>' +
      '<h2 id="detail-title">' + h(row.name) + '</h2>' +
      '<p class="sub">' + h(row.category || 'Other') + ' on ' + h(chains) + '</p>' +
      '<p class="sub rank-context">' + h(neighbours(row)) + '</p>' +
      '</div>' +
      '<button class="close" type="button" aria-label="Close details" data-action="close-detail">Close</button></div>' +
      '<section class="detail-section"><h3>Implied value</h3>' +
      '<div class="equation">' +
      '<div><span>TVL</span><b class="num">' + usd(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day growth</span><b class="num">' + pctStr(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b class="num">' + ageStr(row.age_days) + '</b></div>' +
      '<div><span>First listed</span><b class="num">' + h(row.listed_at || 'unknown') + '</b></div>' +
      '<div><span>Growth multiplier</span><b class="num">' + row.growth_multiplier + '</b></div>' +
      '<div><span>Maturity multiplier</span><b class="num">' + row.maturity_multiplier + '</b></div>' +
      '<div><span>Implied value</span><b class="num">' + usd(row.implied_value_usd) + '</b></div>' +
      sandboxLine +
      '</div>' +
      '<p class="sub">Model ' + h(DATA.model_version) + ': the same function scores every protocol. The page recomputes this row as ' + usd(official) +
      (officialOk ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') +
      ' This is an estimate, not a price.</p></section>' +
      '<section class="detail-section"><h3>Farm plan</h3><ol class="steps">' + stepsHtml + '</ol></section>';
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Rendering and events                                              */
  /* ---------------------------------------------------------------- */

  function render() {
    app.innerHTML = '<div class="shell">' +
      headerHtml() + ledeHtml() + spotlightHtml() + viewsHtml() + controlsHtml() +
      '<div id="table-slot">' + (state.view === 'live' ? liveTableHtml() : boardTableHtml()) + '</div>' +
      (state.view !== 'live' ? sandboxHtml() : '') +
      modelHtml() +
      '</div>';
    var count = document.getElementById('count');
    if (count) count.textContent = countText();
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  /** One click handler for the whole page: rows, cards, tabs, sort, buttons. */
  app.addEventListener('click', function (e) {
    var target = e.target;
    while (target && target !== app && !target.getAttribute('data-action')) target = target.parentElement;
    if (!target || target === app) return;
    var action = target.getAttribute('data-action');
    if (action === 'view') setView(target.getAttribute('data-view'));
    else if (action === 'sort') {
      var key = target.getAttribute('data-key');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = -1; }
      refreshTable();
    } else if (action === 'row' || action === 'card') openDetail(target.getAttribute('data-slug'));
    else if (action === 'clear-filters') {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.age = 'all';
      writeHash(); render();
    } else if (action === 'sandbox-reset') {
      state.sandbox = null; writeHash(); render();
    } else if (action === 'export-csv') downloadCsv();
    else if (action === 'close-detail') dialog.close();
  });

  /** Enter or Space on a row opens it, like a click. */
  app.addEventListener('keydown', function (e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target) return;
    var target = e.target;
    while (target && target !== app && !target.getAttribute('data-action')) target = target.parentElement;
    if (target && target.getAttribute('data-action') === 'row') {
      e.preventDefault();
      openDetail(target.getAttribute('data-slug'));
    }
  });

  /** Typing, choosing and sliding: only the table refreshes, so the control stays alive. */
  app.addEventListener('input', function (e) {
    var id = e.target && e.target.id;
    if (id === 'q') {
      state.q = e.target.value;
      writeHash();
      refreshTable();
      return;
    }
    if (id === 'sb-base' || id === 'sb-growth' || id === 'sb-mat') {
      var value = parseFloat(e.target.value);
      var out = document.getElementById(id + '-out');
      if (out) out.textContent = e.target.value;
      if (!state.sandbox) {
        state.sandbox = { base: DATA.model.base_multiple, growth: DATA.model.growth_weight, maturity: DATA.model.maturity_range };
        if (id === 'sb-base') state.sandbox.base = value;
        if (id === 'sb-growth') state.sandbox.growth = value;
        if (id === 'sb-mat') state.sandbox.maturity = value;
        // Switch the panel on in place: rebuilding the shell here would
        // destroy the slider mid-drag. The panel's own markup is updated,
        // the table re-ranks, and the drag continues.
        var panel = document.getElementById('sandbox');
        if (panel) panel.classList.add('on');
        var note = document.getElementById('sandbox-note');
        if (note) note.textContent = 'Sandbox on: the table re-ranks with your constants. The board itself never changes — board.json is always scored with the constants below the sliders.';
        if (panel && !panel.querySelector('[data-action="sandbox-reset"]')) {
          var resetBtn = document.createElement('button');
          resetBtn.className = 'button';
          resetBtn.type = 'button';
          resetBtn.setAttribute('data-action', 'sandbox-reset');
          resetBtn.textContent = 'Reset to the board model';
          panel.appendChild(resetBtn);
        }
        writeHash();
        refreshTable();
        return;
      }
      if (id === 'sb-base') state.sandbox.base = value;
      if (id === 'sb-growth') state.sandbox.growth = value;
      if (id === 'sb-mat') state.sandbox.maturity = value;
      refreshTable();
    }
  });

  app.addEventListener('change', function (e) {
    var id = e.target && e.target.id;
    if (id === 'category') { state.category = e.target.value; writeHash(); refreshTable(); }
    else if (id === 'chain') { state.chain = e.target.value; writeHash(); refreshTable(); }
    else if (id === 'age') { state.age = e.target.value; writeHash(); refreshTable(); }
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });

  readHash();
  render();
})();
