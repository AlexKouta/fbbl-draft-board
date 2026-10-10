/* FBBL Draft Board: UI layer. Depends on core.js (Core). */
'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let data = null;        // players.json
  let players = [];       // data.players
  let byId = new Map();
  let state = null;       // saved state (Core shape)
  let hasAge = false;
  let wakeLock = null;
  let filtersOpen = false; // phone layout only: whether the filter controls are expanded

  const INJURY_SHORT = { DAY_TO_DAY: 'DTD', OUT: 'OUT', QUESTIONABLE: 'Q', DOUBTFUL: 'D', PROBABLE: 'P', SUSPENSION: 'SUSP', INJURY_RESERVE: 'IR' };
  const SOURCE_LABEL = { proj: 'Projected 26-27', last: 'Last season 25-26' };

  // ---------- Persistence ----------
  function save() {
    try { localStorage.setItem(Core.STATE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save: ' + e.message); }
  }
  function loadSaved() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(Core.STATE_KEY)); } catch (e) { raw = null; }
    state = Core.loadState(raw, data);
    if (!raw) save();
  }

  // ---------- Helpers ----------
  const S = () => state.settings;
  const ps = id => state.players[id];
  const pickInfo = id => Core.pickInfo(state, id);
  const currentPick = () => state.picks.length + 1;
  const totalPicks = () => S().teams * S().rounds;
  const nextMine = () => Core.nextMyPick(currentPick(), S().slot, S().teams, S().rounds);
  const fmt1 = v => (v == null ? '<span class="dash">–</span>' : v.toFixed(1));
  const roundOfTarget = t => Core.roundOf(t, S().teams);

  function statOf(p, src) { return p[src || S().source]; }
  function otherSource() { return S().source === 'proj' ? 'last' : 'proj'; }

  // Value used for sorting; null sorts last in either direction.
  function sortValue(p, key) {
    const s = statOf(p), gp = s.gp > 0;
    switch (key) {
      case 'name': return p.name;
      case 'team': return p.team;
      case 'pos': return p.primaryPosition || '';
      case 'age': return p.age;
      case 'tier': return Core.tierOrder(ps(p.id).tier);
      case 'fppg': return gp ? s.fppg : null;
      case 'fp': return gp ? s.fp : null;
      case 'gp': return gp ? s.gp : null;
      case 'mpg': return gp ? s.mpg : null;
      case 'otherFppg': { const o = statOf(p, otherSource()); return o.gp > 0 ? o.fppg : null; }
      case 'mpgDelta': return (p.proj.gp > 0 && p.last.gp > 0) ? Math.round((p.proj.mpg - p.last.mpg) * 10) / 10 : null;
      case 'adp': return p.adp;
      case 'target': return ps(p.id).target;
      default: return gp ? s.fppg : null;
    }
  }
  const ASC_DEFAULT = new Set(['name', 'team', 'pos', 'age', 'tier', 'adp', 'target']);

  function compare(a, b, key, dir) {
    const va = sortValue(a, key), vb = sortValue(b, key);
    if (va == null && vb == null) return tieBreak(a, b);
    if (va == null) return 1;
    if (vb == null) return -1;
    let c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    if (dir === 'desc') c = -c;
    return c || tieBreak(a, b);
  }
  function tieBreak(a, b) {
    const sa = statOf(a), sb = statOf(b);
    return (sb.gp > 0 ? sb.fppg : -1) - (sa.gp > 0 ? sa.fppg : -1) || a.name.localeCompare(b.name);
  }

  function sortedPool() {
    const { key, dir } = S().sort;
    return [...players].sort((a, b) => compare(a, b, key, dir));
  }

  function matchesFilters(p) {
    const f = S().filters;
    if (f.search && !Core.normalize(p.name).includes(Core.normalize(f.search))) return false;
    const pk = pickInfo(p.id);
    if (f.status === 'available' && pk) return false;
    if (f.status === 'taken' && !pk) return false;
    if (f.status === 'mine' && !(pk && pk.by === 'me')) return false;
    if (f.tiers.length && !f.tiers.includes(ps(p.id).tier)) return false;
    if (f.positions.length && !p.positions.some(x => f.positions.includes(x))) return false;
    if (f.team && p.team !== f.team) return false;
    if (f.uptick && !ps(p.id).uptick) return false;
    return true;
  }

  // ---------- Rendering: shell ----------
  function renderShell() {
    const st = S();
    document.body.classList.toggle('mode-prep', st.mode === 'prep');
    document.body.classList.toggle('mode-draft', st.mode === 'draft');
    document.body.classList.toggle('no-age', !hasAge);
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === st.mode));
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === st.view));
    for (const v of ['players', 'team', 'picks', 'settings']) $('view-' + v).hidden = v !== st.view;
    const mine = state.picks.filter(p => p.by === 'me').length;
    $('team-badge').textContent = mine ? String(mine) : '';
    $('picks-badge').textContent = state.picks.length ? String(state.picks.length) : '';
    renderDraftBar();
  }

  function renderDraftBar() {
    const st = S();
    const bar = $('draftbar');
    bar.hidden = st.mode !== 'draft';
    if (bar.hidden) return;
    const cur = currentPick(), total = totalPicks();
    const done = cur > total;
    $('db-current').textContent = done ? 'Draft complete' : `Pick ${cur} · Round ${Core.roundOf(cur, st.teams)}`;
    const next = nextMine();
    let txt = '', yours = false;
    if (!st.slot) txt = 'Set your draft slot to see your next pick.';
    else if (done) txt = `${state.picks.filter(p => p.by === 'me').length} players on your team.`;
    else if (next === cur) { txt = '★ Your pick'; yours = true; }
    else if (next) txt = `Your next pick: ${next} (Round ${Core.roundOf(next, st.teams)}), in ${next - cur} picks`;
    else txt = 'No picks left for you.';
    $('db-next').textContent = txt;
    bar.classList.toggle('your-pick', yours);
    $('db-slot-btn').hidden = !!st.slot;
    $('db-undo').disabled = state.picks.length === 0;
  }

  // ---------- Rendering: players table ----------
  function renderControls() {
    const f = S().filters;
    $('search').value = f.search;
    $('search-clear').hidden = !f.search;
    document.querySelectorAll('#source-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.source === S().source));
    document.querySelectorAll('#status-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.status === f.status));
    $('tier-chips').innerHTML = Core.TIERS.map(t => `<button class="chip tier-chip tier-${t}${f.tiers.includes(t) ? ' on' : ''}" data-tier="${t}">${t}</button>`).join('');
    $('pos-chips').innerHTML = Core.POSITIONS.map(p => `<button class="chip${f.positions.includes(p) ? ' on' : ''}" data-pos="${p}">${p}</button>`).join('');
    $('team-select').value = f.team;
    $('uptick-toggle').classList.toggle('on', f.uptick);
    $('group-toggle').classList.toggle('on', f.groupByTier);
    $('th-other').textContent = S().source === 'proj' ? 'Last FPPG' : 'Proj FPPG';
    const f2 = S().filters, active = f2.tiers.length + f2.positions.length + (f2.team ? 1 : 0) + (f2.uptick ? 1 : 0) + (f2.groupByTier ? 1 : 0)
      + (f2.status !== (S().mode === 'draft' ? 'available' : 'all') ? 1 : 0) + (S().source !== 'proj' ? 1 : 0);
    $('filters-badge').textContent = active ? String(active) : '';
    $('controls').classList.toggle('expanded', filtersOpen);
    $('filters-toggle').setAttribute('aria-expanded', String(filtersOpen));
    document.querySelectorAll('#players-table th[data-sort]').forEach(th => {
      const on = th.dataset.sort === S().sort.key;
      th.classList.toggle('sorted', on);
      th.classList.toggle('asc', on && S().sort.dir === 'asc');
    });
  }

  function injuryBadge(p) {
    if (!p.injuryStatus || p.injuryStatus === 'ACTIVE') return '';
    const short = INJURY_SHORT[p.injuryStatus] || p.injuryStatus.slice(0, 4);
    const cls = p.injuryStatus === 'DAY_TO_DAY' || p.injuryStatus === 'PROBABLE' || p.injuryStatus === 'QUESTIONABLE' ? ' dtd' : '';
    return `<span class="badge badge-inj${cls}" title="${esc(p.injuryStatus)}">${esc(short)}</span>`;
  }

  function rowHtml(p, rank, nextPick) {
    const st = S(), s = statOf(p), gp = s.gp > 0, u = ps(p.id), pk = pickInfo(p.id);
    const o = statOf(p, otherSource());
    const delta = sortValue(p, 'mpgDelta');
    const cls = [];
    if (pk) cls.push(pk.by === 'me' ? 'mine' : 'taken');
    const targetCue = !pk && u.target && nextPick && u.target <= nextPick;
    if (targetCue) cls.push('target-cue');
    let action = '';
    if (st.mode === 'draft') {
      action = pk ? `<button class="pick-btn" data-action="pick">#${pk.number}</button>` : `<button class="draft-btn" data-action="draft">Draft</button>`;
    }
    const pickTag = pk ? ` <span class="pick-num by-${pk.by}">#${pk.number}</span>` : '';
    return `<tr data-id="${p.id}" class="${cls.join(' ')}">
<td class="col-rank num">${rank}</td>
<td class="col-player"><span class="pname" data-action="name">${esc(p.name)}${injuryBadge(p)}${u.uptick ? '<span class="mark-up" title="Uptick">▲</span>' : ''}${u.note ? '<span class="mark-note" title="Has note">✎</span>' : ''}</span>${pickTag}${targetCue ? ' <span class="target-tag">target</span>' : ''}</td>
<td class="col-team">${esc(p.team)}</td>
<td class="col-pos">${p.positions.join('/')}</td>
<td class="col-age col-opt num">${p.age ?? '<span class="dash">–</span>'}</td>
<td class="col-tier"><span class="tier tier-${u.tier}" data-action="tier">${u.tier}</span></td>
<td class="col-fppg num">${gp ? s.fppg.toFixed(1) : '<span class="dash">–</span>'}</td>
<td class="col-fp col-opt num">${gp ? Math.round(s.fp) : '<span class="dash">–</span>'}</td>
<td class="col-gp num">${gp ? s.gp : '<span class="dash">–</span>'}</td>
<td class="col-mpg num">${gp ? s.mpg.toFixed(1) : '<span class="dash">–</span>'}</td>
<td class="col-other col-opt num">${o.gp > 0 ? o.fppg.toFixed(1) : '<span class="dash">–</span>'}</td>
<td class="col-mpgd col-opt num ${delta > 0 ? 'pos-delta' : delta < 0 ? 'neg-delta' : ''}">${delta == null ? '<span class="dash">–</span>' : (delta > 0 ? '+' : '') + delta.toFixed(1)}</td>
<td class="col-adp num">${p.adp != null ? p.adp.toFixed(1) : '<span class="dash">–</span>'}</td>
<td class="col-target num">${u.target ? `${u.target} · R${roundOfTarget(u.target)}` : '<span class="dash">–</span>'}</td>
<td class="col-action">${action}</td>
</tr>`;
  }

  function renderTable() {
    const st = S();
    const pool = sortedPool();
    const rank = new Map(pool.map((p, i) => [p.id, i + 1]));
    let rows = pool.filter(matchesFilters);
    const nextPick = st.mode === 'draft' ? nextMine() : null;
    let html = '';
    if (st.filters.groupByTier) {
      rows = rows.map((p, i) => ({ p, i })).sort((a, b) => Core.tierOrder(ps(a.p.id).tier) - Core.tierOrder(ps(b.p.id).tier) || a.i - b.i).map(x => x.p);
      let last = null;
      for (const p of rows) {
        const t = ps(p.id).tier;
        if (t !== last) {
          const all = players.filter(q => ps(q.id).tier === t);
          const avail = all.filter(q => !pickInfo(q.id)).length;
          html += `<tr class="group-row"><td colspan="15"><span class="tier tier-${t}">${t}</span><span class="group-count">${avail} of ${all.length} available</span></td></tr>`;
          last = t;
        }
        html += rowHtml(p, rank.get(p.id), nextPick);
      }
    } else {
      for (const p of rows) html += rowHtml(p, rank.get(p.id), nextPick);
    }
    $('rows').innerHTML = html;
    $('empty').hidden = rows.length > 0;
    $('count').textContent = `${rows.length} of ${players.length}`;
  }

  function renderPlayers() { renderControls(); renderTable(); }

  // ---------- Rendering: My Team ----------
  function myPlayers() {
    return state.picks.map((pk, i) => pk.by === 'me' ? { p: byId.get(pk.playerId), number: i + 1 } : null).filter(Boolean);
  }

  function renderTeam() {
    const st = S();
    const mine = myPlayers();
    const roster = mine.map(m => m.p);
    const counts = Object.fromEntries(Core.POSITIONS.map(x => [x, roster.filter(p => p.positions.includes(x)).length]));
    const lineup = Core.assignLineup(roster);
    const rosterSize = Core.LINEUP_SLOTS.length;
    let html = `<div class="stats-row">
      <div class="stat-tile"><div class="k">Roster</div><div class="v">${roster.length} of ${rosterSize}</div></div>
      <div class="stat-tile"><div class="k">Starters proj FPPG</div><div class="v">${lineup.startersFppg.toFixed(1)}</div></div>
      <div class="stat-tile" style="flex:1"><div class="k">By position</div><div class="pos-counts">${Core.POSITIONS.map(x => `<span>${x} ${counts[x]}</span>`).join('')}</div></div>
    </div>`;
    html += `<div class="two-col"><div><h2>Drafted</h2>`;
    if (!mine.length) html += `<p class="hint">No players yet. ${st.mode === 'draft' ? 'Mark a pick as "Drafted by me" in the Players view.' : 'Switch to Draft mode to mark picks.'}</p>`;
    else {
      html += `<table class="roster">${mine.map(({ p, number }) => `<tr data-id="${p.id}">
        <td class="n">${number}</td><td class="meta">R${Core.roundOf(number, st.teams)}</td>
        <td><strong>${esc(p.name)}</strong> ${injuryBadge(p)}</td><td class="meta">${esc(p.team)}</td><td class="meta">${p.positions.join('/')}</td>
        <td><span class="tier tier-${ps(p.id).tier}">${ps(p.id).tier}</span></td><td class="num"><strong>${p.proj.gp ? p.proj.fppg.toFixed(1) : '–'}</strong></td></tr>`).join('')}</table>`;
    }
    html += `</div><div><h2>Lineup</h2><table class="lineup">`;
    for (const s of lineup.slots) {
      html += s.player
        ? `<tr><td class="slot">${s.label}</td><td><strong>${esc(s.player.name)}</strong> <span class="meta">${s.player.positions.join('/')}</span></td><td class="num">${s.player.proj.gp ? s.player.proj.fppg.toFixed(1) : '–'}</td></tr>`
        : `<tr class="open"><td class="slot">${s.label}</td><td>open</td><td></td></tr>`;
    }
    html += `</table>`;
    if (lineup.overflow.length) html += `<p class="hint">Over the roster limit: ${lineup.overflow.map(p => esc(p.name)).join(', ')}</p>`;
    html += `</div></div>`;
    $('team-page').innerHTML = html;
  }

  // ---------- Rendering: Picks ----------
  function renderPicks() {
    const st = S();
    if (!state.picks.length) { $('picks-page').innerHTML = `<p class="hint">No picks yet.</p>`; return; }
    let html = `<table class="picklog">`;
    state.picks.forEach((pk, i) => {
      const p = byId.get(pk.playerId);
      const n = i + 1;
      html += `<tr data-id="${pk.playerId}" class="${pk.by === 'me' ? 'me' : ''}">
        <td class="n">${n}</td><td class="meta">R${Core.roundOf(n, st.teams)}</td>
        <td><strong>${esc(p.name)}</strong> <span class="meta">${esc(p.team)} · ${p.positions.join('/')}</span></td>
        <td class="who ${pk.by}">${pk.by === 'me' ? 'Me' : 'Other'}</td>
        <td class="mvs"><button class="mv" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button> <button class="mv" data-move="1" ${i === state.picks.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></td>
      </tr>`;
    });
    html += `</table><p class="hint">Tap a pick to switch who drafted the player or return them to available. Arrows reorder picks after a missed entry.</p>`;
    $('picks-page').innerHTML = html;
  }

  // ---------- Rendering: Settings ----------
  function renderSettings() {
    const st = S();
    const sel = $('set-slot');
    sel.innerHTML = `<option value="">Not set</option>` + Array.from({ length: st.teams }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    sel.value = st.slot ? String(st.slot) : '';
    $('set-teams').value = st.teams;
    $('set-rounds').value = st.rounds;
    $('slot-hint').textContent = st.slot ? `Your picks: ${Core.myPicks(st.slot, st.teams, st.rounds).join(', ')}` : 'Set your slot once the draft order is known.';
    const built = data.builtAt ? new Date(data.builtAt).toLocaleString() : 'unknown';
    $('about-data').textContent = `Data built ${built} · ${players.length} players · ESPN ${data.seasonLabel || data.season} projections and 2025-26 actuals.`;
  }

  function renderAll() {
    renderShell();
    const v = S().view;
    if (v === 'players') renderPlayers();
    else if (v === 'team') renderTeam();
    else if (v === 'picks') renderPicks();
    else if (v === 'settings') renderSettings();
  }

  // ---------- Modals ----------
  function openModal(html, { wide = false } = {}) {
    const root = $('modal-root');
    root.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog">${html}</div>`;
    root.hidden = false;
    return root.firstElementChild;
  }
  function closeModal() { const r = $('modal-root'); r.hidden = true; r.innerHTML = ''; }
  $('modal-root').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal-root').hidden) closeModal(); });

  function confirmModal(title, text, okLabel, danger) {
    return new Promise(resolve => {
      const m = openModal(`<h3>${esc(title)}</h3><p class="sub">${esc(text)}</p>
        <div class="modal-actions"><button class="btn" data-x="cancel">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="ok">${esc(okLabel)}</button></div>`);
      m.addEventListener('click', e => {
        const b = e.target.closest('[data-x]'); if (!b) return;
        closeModal(); resolve(b.dataset.x === 'ok');
      });
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function pct(m, a) { return a ? (m / a * 100).toFixed(1) + '%' : '–'; }
  function compareTable(p) {
    const rows = [
      ['GP', s => s.gp], ['MPG', s => s.gp ? s.mpg.toFixed(1) : '–'],
      ['PTS', s => s.gp ? (s.pts / s.gp).toFixed(1) : '–'], ['REB', s => s.gp ? (s.reb / s.gp).toFixed(1) : '–'],
      ['AST', s => s.gp ? (s.ast / s.gp).toFixed(1) : '–'], ['STL', s => s.gp ? (s.stl / s.gp).toFixed(1) : '–'],
      ['BLK', s => s.gp ? (s.blk / s.gp).toFixed(1) : '–'], ['TO', s => s.gp ? (s.to / s.gp).toFixed(1) : '–'],
      ['3PM', s => s.gp ? (s.tpm / s.gp).toFixed(1) : '–'],
      ['FG%', s => pct(s.fgm, s.fga)], ['FT%', s => pct(s.ftm, s.fta)],
      ['FPPG', s => s.gp ? s.fppg.toFixed(1) : '–'], ['FP', s => s.gp ? Math.round(s.fp) : '–'],
    ];
    return `<table class="compare"><thead><tr><th></th><th>Proj 26-27</th><th>Last 25-26</th></tr></thead><tbody>
      ${rows.map(([k, f]) => `<tr><td>${k}</td><td>${f(p.proj)}</td><td>${f(p.last)}</td></tr>`).join('')}</tbody></table>`;
  }

  function openPlayerSheet(id) {
    const p = byId.get(id), u = ps(id), ro = S().mode === 'draft';
    const pk = pickInfo(id);
    const m = openModal(`
      <h3>${esc(p.name)}${ro ? '<span class="readonly-tag">read only</span>' : ''}</h3>
      <p class="sub">${esc(p.team)} · ${p.positions.join('/')}${p.age ? ` · age ${p.age}` : ''} · ${injuryBadge(p) || 'Active'} · ADP ${p.adp != null ? p.adp.toFixed(1) : '–'} · ESPN rank ${p.espnRank ?? '–'}${pk ? ` · Pick #${pk.number} (${pk.by === 'me' ? 'me' : 'other'})` : ''}</p>
      <div class="tier-pick" id="sheet-tiers">${Core.TIERS.map(t => `<button class="tier-${t}${u.tier === t ? ' sel' : ''}" data-tier="${t}" ${ro ? 'disabled' : ''}>${t}</button>`).join('')}</div>
      <div class="sheet-row">
        <button class="toggle-btn${u.uptick ? ' on' : ''}" id="sheet-uptick" ${ro ? 'disabled' : ''}>▲ Uptick ${u.uptick ? 'on' : 'off'}</button>
        <label>Target pick <input type="number" id="sheet-target" min="1" max="${totalPicks()}" inputmode="numeric" value="${u.target ?? ''}" ${ro ? 'disabled' : ''}> <span class="round-hint" id="sheet-round">${u.target ? 'R' + roundOfTarget(u.target) : ''}</span></label>
      </div>
      <textarea class="note" id="sheet-note" placeholder="Note" ${ro ? 'disabled' : ''}>${esc(u.note)}</textarea>
      ${compareTable(p)}
      <div class="modal-actions"><button class="btn btn-primary" data-x="close">Done</button></div>`, { wide: true });
    m.querySelector('[data-x="close"]').addEventListener('click', closeModal);
    if (ro) return;
    m.querySelector('#sheet-tiers').addEventListener('click', e => {
      const b = e.target.closest('[data-tier]'); if (!b) return;
      u.tier = b.dataset.tier; save();
      m.querySelectorAll('#sheet-tiers button').forEach(x => x.classList.toggle('sel', x.dataset.tier === u.tier));
      renderTable();
    });
    m.querySelector('#sheet-uptick').addEventListener('click', e => {
      u.uptick = !u.uptick; save();
      e.currentTarget.classList.toggle('on', u.uptick); e.currentTarget.textContent = `▲ Uptick ${u.uptick ? 'on' : 'off'}`;
      renderTable();
    });
    m.querySelector('#sheet-target').addEventListener('input', e => {
      const n = parseInt(e.target.value, 10);
      u.target = Number.isFinite(n) && n > 0 ? n : null; save();
      m.querySelector('#sheet-round').textContent = u.target ? 'R' + roundOfTarget(u.target) : '';
      renderTable();
    });
    m.querySelector('#sheet-note').addEventListener('input', e => { u.note = e.target.value; save(); renderTable(); });
  }

  function openTierPicker(id) {
    const p = byId.get(id), u = ps(id);
    const m = openModal(`<h3>${esc(p.name)}</h3><p class="sub">Tier</p>
      <div class="tier-pick">${Core.TIERS.map(t => `<button class="tier-${t}${u.tier === t ? ' sel' : ''}" data-tier="${t}">${t}</button>`).join('')}</div>
      <div class="modal-actions"><button class="btn btn-quiet" data-x="more">Open full sheet</button><button class="btn" data-x="close">Cancel</button></div>`);
    m.addEventListener('click', e => {
      const t = e.target.closest('[data-tier]');
      if (t) { u.tier = t.dataset.tier; save(); closeModal(); renderTable(); return; }
      const x = e.target.closest('[data-x]'); if (!x) return;
      closeModal(); if (x.dataset.x === 'more') openPlayerSheet(id);
    });
  }

  function openDraftModal(id) {
    const p = byId.get(id);
    if (pickInfo(id)) return openCorrectionModal(id);
    const n = currentPick();
    const m = openModal(`<h3>${esc(p.name)}</h3><p class="sub">${esc(p.team)} · ${p.positions.join('/')} · Pick ${n} · Round ${Core.roundOf(n, S().teams)}</p>
      <div class="big-btns"><button class="big-btn me" data-by="me">Drafted by me</button><button class="big-btn other" data-by="other">Drafted by other</button></div>
      <div class="modal-actions"><button class="btn" data-x="cancel">Cancel</button></div>`);
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-by]');
      if (b) { markPick(id, b.dataset.by); closeModal(); return; }
      if (e.target.closest('[data-x="cancel"]')) closeModal();
    });
  }

  function markPick(id, by) {
    if (!Core.addPick(state, id, by)) return;
    save();
    S().filters.search = '';
    renderAll();
    const n = state.picks.length;
    toast(`Pick ${n}: ${byId.get(id).name} · ${by === 'me' ? 'me' : 'other'}`);
  }

  function openCorrectionModal(id) {
    const p = byId.get(id), pk = pickInfo(id);
    if (!pk) return;
    const m = openModal(`<h3>${esc(p.name)}</h3><p class="sub">Pick ${pk.number} · Round ${pk.round} · drafted by ${pk.by === 'me' ? 'me' : 'other'}</p>
      <div class="big-btns">
        <button class="big-btn me" data-by="me" ${pk.by === 'me' ? 'disabled' : ''}>Switch to me</button>
        <button class="big-btn other" data-by="other" ${pk.by === 'other' ? 'disabled' : ''}>Switch to other</button>
      </div>
      <button class="big-btn danger" style="width:100%" data-x="return">Return to available</button>
      <div class="modal-actions"><button class="btn" data-x="cancel">Cancel</button></div>`);
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-by]');
      if (b && !b.disabled) { Core.setPickBy(state, id, b.dataset.by); save(); closeModal(); renderAll(); toast(`Pick ${pk.number} switched to ${b.dataset.by}`); return; }
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'return') { Core.removePick(state, id); save(); closeModal(); renderAll(); toast(`${p.name} returned to available`); }
      else closeModal();
    });
  }

  function undo() {
    if (!state.picks.length) return;
    const pk = Core.undoPick(state);
    save(); renderAll();
    toast(`Undid pick ${state.picks.length + 1}: ${byId.get(pk.playerId).name}`);
  }

  // ---------- Mode, view, wake lock ----------
  function setMode(mode) {
    if (S().mode === mode) return;
    S().mode = mode;
    S().filters.status = mode === 'draft' ? 'available' : 'all';
    save(); renderAll(); updateWakeLock();
  }
  function setView(view) { S().view = view; save(); renderAll(); }

  async function updateWakeLock() {
    const want = S().mode === 'draft' && document.visibilityState === 'visible';
    try {
      if (want && !wakeLock && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', updateWakeLock);

  // ---------- Export / import ----------
  function doExport() {
    $('import-box').hidden = true;
    const box = $('export-box'); box.hidden = false;
    $('export-text').value = Core.serializeState(state);
  }
  async function copyExport() {
    const ta = $('export-text');
    try { await navigator.clipboard.writeText(ta.value); toast('Copied'); }
    catch (e) { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Select the text and copy it manually'); } }
  }
  function downloadExport() {
    const blob = new Blob([$('export-text').value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fbbl-draft-board-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function applyImport() {
    const text = $('import-text').value.trim();
    if (!text) { toast('Paste JSON or choose a file first'); return; }
    let raw;
    try { raw = JSON.parse(text); } catch (e) { toast('That is not valid JSON'); return; }
    const incoming = Core.loadState(raw, data);
    const ok = await confirmModal('Import and replace?', `This replaces everything saved on this device with the imported data (${incoming.picks.length} picks, ${Object.values(incoming.players).filter(p => p.note || p.uptick || p.target).length} players with notes, flags or targets).`, 'Import', true);
    if (!ok) return;
    state = incoming; save();
    $('import-text').value = ''; $('import-box').hidden = true;
    renderAll(); updateWakeLock(); toast('Imported');
  }

  // ---------- Events ----------
  function bind() {
    $('tabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
    $('mode-switch').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
    $('db-undo').addEventListener('click', undo);
    $('db-slot-btn').addEventListener('click', () => setView('settings'));

    // Controls
    $('search').addEventListener('input', e => { S().filters.search = e.target.value; save(); $('search-clear').hidden = !e.target.value; renderTable(); });
    $('filters-toggle').addEventListener('click', () => { filtersOpen = !filtersOpen; renderControls(); });
    $('search-clear').addEventListener('click', () => { S().filters.search = ''; save(); renderPlayers(); $('search').focus(); });
    $('source-seg').addEventListener('click', e => { const b = e.target.closest('[data-source]'); if (!b) return; S().source = b.dataset.source; save(); renderPlayers(); });
    $('status-seg').addEventListener('click', e => { const b = e.target.closest('[data-status]'); if (!b) return; S().filters.status = b.dataset.status; save(); renderPlayers(); });
    $('tier-chips').addEventListener('click', e => {
      const b = e.target.closest('[data-tier]'); if (!b) return;
      const f = S().filters, t = b.dataset.tier;
      f.tiers = f.tiers.includes(t) ? f.tiers.filter(x => x !== t) : [...f.tiers, t];
      save(); renderPlayers();
    });
    $('pos-chips').addEventListener('click', e => {
      const b = e.target.closest('[data-pos]'); if (!b) return;
      const f = S().filters, p = b.dataset.pos;
      f.positions = f.positions.includes(p) ? f.positions.filter(x => x !== p) : [...f.positions, p];
      save(); renderPlayers();
    });
    $('team-select').addEventListener('change', e => { S().filters.team = e.target.value; save(); renderPlayers(); });
    $('uptick-toggle').addEventListener('click', () => { S().filters.uptick = !S().filters.uptick; save(); renderPlayers(); });
    $('group-toggle').addEventListener('click', () => { S().filters.groupByTier = !S().filters.groupByTier; save(); renderPlayers(); });
    $('clear-filters').addEventListener('click', () => {
      const keepStatus = S().mode === 'draft' ? 'available' : 'all';
      S().filters = Core.defaultFilters(); S().filters.status = keepStatus; save(); renderPlayers();
    });

    // Sorting
    $('players-table').querySelector('thead').addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]'); if (!th) return;
      const key = th.dataset.sort;
      if (key === 'rank') return;
      const s = S().sort;
      if (s.key === key) s.dir = s.dir === 'desc' ? 'asc' : 'desc';
      else { s.key = key; s.dir = ASC_DEFAULT.has(key) ? 'asc' : 'desc'; }
      save(); renderPlayers();
    });

    // Table rows
    $('rows').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = parseInt(tr.dataset.id, 10);
      const act = e.target.closest('[data-action]');
      const action = act ? act.dataset.action : 'row';
      const draft = S().mode === 'draft';
      if (draft) {
        if (action === 'name') return openPlayerSheet(id);
        if (action === 'draft') return openDraftModal(id);
        if (action === 'pick') return openCorrectionModal(id);
        return pickInfo(id) ? openCorrectionModal(id) : openDraftModal(id);
      }
      if (action === 'tier') return openTierPicker(id);
      openPlayerSheet(id);
    });

    // My Team rows and Picks log
    $('team-page').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) openPlayerSheet(parseInt(tr.dataset.id, 10)); });
    $('picks-page').addEventListener('click', e => {
      const mv = e.target.closest('[data-move]');
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = parseInt(tr.dataset.id, 10);
      if (mv) {
        if (mv.disabled) return;
        Core.movePick(state, Core.pickIndexOf(state, id), parseInt(mv.dataset.move, 10)); save(); renderAll(); return;
      }
      openCorrectionModal(id);
    });

    // Settings
    $('set-slot').addEventListener('change', e => { S().slot = e.target.value ? parseInt(e.target.value, 10) : null; save(); renderAll(); });
    $('set-teams').addEventListener('change', e => {
      const n = Math.min(30, Math.max(2, parseInt(e.target.value, 10) || 10)); S().teams = n;
      if (S().slot && S().slot > n) S().slot = null; save(); renderAll();
    });
    $('set-rounds').addEventListener('change', e => { S().rounds = Math.min(30, Math.max(1, parseInt(e.target.value, 10) || 13)); save(); renderAll(); });
    $('export-btn').addEventListener('click', doExport);
    $('export-copy').addEventListener('click', copyExport);
    $('export-download').addEventListener('click', downloadExport);
    $('export-close').addEventListener('click', () => { $('export-box').hidden = true; });
    $('import-btn').addEventListener('click', () => { $('export-box').hidden = true; $('import-box').hidden = false; $('import-text').focus(); });
    $('import-close').addEventListener('click', () => { $('import-box').hidden = true; });
    $('import-apply').addEventListener('click', applyImport);
    $('import-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => { $('import-text').value = String(r.result || ''); }; r.readAsText(f);
      e.target.value = '';
    });
    $('reset-draft').addEventListener('click', async () => {
      if (!state.picks.length) { toast('No picks to clear'); return; }
      if (await confirmModal('Reset draft?', `Clears all ${state.picks.length} picks. Tiers, flags, notes and targets are kept.`, 'Reset draft', true)) {
        state.picks = []; save(); renderAll(); toast('Draft reset');
      }
    });
    $('reset-tiers').addEventListener('click', async () => {
      if (await confirmModal('Reset tiers to seed?', 'Every player goes back to the tier seeded from projected points per game. Flags, notes, targets and picks are kept.', 'Reset tiers', true)) {
        for (const p of players) ps(p.id).tier = Core.TIERS.includes(p.seedTier) ? p.seedTier : 'F';
        save(); renderAll(); toast('Tiers reset');
      }
    });
  }

  // ---------- Init ----------
  async function loadData() {
    const res = await fetch('./data/players.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`players.json ${res.status}`);
    return res.json();
  }

  async function init() {
    try {
      data = await loadData();
    } catch (e) {
      $('loading').textContent = 'Could not load player data. Connect to the internet once, then reload.';
      return;
    }
    players = data.players;
    byId = new Map(players.map(p => [p.id, p]));
    hasAge = players.some(p => p.age != null);
    loadSaved();
    const teams = [...new Set(players.map(p => p.team))].sort();
    $('team-select').innerHTML = `<option value="">All teams</option>` + teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    bind();
    renderAll();
    updateWakeLock();
    $('loading').hidden = true;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
    window.__app = { get state() { return state; }, get data() { return data; }, renderAll, save };
  }

  init();
})();
