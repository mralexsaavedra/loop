/* Top bar date line: the viewer's local today ("mar 30 sept" / "Tue 30 Sep") written with the one date
 * formatter (HC.fmtDate, util.js). Classic script (is:inline). Decided here from Date.now(), never
 * baked, so consecutive builds stay byte-identical; the page opens straight onto the dials, and this
 * line is what tells the viewer which day they are looking at. */
(function () {
  var el = document.getElementById('today-date');
  if (!el) return;
  var iso = HC.todayIso();
  el.textContent = HC.fmtDate(iso);
  el.setAttribute('datetime', iso);
})();
