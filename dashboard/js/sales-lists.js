/* sales-lists.js — A385 · the organizer: the chips, Group by, search and sort, drawn the same way on My Requests
 * (flow-pricing-request.js) and the quotation list (flow-quotations.js), and the grouped sections under them.
 *
 * A page gives it rows (see js/sales-lists-model.js) and a function that draws one group's table; the rows keep every
 * action they already had, so nothing a rep could do before is lost. The view a person picks (chip, grouping, sort, and
 * which sections are folded) is remembered in this browser only.
 *
 * Built to the apple-design skill: a segmented Group by with a sliding indicator and arrow keys, chips that name the
 * stage in words, sections that fold, feedback on press. Turned off with FlowSettings salesListsOrganizer = off, when the
 * pages draw their old flat tables instead.
 */

function _sl2E(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _sl2Load(id) { try { return JSON.parse(localStorage.getItem('sl2:' + id) || 'null') || null; } catch (e) { return null; } }
function _sl2Save(id, st) { try { localStorage.setItem('sl2:' + id, JSON.stringify({ chip: st.chip, group: st.group, sort: st.sort, folded: st.folded })); } catch (e) { /* private window: the view is simply not remembered */ } }

/** Is the organizer on? FlowSettings salesListsOrganizer, 'on' unless it says off (a page with no settings keeps it on). */
function sl2On(settings) { return String(((settings || {}).salesListsOrganizer) || 'on').trim().toLowerCase() !== 'off'; }

/**
 * o = { id, host, noun, chips: [[id, label]], chipOf(row), groups: [[id, label]], sorts: [[id, label]],
 *       defaults: { chip, group, sort }, table(rows) -> html, empty(chip) -> text, today, stages, followGroup, followOrder,
 *       oldestFirst, placeholder, tools (extra html), onDraw(host) }
 * Returns { set(rows), draw(), pick(chip), state }.
 */
function sl2Organizer(o) {
  const saved = _sl2Load(o.id) || {}, d = o.defaults || {};
  const valid = (list, v, dflt) => (list || []).some(x => x[0] === v) ? v : dflt;
  const st = { chip: valid([['all']].concat(o.chips || []), saved.chip, d.chip || 'all'), group: valid(o.groups, saved.group, d.group || 'month'),
               sort: valid(o.sorts, saved.sort, d.sort || 'newest'), folded: saved.folded && typeof saved.folded === 'object' ? saved.folded : {}, q: '' };
  const api = { rows: [], state: st };
  const host = o.host;
  host.innerHTML = '<div class="sl2">' +
    '<div class="sl2-chips" role="group" aria-label="Show"></div>' +
    '<div class="sl2-tools">' +
      '<label class="sl2-search"><span class="sl2-sr">Search</span><input type="search" class="sl2-q" autocomplete="off" placeholder="' + _sl2E(o.placeholder || 'Search') + '"></label>' +
      '<div class="sl2-seg" role="radiogroup" aria-label="Group by"><span class="sl2-thumb" aria-hidden="true"></span>' +
        (o.groups || []).map(g => '<button type="button" role="radio" class="sl2-segb" data-group="' + g[0] + '">' + _sl2E(g[1]) + '</button>').join('') + '</div>' +
      '<label class="sl2-sortw"><span class="sl2-sr">Sort</span><select class="sl2-sort">' +
        (o.sorts || []).map(s => '<option value="' + s[0] + '">' + _sl2E(s[1]) + '</option>').join('') + '</select></label>' +
      (o.tools || '') +
    '</div>' +
    '<p class="sl2-count" aria-live="polite"></p>' +
    '<div class="sl2-groups"></div></div>';
  const $ = (sel) => host.querySelector(sel);
  $('.sl2-sort').value = st.sort;
  $('.sl2-q').addEventListener('input', (e) => { st.q = e.target.value; api.draw(); });
  $('.sl2-sort').addEventListener('change', (e) => { st.sort = e.target.value; _sl2Save(o.id, st); api.draw(); });
  $('.sl2-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-chip]'); if (b) api.pick(b.getAttribute('data-chip')); });
  const seg = $('.sl2-seg');
  const setGroup = (g, focus) => {
    st.group = g; _sl2Save(o.id, st); api.draw();
    if (focus) { const b = seg.querySelector('[data-group="' + g + '"]'); if (b) b.focus(); }
  };
  seg.addEventListener('click', (e) => { const b = e.target.closest('[data-group]'); if (b) setGroup(b.getAttribute('data-group'), false); });
  seg.addEventListener('keydown', (e) => {
    const ids = (o.groups || []).map(g => g[0]), i = ids.indexOf(st.group);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    setGroup(ids[e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + step + ids.length) % ids.length], true);
  });
  $('.sl2-groups').addEventListener('toggle', (e) => {
    const det = e.target;
    if (!det || !det.matches || !det.matches('details.sl2-group')) return;
    const k = st.group + '|' + det.getAttribute('data-g');
    if (det.open) delete st.folded[k]; else st.folded[k] = 1;
    _sl2Save(o.id, st);
  }, true);

  api.pick = (chip) => { st.chip = chip; _sl2Save(o.id, st); api.draw(); };
  api.set = (rows) => { api.rows = rows || []; api.draw(); };
  api.draw = () => {
    const counts = slmChipCounts(api.rows, o.chipOf);
    $('.sl2-chips').innerHTML = [['all', 'All']].concat(o.chips || []).map(c => {
      const n = counts[c[0]] || 0, on = st.chip === c[0];
      if (!n && !on && c[0] !== 'all' && c[2] !== 'keep') return '';
      return '<button type="button" class="sl2-chip' + (on ? ' on' : '') + '" data-chip="' + c[0] + '" aria-pressed="' + on + '">' + _sl2E(c[1]) +
        ' <span class="n">' + n + '</span></button>';
    }).join('');
    seg.querySelectorAll('[data-group]').forEach(b => {
      const on = b.getAttribute('data-group') === st.group;
      b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on);
    });
    const onBtn = seg.querySelector('.sl2-segb.on'), thumb = seg.querySelector('.sl2-thumb');
    if (onBtn && thumb && thumb.style && typeof onBtn.offsetLeft === 'number') {
      thumb.style.width = onBtn.offsetWidth + 'px';
      thumb.style.transform = 'translateX(' + onBtn.offsetLeft + 'px)';
    }
    const inChip = api.rows.filter(r => { const c = o.chipOf(r); return st.chip === 'all' ? c !== 'archived' : c === st.chip; });
    const shown = slmSearch(inChip, st.q);
    const groups = slmGroup(shown, st.group, { today: o.today, sort: st.sort, stages: o.stages, followGroup: o.followGroup, followOrder: o.followOrder, oldestFirst: !!o.oldestFirst });
    const value = shown.reduce((t, r) => t + (Number(r.value) || 0), 0);
    $('.sl2-count').textContent = shown.length ? slmCountLine(shown.length, inChip.length, value, o.noun) : '';
    const money = (v) => v ? ' · ₱' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    $('.sl2-groups').innerHTML = !shown.length
      ? '<p class="sl2-empty">' + _sl2E(st.q ? 'Nothing matches “' + st.q + '”.' : (o.empty ? o.empty(st.chip) : 'Nothing here.')) + '</p>'
      : groups.map((g, i) => {
          const folded = st.folded[st.group + '|' + g.key] || (st.folded[st.group + '|' + g.key] === undefined && i >= 6 && groups.length > 8);
          return '<details class="sl2-group" data-g="' + _sl2E(g.key) + '"' + (folded ? '' : ' open') + '><summary class="sl2-gh"><span class="sl2-gl">' + _sl2E(g.label) +
            '</span><span class="sl2-gm">' + g.count + ' ' + _sl2E(o.noun || 'record') + (g.count === 1 ? '' : 's') + money(g.value) + '</span></summary>' +
            '<div class="sl2-gb">' + o.table(g.rows.map(r => r.raw)) + '</div></details>';
        }).join('');
    if (o.onDraw) o.onDraw(host);
  };
  return api;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { sl2On, sl2Organizer };
