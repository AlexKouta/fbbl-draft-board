#!/usr/bin/env node
// Fetches ESPN's public fantasy basketball player pool and writes data/players.json.
// Standard library only. Usage:
//   node scripts/fetch_data.mjs            fetch from ESPN, then transform
//   node scripts/fetch_data.mjs --offline  transform from data/raw/players_raw.json without fetching
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const RAW_FILE = path.join(RAW_DIR, 'players_raw.json');
const OUT_FILE = path.join(ROOT, 'data', 'players.json');
const ID_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'reference', 'espn_fba_id_map.json'), 'utf8'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'config.json'), 'utf8'));

const SEASON = 2027;
const PROJ_ID = `10${SEASON}`;      // 102027: ESPN projection for 2026-27
const LAST_ID = `00${SEASON - 1}`;  // 002026: 2025-26 actual totals
const ENDPOINT = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${SEASON}/players?view=kona_player_info`;

// Scoring weights keyed by ESPN stat ID. One place to change the league formula.
// FP = PTS + REB + AST + 2*STL + BLK - TO + (FGM - FGA) + (FTM - FTA)
const SCORING_WEIGHTS = { ...ID_MAP.league_41967023.scoringWeights };

const STAT = { PTS: '0', BLK: '1', STL: '2', AST: '3', REB: '6', TO: '11', FGM: '13', FGA: '14', FTM: '15', FTA: '16', TPM: '17', MIN: '40', GP: '42' };
const SLOT_TO_POS = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C' };
const TIER_TARGETS = [['S', 5], ['A', 15], ['B', 30], ['C', 50], ['D', 80], ['E', 120]]; // cumulative cut positions; F is the rest
const HALIBURTON_ID = 4396993;

const offline = process.argv.includes('--offline');
const skipAges = process.argv.includes('--no-ages');
const AGE_CACHE = path.join(RAW_DIR, 'ages.json');
const ATHLETE_URL = id => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/${id}`;

// Age (Nice): ESPN's public athlete endpoint, called only for pool players, throttled, cached in data/raw/ages.json.
async function fetchAges(pool) {
  let cache = {};
  if (fs.existsSync(AGE_CACHE)) cache = JSON.parse(fs.readFileSync(AGE_CACHE, 'utf8'));
  const todo = pool.filter(p => !(String(p.id) in cache));
  log(`\nAges: ${pool.length - todo.length} cached, ${todo.length} to fetch`);
  let failures = 0;
  const started = Date.now();
  for (let i = 0; i < todo.length; i += 4) {
    const batch = todo.slice(i, i + 4);
    await Promise.all(batch.map(async p => {
      try {
        const res = await fetch(ATHLETE_URL(p.id), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(String(res.status));
        const a = await res.json();
        let age = typeof a.age === 'number' ? a.age : null;
        if (age === null && a.dateOfBirth) {
          const dob = new Date(a.dateOfBirth), now = new Date();
          age = now.getFullYear() - dob.getFullYear() - ((now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) ? 1 : 0);
        }
        cache[p.id] = age;
      } catch (e) { failures++; cache[p.id] = null; }
    }));
    await new Promise(r => setTimeout(r, 150));
    if (Date.now() - started > 5 * 60 * 1000) { log('  age fetch taking too long, stopping'); break; }
  }
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(AGE_CACHE, JSON.stringify(cache));
  for (const p of pool) p.age = cache[p.id] ?? null;
  const have = pool.filter(p => p.age !== null).length;
  log(`  ages known for ${have} of ${pool.length} pool players (${failures} request failures)`);
}

function log(...a) { console.log(...a); }
function fail(msg) { console.error(`\nVALIDATION FAILED: ${msg}`); process.exit(1); }

async function fetchPage(offset, limit) {
  const filter = {
    players: {
      limit,
      offset,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`00${SEASON}`, PROJ_ID, LAST_ID] },
    },
    filterActive: { value: true },
  };
  const res = await fetch(ENDPOINT, {
    headers: {
      'X-Fantasy-Filter': JSON.stringify(filter),
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    },
  });
  if (!res.ok) throw new Error(`ESPN responded ${res.status} ${res.statusText}`);
  const body = await res.json();
  return Array.isArray(body) ? body : (body.players || []);
}

async function fetchAll() {
  const limit = 1500;
  let all = [];
  let offset = 0;
  for (let call = 0; call < 5; call++) {
    log(`Fetching offset ${offset}, limit ${limit} ...`);
    const page = await fetchPage(offset, limit);
    log(`  got ${page.length} players`);
    all = all.concat(page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

function unwrap(entry) {
  // Global /players returns player objects directly; league calls wrap them in .player
  return entry.player ? entry.player : entry;
}

function r1(x) { return Math.round(x * 10) / 10; }

function fantasyPoints(stats) {
  let fp = 0;
  for (const [statId, w] of Object.entries(SCORING_WEIGHTS)) fp += (stats[statId] || 0) * w;
  return fp;
}

function statBlock(entry) {
  const s = entry ? entry.stats || {} : {};
  const gp = s[STAT.GP] || 0;
  const min = s[STAT.MIN] || 0;
  const totals = {
    pts: s[STAT.PTS] || 0, reb: s[STAT.REB] || 0, ast: s[STAT.AST] || 0, stl: s[STAT.STL] || 0, blk: s[STAT.BLK] || 0,
    to: s[STAT.TO] || 0, fgm: s[STAT.FGM] || 0, fga: s[STAT.FGA] || 0, ftm: s[STAT.FTM] || 0, fta: s[STAT.FTA] || 0, tpm: s[STAT.TPM] || 0,
  };
  const fp = r1(fantasyPoints(s));
  return {
    gp, min: r1(min), ...totals, fp,
    fppg: gp ? r1(fp / gp) : 0,
    mpg: gp ? r1(min / gp) : 0,
  };
}

function transform(raw) {
  const players = raw.map(unwrap).filter(p => p && p.id && p.fullName);
  log(`Active players in raw response: ${players.length}`);

  const rows = players.map(p => {
    const stats = p.stats || [];
    const proj = statBlock(stats.find(s => s.id === PROJ_ID));
    const last = statBlock(stats.find(s => s.id === LAST_ID));
    const team = (ID_MAP.proTeams[String(p.proTeamId)] || ID_MAP.proTeams['0']).abbrev;
    const positions = (p.eligibleSlots || []).filter(s => s >= 0 && s <= 4).map(s => SLOT_TO_POS[s]);
    return {
      id: p.id,
      name: p.fullName,
      team,
      positions,
      primaryPosition: ID_MAP.defaultPositions[String(p.defaultPositionId)] || null,
      injuryStatus: p.injuryStatus || 'ACTIVE',
      adp: p.ownership && typeof p.ownership.averageDraftPosition === 'number' ? r1(p.ownership.averageDraftPosition) : null,
      espnRank: p.draftRanksByRankType && p.draftRanksByRankType.STANDARD ? p.draftRanksByRankType.STANDARD.rank : null,
      proj,
      last,
      age: null,
    };
  });

  // Pool: top 200 by proj.fp, top 200 by last.fp, plus manual include list.
  const byProj = [...rows].sort((a, b) => b.proj.fp - a.proj.fp).slice(0, 200);
  const byLast = [...rows].sort((a, b) => b.last.fp - a.last.fp).slice(0, 200);
  const poolIds = new Set([...byProj.map(p => p.id), ...byLast.map(p => p.id), ...CONFIG.includeIds]);
  const pool = rows.filter(p => poolIds.has(p.id));
  const missingIncludes = CONFIG.includeIds.filter(id => !rows.some(p => p.id === id));
  if (missingIncludes.length) log(`WARNING: include list IDs not found in ESPN response: ${missingIncludes.join(', ')}`);

  // Tier seeding by projected FPPG.
  pool.sort((a, b) => b.proj.fppg - a.proj.fppg || b.proj.fp - a.proj.fp);
  const cuts = seedTiers(pool);
  return { rows, pool, cuts };
}

function seedTiers(pool) {
  // Returns the chosen cut positions; assigns seedTier on each pool player.
  const cuts = [];
  let prevCut = 0;
  for (const [tier, target] of TIER_TARGETS) {
    let best = target, bestGap = -Infinity;
    for (let c = target - 3; c <= target + 3; c++) {
      if (c <= prevCut || c >= pool.length) continue;
      const gap = pool[c - 1].proj.fppg - pool[c].proj.fppg;
      if (gap > bestGap) { bestGap = gap; best = c; }
    }
    for (let i = prevCut; i < best; i++) pool[i].seedTier = tier;
    cuts.push({ tier, target, cut: best, gap: r1(bestGap), above: pool[best - 1], below: pool[best] });
    prevCut = best;
  }
  for (let i = prevCut; i < pool.length; i++) pool[i].seedTier = 'F';
  return cuts;
}

function validate(rows, pool) {
  const checks = [
    { id: 3112335, name: 'Nikola Jokic', src: 'last', gp: 65, fp: 2757, fppg: 42.4, tol: 0 },
    { id: 3112335, name: 'Nikola Jokic', src: 'proj', gp: 72, fp: 3068, fppg: 42.6, tol: 1 },
    { id: 4278073, name: 'Shai Gilgeous-Alexander', src: 'last', gp: 68, fp: 2284, fppg: 33.6, tol: 0 },
    { id: 5104157, name: 'Victor Wembanyama', src: 'last', gp: 64, fp: 2104, fppg: 32.9, tol: 0 },
  ];
  log('\n=== Validation ===');
  let ok = true;
  for (const c of checks) {
    const p = rows.find(r => r.id === c.id);
    if (!p) { log(`  MISSING ${c.name} (${c.id})`); ok = false; continue; }
    const s = p[c.src];
    const pass = s.gp === c.gp && Math.abs(s.fp - c.fp) <= c.tol && Math.abs(s.fppg - c.fppg) <= 0.1;
    log(`  ${pass ? 'PASS' : 'FAIL'} ${p.name} ${c.src === 'last' ? '2025-26 actual' : '2026-27 projection'}: GP ${s.gp} (exp ${c.gp}), FP ${s.fp} (exp ${c.fp}), FPPG ${s.fppg} (exp ${c.fppg})`);
    if (!pass) ok = false;
  }
  if (!ok) fail('validation rows do not match the expected values');
  if (!pool.some(p => p.id === HALIBURTON_ID)) log('WARNING: Tyrese Haliburton is not in the final pool');
  if (pool.length < 200 || pool.length > 300) log(`WARNING: pool size ${pool.length} is outside the expected 220-240 range`);
}

function report(pool, cuts) {
  log(`\nPool size: ${pool.length}`);
  log('\n=== Top 20 by projected FPPG ===');
  pool.slice(0, 20).forEach((p, i) => log(`  ${String(i + 1).padStart(2)}. ${p.name.padEnd(26)} ${p.team.padEnd(4)} ${String(p.proj.fppg).padStart(5)} fppg  ${String(p.proj.gp).padStart(2)} gp  [${p.seedTier}]`));
  log('\n=== Tier cuts ===');
  for (const c of cuts) {
    log(`  ${c.tier} ends at ${c.cut} (target ${c.target}, gap ${c.gap}): ${c.above.name} ${c.above.proj.fppg} | ${c.below.name} ${c.below.proj.fppg}`);
  }
  const counts = {};
  for (const p of pool) counts[p.seedTier] = (counts[p.seedTier] || 0) + 1;
  log(`  Tier sizes: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ')}`);
}

async function main() {
  let raw;
  if (offline) {
    if (!fs.existsSync(RAW_FILE)) fail(`--offline given but ${RAW_FILE} does not exist`);
    raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
    log(`Loaded raw response from ${RAW_FILE}`);
  } else {
    raw = await fetchAll();
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(RAW_FILE, JSON.stringify(raw));
    log(`Saved raw response (${raw.length} players) to ${RAW_FILE}`);
  }
  const { rows, pool, cuts } = transform(raw);
  validate(rows, pool);
  report(pool, cuts);
  if (!skipAges) await fetchAges(pool);

  const out = {
    builtAt: new Date().toISOString(),
    season: SEASON,
    seasonLabel: '2026-27',
    scoringWeights: SCORING_WEIGHTS,
    players: pool,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  log(`\nWrote ${OUT_FILE} (${pool.length} players)`);
}

main().catch(e => { console.error(e); process.exit(1); });
