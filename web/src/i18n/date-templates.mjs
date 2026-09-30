/* Date names for the ONE shared client date formatter (web/src/client/util.js HC.fmtDate /
 * HC.fmtMonth / the Monday-first calendar headers), baked by layouts/Plan.astro as I18N_DATE.
 * Written out instead of Intl.DateTimeFormat: ICU versions disagree ("Sep" vs "Sept", "mar, 29"),
 * and the page must read the same in every browser. Neutral Spanish, Monday first. */
export const en = {
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  weekdaysMin: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  dayTpl: '{weekday} {day} {month}',
  dayNoWeekdayTpl: '{day} {month}',
  monthTpl: '{month} {year}',
};

export const es = {
  weekdays: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
  weekdaysMin: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  months: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
  monthsLong: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  dayTpl: '{weekday} {day} {month}',
  dayNoWeekdayTpl: '{day} {month}',
  monthTpl: '{month} {year}',
};
