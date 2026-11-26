/* page-moved.js — A407 · the sales pages retired by the clean-up (Neil, 25 Nov 2026: "two of everything"). Each retired
   page is a stub, like clients.html (A385) and hr-memos.html (A390), so a saved link or a bookmark does not 404: it loads
   this script with its new home in data-to and is sent on. data-keep names one query value to carry over when it is a
   day (yyyy-mm-dd), as report.html?date= does. Nothing is read or written; the old Code.gs sheets are untouched.
     report.html, my-reports.html   → my-daily-report.html      (the daily report)
     performance.html               → director-client-book.html (the Client Book)
     quotation-summary.html         → quotation-status.html     (My quotations)
     pending-items.html             → flow-quotations.html      (Quotations)
     weekly-itinerary.html          → client-visits.html        (Client visits)
   Revert A407 to bring the old pages back. */
(function () {
  var me = document.currentScript;
  var to = (me && me.getAttribute('data-to')) || '';
  if (!/^[a-z0-9-]+\.html$/.test(to)) to = 'index.html';   // only a page of this site
  var keep = me && me.getAttribute('data-keep');
  if (keep) {
    var m = new RegExp('[?&]' + keep + '=([^&#]*)').exec(String(location.search || ''));
    if (m && /^\d{4}-\d{2}-\d{2}$/.test(m[1])) to += '?' + keep + '=' + m[1];
  }
  try { window.location.replace(to); } catch (e) { window.location.href = to; }
})();
