/* A338 — the website bridge, backend (FlowAPI 172).
 *
 * Run:  node tests/flow/website-bridge.js
 *
 * hiescorp.com keeps every quote request and contact message; websiteCollectTick collects them every
 * 5 minutes from the website's private feed into WebRequests, and the admin / director turn them into
 * pricing requests. The feed is stubbed with tests/flow/fixtures/website-feed.json, the same sample the
 * website half is built against. Pinned here:
 *   • nothing is collected unless configured, never on a staging copy, never with the kill switch on;
 *   • a request is filed once (the key ring survives a stale sheet read), acknowledged only after it is
 *     written, and a failed acknowledgement just means the next run acknowledges again;
 *   • every visitor string is safe as a cell: no formula, no markup;
 *   • failures are recorded in plain words, and three in a row past 30 minutes raise the alarm;
 *   • the alert email carries counts and a link only, at most one per 30 minutes;
 *   • converting: item-less requests refused, the clientRef check first (a retry makes no second
 *     prospect or pricing request), an existing client is never patched, HE numbers kept as the
 *     requested code, no inventory added;
 *   • admin and director only, through the secured path; spam loses its personal data after 30 days.
 */
const fs = require('fs');
const path = require('path');
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 700))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const section = (t) => console.log('\n== ' + t + ' ==');

const FEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'website-feed.json'), 'utf8'));
const ADMIN = { actorRole: 'admin', actorName: 'Ana Admin' };
const DIR = { actorRole: 'director', actorName: 'Neil Estur' };
const KEY = 'k'.repeat(64);
const URL_ = 'https://hiescorp.com/api/requests-feed.php';

/** A context with a scripted website. `answers` is a queue of {code, body|text}; GETs and POSTs share it
 *  unless a handler is given. Every call is recorded with what the sheet held at that moment. */
function boot(opts) {
  opts = opts || {};
  const store = Object.assign({ ActivityLog: [], Clients: [], PricingRequests: [], PricingRequestItems: [], Inventory: [], FlowSettings: [] }, opts.store || {});
  const c = load(undefined, store);
  if (opts.configured !== false) { c.__props.WEBSITE_FEED_URL = URL_; c.__props.WEBSITE_FEED_KEY = KEY; c.__props.WEBSITE_ALERT_EMAIL = 'neil@example.com'; }
  Object.assign(c.__props, opts.props || {});
  c.__calls = []; c.__mail = []; c.__log = [];
  c.MailApp = { sendEmail: (to, subject, body) => c.__mail.push({ to, subject, body }) };
  c.Logger = { log: (m) => c.__log.push(String(m)) };
  c.UrlFetchApp = { fetch: (url, o) => {
    c.__calls.push({ url, o, rowsAtCall: (store.WebRequests || []).length });
    const a = opts.handler ? opts.handler(url, o, c.__calls.length) : { code: 200, body: o.method === 'post' ? { ok: true, acked: JSON.parse(o.payload).ack.length } : FEED };
    if (a.throw) throw new Error(a.throw);
    const text = a.text !== undefined ? a.text : JSON.stringify(a.body);
    return { getResponseCode: () => a.code, getContentText: () => text };
  } };
  return c;
}
const rows = (c) => c.__store.WebRequests || [];
const gets = (c) => c.__calls.filter(x => x.o.method === 'get');
const posts = (c) => c.__calls.filter(x => x.o.method === 'post');

section('not connected, staging, switched off, roles');
{
  let c = boot({ configured: false });
  let r = call(c, 'collectWebsiteRequestsNow', ADMIN);
  ok('not configured: says so and calls nobody', !r.success && /Not connected yet/.test(r.message) && c.__calls.length === 0, r);
  ok('  and a read does not create the tab', call(c, 'getWebRequests', ADMIN).count === 0 && c.__store.WebRequests === undefined);
  c = boot({ props: { HX_ENV: 'staging' } });
  r = call(c, 'collectWebsiteRequestsNow', DIR);
  ok('a staging copy never collects (it would take live requests)', !r.success && /staging/.test(r.message) && c.__calls.length === 0, r);
  c = boot({ props: { WEBSITE_COLLECT_OFF: '1' } });
  r = call(c, 'collectWebsiteRequestsNow', DIR);
  ok('WEBSITE_COLLECT_OFF stops it', !r.success && r.off === true && c.__calls.length === 0, r);
  c = boot();
  ['sales', 'accounting', 'management', 'hr', ''].forEach(role => {
    const who = { actorRole: role, actorName: 'X' };
    const all = ['getWebRequests', 'collectWebsiteRequestsNow', 'convertWebRequest', 'setWebRequestStatus', 'eraseWebRequest']
      .map(a => call(c, a, Object.assign({ ref: 'Q-261016-4821', status: 'Closed' }, who)));
    ok('  ' + (role || 'no role') + ': every website-request action is refused', all.every(x => x.success === false), all.map(x => x.message));
  });
  ok('  and nothing was fetched', c.__calls.length === 0);
  r = call(c, 'getWebRequests', Object.assign({ flowSecret: '' }, ADMIN));
  ok('the inbox read is secured (visitors\' personal data): no secret, no data', !r.success && /through the app/.test(r.message), r);
  r = call(c, 'convertWebRequest', Object.assign({ flowSecret: '', ref: 'x' }, ADMIN));
  ok('  and so is every write', !r.success && /through the app/.test(r.message), r);
}

section('collecting');
{
  const c = boot();
  const r = call(c, 'collectWebsiteRequestsNow', ADMIN);
  ok('the admin collects the two waiting requests', r.success && r.collected === 2, r);
  eq('  rows filed', rows(c).map(x => x['Ref']), ['Q-261016-4821', 'C-261016-1177']);
  const g = gets(c)[0];
  ok('  GET with the key header, Accept JSON, a limit, no redirects, errors muted',
    g.url === URL_ + '?limit=50' && g.o.headers['X-Portal-Key'] === KEY && g.o.headers.Accept === 'application/json'
    && g.o.followRedirects === false && g.o.muteHttpExceptions === true, g);
  const p = posts(c)[0];
  ok('  acknowledged after the rows were written, by ref', p && p.rowsAtCall === 2 && JSON.stringify(JSON.parse(p.o.payload)) === JSON.stringify({ ack: ['Q-261016-4821', 'C-261016-1177'] }), p);
  const q = rows(c)[0];
  ok('  a quote row: status New, items kept with the HE number, counts', q['Status'] === 'New' && q['Kind'] === 'quote'
    && JSON.parse(q['Items JSON'])[0].sku === 'HE-01323' && q['Item Count'] === 1 && q['Unit Count'] === 2, q);
  ok('  markup in a category never survives (the sample\'s "<category name>")', JSON.parse(q['Items JSON'])[0].category === 'category name', JSON.parse(q['Items JSON'])[0]);
  ok('  a contact row has no items', rows(c)[1]['Kind'] === 'contact' && rows(c)[1]['Item Count'] === 0);
  ok('  every row is exactly the schema width', rows(c).every(x => Object.keys(x).filter(k => !k.startsWith('__')).length === c.SCHEMA.WebRequests.length));
  eq('one alert email', c.__mail.length, 1);
  const m = c.__mail[0];
  ok('  counts and a link only: no name, email, phone or company', /2 new website requests/.test(m.subject) && /website-requests\.html/.test(m.body)
    && !/Juan|Maria|acme|example\.com|917|Torque/i.test(m.subject + m.body), m);
  ok('  health is good', c._webHealth().fails === 0 && !!c._webHealth().okAt && !c._webHealth().error);

  // the website did not take the acknowledgement, so it sends the same two again
  const r2 = call(c, 'collectWebsiteRequestsNow', ADMIN);
  ok('the same feed again files nothing new', r2.success && r2.collected === 0 && rows(c).length === 2, r2);
  ok('  but still acknowledges both, so the website stops sending them', JSON.parse(posts(c)[1].o.payload).ack.length === 2);
  // a stale read across executions: the sheet looks empty, the key ring still knows
  const kept = c.__store.WebRequests; c.__store.WebRequests = [];
  call(c, 'collectWebsiteRequestsNow', ADMIN);
  ok('a stale (empty-looking) sheet still files nothing twice: the key ring remembers', c.__store.WebRequests.length === 0);
  c.__store.WebRequests = kept;
  ok('  the ring holds at most 300 keys', (() => { c._webRingAdd(Array.from({ length: 400 }, (_, i) => 'k' + i)); return c._webRing().length === 300; })());
  ok('the 5-minute trigger is websiteCollectTick, a plain top-level function', typeof c.websiteCollectTick === 'function' && /^function websiteCollectTick\(\) \{/m.test(fs.readFileSync(require('./gasload').GS, 'utf8')));
}

section('a stranger\'s text is safe as a cell');
{
  const evil = { ok: true, more: false, requests: [{ ref: 'Q-261016-9999', key: 'Q-261016-9999@x', kind: 'quote', createdAt: '2026-10-16T15:00:00+08:00',
    name: '=HYPERLINK("http://x","click")', company: '<img src=x onerror=alert(1)>Acme', email: '+cmd@x.ph', phone: '09170000000',
    location: '@SUM(A1)', subject: '', message: 'line one\n<script>alert(1)</script> 5 bar', items: [{ id: 1, sku: 'HE-00001', name: '-Torque', brand: 'RAD', qty: 5000 }] }] };
  const c = boot({ handler: (u, o) => ({ code: 200, body: o.method === 'post' ? { ok: true, acked: 1 } : evil }) });
  call(c, 'collectWebsiteRequestsNow', ADMIN);
  const r = rows(c)[0];
  ok('a formula never starts a cell', r['Name'].startsWith("'=") && r['Email'].startsWith("'+") && r['Location'].startsWith("'@"), r);
  ok('single-line fields lose < and >', !/[<>]/.test(r['Company']) && r['Company'] === 'img src=x onerror=alert(1)Acme', r['Company']);
  ok('a message keeps its meaning without markup', r['Message'] === 'line one\n‹script›alert(1)‹/script› 5 bar', r['Message']);
  ok('a phone keeps its leading 0 (a text column)', r['Phone'] === '09170000000' && c._TEXT_COLS.WebRequests.indexOf('Phone') >= 0);
  const it = JSON.parse(r['Items JSON'])[0];
  ok('an item name starting with - is neutralised, and qty is capped at 999', it.name === "'-Torque" && it.qty === 999, it);
  const bad = boot({ handler: (u, o) => ({ code: 200, body: o.method === 'post' ? { ok: true, acked: 0 } : { ok: true, requests: [{ ref: 'not-a-ref', name: 'x' }, null, 'junk'] } }) });
  const rb = call(bad, 'collectWebsiteRequestsNow', ADMIN);
  ok('entries that are not requests are skipped, not filed', rb.success && rows(bad).length === 0, rb);
}

section('failures are recorded in plain words');
{
  const cases = [
    [{ code: 401, body: { ok: false, error: 'key' } }, /refused the key/],
    [{ code: 200, text: '<html>Access denied</html>' }, /did not answer with data.*firewall/],
    [{ code: 301, text: '' }, /redirected.*exactly https:\/\/hiescorp\.com/],
    [{ code: 503, body: { ok: false, error: 'off' } }, /switched off on the website/],
    [{ code: 429, body: { ok: false, error: 'locked' } }, /locked the feed/],
  ];
  cases.forEach(([ans, re]) => {
    const c = boot({ handler: () => ans });
    const r = call(c, 'collectWebsiteRequestsNow', ADMIN);
    ok('HTTP ' + ans.code + ': ' + re.source.slice(0, 40), !r.success && re.test(r.message) && re.test(c._webHealth().error) && c._webHealth().fails === 1, r);
  });
  const c = boot({ handler: () => ({ throw: 'Address unavailable' }) });
  let threw = false; try { c.websiteCollectTick(); } catch (e) { threw = true; }
  ok('the trigger never throws: an unreachable website is recorded', !threw && /Address unavailable/.test(c._webHealth().error));
  c.websiteCollectTick(); c.websiteCollectTick();
  c.__props.web_ok_at = new Date(Date.now() - 45 * 60000).toISOString();
  ok('three failures and no good read for 30+ minutes = stale (the urgent "Needs you" line)', c._webHealth().stale === true && c._webHealth().fails === 3);
  c.__props.web_ok_at = new Date(Date.now() - 5 * 60000).toISOString();
  ok('  but not when the last good read was 5 minutes ago', c._webHealth().stale === false);
  const r = call(c, 'getWebRequests', DIR);
  ok('  the inbox read carries the health', r.success && r.health && r.health.fails === 3 && r.health.configured === true, r);
  // the acknowledgement fails after the rows were written
  const a = boot({ handler: (u, o) => o.method === 'post' ? { code: 500, text: 'oops' } : { code: 200, body: FEED } });
  const ra = call(a, 'collectWebsiteRequestsNow', ADMIN);
  ok('a failed acknowledgement keeps the rows and says so', ra.success && rows(a).length === 2 && /did not take the acknowledgement/.test(a._webHealth().error), a._webHealth());
}

section('the alert email, throttled');
{
  let n = 0;
  const one = (i) => ({ ok: true, more: false, requests: [{ ref: 'Q-261016-10' + (10 + i), key: 'k' + i, kind: 'quote', createdAt: '2026-10-16T15:00:00+08:00', name: 'A', email: 'a@b.c', items: [] }] });
  const c = boot({ handler: (u, o) => o.method === 'post' ? { code: 200, body: { ok: true, acked: 1 } } : { code: 200, body: one(n++) } });
  call(c, 'collectWebsiteRequestsNow', ADMIN); call(c, 'collectWebsiteRequestsNow', ADMIN); call(c, 'collectWebsiteRequestsNow', ADMIN);
  ok('three batches within 30 minutes send one email', c.__mail.length === 1 && c.__props.web_alert_n === '2', { mails: c.__mail.length, held: c.__props.web_alert_n });
  c.__props.web_alert_at = String(Date.now() - 31 * 60000);
  const empty = boot(); // reuse the same context with an empty feed
  c.UrlFetchApp = { fetch: (u, o) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, more: false, requests: [] }) }) };
  call(c, 'collectWebsiteRequestsNow', ADMIN);
  ok('  what was held back goes out with the next run, even an empty one', c.__mail.length === 2 && /2 new website requests/.test(c.__mail[1].subject), c.__mail[1]);
  c.__props.WEBSITE_ALERT_EMAIL = '';
  ok('  no address set, no email', (() => { const before = c.__mail.length; c._webAlert([{}]); return c.__mail.length === before; })());
  void empty;
}

section('the inbox');
{
  const c = boot();
  call(c, 'collectWebsiteRequestsNow', ADMIN);
  let r = call(c, 'getWebRequests', Object.assign({ countOnly: true }, DIR));
  ok('countOnly: the number of New requests, no rows', r.success && r.count === 2 && r.data === undefined, r);
  call(c, 'setWebRequestStatus', Object.assign({ ref: 'C-261016-1177', status: 'Closed', note: 'Replied by phone' }, ADMIN));
  r = call(c, 'getWebRequests', DIR);
  ok('the full read: New first, then the rest, with items parsed', r.success && r.count === 1 && r.data[0].status === 'New' && r.data[1].status === 'Closed'
    && Array.isArray(r.data[0].items) && r.data[0].items[0].sku === 'HE-01323', r.data && r.data.map(x => x.status));
  ok('  phone comes back as text', typeof r.data[0].phone === 'string');
}

section('make a pricing request');
{
  const c = boot({ store: { Clients: [{ 'Customer': 'ACME MINING CORPORATION', 'Email': 'buyer@acme.ph', 'Phone': '', 'Contact Person': '', 'Stage': 'Customer' }] } });
  call(c, 'collectWebsiteRequestsNow', ADMIN);
  let r = call(c, 'convertWebRequest', Object.assign({ ref: 'C-261016-1177' }, DIR));
  ok('a contact message with no products is refused in plain words', !r.success && /lists no products/.test(r.message), r);
  r = call(c, 'convertWebRequest', Object.assign({ ref: 'Q-261016-4821', customer: 'Acme Mining Corporation', salesperson: 'Kimberlyn Blones' }, DIR));
  ok('the director makes the pricing request', r.success && /^PR-\d{6}-\d{3}$/.test(r.prNo) && r.clientCreated === false, r);
  const pr = c.__store.PricingRequests[0], items = c.__store.PricingRequestItems;
  ok('  for the existing client, by alias-aware name', pr['Customer'] === 'ACME MINING CORPORATION' && c.__store.Clients.length === 1, pr);
  const cl = c.__store.Clients[0];
  ok('  and the existing client is NOT patched from the visitor (anyone can claim to be a customer)', cl['Email'] === 'buyer@acme.ph' && cl['Phone'] === '' && cl['Contact Person'] === '', cl);
  ok('  clientRef web:<ref>, salesperson, requested by the director, notes carry the ref and message',
    pr['Client Ref'] === 'web:Q-261016-4821' && pr['Salesperson'] === 'Kimberlyn Blones' && pr['Requested By'] === 'Neil Estur'
    && /Website request Q-261016-4821: Needed by November/.test(pr['Notes']), pr);
  const doc = JSON.parse(pr['Doc JSON']);
  ok('  the visitor\'s contact details live on the pricing request only', doc.contactPerson === 'Juan Dela Cruz' && doc.contactEmail === 'juan@acme.ph' && pr['Client Location'] === 'Surigao del Norte', doc);
  ok('  the line keeps the HE number as the requested code, brand + name, category / range',
    items.length === 1 && items[0]['Item No'] === 'HE-01323' && items[0]['Item Name'] === 'Hydraulic Technologies Synchronous Hydraulic Power Unit ( Shpu) Series'
    && items[0]['Qty'] === 2 && items[0]['Remarks'] === 'category name / range name', items[0]);
  ok('  no inventory item is added', c.__store.Inventory.length === 0);
  const row = rows(c)[0];
  ok('  the request is stamped Converted with the PR', row['Status'] === 'Converted' && row['PR No'] === r.prNo && row['Handled By'] === 'Neil Estur' && row['Customer'] === 'ACME MINING CORPORATION', row);
  ok('  and the daily report gets one task row', c.__store.ActivityLog.some(a => JSON.stringify(a).indexOf('Website request') >= 0));
  const again = call(c, 'convertWebRequest', Object.assign({ ref: 'Q-261016-4821' }, ADMIN));
  ok('a second click returns the same pricing request and makes nothing new', again.success && again.duplicate && again.prNo === r.prNo
    && c.__store.PricingRequests.length === 1 && c.__store.PricingRequestItems.length === 1, again);
  ok('a converted request cannot be closed or marked spam', !call(c, 'setWebRequestStatus', Object.assign({ ref: 'Q-261016-4821', status: 'Spam' }, ADMIN)).success);
}
{
  // a new company → a Prospect; a crash between the pricing request and the stamp heals without a second one
  const c = boot();
  call(c, 'collectWebsiteRequestsNow', ADMIN);
  const r = call(c, 'convertWebRequest', Object.assign({ ref: 'Q-261016-4821' }, ADMIN));
  const cl = c.__store.Clients[0];
  ok('an unknown company becomes a Prospect with the visitor\'s details', r.success && r.clientCreated && cl['Stage'] === 'Prospect'
    && cl['Customer'] === 'Acme Mining Corp.' && cl['Email'] === 'juan@acme.ph' && cl['RFQ Ref'] === 'Q-261016-4821', cl);
  // undo the stamp as if the run had died right after createPricingRequest
  Object.assign(rows(c)[0], { 'Status': 'New', 'PR No': '', 'Handled By': '', 'Handled At': '', 'Customer': '' });
  const again = call(c, 'convertWebRequest', Object.assign({ ref: 'Q-261016-4821' }, ADMIN));
  ok('after a crash the retry stamps the SAME pricing request: no second request, no second prospect',
    again.success && again.prNo === r.prNo && c.__store.PricingRequests.length === 1 && c.__store.Clients.length === 1 && rows(c)[0]['PR No'] === r.prNo, again);
}
{
  const c = boot();
  call(c, 'collectWebsiteRequestsNow', ADMIN);
  call(c, 'setWebRequestStatus', Object.assign({ ref: 'Q-261016-4821', status: 'Closed' }, ADMIN));
  let r = call(c, 'convertWebRequest', Object.assign({ ref: 'Q-261016-4821' }, ADMIN));
  ok('a closed request must be reopened first', !r.success && /Reopen it first/.test(r.message), r);
  r = call(c, 'setWebRequestStatus', Object.assign({ ref: 'Q-261016-4821', status: 'New' }, DIR));
  ok('  reopening puts it back in the inbox', r.success && rows(c)[0]['Status'] === 'New', r);
  r = call(c, 'convertWebRequest', Object.assign({ ref: 'Q-261016-4821', customer: '=IMPORTXML("x")' }, ADMIN));
  ok('a customer name typed as a formula is stored as text everywhere', r.success && c.__store.PricingRequests[0]['Customer'].startsWith("'=") && c.__store.Clients[0]['Customer'].startsWith("'="), c.__store.PricingRequests[0]['Customer']);
  r = call(c, 'setWebRequestStatus', Object.assign({ ref: 'C-261016-1177', status: 'Deleted' }, ADMIN));
  ok('an unknown status is refused', !r.success && /Closed, Spam or New/.test(r.message), r);
}

section('privacy: erase, and spam after 30 days');
{
  const c = boot();
  call(c, 'collectWebsiteRequestsNow', ADMIN);
  call(c, 'convertWebRequest', Object.assign({ ref: 'Q-261016-4821' }, ADMIN));
  let r = call(c, 'eraseWebRequest', Object.assign({ ref: 'Q-261016-4821' }, DIR));
  const row = rows(c)[0];
  ok('erase blanks the personal data and keeps the ref, status and PR', r.success && row['Name'] === '' && row['Email'] === '' && row['Items JSON'] === ''
    && row['Ref'] === 'Q-261016-4821' && row['Status'] === 'Converted' && !!row['PR No'] && /erased by Neil Estur/.test(row['Note']), row);
  ok('  and says the pricing request keeps its own copy', /keeps its own copy/.test(r.message), r.message);
  // spam: one 31 days old, one 5 days old
  call(c, 'setWebRequestStatus', Object.assign({ ref: 'C-261016-1177', status: 'Spam' }, ADMIN));
  const spam = rows(c)[1];
  spam['Handled At'] = new Date(Date.now() - 31 * 86400000);
  c.__store.WebRequests.push(Object.assign({}, spam, { 'Ref': 'C-261016-2000', 'Key': 'fresh', 'Handled At': new Date(Date.now() - 5 * 86400000), 'Name': 'Fresh Spam' }));
  c.__props.web_purge_at = String(Date.now() - 2 * 86400000);
  c.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, more: false, requests: [] }) }) };
  call(c, 'collectWebsiteRequestsNow', ADMIN);
  ok('spam older than 30 days loses its personal data in the daily sweep', rows(c)[1]['Name'] === '' && /removed after 30 days/.test(rows(c)[1]['Note']), rows(c)[1]);
  ok('  newer spam keeps it for now', rows(c)[2]['Name'] === 'Fresh Spam');
}

section('the editor self-test logs no personal data');
{
  const c = boot();
  c.websiteFeedSelfTest();
  ok('it reports the count only', c.__log.length === 1 && /OK: the website answered\. Waiting requests: 2/.test(c.__log[0]) && !/Juan|Maria|acme/i.test(c.__log.join(' ')), c.__log);
  const d = boot({ configured: false });
  d.websiteFeedSelfTest();
  ok('  and says what to set when it is not configured', /WEBSITE_FEED_URL and WEBSITE_FEED_KEY/.test(d.__log[0]));
}

console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
