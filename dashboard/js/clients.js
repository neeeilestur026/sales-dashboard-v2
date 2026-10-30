/* clients.js — A385 · the old Client List (clients.html) is retired for everyone (Neil, 30 Oct 2026). A saved link lands
   on the stub page and is sent on: sales and the director to the Client Book, admin, accounting and management to the
   Client master, anyone else home. Nothing is read or written. Revert A385 to bring the old page back. */
(function () {
  var role = '';
  try { role = String((JSON.parse(localStorage.getItem('session') || 'null') || {}).role || '').toLowerCase(); } catch (e) { role = ''; }
  var to = (role === 'sales' || role === 'director') ? 'director-client-book.html'
    : (role === 'admin' || role === 'accounting' || role === 'management') ? 'flow-clients.html' : 'index.html';
  try { window.location.replace(to); } catch (e) { window.location.href = to; }
})();
