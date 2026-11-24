/* The page's classic client scripts, in the ONE order layouts/Plan.astro inlines them (after the bakes:
 * the per-tab data globals, NAV + HC_CONST, then HC_FMT … HC_GUIDE from the libs' clientSource()).
 * Every script is a classic `is:inline` script; they talk only through page globals, so the order is
 * the contract this list states and web/test/script-manifest.test.mjs checks:
 * - provides: the globals the file defines: top-level `var` / `function` names + every `window.X =`
 *   write (lazy ones too). Must equal a static scan of the file.
 * - requires: the globals READ while the script runs at load (synchronously, including functions it
 *   calls then), each baked or provided by an EARLIER entry. Reads inside handlers, timers and fetch
 *   answers happen after every script ran and do not constrain the order. Derived from, and checked
 *   against, a vm trace of the example page (web/test/script-trace.mjs; plain load plus the #profile,
 *   #tonight and #detail/sleep deep links, whose sheet opens at load).
 * - probes: globals read at load that a LATER entry defines: always feature-detected (typeof / &&),
 *   so the reader falls back now and the later script calls back (intakeRefresh, HCNutri.render…).
 * Adding a script: add it here at its place; the test names any missing require or provide. */
export const CLIENT_SCRIPTS = [
  {
    file: 'lib-globals.ts',
    provides: ['HC_FMT', 'HC_BAND', 'HC_ADH', 'HC_PROG', 'HC_NSCORE', 'HC_FOODLOG', 'HC_DAYTYPE', 'HC_FUEL', 'HC_SCALE', 'HC_GUIDE', 'HC_ENERGY'],
    requires: [],
  },
  { file: 'util.ts', provides: ['HC', 'HCViews'], requires: ['HC_CONST', 'HC_FMT'] },
  {
    file: 'core.ts',
    provides: ['setTab', 'jump', 'jumpOr', 'currentTab', 'HCNav'],
    requires: ['HC', 'NAV'],
    probes: ['HCDay'],
  },
  { file: 'today-date.ts', provides: ['HCDay'], requires: ['HC', 'I18N_DATE', 'NAV', 'SCORES'] },
  {
    file: 'nutri-day.ts',
    provides: ['nutriTarget', 'HCNutri'],
    requires: [
      'DETAIL', 'FOOD_BASICS', 'HC', 'HCDay', 'HC_DAYTYPE', 'HC_FMT', 'HC_FUEL', 'HC_GUIDE', 'HC_SCALE', 'I18N_NUTRI', 'INTAKE', 'LOCALE',
      'NUTRI', 'NUTRI_ARC', 'SCORES', 'TRAINING'
    ],
    probes: ['intakeWaiting', 'HCFood', 'foodTotals', 'intakeRefresh', 'HCProgress', 'HCAdherence', 'HCNutriScore'],
  },
  {
    file: 'food-core.ts',
    provides: ['foodTotals', 'HCFoodInternal'],
    requires: ['FOOD_BASICS', 'FOOD_CONST', 'HC', 'HC_FOODLOG', 'HC_GUIDE', 'I18N_FOOD'],
  },
  { file: 'food-sheet.ts', provides: [], requires: ['HC', 'HCFoodInternal'] },
  { file: 'food-catalog.ts', provides: [], requires: ['HC', 'HCFoodInternal'] },
  { file: 'food-log.ts', provides: ['foodTotals', 'HCFood'], requires: ['HC', 'HCFoodInternal'] },
  { file: 'settings.ts', provides: ['HCSettings'], requires: ['FOOD_CONST', 'HC', 'HCFood'] },
  {
    file: 'progress.ts',
    provides: ['HCProgress'],
    requires: ['DETAIL', 'HC', 'HCNutri', 'HCSettings', 'HC_FMT', 'HC_PROG', 'I18N_DATE', 'I18N_NUTRI', 'LOCALE', 'NUTRI'],
  },
  { file: 'adherence.ts', provides: ['HCAdherence'], requires: ['HC', 'HCFood', 'HC_ADH', 'I18N_NUTRI', 'NUTRI'] },
  {
    file: 'intake.ts',
    provides: ['intakeRefresh', 'intakeWaiting'],
    requires: [
      'DETAIL', 'FOOD_BASICS', 'HC', 'HCAdherence', 'HCDay', 'HCFood', 'HCNutri', 'HCProgress', 'HCSettings', 'HC_FMT', 'I18N_DATE',
      'I18N_INTAKE', 'INTAKE', 'LOCALE', 'NUTRI_ARC'
    ],
    probes: ['HCNutriScore'],
  },
  { file: 'training-today.ts', provides: ['HCProgram'], requires: ['HC', 'I18N_DATE', 'I18N_HOY', 'TRAINING', 'TRAINING_META'] },
  { file: 'training-dash.ts', provides: [], requires: ['DASH', 'HC', 'I18N_DASH', 'I18N_DATE'] },
  {
    file: 'training-activity.ts',
    provides: ['HCActivity'],
    requires: ['ACTIVITY', 'DETAIL', 'HC', 'HC_FMT', 'I18N_ACTIVITY', 'I18N_DATE', 'LOCALE'],
  },
  {
    file: 'health.ts',
    provides: [],
    requires: ['DETAIL', 'HC', 'HC_FMT', 'HEALTH', 'I18N_DATE', 'I18N_HEALTH', 'LOCALE', 'PROFILE', 'SCORES'],
  },
  {
    file: 'score.ts',
    provides: ['HCScore', 'HCAdvice'],
    requires: ['DETAIL', 'DIALS', 'HC', 'HCDay', 'HC_FMT', 'I18N_DATE', 'I18N_SCORE', 'LOCALE', 'SCORES'],
  },
  { file: 'monitor.ts', provides: [], requires: ['DETAIL', 'HC', 'HCDay', 'HC_FMT', 'I18N_DATE', 'I18N_DETAIL', 'I18N_SCORE', 'LOCALE', 'SCORES'] },
  { file: 'energy.ts', provides: [], requires: ['HC', 'HCDay', 'HC_BAND', 'I18N_SCORE', 'SCORES'] },
  {
    file: 'nutri-score.ts',
    provides: ['HCNutriScore'],
    requires: [
      'DETAIL', 'HC', 'HCAdherence', 'HCDay', 'HCNutri', 'HC_FMT', 'HC_NSCORE', 'I18N_NUTRI', 'I18N_SCORE', 'INTAKE', 'LOCALE', 'NUTRI',
      'SCORES', 'TRAINING', 'nutriTarget'
    ],
  },
  {
    file: 'timeline.ts',
    provides: [],
    requires: ['DETAIL', 'HC', 'HCDay', 'HCProgram', 'HC_FMT', 'I18N_DATE', 'I18N_SCORE', 'LOCALE', 'SCORES'],
  },
  { file: 'profile.ts', provides: ['HCProfile'], requires: ['HC', 'HCSettings', 'HCViews', 'I18N_PROFILE', 'LOCALE', 'PROFILE'] },
  { file: 'onboarding.ts', provides: ['HCOnboarding'], requires: ['HC', 'HCViews', 'HC_ENERGY', 'I18N_ONB', 'PROFILE'] },
  { file: 'nav-actions.ts', provides: ['HCActions'], requires: [] },
  {
    file: 'home-week.ts',
    provides: ['HCWeekPlan'],
    requires: ['DETAIL', 'HC', 'HCAdherence', 'HCDay', 'HCViews', 'I18N_SCORE', 'SCORES', 'TRAINING'],
  },
  {
    file: 'home-dash.ts',
    provides: ['HCDash'],
    requires: ['DETAIL', 'HC', 'HCViews', 'HC_FMT', 'I18N_DATE', 'I18N_DETAIL', 'I18N_SCORE', 'LOCALE', 'SCORES'],
  },
  { file: 'journal.ts', provides: ['HCJournal'], requires: ['HC', 'HCViews', 'I18N_DATE', 'I18N_SCORE', 'SCORES'] },
  // after every Inicio block's script (it moves the rendered blocks), before detail.ts (#home-edit)
  { file: 'home-order.ts', provides: ['HCHomeOrder'], requires: ['HC', 'HCViews', 'I18N_SCORE'] },
  // before detail.ts: the "?" help sheet is a registered view when detail.ts reads a #shortcuts deep link
  { file: 'shortcuts.ts', provides: [], requires: ['HC', 'HCViews', 'I18N_DETAIL', 'NAV'] },
  { file: 'deepdive.ts', provides: ['HCDeep'], requires: ['HC'] },
  // factories: loading them only assigns window.HCDetailState / HCDetailChart and reads nothing, so they
  // require nothing (the trace proves it, and still runs clean with both moved to the very front). What
  // they read (HC, HC_BAND, SCORES, HCNutriScore, HCSettings, I18N_DATE) is read when detail.ts calls
  // them: at its load (traced and declared on detail.ts) or later in handlers, which do not count.
  { file: 'detail-state.ts', provides: ['HCDetailState'], requires: [] },
  { file: 'detail-chart.ts', provides: ['HCDetailChart'], requires: [] },
  {
    file: 'detail.ts',
    provides: ['HCDetail'],
    requires: [
      'DETAIL', 'DIALS', 'HC', 'HCDeep', 'HCDetailChart', 'HCDetailState', 'HCNav', 'HCNutri', 'HCProgress', 'HCSettings', 'HCViews', 'HC_FMT', 'I18N_DATE', 'I18N_DETAIL', 'I18N_ONB',
      'LOCALE', 'NAV', 'SCORES'
    ],
  },
  { file: 'freshness.ts', provides: [], requires: ['HC', 'I18N_SYNC'] },
];
