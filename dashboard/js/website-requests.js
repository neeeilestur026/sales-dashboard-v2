/* website-requests.js — A338 · requests from hiescorp.com: quote lists and contact messages.
   FlowAPI collects them from the website every 5 minutes (websiteCollectTick); the admin and the director
   answer them here. A quote with products becomes a pricing request in one click (the existing sourcing →
   quotation → SO chain takes it from there); anything else is closed once replied, or marked spam.

   EVERY FIELD ON THIS PAGE WAS TYPED BY A STRANGER on the website. Each one goes through flowEsc, links
   are built only as mailto:/tel:, and nothing else here turns their text into markup. */
let wrSession = null;
let wrData = [];
let wrLive = false;
let wrOpen = '';            // the ref whose "Make pricing request" form is open

document.addEventListener('DOMContentLoaded', async () => {
  wrSession = requireWebRequestsAccess();
  if (!wrSession) return;
  renderNavbar('website-requests');
  document.getElementById('wrFilter').addEventListener('change', wrRender);
  document.getElementById('wrList').addEventListener('click', wrClick);
  document.getElementById('wrCheck').addEventListener('click', wrCheckNow);
  document.getElementById('wrRefresh').addEventListener('click', () => wrLoad());
  try { wrLive = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(172) : false; }
  catch (e) { wrLive = false; }
  if (!wrLive) { wrNotLive(); return; }
  wrLoadPeople();
  await wrLoad();
});

function wrNotLive() {
  document.getElementById('wrHealth').textContent = 'Not connected yet. This inbox starts working once FlowAPI 172 is pasted and the website is connected.';
  document.getElementById('wrList').innerHTML = '<div class="fc-empty">Website requests will appear here.</div>';
  document.getElementById('wrCheck').disabled = true;
}

async function wrLoad() {
  const list = document.getElementById('wrList');
  let r;
  try { r = await postFlow('getWebRequests', {}); } catch (e) { r = { success: false, message: e.message }; }
  if (!r || !r.success) {
    list.innerHTML = '<div class="fc-empty">' + flowEsc((r && r.message) || 'Could not load the website requests.') + '</div>';
    return;
  }
  wrData = r.data || [];
  wrShowHealth(r.health || {});
  wrRender();
}

/** Who quotes it: the people already named on pricing requests, offered as suggestions. */
async function wrLoadPeople() {
  try {
    const r = await fetchFlow('getPricingRequests');
    const names = Array.from(new Set(((r && r.data) || []).map(x => String(x.salesperson || '').trim()).filter(Boolean))).sort();
    document.getElementById('wrPeople').innerHTML = names.map(n => `<option value="${flowEsc(n)}">`).join('');
  } catch (e) { /* suggestions only */ }
}

function wrAgo(iso) {
  const t = new Date(iso).getTime();
  if (!iso || isNaN(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.round(m / 60) + ' h ago';
  return wrWhen(iso);
}
function wrWhen(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-PH', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function wrShowHealth(h) {
  const el = document.getElementById('wrHealth');
  let text = '', bad = false;
  if (h.staging) text = 'This is a staging copy: it never collects website requests.';
  else if (!h.configured) text = 'Not connected yet: the website address and key are not set in FlowAPI (WEBSITE_FEED_URL, WEBSITE_FEED_KEY).';
  else if (h.off) text = 'Collecting is switched off (WEBSITE_COLLECT_OFF).';
  else if (h.fails > 0 && h.error) {
    bad = true;
    text = 'The last check failed ' + wrAgo(h.errAt) + ': ' + h.error + '.' + (h.okAt ? ' Last good check ' + wrAgo(h.okAt) + '.' : '');
  } else if (h.okAt) text = 'Checked ' + wrAgo(h.okAt) + '. New requests arrive every 5 minutes.';
  else text = 'Connected. The first check runs within 5 minutes.';
  el.textContent = text;                       // textContent: the error can quote the website
  el.classList.toggle('bad', bad);
}

function wrRender() {
  const want = document.getElementById('wrFilter').value;
  const rows = want ? wrData.filter(q => q.status === want) : wrData;
  const fresh = wrData.filter(q => q.status === 'New').length;
  document.getElementById('wrMeta').textContent = fresh ? fresh + ' to answer' : 'Nothing waiting';
  document.getElementById('wrList').innerHTML = rows.length ? rows.map(wrCard).join('')
    : '<div class="fc-empty">' + (want === 'New' ? 'No new requests. Quote lists and messages from hiescorp.com land here.' : 'Nothing to show.') + '</div>';
}

function wrCard(q) {
  const quote = q.kind !== 'contact';
  const items = q.items || [];
  const erased = !q.name && !q.email && !items.length && /erased|removed/i.test(q.note || '');
  const who = [q.name, q.company].filter(Boolean).map(flowEsc).join(' · ') || (erased ? 'Personal data erased' : 'No name given');
  const phone = String(q.phone || '').replace(/[^\d+]/g, '');
  const contact = [
    q.email ? `<a href="mailto:${flowEsc(String(q.email).split('?')[0])}">${flowEsc(q.email)}</a>` : '',   // never a pre-filled subject or body
    q.phone ? (phone ? `<a href="tel:${flowEsc(phone)}">${flowEsc(q.phone)}</a>` : flowEsc(q.phone)) : '',
    flowEsc(q.location)
  ].filter(Boolean).join(' · ');
  const lines = items.length ? `<table class="wr-items"><tbody>${items.map(it => `<tr>
      <td>${flowEsc(it.sku)}</td><td>${flowEsc([it.brand, it.name].filter(Boolean).join(' '))}${it.category || it.range ? `<div class="fc-dim">${flowEsc([it.category, it.range].filter(Boolean).join(' / '))}</div>` : ''}</td>
      <td class="num">${flowEsc(it.qty)}</td></tr>`).join('')}</tbody></table>` : '';
  const text = [q.subject, q.message].filter(Boolean).join('\n');
  let state = '';
  if (q.status === 'Converted') state = `Pricing request <a href="flow-pricing-request.html?pr=${encodeURIComponent(q.prNo)}">${flowEsc(q.prNo)}</a> for ${flowEsc(q.customer)}${q.salesperson ? ', quoted by ' + flowEsc(q.salesperson) : ''} · by ${flowEsc(q.handledBy)}`;
  else if (q.status !== 'New') state = `${flowEsc(q.status)} by ${flowEsc(q.handledBy)} ${flowEsc(wrWhen(q.handledAt))}${q.note ? ' · ' + flowEsc(q.note) : ''}`;
  else if (q.note) state = flowEsc(q.note);
  const acts = [];
  if (q.status === 'New') {
    if (quote && items.length) acts.push(`<button type="button" class="btn btn-sm btn-primary" data-act="convert" data-ref="${flowEsc(q.ref)}">Make pricing request</button>`);
    acts.push(`<button type="button" class="btn btn-sm btn-secondary" data-act="close" data-ref="${flowEsc(q.ref)}">Close</button>`);
    acts.push(`<button type="button" class="btn btn-sm btn-secondary" data-act="spam" data-ref="${flowEsc(q.ref)}">Spam</button>`);
  } else if (q.status !== 'Converted') acts.push(`<button type="button" class="btn btn-sm btn-secondary" data-act="reopen" data-ref="${flowEsc(q.ref)}">Reopen</button>`);
  if (!erased) acts.push(`<button type="button" class="btn btn-sm btn-secondary" data-act="erase" data-ref="${flowEsc(q.ref)}">Erase personal data</button>`);
  const form = wrOpen === q.ref ? `<div class="flow-form wr-form">
      <div><label for="wrCust">Customer</label><input id="wrCust" type="text" maxlength="160" value="${flowEsc(q.company || q.name)}"></div>
      <div><label for="wrSales">Salesperson who quotes it</label><input id="wrSales" type="text" maxlength="80" list="wrPeople" placeholder="Optional"></div>
      <div class="full wr-act"><button type="button" class="btn btn-sm btn-primary" data-act="convert-go" data-ref="${flowEsc(q.ref)}">Make it</button>
        <button type="button" class="btn btn-sm btn-secondary" data-act="convert-cancel">Cancel</button>
        <span class="fc-dim">An existing client with this name is used as it is; a new name becomes a prospect.</span></div>
    </div>` : '';
  return `<div class="fc-card wr-card" data-status="${flowEsc(q.status)}">
    <div class="fc-top"><b>${who}</b><span class="fc-dim">${flowEsc(q.ref)}</span></div>
    <div class="fc-line">${quote ? 'Quote request' : 'Message'}${items.length ? ' · ' + items.length + ' product' + (items.length === 1 ? '' : 's') + ', ' + flowEsc(q.unitCount) + ' unit' + (q.unitCount === 1 ? '' : 's') : ''} · ${flowEsc(wrWhen(q.sentAt || q.receivedAt))}</div>
    ${contact ? `<div class="fc-line">${contact}</div>` : ''}
    ${lines}
    ${text ? `<div class="fc-line wr-msg">${flowEsc(text)}</div>` : ''}
    ${state ? `<div class="fc-line fc-dim">${state}</div>` : ''}
    ${acts.length ? `<div class="wr-act">${acts.join('')}</div>` : ''}
    ${form}
  </div>`;
}

async function wrClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, ref = b.dataset.ref;
  if (act === 'convert') { wrOpen = ref; wrRender(); const c = document.getElementById('wrCust'); if (c) c.focus(); return; }
  if (act === 'convert-cancel') { wrOpen = ''; wrRender(); return; }
  let action = '', params = { ref };
  if (act === 'convert-go') {
    const customer = document.getElementById('wrCust').value.trim();
    if (!customer) { flowMsg('wrMsg', 'Enter the customer name.', false); return; }
    action = 'convertWebRequest';
    params = { ref, customer, salesperson: document.getElementById('wrSales').value.trim() };
  } else if (act === 'close') {
    const note = window.prompt('Close ' + ref + '. Note (optional), e.g. "Replied by email":', '');
    if (note === null) return;
    action = 'setWebRequestStatus'; params = { ref, status: 'Closed', note: note.trim() };
  } else if (act === 'spam') { action = 'setWebRequestStatus'; params = { ref, status: 'Spam' }; }
  else if (act === 'reopen') { action = 'setWebRequestStatus'; params = { ref, status: 'New' }; }
  else if (act === 'erase') {
    if (!window.confirm('Erase the personal data of ' + ref + '? Its reference and status stay. This cannot be undone.')) return;
    action = 'eraseWebRequest';
  } else return;
  b.disabled = true;
  try {
    const r = await postFlow(action, params);
    if (!r || !r.success) throw new Error((r && r.message) || 'Not saved.');
    wrOpen = '';
    flowMsg('wrMsg', r.message, true);
    await wrLoad();
    if (typeof flowRefreshActions === 'function') flowRefreshActions();
  } catch (err) { flowMsg('wrMsg', err.message, false); b.disabled = false; }
}

async function wrCheckNow() {
  const b = document.getElementById('wrCheck');
  b.disabled = true; b.textContent = 'Checking...';
  try {
    const r = await postFlow('collectWebsiteRequestsNow', {});
    flowMsg('wrMsg', (r && r.message) || 'No answer.', !!(r && r.success));
    if (r && r.health) wrShowHealth(r.health);
    await wrLoad();
    if (typeof flowRefreshActions === 'function') flowRefreshActions();
  } catch (e) { flowMsg('wrMsg', e.message, false); }
  finally { b.disabled = false; b.textContent = 'Check the website now'; }
}
