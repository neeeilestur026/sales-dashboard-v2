/* A390 — the bulletin board store (FlowAPI 195: getBulletin, getBulletinFile, saveBulletin, archiveBulletin, ackBulletin,
 * previewBulletinMemos, importBulletinMemos).
 *
 * Run:  node tests/flow/bulletin-store.js
 *
 * Neil, 2 Nov 2026: announcements on every user's dashboard; HR, admin, the director and management add and edit them
 * (any of the four, any post); to everyone or chosen roles; pin, show until a date, "Got it" with who has seen it, and a
 * file or image. It replaces HR Memos. Runs the real FlowAPI.gs through its dispatcher (gasload).
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const who = (role, name, user) => ({ actorRole: role, actorName: name, actorUsername: user });
const NEIL = who('director', 'Neil Estur', 'neil'), LARRY = who('management', 'Larry Estur', 'mgmt');
const ANA = who('hr', 'Ana Reyes', 'hr1'), JIEZ = who('admin', 'Jiezzel Barrios-Regente', 'admin1');
const KIM = who('sales', 'Kimberlyn Blones', 'sales1'), GER = who('sales', 'Gerald Lucena', 'sales2'), MARIA = who('accounting', 'Maria Santos', 'acct1');
const MK = who('marketing', 'Mia Cruz', 'mkt1'), LG = who('leadgen', 'Lito Gomez', 'lg1'), WH = who('warehouse', 'Rico Dela Cruz', 'wh1');
const day = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 8 / 24 + n); return new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10); };
const post = (c, p, actor, more) => call(c, 'saveBulletin', Object.assign({ title: 'Office closed on Friday', body: 'The office is closed for the holiday.', clientRef: 'cr-' + Math.random() }, p || {}, actor || ANA, more || {}));

sec('1 · the version, an empty board, and who may read it');
{
  const store = {}, c = load(GS, store);
  ok('getVersion = 197', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 197);
  [KIM, MARIA, LARRY, NEIL, ANA, JIEZ, MK, LG, WH].forEach(a => {
    const r = call(c, 'getBulletin', a);
    ok(a.actorRole + ' reads the board', r.success && r.items.length === 0, r);
  });
  ok('  and a read creates no tab', !('Bulletin' in store) && !('BulletinAcks' in store));
  ok('a role outside bulletinRoles is refused', !call(c, 'getBulletin', who('intern', 'X', 'x1')).success);
  ok('the read is secured: no secret, no board', !call(c, 'getBulletin', Object.assign({ flowSecret: '' }, KIM)).success);
  const off = load(GS, { FlowSettings: [{ 'Key': 'bulletin', 'Value': 'off' }] });
  ok('FlowSettings bulletin off closes it', /switched off/.test(call(off, 'getBulletin', KIM).message));
}

sec('2 · writing: HR, admin, the director and management; any of them edits any post');
{
  const store = {}, c = load(GS, store), props0 = JSON.stringify(Object.keys(load(GS, {}).__props).sort());
  const r = post(c, { audience: 'all', kind: 'Announcement' });
  const row = store.Bulletin[0];
  ok('HR posts: a 23-wide row in SCHEMA order, a clock id, Live', r.success && row.__arity === 23 && /^BB-\d{14}-[0-9A-F]{4}$/.test(row['Bulletin No']) &&
     row['Status'] === 'Live' && row['Created By'] === 'Ana Reyes' && row['Created By User'] === 'hr1', [r, row]);
  ok('  and one log row', store.BulletinLog.length === 1 && store.BulletinLog[0]['Kind'] === 'posted' && store.BulletinLog[0].__arity === 8);
  const again = call(c, 'saveBulletin', Object.assign({ title: 'Office closed on Friday', body: 'x', clientRef: row['Client Ref'] }, ANA));
  ok('a retry with the same Client Ref is the same post', again.success && again.duplicate && again.bulletinNo === r.bulletinNo && store.Bulletin.length === 1, again);
  [JIEZ, NEIL, LARRY].forEach(a => ok(a.actorRole + ' may post', post(c, {}, a).success));
  [KIM, MARIA, MK, LG, WH].forEach(a => ok(a.actorRole + ' may not post', !post(c, {}, a).success));
  const e = call(c, 'saveBulletin', Object.assign({ bulletinNo: r.bulletinNo, title: 'Office closed on Friday 7 Nov', ifUpdatedAt: r.updatedAt }, JIEZ));
  ok('admin edits HR\'s post (any writer, any post); a field not sent keeps its value', e.success && store.Bulletin[0]['Title'] === 'Office closed on Friday 7 Nov' &&
     store.Bulletin[0]['Body'] === 'The office is closed for the holiday.' && store.Bulletin[0]['Updated By'] === 'Jiezzel Barrios-Regente', e);
  store.Bulletin[0]['Updated At'] = new Date(Date.now() - 60000);
  const stale = call(c, 'saveBulletin', Object.assign({ bulletinNo: r.bulletinNo, title: 'Again', ifUpdatedAt: e.updatedAt }, NEIL));
  ok('a save over someone else\'s newer one is refused', !stale.success && stale.stale && /changed this announcement/.test(stale.message), stale);
  ok('the edit logged the field it changed', store.BulletinLog.some(l => l['Kind'] === 'title' && l['From'] === 'Office closed on Friday'));
  ok('no Script Property was added by any of it', JSON.stringify(Object.keys(c.__props).sort()) === props0, Object.keys(c.__props));
}

sec('3 · the rules a post must keep');
{
  const c = load(GS, {});
  ok('a title is needed', !post(c, { title: '  ' }).success);
  ok('a title over 120 characters is refused', !post(c, { title: 'x'.repeat(121) }).success);
  ok('a message over 3000 characters is refused', !post(c, { body: 'x'.repeat(3001) }).success);
  ok('no message and no file is refused', /Write the message/.test(post(c, { body: '' }).message));
  ok('an unknown kind is refused', !post(c, { kind: 'Gossip' }).success);
  ok('an audience that is not roles is refused', !post(c, { audience: 'sales,friends' }).success);
  ok('show until in the past is refused', !post(c, { showUntil: day(-1) }).success);
  ok('show until over a year ahead is refused', !post(c, { showUntil: day(400) }).success);
  ok('show until not a date is refused', !post(c, { showUntil: '7 Nov' }).success);
  [1, 2, 3].forEach(i => ok('pin ' + i + ' of 3', post(c, { title: 'Pinned ' + i, pinned: true }).success));
  const fourth = post(c, { title: 'Pinned 4', pinned: true });
  ok('a 4th pin is refused', !fourth.success && /3 announcements are pinned/.test(fourth.message), fourth);
}

sec('4 · audience, the board, history, "Got it", the bell count');
{
  const store = {}, c = load(GS, store);
  const all = post(c, { title: 'Holiday', audience: 'all' }), sales = post(c, { title: 'New price list', audience: 'sales,director' }, LARRY);
  const pin = post(c, { title: 'Safety first', pinned: true }), old = post(c, { title: 'Ended', showUntil: day(0) });
  store.Bulletin.find(r => r['Bulletin No'] === old.bulletinNo)['Show Until'] = day(-2);   // it ended two days ago
  const k = call(c, 'getBulletin', KIM), m = call(c, 'getBulletin', MARIA);
  ok('a rep sees posts to everyone and to sales, pinned first', k.items.map(x => x.title).join('|') === 'Safety first|New price list|Holiday', k.items.map(x => x.title));
  ok('accounting does not see the sales-only post', m.items.every(x => x.title !== 'New price list'), m.items.map(x => x.title));
  ok('the ended post is in history, not on the board', call(c, 'getBulletin', Object.assign({ view: 'history' }, KIM)).items.map(x => x.title).join() === 'Ended' &&
     !k.items.some(x => x.title === 'Ended'));
  ok('the bell count: posts for me I have not marked', call(c, 'getBulletin', Object.assign({ countOnly: true }, KIM)).count === 3);
  ok('  not counting my own posts (HR wrote three of them)', call(c, 'getBulletin', Object.assign({ countOnly: true }, ANA)).count === 0);
  const g = call(c, 'ackBulletin', Object.assign({ bulletinNo: all.bulletinNo }, KIM));
  ok('"Got it": one row, then the count drops', g.success && store.BulletinAcks.length === 1 && store.BulletinAcks[0].__arity === 5 &&
     call(c, 'getBulletin', Object.assign({ countOnly: true }, KIM)).count === 2, g);
  ok('  pressing it again changes nothing', call(c, 'ackBulletin', Object.assign({ bulletinNo: all.bulletinNo }, KIM)).already === true && store.BulletinAcks.length === 1);
  ok('  the board says I have seen it', call(c, 'getBulletin', KIM).items.find(x => x.bulletinNo === all.bulletinNo).gotIt);
  ok('"Got it" on a post not addressed to me is refused', !call(c, 'ackBulletin', Object.assign({ bulletinNo: sales.bulletinNo }, MARIA)).success);
  ok('"Got it" on an ended post is refused', /has ended/.test(call(c, 'ackBulletin', Object.assign({ bulletinNo: old.bulletinNo }, KIM)).message));
  const mg = call(c, 'getBulletin', Object.assign({ view: 'manage' }, NEIL));
  ok('the writers\' view: every post with who has seen it, and the log', mg.success && mg.items.length === 4 && mg.items.find(x => x.bulletinNo === all.bulletinNo).acks[0].name === 'Kimberlyn Blones' &&
     mg.log.length >= 4, mg.items.map(x => [x.title, (x.acks || []).length]));
  ok('a reader cannot ask for it', !call(c, 'getBulletin', Object.assign({ view: 'manage' }, KIM)).success);
  const homeOff = load(GS, { FlowSettings: [{ 'Key': 'bulletinHome', 'Value': 'off' }] });
  post(homeOff, { title: 'x' });
  ok('bulletinHome off quiets the bell (the page still works)', call(homeOff, 'getBulletin', Object.assign({ countOnly: true }, KIM)).count === 0 &&
     call(homeOff, 'getBulletin', KIM).items.length === 1);
}

sec('5 · archive and its Undo');
{
  const store = {}, c = load(GS, store), r = post(c, { title: 'Take me down' });
  const a = call(c, 'archiveBulletin', Object.assign({ bulletinNo: r.bulletinNo, reason: 'Posted twice' }, LARRY));
  ok('management takes HR\'s post down: off the board, kept, logged', a.success && store.Bulletin[0]['Status'] === 'Archived' && store.Bulletin[0]['Archive Reason'] === 'Posted twice' &&
     call(c, 'getBulletin', KIM).items.length === 0 && store.BulletinLog.some(l => l['Kind'] === 'archived'), a);
  ok('  an archived post cannot be edited until restored', /Restore it first/.test(call(c, 'saveBulletin', Object.assign({ bulletinNo: r.bulletinNo, title: 'x' }, ANA)).message));
  const u = call(c, 'archiveBulletin', Object.assign({ bulletinNo: r.bulletinNo, restore: true }, ANA));
  ok('Undo puts it back', u.success && store.Bulletin[0]['Status'] === 'Live' && call(c, 'getBulletin', KIM).items.length === 1, u);
  ok('a rep cannot archive', !call(c, 'archiveBulletin', Object.assign({ bulletinNo: r.bulletinNo }, KIM)).success);
  ok('nothing was deleted', store.Bulletin.length === 1);
}

sec('6 · the attachment: private, off the Documents register, shown only to its audience');
{
  const store = {}, c = load(GS, store);
  let shared = 0, saved = [];
  const fold = (name) => ({ getName: () => name, getId: () => 'f-' + name, getFoldersByName: () => ({ hasNext: () => false }), createFolder: (n) => { saved.push(n); return fold(n); },
    createFile: (blob) => ({ getId: () => 'file-bb-1', getUrl: () => 'https://drive.test/x', setSharing: () => { shared++; } }) });
  c.DriveApp.getFolderById = () => fold('root'); c.DriveApp.getRootFolder = () => fold('root');
  c.DriveApp.getFileById = (id) => ({ getBlob: () => ({ getContentType: () => 'application/pdf', getBytes: () => [1, 2] }), getThumbnail: () => ({ getContentType: () => 'image/png', getBytes: () => [3] }) });
  const r = post(c, { title: 'Memo with a file', audience: 'accounting', fileBase64: 'aGVsbG8gd29ybGQ=', fileName: 'Holiday memo.pdf', mimeType: 'application/pdf' }, ANA);
  const row = store.Bulletin[0];
  ok('a PDF is saved: its id, name, type and size on the post', r.success && row['File ID'] === 'file-bb-1' && row['File Name'] === 'Holiday memo.pdf' && row['File Type'] === 'application/pdf' && row['File Size'] > 0, [r, row]);
  ok('  in _Internal / Announcements / <the post>', saved.slice(-3).join('/') === '_Internal/Announcements/' + r.bulletinNo, saved);
  ok('  private: sharing is never set', shared === 0);
  ok('  and NOT on the Documents register', !(store.Documents || []).length);
  ok('an SVG is refused', !post(c, { title: 'x', fileBase64: 'PHN2Zz4=', fileName: 'a.svg', mimeType: 'image/svg+xml' }).success);
  ok('an HTML file is refused', !post(c, { title: 'x', fileBase64: 'PGI+', fileName: 'a.html', mimeType: 'text/html' }).success);
  ok('a file over 10 MB is refused', !post(c, { title: 'x', fileBase64: 'A'.repeat(14000001), fileName: 'big.pdf', mimeType: 'application/pdf' }).success);
  const f = call(c, 'getBulletinFile', Object.assign({ bulletinNo: r.bulletinNo }, MARIA));
  ok('accounting (its audience) reads the file', f.success && f.mimeType === 'application/pdf' && f.fileName === 'Holiday memo.pdf' && f.base64, f);
  ok('a rep (not its audience) does not', !call(c, 'getBulletinFile', Object.assign({ bulletinNo: r.bulletinNo }, KIM)).success);
  ok('a writer does', call(c, 'getBulletinFile', Object.assign({ bulletinNo: r.bulletinNo }, NEIL)).success);
  const rm = call(c, 'saveBulletin', Object.assign({ bulletinNo: r.bulletinNo, removeFile: true }, ANA));
  ok('taking the file off a post with a message keeps the post', rm.success && store.Bulletin[0]['File ID'] === '' && store.BulletinLog.some(l => /Took the file off/.test(l['Note'])), rm);
}

sec('7 · bringing the HR memos over, once');
{
  const store = {}, c = load(GS, store);
  const memos = [
    { title: 'Holiday schedule', content: 'Office closed on the 30th.', type: 'Announcement', priority: 'Urgent', createdBy: 'Ana Reyes', target: 'All', status: 'Active', createdAt: '10/20/2026 09:15:00' },
    { title: 'Sales kickoff', content: 'Meeting at 9.', type: 'Memo', priority: 'Normal', createdBy: 'Ana Reyes', target: 'Sales Team', status: 'Active', createdAt: 'Tue Oct 21 2026 08:00:00 GMT+0800' },
    { title: 'Old notice', content: 'x', type: 'Memo', priority: 'Low', createdBy: 'Ana Reyes', target: 'All', status: 'Archived', createdAt: '09/01/2026 08:00:00' },
    { title: 'For the drivers', content: 'Use the gate.', type: 'Policy Update', priority: 'High', createdBy: 'Ana Reyes', target: 'Drivers', status: 'Active', createdAt: '' }];
  const pv = call(c, 'previewBulletinMemos', Object.assign({ memos: JSON.stringify(memos) }, ANA));
  ok('the preview writes nothing and logs nothing', pv.success && !(store.Bulletin || []).length && !(store.ActivityLog || []).length && pv.toImport === 3, pv);
  ok('  maps kinds, audiences and Urgent → pinned', pv.plan[0].kind === 'Announcement' && pv.plan[0].pinned && pv.plan[1].audience.join() === 'sales' && pv.plan[3].kind === 'Policy update', pv.plan);
  ok('  and says what it guessed', /names no role/.test(pv.plan[3].note) && /no readable date/.test(pv.plan[3].note) && pv.plan[2].skip === 'not active', pv.plan.map(x => [x.note, x.skip]));
  const im = call(c, 'importBulletinMemos', Object.assign({ memos: JSON.stringify(memos) }, ANA));
  ok('the import brings the 3 active memos, keeping author and date', im.success && im.created === 3 && store.Bulletin.length === 3 && store.Bulletin.every(r => r['Source'] === 'memo' && r.__arity === 23) &&
     store.Bulletin[0]['Created By'] === 'Ana Reyes' && typeof store.Bulletin[0]['Created At'].getMonth === 'function' && store.Bulletin[0]['Created At'].getMonth() === 9, im);   // a vm Date: no instanceof
  ok('  logged once as Bulletin board · Memos imported', store.ActivityLog.filter(a => a['Module'] === 'Bulletin board' && a['Action'] === 'Memos imported').length === 1, store.ActivityLog.slice(-1));
  ok('  and they do not count as new on the bell', call(c, 'getBulletin', Object.assign({ countOnly: true }, KIM)).count === 0);
  ok('  but they are on the board (a rep: everyone\'s two + sales; accounting: everyone\'s two)', call(c, 'getBulletin', KIM).items.length === 3 && call(c, 'getBulletin', MARIA).items.length === 2);
  const again = call(c, 'importBulletinMemos', Object.assign({ memos: JSON.stringify(memos) }, ANA));
  ok('a second run creates nothing', again.success && again.created === 0 && store.Bulletin.length === 3, again);
  ok('a rep cannot import', !call(c, 'importBulletinMemos', Object.assign({ memos: JSON.stringify(memos) }, KIM)).success);
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
process.exit(FAIL ? 1 : 0);
