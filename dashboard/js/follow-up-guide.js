/* follow-up-guide.js — A393 · the follow-up guide page (follow-up-guide.html): the guard and the navbar. The week itself
 * is drawn by js/follow-up-guide-card.js, which finds #followUpGuide with data-mode="page". */
document.addEventListener('DOMContentLoaded', function () {
  const s = typeof requireFollowUpGuideAccess === 'function' ? requireFollowUpGuideAccess() : null;
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('follow-up-guide');
  const lede = document.querySelector('.fgp-lede');
  if (lede && s.role !== 'sales') lede.textContent = 'Each rep\'s top 50 through the week, read only. Quotations come first, on day 3, 5, 7 and 14 after sending and then every week until they are won or lost. Then ten clients a day, Monday to Friday.';
});
