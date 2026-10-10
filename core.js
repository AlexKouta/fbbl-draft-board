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
      teams: 10, rounds: 13, slot: null, mode: 'prep', source: 'proj', view: 'players', depthTeam: null,
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
    st.view = ['players', 'team', 'picks', 'depth', 'settings'].includes(rs.view) ? rs.view : 'players';
    st.depthTeam = typeof rs.depthTeam === 'string' && data.teams && data.teams[rs.depthTeam] ? rs.depthTeam : null;
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

  // ---- Team depth charts ----
  // Position groups from eligible positions: G = PG or SG, F = SF or PF, C = C.
  const GROUP_LABELS = { G: 'Guards', F: 'Forwards', C: 'Centres' };
  const GROUP_SINGULAR = { G: 'guard', F: 'forward', C: 'centre' };
  const USAGE_FT_WEIGHT = 0.44;

  function positionGroups(positions) {
    const p = positions || [], g = [];
    if (p.includes('PG') || p.includes('SG')) g.push('G');
    if (p.includes('SF') || p.includes('PF')) g.push('F');
    if (p.includes('C')) g.push('C');
    return g;
  }

  // Possessions used per game: (FGA + 0.44 FTA + TO) / GP, 1 decimal. Zero with no games.
  function possPerGame(stat, weight = USAGE_FT_WEIGHT) {
    if (!stat || !(stat.gp > 0)) return 0;
    return Math.round((stat.fga + weight * stat.fta + stat.to) / stat.gp * 10) / 10;
  }

  // Resolve data.teams into full player records once at load. Pool entries point at the pool
  // record (so tiers, notes and picks apply); non-pool entries carry their own light record.
  function resolveTeams(data) {
    const byId = new Map((data.players || []).map(p => [p.id, p]));
    const out = {};
    for (const [abbr, t] of Object.entries(data.teams || {})) {
      const roster = [];
      for (const e of t.roster || []) {
        const p = e.inPool ? byId.get(e.id) : e;
        if (!p) continue;
        p.inPool = !!e.inPool && byId.has(e.id);
        p.groups = positionGroups(p.positions);
        roster.push(p);
      }
      out[abbr] = { abbr, name: t.name, totalProjMpg: t.totalProjMpg || 0, roster };
    }
    return out;
  }

  // Sort for a stat source: zero games last, then MPG descending, then FPPG descending.
  function sortByMpg(list, source) {
    return [...list].sort((a, b) => {
      const sa = a[source] || {}, sb = b[source] || {};
      const ga = sa.gp > 0, gb = sb.gp > 0;
      if (ga !== gb) return ga ? -1 : 1;
      return (sb.mpg || 0) - (sa.mpg || 0) || (sb.fppg || 0) - (sa.fppg || 0) || String(a.name).localeCompare(String(b.name));
    });
  }

  // Five columns by primary position; each player appears once.
  function depthColumns(roster, source) {
    const cols = {};
    for (const pos of POSITIONS) cols[pos] = [];
    for (const p of roster) {
      const pos = POSITIONS.includes(p.primaryPosition) ? p.primaryPosition : (p.positions && p.positions[0]) || 'C';
      cols[pos].push(p);
    }
    for (const pos of POSITIONS) cols[pos] = sortByMpg(cols[pos], source);
    return cols;
  }

  // Three columns by position group using eligible positions; a player can appear in two.
  function depthGroups(roster, source) {
    const cols = { G: [], F: [], C: [] };
    for (const p of roster) for (const g of positionGroups(p.positions)) cols[g].push(p);
    for (const g of Object.keys(cols)) cols[g] = sortByMpg(cols[g], source);
    return cols;
  }

  // Teammates sharing a position group with the player, plus the player, ordered by MPG.
  function competition(roster, player, source) {
    const groups = positionGroups(player.positions);
    const list = roster.filter(p => p.id === player.id || positionGroups(p.positions).some(g => groups.includes(g)));
    if (!list.some(p => p.id === player.id)) list.push(player);
    return sortByMpg(list, source);
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // "2nd of 6 guards · 4.2 MPG behind the leader · 6.8 MPG ahead of the next"
  function competitionSummary(list, player, source) {
    const i = list.findIndex(p => p.id === player.id);
    if (i < 0) return '';
    const groups = positionGroups(player.positions);
    const noun = groups.length === 1 ? GROUP_SINGULAR[groups[0]] + (list.length === 1 ? '' : 's') : 'players in group';
    const mpg = p => (p[source] && p[source].gp > 0) ? p[source].mpg : null;
    const parts = [`${ordinal(i + 1)} of ${list.length} ${noun}`];
    const me = mpg(player);
    if (me != null) {
      if (i > 0 && mpg(list[0]) != null) parts.push(`${(mpg(list[0]) - me).toFixed(1)} MPG behind the leader`);
      if (i < list.length - 1 && mpg(list[i + 1]) != null) parts.push(`${(me - mpg(list[i + 1])).toFixed(1)} MPG ahead of the next`);
    }
    return parts.join(' · ');
  }

  // Share of the team's possessions per game, as a percentage per player id.
  function usageShares(roster, source, weight = USAGE_FT_WEIGHT) {
    const poss = new Map(roster.map(p => [p.id, possPerGame(p[source], weight)]));
    const total = [...poss.values()].reduce((t, v) => t + v, 0);
    const out = new Map();
    for (const [id, v] of poss) out.set(id, total > 0 ? v / total * 100 : 0);
    return out;
  }

  return {
    STATE_KEY, STATE_VERSION, TIERS, POSITIONS, LINEUP_SLOTS, STARTER_COUNT, DEFAULT_WEIGHTS,
    fantasyPoints, roundOf, myPickInRound, myPicks, nextMyPick, normalize,
    defaultFilters, defaultSettings, createState, loadState, serializeState,
    pickIndexOf, pickInfo, addPick, removePick, setPickBy, undoPick, movePick,
    assignLineup, tierOrder,
    GROUP_LABELS, USAGE_FT_WEIGHT, positionGroups, possPerGame, resolveTeams, sortByMpg, depthColumns, depthGroups,
    competition, competitionSummary, usageShares, ordinal,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Core;
