/* apple.js — A344 · motion for the Apple look (css/apple.css). Loaded by js/theme.js only while
 * html[data-look="apple"] is set. P0 placeholder: the springs, the drawer and the phone sheets
 * (drag to dismiss, rubber-band 0.55, momentum projection d = 0.998, release velocity handed to the
 * spring) arrive in P3. Nothing here may run unless the Apple look is on. */
(function () {
  var h = document.documentElement;
  if (!h || h.getAttribute('data-look') !== 'apple') return;
  window.hxApple = { version: 'p0' };
})();
