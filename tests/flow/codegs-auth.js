/* AS-1 — the hardened Code.gs, proven in Node before it is pasted.
 *
 * Run:  node tests/flow/codegs-auth.js
 *
 * Drives the real doGet/doPost through the gasload-code stub: a call with no session is refused,
 * a mutation over GET is refused, a legacy Base64 password logs in once and is re-stored hashed
 * with the Base64 column emptied, the hash then verifies (and a wrong password does not),
 * changePassword / addUser / resetUserPassword store hashes only, the admin-page actions are
 * refused for other roles, a request naming somebody else's sheet is refused, the server's
 * shared-secret path works and a wrong secret does not, and the session cleanup rewrites the
 * sheet in one pass. */
const path = require('path');
const { makeCtx, seedSession } = require(path.join(__dirname, 'gasload-code.js'));

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const b64 = (s) => Buffer.from(s).toString('base64');
function fresh() {
  const store = {
    Users: [
      ['Username', 'Password', 'Role', 'Full Name', 'Quotation Sheet ID', 'PR Sheet ID', 'PO Sheet ID', 'App URL - Quotation', 'App URL - PR', 'App URL - PO', 'MRO Sheet ID', 'App URL - MRO', 'Training Mode'],
      ['neil', b64('secret1'), 'sales', 'Neil Estur', 'QS-neil', 'PR-neil', 'PO-neil', '', '', '', 'MRO-neil', '', 'FALSE'],
      ['boss', b64('adminpw'), 'admin', 'The Admin', 'QS-boss', 'PR-boss', 'PO-boss', '', '', '', '', '', 'FALSE'],
    ],
    Sessions: [['Token', 'Username', 'FullName', 'Role', 'CreatedAt', 'ExpiresAt']],
    'Login Tracker': [['Timestamp', 'Username', 'Full Name', 'Role']],
  };
  const ctx = makeCtx(store, { USERS_SHEET_ID: 'users-sheet', INTERNAL_SHARED_SECRET: 'server-secret' });
  ctx.__store = store;
  return ctx;
}
const get = (ctx, params) => JSON.parse(ctx.doGet({ parameter: params }).getContent());
const post = (ctx, body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const usersRow = (ctx, name) => ctx.__store.Users.find(r => r[0] === name);
const col = (ctx, header) => ctx.__store.Users[0].indexOf(header);

const ctx = fresh();

sec('1 · nothing runs without a session');
let r = get(ctx, { action: 'getStats' });
ok('a GET read with no token is refused with authError', r.success === false && r.authError === true, r);
r = post(ctx, { action: 'getUsers' });
ok('a POST with no token is refused with authError', r.success === false && r.authError === true, r);
r = get(ctx, { action: 'getStats', token: 'nope' });
ok('an unknown token is refused', r.success === false && r.authError === true, r);
r = get(ctx, { action: 'getCodeVersion' });
ok('getCodeVersion stays open (the smoke probe)', r.success === true && r.version === 5, r);
r = get(ctx, { action: 'addUser', token: 'anything' });
ok('a mutation over GET is refused before anything else', /POST/.test(r.message || ''), r);
r = get(ctx, { action: 'login', user: 'neil', pass: 'secret1' });
ok('  login too: it must be POSTed', /POST/.test(r.message || ''), r);

sec('2 · legacy Base64 → hashed on first login');
ok('the row still holds the Base64 value', usersRow(ctx, 'neil')[1] === b64('secret1'));
r = post(ctx, { action: 'login', user: 'neil', pass: 'wrong' });
ok('a wrong password fails', r.success === false, r);
r = post(ctx, { action: 'login', user: 'neil', pass: 'secret1' });
ok('the right password logs in', r.success === true && !!r.token && r.role === 'sales', r);
const neilToken = r.token;
const row = usersRow(ctx, 'neil');
ok('  the Base64 column is now empty', String(row[1] || '') === '', row[1]);
ok('  pwHash and pwSalt columns exist and are filled', col(ctx, 'pwHash') > 12 && /^h1\$1500\$/.test(String(row[col(ctx, 'pwHash')])) && String(row[col(ctx, 'pwSalt')]).length > 10, [row[col(ctx, 'pwHash')], row[col(ctx, 'pwSalt')]]);
r = post(ctx, { action: 'login', user: 'neil', pass: 'secret1' });
ok('the second login verifies the hash', r.success === true, r);
r = post(ctx, { action: 'login', user: 'neil', pass: 'secret2' });
ok('  and a wrong password still fails against the hash', r.success === false, r);
r = post(ctx, { action: 'login', user: 'nobody', pass: 'x' });
ok('an unknown user fails the same way', r.success === false && /Invalid credentials/.test(r.message), r);

sec('3 · changePassword, addUser, resetUserPassword store hashes only');
r = post(ctx, { action: 'changePassword', token: neilToken, username: 'neil', currentPassword: 'secret1', newPassword: 'newpass9' });
ok('changePassword with the right current password', r.success === true, r);
r = post(ctx, { action: 'login', user: 'neil', pass: 'newpass9' });
ok('  the new password logs in', r.success === true, r);
r = post(ctx, { action: 'login', user: 'neil', pass: 'secret1' });
ok('  the old one does not', r.success === false, r);
r = post(ctx, { action: 'login', user: 'boss', pass: 'adminpw' });
const adminToken = r.token;
ok('the admin logs in (migrated too)', r.success === true && r.role === 'admin', r);
r = post(ctx, { action: 'addUser', token: adminToken, username: 'ana', password: 'anapass1', fullName: 'Ana', role: 'sales' });
ok('admin adds a user', r.success === true, r);
const ana = usersRow(ctx, 'ana');
ok('  stored with an empty Base64 column and a hash', String(ana[1] || '') === '' && /^h1\$/.test(String(ana[col(ctx, 'pwHash')])), ana);
r = post(ctx, { action: 'login', user: 'ana', pass: 'anapass1' });
ok('  and she can log in', r.success === true, r);
r = post(ctx, { action: 'resetUserPassword', token: adminToken, rowIndex: ctx.__store.Users.indexOf(ana) + 1 });
ok('admin resets her password and gets a 12-character temporary one', r.success === true && typeof r.tempPassword === 'string' && r.tempPassword.length === 12 && /^[A-Za-z2-9]+$/.test(r.tempPassword), r);
r = post(ctx, { action: 'login', user: 'ana', pass: r.tempPassword });
ok('  which logs in', r.success === true, r);
r = post(ctx, { action: 'updateUser', token: adminToken, rowIndex: ctx.__store.Users.indexOf(ana) + 1, password: 'later123' });
ok('updateUser with a password re-hashes', r.success === true && /^h1\$/.test(String(ana[col(ctx, 'pwHash')])) && String(ana[1] || '') === '', r);
ok('no Base64 password is left anywhere in the sheet', ctx.__store.Users.slice(1).every(u => String(u[1] || '') === ''));

sec('4 · roles are checked on the server');
r = get(ctx, { action: 'getUsers', token: neilToken });   // a read: doGet
ok('a sales user may read the roster (many pages do)', r.success === true && Array.isArray(r.data), r);
r = post(ctx, { action: 'addUser', token: neilToken, username: 'evil', password: 'evilpass', fullName: 'E', role: 'admin' });
ok('a sales user may NOT add an admin', r.success === false && /Forbidden/.test(r.message), r);
ok('  and no such row was written', !usersRow(ctx, 'evil'));
r = post(ctx, { action: 'deleteUser', token: neilToken, rowIndex: 3 });
ok('  nor delete one', r.success === false && /Forbidden/.test(r.message), r);
r = get(ctx, { action: 'getLoginLog', token: neilToken });
ok('  nor read the login log', r.success === false && /Forbidden/.test(r.message), r);
r = post(ctx, { action: 'setTargets', token: neilToken, month: '2026-09' });
ok('  nor set targets', r.success === false && /Forbidden/.test(r.message), r);

sec('5 · a request may only name the caller\'s own sheets');
ctx._SESSION = { username: 'neil', role: 'sales' };
ok('neil naming his own quotation sheet passes', ctx._sheetIdGuard({ quotationSheetId: 'QS-neil', prSheetId: 'PR-neil' }) === null);
r = ctx._sheetIdGuard({ quotationSheetId: 'QS-boss' });
ok('neil naming the admin\'s sheet is refused', r && /not yours/.test(r.message), r);
r = ctx._sheetIdGuard({ sheetId: 'https://docs.google.com/anything' });
ok('  as is any sheet id typed into a request', r && /not yours/.test(r.message), r);
ctx._SESSION = { username: 'boss', role: 'admin' };
ok('an oversight role may name any roster sheet', ctx._sheetIdGuard({ quotationSheetId: 'QS-neil' }) === null);
r = ctx._sheetIdGuard({ quotationSheetId: 'QS-unknown' });
ok('  but not a sheet nobody owns', r && /not yours/.test(r.message), r);
ok('a request with no sheet id is not affected', ctx._sheetIdGuard({ rowIndex: 2 }) === null);

sec('6 · the server\'s shared-secret path');
r = post(ctx, { action: 'getUsersForBackend', sharedSecret: 'wrong' });
ok('a wrong secret is refused', r.success === false && /Forbidden/.test(r.message), r);
r = post(ctx, { action: 'getUsersForBackend', sharedSecret: 'server-secret' });
ok('the right secret reaches the handler', r.success === true && Array.isArray(r.users) && r.users.every(u => !('password' in u)), r);
r = get(ctx, { action: 'getUsers', sharedSecret: 'server-secret', token: neilToken });
ok('with a forwarded user token the call runs as that user', r.success === true, r);
r = post(ctx, { action: 'addUser', sharedSecret: 'server-secret', token: neilToken, username: 'evil2', password: 'evilpass', fullName: 'E', role: 'admin' });
ok('  and that user\'s role still applies', r.success === false && /Forbidden/.test(r.message), r);
ok('_ctEq: equal strings compare equal, unequal do not', ctx._ctEq('abc', 'abc') === true && ctx._ctEq('abc', 'abd') === false && ctx._ctEq('', '') === true && ctx._ctEq('a', '') === false);

sec('7 · session cleanup rewrites the sheet in one pass');
const c2 = fresh();
const past = new Date(Date.now() - 3600 * 1000).toISOString();
seedSession(c2.__store, 'T-live', 'neil', 'Neil', 'sales');
c2.__store.Sessions.push(['T-dead', 'neil', 'Neil', 'sales', past, past]);
c2.__store.Sessions.push(['T-dead2', 'boss', 'Boss', 'admin', past, past]);
c2.cleanupExpiredSessions();
eq('two expired rows removed, the live one kept', c2.__store.Sessions.map(r => r[0]).join(','), 'Token,T-live');

sec('8 · dead actions are gone, the link case exists');
r = post(ctx, { action: 'markNotificationsRead', token: neilToken });
ok('markNotificationsRead is no longer an action', /Unknown (POST )?action/.test(r.message), r);
r = post(ctx, { action: 'linkPRToQuotation', token: neilToken, rfqNo: 'X', prSheetId: 'PR-neil', quotationRef: 'Q' });
ok('linkPRToQuotation can be POSTed (it reaches its handler)', !/Unknown (POST )?action|must be sent as POST/.test(r.message || ''), r);

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
