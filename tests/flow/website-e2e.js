/* A338 — the bridge end to end: the REAL website (PHP + MariaDB, run locally) and the REAL FlowAPI
 * collector, talking over HTTP. Opt-in: it skips unless a local copy of the website is running.
 *
 * Run (from hiescorp-shop):  KEEP=1 bash tools/tests/run.sh      → prints "Kept: <dir> (php -S <url>, …)"
 * then (from this repo):     WEBSITE_E2E_BASE=<url> WEBSITE_E2E_CONFIG=<dir>/hiescorp-config.php node tests/flow/website-e2e.js
 * and stop the website:      bash <hiescorp-shop>/tools/tests/run.sh --stop <dir>
 *
 * A visitor sends a quote (with markup and a formula in it) and a contact message; the collector files
 * them, acknowledges them so the website stops offering them, and (A341) the quote becomes a purchase
 * request by itself, owned by "Admin" and waiting for sourcing. Nothing the visitor typed may reach a
 * cell as markup or as a formula.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const { load, call } = require('./gasload');

const BASE = process.env.WEBSITE_E2E_BASE, CONF = process.env.WEBSITE_E2E_CONFIG;
if (!BASE || !CONF) { console.log('skipped: set WEBSITE_E2E_BASE and WEBSITE_E2E_CONFIG (see the header)'); process.exit(0); }
const KEY = (fs.readFileSync(CONF, 'utf8').match(/'portal_key'\s*=>\s*'([0-9a-f]{32,})'/) || [])[1];   // never printed
if (!KEY) { console.log('FAIL no portal_key in ' + CONF); process.exit(1); }

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };

/** One HTTP call through curl: [status, body]. Never follows redirects. */
function http(method, url, headers, body) {
  const args = ['-s', '-X', method, '-w', '\n%{http_code}'];
  Object.keys(headers || {}).forEach(h => args.push('-H', h + ': ' + headers[h]));
  if (body !== undefined) args.push('--data-binary', body);
  args.push(url);
  const out = execFileSync('curl', args, { encoding: 'utf8' });
  const i = out.lastIndexOf('\n');
  return [parseInt(out.slice(i + 1), 10), out.slice(0, i)];
}
const host = BASE.replace(/^https?:\/\//, '');
const send = (body) => http('POST', BASE + '/api/request.php', { 'Content-Type': 'application/json', 'Origin': BASE, 'Host': host },
  JSON.stringify(Object.assign({ hp: '', shownMs: 9000, idem: require('crypto').randomBytes(16).toString('hex') }, body)));

console.log('\n== a visitor sends a quote and a message');
const XSS = '<img src=x onerror=alert(1)>';
let [code, text] = send({ kind: 'quote', name: 'Juan Dela Cruz', company: '=HYPERLINK("http://x","Acme")', email: 'juan@acme.ph', phone: '09170000000',
  location: 'Surigao del Norte', subject: '', message: 'Needed by November ' + XSS, items: [{ id: 1323, qty: 2 }, { id: 145, qty: 1 }] });
const quote = JSON.parse(text || '{}');
ok('the website takes the quote and answers with its ref', code === 200 && /^Q-\d{6}-\d{4,6}$/.test(quote.ref), [code, text]);
[code, text] = send({ kind: 'quote', name: 'Juan ' + XSS, company: '', email: 'x@y.ph', items: [{ id: 1323, qty: 1 }] });
ok('markup in a name is refused by the website itself', code === 400, [code, text]);
[code, text] = send({ kind: 'contact', name: 'Maria Santos', company: '', email: 'maria@example.com', phone: '', location: '', subject: 'Calibration', message: 'Do you calibrate RAD wrenches?', items: [] });
const contact = JSON.parse(text || '{}');
ok('and the contact message', code === 200 && /^C-\d{6}-\d{4,6}$/.test(contact.ref), [code, text]);

console.log('\n== the portal collects them');
const store = { ActivityLog: [], Clients: [], PricingRequests: [], PricingRequestItems: [], Inventory: [], FlowSettings: [] };
const c = load(undefined, store);
c.__props.WEBSITE_FEED_URL = BASE + '/api/requests-feed.php';
c.__props.WEBSITE_FEED_KEY = KEY;
c.MailApp = { sendEmail: () => {} };
c.UrlFetchApp = { fetch: (url, o) => {
  const [st, body] = http(o.method === 'post' ? 'POST' : 'GET', url, Object.assign({ Host: host }, o.headers, o.contentType ? { 'Content-Type': o.contentType } : {}), o.payload);
  return { getResponseCode: () => st, getContentText: () => body };
} };
const ADMIN = { actorRole: 'admin', actorName: 'Ana Admin' };
let r = call(c, 'collectWebsiteRequestsNow', ADMIN);
const refs = (store.WebRequests || []).map(x => x['Ref']);
ok('the collector files both from the live feed', r.success && refs.indexOf(quote.ref) >= 0 && refs.indexOf(contact.ref) >= 0, { r, refs });
const firstRun = r;
const row = (store.WebRequests || []).find(x => x['Ref'] === quote.ref) || {};
const items = JSON.parse(row['Items JSON'] || '[]');
ok('  the items came back from the website database with their HE numbers', items.length === 2 && items[0].sku === 'HE-01323' && items[0].qty === 2 && !!items[0].brand, items);
ok('  the formula is stored as text, the markup never as markup', String(row['Company']).startsWith("'=") && !/[<>]/.test(row['Message']) && /‹img/.test(row['Message']), [row['Company'], row['Message']]);
ok('  a phone keeps its leading 0', row['Phone'] === '09170000000');
const [fs2, feed] = http('GET', BASE + '/api/requests-feed.php?limit=50', { 'X-Portal-Key': KEY, Host: host });
const left = (JSON.parse(feed || '{}').requests || []).map(x => x.ref);
ok('the website no longer offers them: the acknowledgement landed', fs2 === 200 && left.indexOf(quote.ref) < 0 && left.indexOf(contact.ref) < 0, { fs2, left });
r = call(c, 'collectWebsiteRequestsNow', ADMIN);
ok('a second run files nothing new', r.success && r.collected === 0, r);

console.log('\n== the quote became a purchase request by itself (A341)');
const pr = store.PricingRequests[0] || {}, lines = store.PricingRequestItems;
ok('made in the same run, without a click', firstRun.autoMade === 1 && store.PricingRequests.length === 1 && /^PR-/.test(pr['PR No']) && row['PR No'] === pr['PR No'], firstRun);
ok('  waiting for admin\'s sourcing, owned by Admin, requested by the website', pr['Status'] === 'Requested' && pr['Salesperson'] === 'Admin' && pr['Requested By'] === 'Website (hiescorp.com)', pr);
r = call(c, 'convertWebRequest', Object.assign({ ref: quote.ref }, ADMIN));
ok('  the inbox button now just points at it', r.success && r.duplicate && r.prNo === pr['PR No'] && store.PricingRequests.length === 1, r);
ok('  the contact message waits in the inbox', ((store.WebRequests || []).find(x => x['Ref'] === contact.ref) || {})['Status'] === 'New');
ok('  with both products, HE numbers kept as the requested codes', lines.length === 2 && lines[0]['Item No'] === 'HE-01323', lines.map(l => l['Item No']));
const cells = JSON.stringify([pr, lines, store.Clients, store.WebRequests]);
ok('  and no cell anywhere holds a visitor\'s < or >', !/[<>]/.test(cells));

console.log('\n== a wrong key is reported in plain words');
c.__props.WEBSITE_FEED_KEY = 'f'.repeat(64);
r = call(c, 'collectWebsiteRequestsNow', ADMIN);
ok('"the website refused the key"', !r.success && /refused the key/.test(r.message), r);

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
