// Automated tests from the PRD acceptance criteria. Run: node tests/run_tests.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Core = require(path.join(ROOT, 'core.js'));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('Fantasy point calculation');
const byId = id => data.players.find(p => p.id === id);
test('Jokic 2025-26 actual: 65 GP, 2757 FP, 42.4 FPPG', () => {
  const p = byId(3112335);
  assert.equal(p.last.gp, 65);
  assert.equal(Core.fantasyPoints(p.last, Core.DEFAULT_WEIGHTS), 2757);
  assert.equal(p.last.fp, 2757); assert.equal(p.last.fppg, 42.4);
});
test('Jokic 2026-27 projection: 72 GP, 3068 FP (±1), 42.6 FPPG', () => {
  const p = byId(3112335);
  assert.equal(p.proj.gp, 72);
  assert.ok(Math.abs(Core.fantasyPoints(p.proj) - 3068) <= 1);
  assert.ok(Math.abs(p.proj.fppg - 42.6) <= 0.1);
});
test('Gilgeous-Alexander 2025-26 actual: 68 GP, 2284 FP, 33.6 FPPG', () => {
  const p = byId(4278073);
  assert.equal(p.last.gp, 68); assert.equal(Core.fantasyPoints(p.last), 2284); assert.equal(p.last.fppg, 33.6);
});
test('Wembanyama 2025-26 actual: 64 GP, 2104 FP, 32.9 FPPG', () => {
  const p = byId(5104157);
  assert.equal(p.last.gp, 64); assert.equal(Core.fantasyPoints(p.last), 2104); assert.equal(p.last.fppg, 32.9);
});
test('formula weights match data file scoringWeights', () => {
  const w = data.scoringWeights;
  assert.deepEqual([w['0'], w['6'], w['3'], w['2'], w['1'], w['11'], w['13'], w['14'], w['15'], w['16']], [1, 1, 1, 2, 1, -1, 1, -1, 1, -1]);
});

console.log('Snake order');
test('slot 3 of 10 gives 3, 18, 23, 38, 43', () => assert.deepEqual(Core.myPicks(3, 10, 5), [3, 18, 23, 38, 43]));
test('slot 10 gives 10, 11, 30, 31', () => assert.deepEqual(Core.myPicks(10, 10, 4), [10, 11, 30, 31]));
test('slot 1 gives 1, 20, 21, 40', () => assert.deepEqual(Core.myPicks(1, 10, 4), [1, 20, 21, 40]));
test('next pick from current pick', () => {
  assert.equal(Core.nextMyPick(1, 3, 10, 13), 3);
  assert.equal(Core.nextMyPick(3, 3, 10, 13), 3);
  assert.equal(Core.nextMyPick(4, 3, 10, 13), 18);
  assert.equal(Core.nextMyPick(131, 3, 10, 13), null);
  assert.equal(Core.nextMyPick(1, null, 10, 13), null);
});

console.log('Round of a pick');
test('1→1, 10→1, 11→2, 45→5, 130→13', () => {
  assert.equal(Core.roundOf(1, 10), 1); assert.equal(Core.roundOf(10, 10), 1);
  assert.equal(Core.roundOf(11, 10), 2); assert.equal(Core.roundOf(45, 10), 5); assert.equal(Core.roundOf(130, 10), 13);
});

console.log('Tier seeding');
test('every pool player has exactly one valid tier', () => {
  for (const p of data.players) assert.ok(Core.TIERS.includes(p.seedTier), `${p.name} has tier ${p.seedTier}`);
});
test('tiers are in order down the projected FPPG ranking', () => {
  const sorted = [...data.players].sort((a, b) => b.proj.fppg - a.proj.fppg || b.proj.fp - a.proj.fp);
  let last = 0;
  for (const p of sorted) { const o = Core.tierOrder(p.seedTier); assert.ok(o >= last, `${p.name} ${p.seedTier} after a lower tier`); last = o; }
});
test('each cut is within 3 places of its target', () => {
  const sorted = [...data.players].sort((a, b) => b.proj.fppg - a.proj.fppg || b.proj.fp - a.proj.fp);
  const targets = { S: 5, A: 15, B: 30, C: 50, D: 80, E: 120 };
  for (const [tier, target] of Object.entries(targets)) {
    const cut = sorted.filter(p => Core.tierOrder(p.seedTier) <= Core.tierOrder(tier)).length;
    assert.ok(Math.abs(cut - target) <= 3, `${tier} ends at ${cut}, target ${target}`);
  }
});

console.log('Picks');
test('returning the second of five picks leaves four numbered 1 to 4 in order', () => {
  const s = Core.createState(data);
  const ids = data.players.slice(0, 5).map(p => p.id);
  ids.forEach((id, i) => Core.addPick(s, id, i % 2 ? 'me' : 'other'));
  assert.equal(s.picks.length, 5);
  Core.removePick(s, ids[1]);
  assert.equal(s.picks.length, 4);
  assert.deepEqual(s.picks.map(p => p.playerId), [ids[0], ids[2], ids[3], ids[4]]);
  assert.equal(Core.pickInfo(s, ids[2]).number, 2);
  assert.equal(Core.pickInfo(s, ids[4]).number, 4);
  assert.equal(Core.pickInfo(s, ids[1]), null);
});
test('duplicate pick is rejected, undo removes the latest, switch changes by', () => {
  const s = Core.createState(data);
  const [a, b] = data.players.map(p => p.id);
  assert.ok(Core.addPick(s, a, 'me')); assert.ok(!Core.addPick(s, a, 'other'));
  Core.addPick(s, b, 'other');
  Core.setPickBy(s, b, 'me'); assert.equal(Core.pickInfo(s, b).by, 'me');
  assert.equal(Core.undoPick(s).playerId, b); assert.equal(s.picks.length, 1);
});
test('move pick up and down', () => {
  const s = Core.createState(data);
  const ids = data.players.slice(0, 3).map(p => p.id);
  ids.forEach(id => Core.addPick(s, id, 'other'));
  assert.ok(Core.movePick(s, 2, -1));
  assert.deepEqual(s.picks.map(p => p.playerId), [ids[0], ids[2], ids[1]]);
  assert.ok(!Core.movePick(s, 0, -1));
});

console.log('State');
test('save and reload round-trip without loss', () => {
  const s = Core.createState(data);
  const p = data.players[7];
  s.players[p.id] = { tier: 'A', uptick: true, note: 'Jokić note', target: 45 };
  Core.addPick(s, data.players[1].id, 'other'); Core.addPick(s, data.players[2].id, 'me');
  s.settings.slot = 4; s.settings.mode = 'draft'; s.settings.source = 'last';
  s.settings.filters.tiers = ['S', 'A']; s.settings.sort = { key: 'adp', dir: 'asc' };
  const json = Core.serializeState(s);
  const back = Core.loadState(JSON.parse(json), data);
  assert.deepEqual(back.players[p.id], s.players[p.id]);
  assert.deepEqual(back.picks, s.picks);
  assert.deepEqual(back.settings, s.settings);
});
test('loading tolerates a player ID no longer in the pool, missing fields and junk', () => {
  const raw = {
    players: { 999999999: { tier: 'S', note: 'gone' }, [data.players[0].id]: { tier: 'C' }, [data.players[1].id]: 'junk' },
    picks: [{ playerId: 999999999, by: 'me' }, { playerId: data.players[3].id, by: 'me' }, null, { playerId: data.players[3].id, by: 'other' }],
    settings: { slot: 99, teams: 'x', mode: 'weird', filters: { tiers: ['S', 'Z'] } },
  };
  const s = Core.loadState(raw, data);
  assert.equal(s.players[999999999], undefined);
  assert.equal(s.players[data.players[0].id].tier, 'C');
  assert.equal(s.players[data.players[0].id].note, '');
  assert.equal(s.players[data.players[1].id].tier, data.players[1].seedTier);
  assert.deepEqual(s.picks, [{ playerId: data.players[3].id, by: 'me' }]);
  assert.equal(s.settings.teams, 10); assert.equal(s.settings.slot, 10); assert.equal(s.settings.mode, 'prep');
  assert.deepEqual(s.settings.filters.tiers, ['S']);
  assert.equal(Object.keys(s.players).length, data.players.length);
});
test('first run copies seedTier into state', () => {
  const s = Core.createState(data);
  for (const p of data.players) assert.equal(s.players[p.id].tier, p.seedTier);
});
test('import of null or garbage yields a fresh state', () => {
  assert.equal(Core.loadState(null, data).picks.length, 0);
  assert.equal(Core.loadState('nope', data).settings.mode, 'prep');
});

console.log('Lineup');
test('lineup assignment fills restricted slots and uses G/F/UTIL', () => {
  const mk = (id, positions, fppg) => ({ id, name: String(id), positions, proj: { fppg } });
  const team = [mk(1, ['PG'], 30), mk(2, ['PG'], 25), mk(3, ['SG'], 20), mk(4, ['SF', 'PF'], 22), mk(5, ['PF'], 18), mk(6, ['C'], 28), mk(7, ['C'], 15)];
  const r = Core.assignLineup(team);
  const by = Object.fromEntries(r.slots.map(s => [s.key, s.player && s.player.id]));
  assert.ok(by.PG && by.SG && by.SF && by.PF && by.C && by.G, JSON.stringify(by));
  assert.equal(r.slots.filter(s => s.player).length, 7);
  assert.equal(r.startersFppg, 158);
  assert.equal(r.slots.filter(s => s.key.startsWith('BE') && s.player).length, 0);
});
test('a 13-man roster fills all slots with bench overflow', () => {
  const mk = (id, positions, fppg) => ({ id, name: String(id), positions, proj: { fppg } });
  const team = Array.from({ length: 13 }, (_, i) => mk(i + 1, [Core.POSITIONS[i % 5]], 20 - i));
  const r = Core.assignLineup(team);
  assert.equal(r.slots.filter(s => s.player).length, 13);
  assert.equal(r.overflow.length, 0);
});

console.log('Depth charts');
const mkp = (id, positions, primary, projMpg, lastMpg, extra = {}) => ({
  id, name: 'P' + id, team: 'TST', positions, primaryPosition: primary,
  proj: { gp: projMpg ? 70 : 0, mpg: projMpg, fppg: projMpg / 2, fga: 10, fta: 5, to: 2 },
  last: { gp: lastMpg ? 60 : 0, mpg: lastMpg, fppg: lastMpg / 2, fga: 8, fta: 4, to: 1 }, ...extra,
});
const fixture = [
  mkp(1, ['PG'], 'PG', 34, 30), mkp(2, ['PG', 'SG'], 'SG', 28, 32), mkp(3, ['SG', 'SF'], 'SG', 22, 0),
  mkp(4, ['SF', 'PF'], 'SF', 30, 28), mkp(5, ['PF', 'C'], 'PF', 26, 25), mkp(6, ['C'], 'C', 32, 33),
  mkp(7, ['PG'], 'PG', 0, 20),
];
test('position groups: PG→G, SG/SF→G+F, PF/C→F+C, C→C', () => {
  assert.deepEqual(Core.positionGroups(['PG']), ['G']);
  assert.deepEqual(Core.positionGroups(['SG', 'SF']), ['G', 'F']);
  assert.deepEqual(Core.positionGroups(['PF', 'C']), ['F', 'C']);
  assert.deepEqual(Core.positionGroups(['C']), ['C']);
});
test('competition list: a guard sees every PG/SG-eligible teammate and no one else, by projected MPG', () => {
  const list = Core.competition(fixture, fixture[0], 'proj');
  assert.deepEqual(list.map(p => p.id), [1, 2, 3, 7]);
  assert.ok(list.every(p => p.positions.includes('PG') || p.positions.includes('SG')));
  const pfc = Core.competition(fixture, fixture[4], 'proj');
  assert.deepEqual(pfc.map(p => p.id), [6, 4, 5, 3], 'PF/C merges forwards and centres (SG/SF counts as a forward)');
});
test('depth columns: every roster player in exactly one column, by primary position', () => {
  const cols = Core.depthColumns(fixture, 'proj');
  const all = Object.values(cols).flat().map(p => p.id).sort();
  assert.deepEqual(all, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(cols.SG.map(p => p.id), [2, 3]);
  assert.deepEqual(cols.PG.map(p => p.id), [1, 7]);
});
test('ordering: zero games sorts last; last-season source re-orders', () => {
  assert.deepEqual(Core.sortByMpg(fixture, 'proj').map(p => p.id), [1, 6, 4, 2, 5, 3, 7]);
  assert.deepEqual(Core.sortByMpg(fixture, 'last').map(p => p.id), [6, 2, 1, 4, 5, 7, 3]);
});
test('usage: POSS matches a hand calculation and shares sum to 100%', () => {
  // (10 + 0.44*5 + 2) / 70 games... use a whole-season example: FGA 1325, FTA 475, TO 245, GP 72 (Jokic proj)
  const j = byId(3112335);
  const hand = Math.round((1325 + 0.44 * 475 + 245) / 72 * 10) / 10;
  assert.equal(Core.possPerGame(j.proj), hand);
  assert.equal(j.proj.poss, hand, 'data file stores the same value');
  const teams = Core.resolveTeams(data);
  const shares = Core.usageShares(teams.DEN.roster, 'proj');
  const sum = [...shares.values()].reduce((t, v) => t + v, 0);
  assert.ok(Math.abs(sum - 100) < 0.01, `shares sum to ${sum}`);
});
test('competition summary names rank and gaps', () => {
  const list = Core.competition(fixture, fixture[1], 'proj');
  const s = Core.competitionSummary(list, fixture[1], 'proj');
  assert.equal(s, '2nd of 4 guards · 6.0 MPG behind the leader · 6.0 MPG ahead of the next');
});
test('roster build: 30 teams, no free agents, every pool player with a team is on its chart', () => {
  const teams = Core.resolveTeams(data);
  assert.equal(Object.keys(teams).length, 30);
  assert.ok(!teams.FA);
  for (const [abbr, t] of Object.entries(teams)) {
    assert.ok(t.roster.length >= 8, `${abbr} has ${t.roster.length}`);
    for (const p of t.roster) assert.equal(p.team, abbr, `${p.name} listed under ${abbr}`);
  }
  for (const p of data.players) {
    if (p.team === 'FA') continue;
    assert.ok(teams[p.team].roster.some(r => r.id === p.id), `${p.name} missing from ${p.team}`);
  }
});
test('state: saved state without depthTeam loads; depthTeam round-trips; unknown team is dropped', () => {
  const s = Core.loadState({ settings: { mode: 'draft' } }, data);
  assert.equal(s.settings.depthTeam, null);
  const s2 = Core.createState(data); s2.settings.depthTeam = 'DEN'; s2.settings.view = 'depth';
  const back = Core.loadState(JSON.parse(Core.serializeState(s2)), data);
  assert.equal(back.settings.depthTeam, 'DEN'); assert.equal(back.settings.view, 'depth');
  assert.equal(Core.loadState({ settings: { depthTeam: 'XYZ' } }, data).settings.depthTeam, null);
});
test('an export made before this change imports without error', () => {
  const old = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'export-v1-before-depth.json'), 'utf8'));
  const s = Core.loadState(old, data);
  assert.equal(s.picks.length, old.picks.length);
  assert.equal(s.settings.depthTeam, null);
});

console.log('Text');
test('search normalisation ignores case and accents', () => {
  assert.equal(Core.normalize('Jokić'), 'jokic');
  assert.ok(Core.normalize('Nikola Jokić').includes(Core.normalize('JOKIC')));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
