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

console.log('Text');
test('search normalisation ignores case and accents', () => {
  assert.equal(Core.normalize('Jokić'), 'jokic');
  assert.ok(Core.normalize('Nikola Jokić').includes(Core.normalize('JOKIC')));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
