/* Core logic for the draft board: pure functions, no DOM.
   Loaded as a classic script in the browser and required by tests/run_tests.mjs in Node. */
'use strict';

const Core = (() => {
  const STATE_KEY = 'fbbl-draft-board.v1';
  const STATE_VERSION = 1;
  const TIERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  const LINEUP_SLOTS = [
    { key: 'PG', label: 'PG', takes: ['PG'] },
    { key: 'SG', label: 'SG', takes: ['SG'] },
    { key: 'SF', label: 'SF', takes: ['SF'] },
    { key: 'PF', label: 'PF', takes: ['PF'] },
    { key: 'C', label: 'C', takes: ['C'] },
    { key: 'G', label: 'G', takes: ['PG', 'SG'] },
    { key: 'F', label: 'F', takes: ['SF', 'PF'] },
    { key: 'UTIL1', label: 'UTIL', takes: POSITIONS },
    { key: 'UTIL2', label: 'UTIL', takes: POSITIONS },
    { key: 'UTIL3', label: 'UTIL', takes: POSITIONS },
    { key: 'BE1', label: 'Bench', takes: null },
    { key: 'BE2', label: 'Bench', takes: null },
    { key: 'BE3', label: 'Bench', takes: null },
  ];
  const STARTER_COUNT = 10;

  // ---- Scoring ----
  // FP = PTS + REB + AST + 2*STL + BLK - TO + (FGM - FGA) + (FTM - FTA)
  const DEFAULT_WEIGHTS = { pts: 1, reb: 1, ast: 1, stl: 2, blk: 1, to: -1, fgm: 1, fga: -1, ftm: 1, fta: -1 };

  function fantasyPoints(totals, weights = DEFAULT_WEIGHTS) {
    let fp = 0;
    for (const [k, w] of Object.entries(weights)) fp += (totals[k] || 0) * w;
    return Math.round(fp * 10) / 10;
  }

  // ---- Snake draft ----
  function roundOf(pick, teams) { return Math.ceil(pick / teams); }

  function myPickInRound(round, slot, teams) {
    return round % 2 === 1 ? (round - 1) * teams + slot : (round - 1) * teams + (teams - slot + 1);
  }

  function myPicks(slot, teams, rounds) {
    const out = [];
    for (let r = 1; r <= rounds; r++) out.push(myPickInRound(r, slot, teams));
    return out;
  }

  // The first of my picks that is >= currentPick, or null when the draft is over for me.
  function nextMyPick(currentPick, slot, teams, rounds) {
    if (!slot) return null;
    for (const p of myPicks(slot, teams, rounds)) if (p >= currentPick) return p;
    return null;
  }

  // ---- Text ----
  function normalize(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  // ---- State ----
  function defaultFilters() {
    return { search: '', status: 'all', tiers: [], positions: [], team: '', uptick: false, groupByTier: false };
  }

  function defaultSettings() {
    return {
      teams: 10, rounds: 13, slot: null, mode: 'prep', source: 'proj', view: 'players',
      sort: { key: 'fppg', dir: 'desc' }, filters: defaultFilters(),
    };
  }

  function defaultPlayerState(seedTier) {
    return { tier: TIERS.includes(seedTier) ? seedTier : 'F', uptick: false, note: '', target: null };
  }

  function createState(data) {
    const state = { version: STATE_VERSION, players: {}, picks: [], settings: defaultSettings() };
    for (const p of data.players) state.players[p.id] = defaultPlayerState(p.seedTier);
    return state;
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // Normalise any saved or imported object into a valid state. Tolerates missing or extra
  // players and missing fields. Players new to the pool take their seedTier.
  function loadState(raw, data) {
    const fresh = createState(data);
    if (!raw || typeof raw !== 'object') return fresh;
    const state = fresh;
    const savedPlayers = raw.players && typeof raw.players === 'object' ? raw.players : {};
    for (const p of data.players) {
      const s = savedPlayers[p.id];
      if (!s || typeof s !== 'object') continue;
      const ps = state.players[p.id];
      if (TIERS.includes(s.tier)) ps.tier = s.tier;
      ps.uptick = !!s.uptick;
      ps.note = typeof s.note === 'string' ? s.note : '';
      ps.target = Number.isFinite(parseInt(s.target, 10)) && parseInt(s.target, 10) > 0 ? parseInt(s.target, 10) : null;
    }
    if (Array.isArray(raw.picks)) {
      const known = new Set(data.players.map(p => p.id));
      const seen = new Set();
      for (const pk of raw.picks) {
        if (!pk || typeof pk !== 'object') continue;
        const id = parseInt(pk.playerId, 10);
        if (!known.has(id) || seen.has(id)) continue;
        seen.add(id);
        state.picks.push({ playerId: id, by: pk.by === 'me' ? 'me' : 'other' });
      }
    }
    const rs = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const st = state.settings;
    st.teams = clampInt(rs.teams, 2, 30, 10);
    st.rounds = clampInt(rs.rounds, 1, 30, 13);
    st.slot = rs.slot == null || rs.slot === '' ? null : clampInt(rs.slot, 1, st.teams, null);
    st.mode = rs.mode === 'draft' ? 'draft' : 'prep';
    st.source = rs.source === 'last' ? 'last' : 'proj';
    st.view = ['players', 'team', 'picks', 'settings'].includes(rs.view) ? rs.view : 'players';
    if (rs.sort && typeof rs.sort === 'object' && typeof rs.sort.key === 'string') {
      st.sort = { key: rs.sort.key, dir: rs.sort.dir === 'asc' ? 'asc' : 'desc' };
    }
    const f = rs.filters && typeof rs.filters === 'object' ? rs.filters : {};
    const df = st.filters;
    df.search = typeof f.search === 'string' ? f.search : '';
    df.status = ['available', 'taken', 'mine', 'all'].includes(f.status) ? f.status : (st.mode === 'draft' ? 'available' : 'all');
    df.tiers = Array.isArray(f.tiers) ? f.tiers.filter(t => TIERS.includes(t)) : [];
    df.positions = Array.isArray(f.positions) ? f.positions.filter(p => POSITIONS.includes(p)) : [];
    df.team = typeof f.team === 'string' ? f.team : '';
    df.uptick = !!f.uptick;
    df.groupByTier = !!f.groupByTier;
    return state;
  }

  function serializeState(state) {
    return JSON.stringify({ version: STATE_VERSION, exportedAt: new Date().toISOString(), ...state }, null, 1);
  }

  // ---- Picks ----
  function pickIndexOf(state, playerId) {
    return state.picks.findIndex(p => p.playerId === playerId);
  }

  function pickInfo(state, playerId) {
    const i = pickIndexOf(state, playerId);
    if (i < 0) return null;
    return { number: i + 1, by: state.picks[i].by, round: roundOf(i + 1, state.settings.teams) };
  }

  function addPick(state, playerId, by) {
    if (pickIndexOf(state, playerId) >= 0) return false;
    state.picks.push({ playerId, by: by === 'me' ? 'me' : 'other' });
    return true;
  }

  function removePick(state, playerId) {
    const i = pickIndexOf(state, playerId);
    if (i < 0) return null;
    return state.picks.splice(i, 1)[0];
  }

  function setPickBy(state, playerId, by) {
    const i = pickIndexOf(state, playerId);
    if (i < 0) return false;
    state.picks[i].by = by === 'me' ? 'me' : 'other';
    return true;
  }

  function undoPick(state) {
    return state.picks.length ? state.picks.pop() : null;
  }

  function movePick(state, index, delta) {
    const j = index + delta;
    if (index < 0 || index >= state.picks.length || j < 0 || j >= state.picks.length) return false;
    const [item] = state.picks.splice(index, 1);
    state.picks.splice(j, 0, item);
    return true;
  }

  // ---- Lineup ----
  // Best-effort assignment of my players to the 13 slots. Starter slots are filled with a
  // maximum bipartite matching (so as many starters as possible are placed), trying the most
  // restricted slots first for each player; everyone left over goes to the bench.
  function assignLineup(players) {
    const starterSlots = LINEUP_SLOTS.slice(0, STARTER_COUNT);
    const slotOf = new Array(starterSlots.length).fill(null); // slot index -> player
    const order = [...players].sort((a, b) => (b.proj?.fppg || 0) - (a.proj?.fppg || 0));
    const eligible = p => starterSlots.map((s, i) => s.takes.some(pos => (p.positions || []).includes(pos)) ? i : -1).filter(i => i >= 0);

    function tryPlace(p, visited) {
      for (const i of eligible(p)) {
        if (visited.has(i)) continue;
        visited.add(i);
        if (slotOf[i] === null || tryPlace(slotOf[i], visited)) { slotOf[i] = p; return true; }
      }
      return false;
    }
    for (const p of order) tryPlace(p, new Set());

    const placed = new Set(slotOf.filter(Boolean).map(p => p.id));
    const bench = order.filter(p => !placed.has(p.id));
    const result = LINEUP_SLOTS.map((s, i) => ({ key: s.key, label: s.label, player: i < STARTER_COUNT ? slotOf[i] : (bench[i - STARTER_COUNT] || null) }));
    const overflow = bench.slice(LINEUP_SLOTS.length - STARTER_COUNT);
    const startersFppg = Math.round(slotOf.filter(Boolean).reduce((t, p) => t + (p.proj?.fppg || 0), 0) * 10) / 10;
    return { slots: result, overflow, startersFppg };
  }

  // ---- Tiers (checks on the build-time seeding) ----
  function tierOrder(t) { return TIERS.indexOf(t); }

  return {
    STATE_KEY, STATE_VERSION, TIERS, POSITIONS, LINEUP_SLOTS, STARTER_COUNT, DEFAULT_WEIGHTS,
    fantasyPoints, roundOf, myPickInRound, myPicks, nextMyPick, normalize,
    defaultFilters, defaultSettings, createState, loadState, serializeState,
    pickIndexOf, pickInfo, addPick, removePick, setPickBy, undoPick, movePick,
    assignLineup, tierOrder,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Core;
