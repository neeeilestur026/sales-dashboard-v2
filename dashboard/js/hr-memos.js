/* hr-memos.js — A390 · HR Memos moved to the bulletin board (Neil, 2 Nov 2026). A saved link lands on the stub page and is
   sent on to bulletin.html; "New memo" (?new=1, the phone's + button and old bookmarks) opens the composer there. Nothing
   is read or written. Revert A390 to bring the old page back (its Code.gs Memos sheet was never touched). */
(function () {
  var to = 'bulletin.html' + (/[?&]new=1(&|$)/.test(String(location.search || '')) ? '?new=1' : '');
  try { window.location.replace(to); } catch (e) { window.location.href = to; }
})();
