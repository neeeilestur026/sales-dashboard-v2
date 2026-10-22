/* client-book-card.js — A350 · the Client Book's card on the director's home (a private trial).
 *
 * The counts and the way in. It reads getClientBook once (its own trial store) and counts with cbSummary
 * (js/client-book-model.js); without FlowAPI 178 it says so in one line. It never writes anything. */

async function clientBookCard(id) {
  const el = document.getElementById(id);
  if (!el || typeof postFlow !== 'function' || typeof cbSummary !== 'function') return;
  const r = await postFlow('getClientBook', {}).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (!r || !r.success) {
    el.innerHTML = '<p class="cbc-note">' + (/Unknown action|not a secured action/i.test((r && r.message) || '')
      ? 'The Client Book needs the FlowAPI update (version 178) before it can save.' : 'Could not read the Client Book just now.') + '</p>';
    return;
  }
  const s = cbSummary(r.clients || [], r.log || [], flowToday());
  if (!s.total) { el.innerHTML = '<p class="cbc-note">No clients yet. Open the Client Book to add the first one.</p>'; return; }
  const tile = (n, label, warn) => '<div class="cbc-tile' + (warn && n ? ' warn' : '') + '"><span class="v">' + n + '</span><span class="l">' + label + '</span></div>';
  el.innerHTML = '<div class="cbc-tiles">' + tile(s.total, s.total === 1 ? 'Client' : 'Clients') + tile(s.major, 'Major') + tile(s.accredited, 'Accredited') + tile(s.onProcess, 'On process') +
    tile(s.notAccredited, 'Not accredited') + tile(s.needsUpdate, s.needsUpdate === 1 ? 'Needs an update' : 'Need an update', true) + '</div>';
}
