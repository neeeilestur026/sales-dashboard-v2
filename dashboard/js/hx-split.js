/* hx-split.js — A387 · a list beside its detail, the way Contacts lays out on a Mac: from 1180px the record sits in a
 * pane beside the list, each scrolling on its own and together filling the window; narrower, it opens as a sheet over
 * the page (a bottom sheet on a phone, from apple.css). Taken from the Client Book's A362 split so a third page does
 * not copy it again; the Item Book is the first to use it.
 *
 *   const sv = hxSplitView({ split: 'ibSplit', pane: 'ibPane', prefix: 'ib', label: 'ibCardTitle', onClose });
 *   sv.wide()                    — is the pane showing?
 *   sv.fit()                     — size the split to the window (call on load and resize)
 *   sv.show(html, { key, pane }) — draw a record (pane: beside the list when there is room) or a form (always a sheet);
 *                                  returns the fresh element, so the listeners of the last one never pile up
 *   sv.close()                   — close the sheet (the pane keeps its record)
 */
function hxSplitView(o) {
  o = Object.assign({ mq: '(min-width: 1180px)', prefix: 'hx', min: 440 }, o || {});
  const P = o.prefix, byId = (id) => document.getElementById(id);
  let ov = null;
  const api = {};
  api.wide = () => { try { return !!byId(o.pane) && !!(window.matchMedia && window.matchMedia(o.mq).matches); } catch (e) { return false; } };
  api.fit = () => {
    const sp = byId(o.split);
    if (!sp || !sp.getBoundingClientRect || !sp.style || !sp.style.setProperty) return;
    if (!api.wide()) { sp.style.removeProperty('--' + P + '-h'); return; }
    const top = sp.getBoundingClientRect().top + (window.scrollY || 0);
    let h = Math.max(o.min, Math.round(window.innerHeight - top - 20));
    sp.style.setProperty('--' + P + '-h', h + 'px');
    const over = document.documentElement.scrollHeight - window.innerHeight;
    if (over > 0 && h - over >= o.min) sp.style.setProperty('--' + P + '-h', (h - over) + 'px');
  };
  const overlay = () => {
    if (ov) return ov;
    ov = document.createElement('div');
    ov.className = 'flow-modal-overlay ' + P + '-overlay';
    ov.innerHTML = '<div class="flow-modal ' + P + '-modal" role="dialog" aria-modal="true"' + (o.label ? ' aria-labelledby="' + o.label + '"' : '') + '></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => {
      if (ev.target === ov) { api.close(); return; }
      const b = ev.target.closest ? ev.target.closest('button') : null;
      if (b && b.hasAttribute('data-close')) api.close();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ov.classList.contains('open')) api.close(); });
    return ov;
  };
  api.show = (html, so) => {
    so = so || {};
    if (so.pane && api.wide()) {
      if (ov && ov.classList.contains('open')) { ov.classList.remove('open'); document.body.classList.remove(P + '-open-dlg'); }
      const pane = byId(o.pane), was = pane.querySelector('.' + P + '-sheet'), same = !!was && was.getAttribute('data-key') === String(so.key || ''), top = pane.scrollTop;
      pane.innerHTML = '<div class="' + P + '-sheet ' + P + '-detail' + (same ? '' : ' ' + P + '-enter') + '" data-key="' + String(so.key || '').replace(/"/g, '') + '">' + html + '</div>';
      pane.scrollTop = same ? top : 0;
      return pane.firstChild;
    }
    const box = overlay().querySelector('.' + P + '-modal');
    box.innerHTML = '<div class="' + P + '-sheet' + (so.pane ? ' ' + P + '-detail' : '') + '" data-key="' + String(so.key || '').replace(/"/g, '') + '">' + html + '</div>';
    ov.classList.add('open');
    document.body.classList.add(P + '-open-dlg');
    return box.firstChild;
  };
  api.open = () => !!(ov && ov.classList.contains('open'));
  api.close = () => {
    if (!ov || !ov.classList.contains('open')) return;
    ov.classList.remove('open');
    document.body.classList.remove(P + '-open-dlg');
    if (o.onClose) o.onClose();
  };
  return api;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { hxSplitView };
