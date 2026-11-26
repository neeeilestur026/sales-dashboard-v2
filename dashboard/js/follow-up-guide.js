/* follow-up-guide.js — A393 · the follow-up guide page (follow-up-guide.html): the guard and the navbar. The week itself
 * is drawn by js/follow-up-guide-card.js, which finds #followUpGuide with data-mode="page". */
document.addEventListener('DOMContentLoaded', function () {
  const s = typeof requireFollowUpGuideAccess === 'function' ? requireFollowUpGuideAccess() : null;
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('follow-up-guide');
  const lede = document.querySelector('.fgp-lede');
  /* A407 — the plan is each rep's Client Book: Major, then Minor, then Developing */
  if (lede && s.role !== 'sales') lede.textContent = 'Each rep\'s clients through the week, read only. Every open quotation comes first, on day 3, 5, 7 and 14 after sending and then every week until it is won or lost. Then the Major, Minor and Developing clients, spread over Monday to Friday.';
});
