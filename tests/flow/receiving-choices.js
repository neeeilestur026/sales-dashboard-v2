/* A416 — receiving asks its questions in the page, with named buttons, and never loses the reason.
 *
 * Run:  node tests/flow/receiving-choices.js
 *
 * 28 Nov 2026: Gayle receiving 2026-52 ABASCO got a bare "Receiving cancelled." twice. The order was
 * missing its delivery receipt; the two window.confirm pop-ups (where Cancel meant "receive anyway")
 * ended in Cancel, and the message naming the missing document was overwritten. window.confirm can
 * also be blocked by the browser, which answers Cancel without showing anything.
 *
 * Pinned here:
 *   1. flow-receiving.js has no window.confirm left; every check goes through rcChoose.
 *   2. rcChoose: title, sentence, list, NAMED buttons (no OK / Cancel), Escape and a click outside mean
 *      "back", the Go back button is findable by the phone sheet's swipe-down.
 *   3. Missing documents: Attach (opens the Docs window, says what to do next) / Receive without (sends
 *      confirmNoDocs) / Go back (the message still names the missing document).
 *   4. Already received / part paid / unpaid: Go back keeps the reason; going ahead sends the flag.
 *   5. css/flow.css hides a [hidden] .flow-form, so only the import OR the local fields show.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };

const D = path.join(__dirname, '../../dashboard/');
const SRC = fs.readFileSync(D + 'js/flow-receiving.js', 'utf8');
const CSS = fs.readFileSync(D + 'css/flow.css', 'utf8');

console.log('\n1 · no browser pop-ups left');
ok('no window.confirm in flow-receiving.js', !/\bconfirm\(/.test(SRC));
ok('no bare "Receiving cancelled." any more', !/'Receiving cancelled\.'/.test(SRC));
ok('rcChoose is defined', /function rcChoose\(opts\)/.test(SRC));

/* ── a tiny page: elements by id, one overlay at a time ─────────────────────────────────────── */
function boot() {
  const els = {}, msgs = [], posts = [], opened = [], keys = [];
  let overlay = null;
  const el = (id) => (els[id] = els[id] || { id, value: '', textContent: '', innerHTML: '', disabled: false, style: {},
    classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {}, querySelector: () => null, focus() {} });
  const button = (cls, choice, label) => ({ className: cls, textContent: label, focus() {},
    getAttribute: (n) => (n === 'data-choice' ? choice : n === 'class' ? cls : null), closest() { return this; } });
  const ctx = {
    console,
    document: {
      getElementById: el, querySelectorAll: () => [], addEventListener: (t, fn) => { if (t === 'keydown') keys.push(fn); },
      removeEventListener: (t, fn) => { const i = keys.indexOf(fn); if (i >= 0) keys.splice(i, 1); },
      activeElement: { focus() {} },
      body: { appendChild(o) { overlay = o; } },
      createElement: () => {
        const o = { className: '', _html: '', handlers: {}, removed: false,
          set innerHTML(h) { this._html = h; }, get innerHTML() { return this._html; },
          addEventListener(t, fn) { this.handlers[t] = fn; },
          remove() { this.removed = true; overlay = null; },
          buttons() { return [...this._html.matchAll(/<button type="button" class="([^"]*)" data-choice="([^"]*)">([^<]*)<\/button>/g)].map(m => button(m[1], m[2], m[3])); },
          querySelector(sel) { const b = this.buttons(); return sel === '.btn-primary' ? (b.find(x => /btn-primary/.test(x.className)) || null) : (b[0] || null); } };
        return o;
      }
    },
    flowEsc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    flowMsg: (id, text, good) => msgs.push({ id, text, good }),
    flowNum: (v) => Number(v) || 0, flowClientRef: () => 'ref-1', flowToday: () => '2026-11-28',
    fetchFlow: async () => ({ success: true, data: [] }),
    window: { addEventListener() {} }, hxRaf: (fn) => fn, flowFitScroll() {}, setTimeout, location: { search: '' },
    flowOpenShipmentDocs: async (po, docs) => { opened.push({ po, docs }); },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  vm.runInContext(`
    rcCurrent = { poNo: '2026-52 ABASCO', supplier: 'ABASCO TOOLS TRADING LLC', currency: 'AED', items: [] };
    rcSession = { name: 'Crystal Gayle' };
    collectItems = () => [{ itemNo: '03-021', itemName: 'TORQUE MULTIPLIER', qty: 1, price: 7507.5 }];
    loadAP = async () => {}; loadReceiving = async () => {}; resetForm = () => {};`, ctx);
  ctx.document.getElementById('saveBtn');
  return {
    ctx, msgs, posts, opened, get overlay() { return overlay; }, keys,
    replies(list) { ctx.postFlow = async (action, p) => { posts.push(p); return list.shift() || { success: true, mrNo: 'MR-1', message: 'ok' }; }; },
    choose(id) { const o = overlay; const b = o.buttons().find(x => x.getAttribute('data-choice') === id);
      o.handlers.click({ target: b }); },
    run() { return vm.runInContext('saveReceiving()', ctx); }
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const MISSING = { success: false, missingDocs: ['Delivery receipt (goods received at our office)'],
  message: 'Before receiving 2026-52 ABASCO into inventory, attach: Delivery receipt (goods received at our office).' };

(async () => {
  console.log('\n2 · the choice window');
  {
    const t = boot();
    const p = t.ctx.rcChoose({ title: 'One document is missing', message: 'Before X goes into inventory, this order needs:',
      items: ['Delivery receipt <x>'], choices: [{ id: 'attach', label: 'Attach it now', primary: true }, { id: 'without', label: 'Receive without it' }, { id: 'back', label: 'Go back' }] });
    const h = t.overlay.innerHTML;
    ok('a dialog with its title', /role="dialog" aria-modal="true" aria-labelledby="rcChoiceTitle"/.test(h) && /<h3 id="rcChoiceTitle">One document is missing<\/h3>/.test(h));
    ok('the list of what is missing (escaped)', /<ul class="rc-choice-list"><li>Delivery receipt &lt;x&gt;<\/li><\/ul>/.test(h));
    ok('three named buttons, no OK or Cancel', t.overlay.buttons().map(b => b.textContent).join('|') === 'Attach it now|Receive without it|Go back' && !/>(OK|Cancel)</.test(h));
    ok('the primary choice is the blue one', /btn btn-primary" data-choice="attach"/.test(h));
    ok('Go back carries rc-close, so the phone swipe-down can find it', /btn btn-secondary rc-close" data-choice="back"/.test(h));
    ok('it uses the standard modal (lifted above the sidebar, a sheet on phones)', t.overlay.className === 'flow-modal-overlay open rc-choice');
    t.choose('without');
    ok('a click resolves the chosen id and removes the window', (await p) === 'without' && t.overlay === null);
    const p2 = t.ctx.rcChoose({ title: 'x', message: 'y', choices: [{ id: 'go', label: 'Go' }, { id: 'back', label: 'Go back' }] });
    t.keys[0]({ key: 'Escape', preventDefault() {} });
    ok('Escape means back', (await p2) === 'back' && t.keys.length === 0);
    const p3 = t.ctx.rcChoose({ title: 'x', message: 'y', choices: [{ id: 'go', label: 'Go' }] });
    const ov = t.overlay; ov.handlers.click({ target: ov });
    ok('a click outside means back', (await p3) === 'back');
  }

  console.log('\n3 · missing documents');
  {
    const t = boot(); t.replies([MISSING]);
    const run = t.run(); await tick();
    ok('the window names the missing document', /One document is missing/.test(t.overlay.innerHTML) && /Delivery receipt \(goods received at our office\)/.test(t.overlay.innerHTML) && /Before 2026-52 ABASCO goes into inventory/.test(t.overlay.innerHTML));
    t.choose('back'); await run;
    const m = t.msgs[t.msgs.length - 1];
    ok('Go back: not received, and the message still says what is missing and what to do',
       /^Not received yet\. Missing: Delivery receipt \(goods received at our office\)\. Attach it under Docs, or click Receive again and choose "Receive without it"\.$/.test(m.text), m);
    ok('  and nothing more was sent', t.posts.length === 1);
  }
  {
    const t = boot(); t.replies([MISSING, { success: true, mrNo: 'MR-2026-11-0042', message: 'Materials received.' }]);
    const run = t.run(); await tick(); t.choose('without'); await run;
    ok('Receive without it: the same receiving is sent again with confirmNoDocs', t.posts.length === 2 && t.posts[1].confirmNoDocs === true && t.posts[1].poNo === '2026-52 ABASCO');
    ok('  and it is received', /Materials received\. \(MR-2026-11-0042\)/.test(t.msgs[t.msgs.length - 1].text));
  }
  {
    const t = boot(); t.replies([MISSING]);
    const run = t.run(); await tick(); t.choose('attach'); await run;
    ok('Attach it now: opens the Docs window on that order, for that document', t.opened.length === 1 && t.opened[0].po === '2026-52 ABASCO' && t.opened[0].docs[0] === 'Delivery receipt (goods received at our office)');
    ok('  and says what to do next', /Attach Delivery receipt \(goods received at our office\) in the Documents window, then click Receive & Update Inventory again\./.test(t.msgs[t.msgs.length - 1].text));
    ok('  nothing was received', t.posts.length === 1);
  }
  {
    const t = boot(); t.replies([Object.assign({}, MISSING, { missingDocs: ['A', 'B'] })]);
    const run = t.run(); await tick();
    ok('two missing: "2 documents are missing", "Receive without them"', /2 documents are missing/.test(t.overlay.innerHTML) && /Receive without them/.test(t.overlay.innerHTML));
    t.choose('back'); await run;
  }

  console.log('\n4 · the other checks');
  const flows = [
    ['alreadyReceived', { success: false, alreadyReceived: true, message: '2026-52 ABASCO was already received on MR-1.' }, 'additional', /^Not received: 2026-52 ABASCO was already received on MR-1\.$/],
    ['partialPay', { success: false, partialPay: true, message: 'Only 30% is paid.' }, 'confirmPartialPay', /^Not received — record the balance in AP Aging first\.$/],
    ['unpaid', { success: false, unpaid: true, message: 'No AP payment recorded.' }, 'confirmUnpaid', /^Not received — record the AP payment first\.$/],
  ];
  for (const [name, reply, flag, backMsg] of flows) {
    let t = boot(); t.replies([reply]);
    let run = t.run(); await tick(); t.choose('back'); await run;
    ok(name + ': Go back keeps the reason', backMsg.test(t.msgs[t.msgs.length - 1].text), t.msgs[t.msgs.length - 1]);
    t = boot(); t.replies([reply, { success: true, mrNo: 'MR-9', message: 'Materials received.' }]);
    run = t.run(); await tick(); t.choose('go'); await run;
    ok(name + ': going ahead sends ' + flag, t.posts.length === 2 && t.posts[1][flag] === true);
  }
  {
    const t = boot(); t.replies([{ success: false, unpaid: true, message: 'x' }]);
    const run = t.run(); await tick();
    ok('a money warning defaults to Go back (the safe choice is the blue one)', /btn btn-primary rc-close" data-choice="back"/.test(t.overlay.innerHTML));
    t.choose('back'); await run;
  }

  console.log('\n5 · only the fields that apply');
  ok('css/flow.css hides a [hidden] .flow-form', /\.flow-form\[hidden\]\s*\{\s*display:\s*none;\s*\}/.test(CSS));
  const HTML = fs.readFileSync(D + 'flow-receiving.html', 'utf8');
  ok('the import and local blocks are .flow-form with hidden', /id="shipImportBlock" class="flow-form" hidden/.test(HTML) && /id="shipLocalBlock" class="flow-form" hidden/.test(HTML));

  console.log('\n' + (FAIL ? FAIL + ' FAILED' : 'all ' + N + ' passed'));
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
