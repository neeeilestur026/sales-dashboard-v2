/* A288 — the three director reference pages' CONTRACT: Expenses, Sales orders, Email.
 *
 * Run:  node tests/flow/director-pages-contract.js
 *
 * Each page was rebuilt on the shared director system, its inline script moved to a file, and its
 * private class kit replaced. The scripts reach into the markup by id with no null guards, so
 * section 1 pins every id with its tag, the link and script lists, and the things the rebuild
 * removed (the skin, the <style> blocks, inline styling, emoji, the misleading ranking). Section 2
 * lints the new scripts. Section 3 boots each page's real script against its real markup through
 * the pageload harness with fetchFromAPI stubbed, and checks what it renders — including the two
 * fixes on sales orders (the row click no longer built from an escaped order number; lapsed buyers
 * instead of "least active"). */
const fs = require('fs');
const path = require('path');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

const PAGES = {
  'director-expenses.html': { body: 'dh dh-expenses', links: 'styles.css,director.css,director-pages.css', scripts: 'theme.js,api.js,auth.js,director-expenses.js', js: 'director-expenses.js',
    tags: { dd: ['kpiCount', 'kpiAvg', 'kpiTopCat'], div: ['kpiTotal', 'dexCount'], small: ['kpiTopCatAmt'], tbody: ['topCatBody', 'typeBreakdownBody', 'dexBody'], input: ['dexSearch', 'dexMonth'], select: ['dexYear', 'dexCategory'], table: ['dexTable'], button: ['dexClear', 'dexRefresh', 'themeToggle'], aside: ['rail'] } },
  'director-sales-orders.html': { body: 'dh dh-so', links: 'styles.css,director.css,director-pages.css', scripts: 'theme.js,api.js,auth.js,director-sales-orders.js', js: 'director-sales-orders.js',
    tags: { dd: ['kpiTotal', 'kpiPending', 'kpiDelivered'], div: ['kpiAmount', 'dsoCount'], tbody: ['topBuyersBody', 'leastBuyersBody', 'dsoBody'], input: ['dsoSearch', 'dsoMonth'], select: ['dsoYear'], table: ['dsoTable'], button: ['tabAll', 'tabPending', 'tabDelivered', 'dsoClear', 'dsoRefresh', 'themeToggle'], h3: ['leastTitle'], p: ['leastNote'], aside: ['rail'] } },
  'director-emails.html': { body: 'dh dh-emails', links: 'styles.css,flow.css,director.css,director-pages.css', scripts: 'theme.js,api.js,auth.js,director-emails.js', js: 'director-emails.js',
    tags: { span: ['whoTag', 'cntInbox', 'cntSent', 'cntSpam'], button: ['refreshBtn', 'themeToggle'], div: ['setupBox', 'feedBox', 'tabs', 'catFilter', 'listBox', 'metaLine'], input: ['search'], select: ['daysSel'], aside: ['rail'] } },
};

/* ── 1 · the markup contract ─────────────────────────────────────────────────────────────────── */
Object.keys(PAGES).forEach(file => {
  const P = PAGES[file], HTML = fs.readFileSync(D + file, 'utf8');
  const tagOf = (id) => { const m = HTML.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };
  sec('1 · ' + file);
  eq('stylesheets', (HTML.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(','), P.links);
  ok('no shared skin, no <style> block', !/bento-skin|flow-screen/.test(HTML) && !/<style[\s>]/i.test(HTML));
  ok('<body class="' + P.body + '">', new RegExp('<body class="' + P.body + '">').test(HTML));
  ok('the theme script is the first child of <body>', new RegExp('<body class="' + P.body + '">\\s*<script src="js/theme\\.js"></script>').test(HTML));
  eq('scripts', (HTML.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','), P.scripts);
  eq('no inline <script> at all', (HTML.match(/<script>/g) || []).length, 0);
  const styles = HTML.match(/style="[^"]*"/g) || [];
  ok('every style= is display:none; (' + styles.length + ')', styles.every(s => s === 'style="display:none;"'), styles.filter(s => s !== 'style="display:none;"'));
  ok('no emoji, arrows, refresh glyphs or middle dots', !EMOJI.test(HTML) && !/→|↻|·/.test(HTML));
  ok('no "Least Active"', !/least active/i.test(HTML));
  ok('no inline event handlers (listeners live in the script)', !/\son(click|input|change)="/.test(HTML));
  Object.keys(P.tags).forEach(tag => P.tags[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
  ok('the rail carries the slab and the theme toggle', /<aside class="dh-rail" id="rail">[\s\S]*class="dh-slab"[\s\S]*id="themeToggle"[\s\S]*<\/aside>/.test(HTML) || /<aside class="dh-rail" id="rail">[\s\S]*id="themeToggle"[\s\S]*class="dh-slab"[\s\S]*<\/aside>/.test(HTML));
  ok('the main table sits in a bounded scroll host', /<div class="dh-scroll">\s*<table class="pay-table dx-table"/.test(HTML) || /id="listBox" class="dh-scroll"/.test(HTML));
});
ok('emails: the three folder tabs are buttons with data-folder (the script selects .em-tab)', (fs.readFileSync(D + 'director-emails.html', 'utf8').match(/<button type="button" class="dx-tab em-tab[^"]*" data-folder="(inbox|sent|spam)"/g) || []).length === 3);

/* ── 2 · the scripts ─────────────────────────────────────────────────────────────────────────── */
sec('2 · the scripts');
['director-expenses.js', 'director-sales-orders.js', 'director-emails.js', 'theme.js'].forEach(f => {
  const JS = fs.readFileSync(D + 'js/' + f, 'utf8');
  ok(f + ': no hex colour, no inline style, no emoji', !/#[0-9a-fA-F]{6}\b/.test(JS) && !/style="/.test(JS) && !EMOJI.test(JS));
});
{
  const SO = fs.readFileSync(D + 'js/director-sales-orders.js', 'utf8');
  ok('sales orders: rows are opened by index through one delegated listener, not an onclick built from the escaped number',
     !/onclick="toggleRow\(/.test(SO) && !/esc\(soNo\)\.replace\(\/'\/g/.test(SO) && /data-i="/.test(SO) && /closest\('tr\.main-row'\)/.test(SO));
  ok('  and the quiet-buyers panel is lapsed / single-order, never "least active"', /Lapsed buyers/.test(SO) && /Single-order buyers/.test(SO) && !/least active/i.test(SO));
  const TH = fs.readFileSync(D + 'js/theme.js', 'utf8');
  ok('theme: validates the stored value, defaults to light, wires #themeToggle', /v === 'dark' \|\| v === 'light'/.test(TH) && /\|\| 'light'/.test(TH) && /getElementById\('themeToggle'\)/.test(TH));
}

/* ── 3 · boot each page against its real markup ──────────────────────────────────────────────── */
const SESSION = { role: 'director', name: 'Test Director', username: 'td' };
const boot = (html, js) => {
  const p = page(['js/theme.js', 'js/' + js], html, SESSION);
  p.run('setInterval = () => 0; window.addEventListener = () => {};');
  return p;
};
(async () => {
  sec('3 · expenses');
  {
    const p = boot('director-expenses.html', 'director-expenses.js');
    p.run(`fetchFromAPI = async () => ({ success: true, data: [
      { date: '2026-09-02', category: 'Fuel', client: 'Holcim', orderRef: 'SO-1', description: 'Bulacan run', fuel: 1500, total: 1500 },
      { date: '2026-09-05', category: 'Fuel', client: 'Apex', description: 'Maco', fuel: 900, toll: 100, total: 1000 },
      { date: '2025-12-20', category: 'Meals', client: 'TMI', description: 'lunch', meals: 400, total: 400 } ] });`);
    let err = null; try { await p.boot(); } catch (e) { err = String(e && e.stack || e); }
    ok('boots', err === null, err);
    eq('entries', String(p.els.kpiCount.textContent), '3');
    ok('total spent is pesos', /₱2,900\.00/.test(p.els.kpiTotal.textContent), p.els.kpiTotal.textContent);
    eq('top category', p.els.kpiTopCat.textContent, 'Fuel');
    eq('  and its amount sits beside it', p.els.kpiTopCatAmt.textContent, '₱2,500.00');
    eq('three rows', (p.els.dexBody.innerHTML.match(/<tr>/g) || []).length, 3);
    ok('the ranking bars are classed, sized by a custom property, never inline width', /class="dx-bar" data-w="1\.000"/.test(p.els.topCatBody.innerHTML) && !/style="/.test(p.els.topCatBody.innerHTML));
    ok('the first ranked category is Fuel', /^<tr><td>Fuel/.test(p.els.topCatBody.innerHTML), p.els.topCatBody.innerHTML.slice(0, 80));
    p.els.dexYear.value = '2025'; p.run('applyFilters()');
    eq('a year filter narrows the view', String(p.els.kpiCount.textContent), '1');
  }
  sec('3 · sales orders');
  {
    const p = boot('director-sales-orders.html', 'director-sales-orders.js');
    p.run(`fetchFromAPI = async () => ({ success: true, data: [
      { soNo: "SO-1'x", date: '2026-09-10', customerName: 'Holcim', status: 'Pending', grandTotal: 5000, items: [{ productCode: 'B1', productDescription: 'Bolt', qty: 2, unitPrice: 2500, amount: 5000 }] },
      { soNo: 'SO-2', date: '2026-09-12', customerName: 'Apex', status: 'Delivered', grandTotal: 3000, items: [] },
      { soNo: 'SO-3', date: '2025-11-01', customerName: 'TMI', status: 'Pending', grandTotal: 800, items: [] } ] });`);
    let err = null; try { await p.boot(); } catch (e) { err = String(e && e.stack || e); }
    ok('boots', err === null, err);
    eq('pending', String(p.els.kpiPending.textContent), '2');
    eq('delivered', String(p.els.kpiDelivered.textContent), '1');
    const body = p.els.dsoBody.innerHTML;
    ok('rows carry data-i and an index-keyed items row; no onclick', /class="main-row" data-i="0"/.test(body) && /id="items-0"/.test(body) && !/onclick/.test(body), body.slice(0, 200));
    ok('the apostrophe order number is escaped in the cell and breaks nothing', /SO-1&#39;x/.test(body));
    ok('items rows start hidden', /class="items-row hidden" id="items-0"/.test(body));
    p.run('toggleRow(0); applyFilters();');
    ok('toggleRow(0) opens the newest row and survives a re-render', /class="items-row" id="items-1"/.test(p.els.dsoBody.innerHTML) || /class="items-row" id="items-0"/.test(p.els.dsoBody.innerHTML), p.els.dsoBody.innerHTML.match(/class="items-row[^"]*" id="items-\d"/g));
    eq('all-time view: the quiet panel is single-order buyers', p.els.leastTitle.textContent, 'Single-order buyers');
    p.els.dsoYear.value = '2026'; p.run('applyFilters()');
    eq('with a year set it becomes lapsed buyers', p.els.leastTitle.textContent, 'Lapsed buyers');
    ok('  listing the buyer who ordered only last year', /TMI/.test(p.els.leastBuyersBody.innerHTML) && !/Holcim/.test(p.els.leastBuyersBody.innerHTML), p.els.leastBuyersBody.innerHTML);
    ok('status badges use the shared classes', /dh-badge s-delivered/.test(p.els.dsoBody.innerHTML));
  }
  sec('3 · emails');
  {
    const p = boot('director-emails.html', 'director-emails.js');
    p.run(`apiGetEmailStatus = async () => ({ configured: false }); apiFetchEmailFeed = async () => ({ success: true, emails: [] });`);
    let err = null; try { await p.boot(); } catch (e) { err = String(e && e.stack || e); }
    ok('boots (not connected)', err === null, err);
    ok('shows the connect card, hides the feed', p.els.setupBox.style.display === '' && p.els.feedBox.style.display === 'none' && /Connect your GoDaddy mailbox/.test(p.els.setupBox.innerHTML));
    ok('  with an SVG, not an emoji', /<svg/.test(p.els.setupBox.innerHTML) && !EMOJI.test(p.els.setupBox.innerHTML));
    const p2 = boot('director-emails.html', 'director-emails.js');
    p2.run(`apiGetEmailStatus = async () => ({ configured: true, godaddyEmail: 'neil@example.com' });
            apiFetchEmailFeed = async () => ({ success: true, fetchedAt: '2026-09-28T09:00:00', emails: [
              { name: 'Holcim', from: 'buyer@holcim.example', subject: 'RFQ bolts', category: 'Sales Inquiry/RFQ', date: '2026-09-28T08:00:00' },
              { name: 'Apex', from: 'po@apex.example', subject: 'PO 55', category: 'Purchase Order', date: '2026-09-27T08:00:00' } ] });`);
    err = null; try { await p2.boot(); } catch (e) { err = String(e && e.stack || e); }
    await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
    ok('boots (connected)', err === null, err);
    ok('the feed shows, the account line fills', p2.els.feedBox.style.display === '' && p2.els.whoTag.textContent === 'neil@example.com' && p2.els.whoTag.style.display === '');
    eq('the inbox count', p2.els.cntInbox.textContent, '(2)');
    ok('the list is a table with category badges in brand classes', /<table class="em-table">/.test(p2.els.listBox.innerHTML) && /cat-badge cat-rfq/.test(p2.els.listBox.innerHTML));
    ok('the meta line has no middle dots', !/·/.test(p2.els.metaLine.textContent) && /2 messages/.test(p2.els.metaLine.textContent), p2.els.metaLine.textContent);
  }
  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
})();
