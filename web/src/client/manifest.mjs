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
  { file: 'util.js', provides: ['HC', 'HCViews'], requires: ['HC_CONST', 'HC_FMT'] },
  {
    file: 'core.js',
    provides: [
      'NAV_TABS', 'SECTION_TAB', 'DETAIL_TAB', 'VIEW_TAB', 'ANCHOR_TAB', 'DAY', 'hasOwn', 'tabVisible', 'defaultTab', 'currentTab',
      'readHash', 'tabHash', 'writeTabHash', 'setTab', 'showTab', 'jump', 'jumpOr', 'DETAIL_HASH_RE', 'KEY_HASH_RE', 'hashRoute',
      'showAnchor', 'HCNav'
    ],
    requires: ['HC', 'NAV'],
    probes: ['HCDay'],
  },
  { file: 'today-date.js', provides: ['HCDay'], requires: ['HC', 'I18N_DATE', 'NAV', 'SCORES'] },
  {
    file: 'nutri-day.js',
    provides: ['nutriTarget', 'HCNutri'],
    requires: [
      'DETAIL', 'FOOD_BASICS', 'HC', 'HCDay', 'HC_DAYTYPE', 'HC_FMT', 'HC_FUEL', 'HC_GUIDE', 'HC_SCALE', 'I18N_NUTRI', 'INTAKE', 'LOCALE',
      'NUTRI', 'NUTRI_ARC', 'SCORES', 'TRAINING'
    ],
    probes: ['intakeWaiting', 'HCFood', 'foodTotals', 'intakeRefresh', 'HCProgress', 'HCAdherence', 'HCNutriScore'],
  },
  {
    file: 'food-core.js',
    provides: ['foodTotals', 'HCFoodInternal'],
    requires: ['FOOD_BASICS', 'FOOD_CONST', 'HC', 'HC_FOODLOG', 'HC_GUIDE', 'I18N_FOOD'],
  },
  { file: 'food-sheet.js', provides: [], requires: ['HC', 'HCFoodInternal'] },
  { file: 'food-catalog.js', provides: [], requires: ['HC', 'HCFoodInternal'] },
  { file: 'food-log.js', provides: ['foodTotals', 'HCFood'], requires: ['HC', 'HCFoodInternal'] },
  { file: 'settings.js', provides: ['HCSettings'], requires: ['FOOD_CONST', 'HC', 'HCFood'] },
  {
    file: 'progress.js',
    provides: ['HCProgress'],
    requires: ['DETAIL', 'HC', 'HCNutri', 'HCSettings', 'HC_FMT', 'HC_PROG', 'I18N_DATE', 'I18N_NUTRI', 'LOCALE', 'NUTRI'],
  },
  { file: 'adherence.js', provides: ['HCAdherence'], requires: ['HC', 'HCFood', 'HC_ADH', 'I18N_NUTRI', 'NUTRI'] },
  {
    file: 'intake.js',
    provides: ['intakeRefresh', 'intakeWaiting'],
    requires: [
      'DETAIL', 'FOOD_BASICS', 'HC', 'HCAdherence', 'HCDay', 'HCFood', 'HCNutri', 'HCProgress', 'HCSettings', 'HC_FMT', 'I18N_DATE',
      'I18N_INTAKE', 'INTAKE', 'LOCALE', 'NUTRI_ARC'
    ],
    probes: ['HCNutriScore'],
  },
  { file: 'training-today.js', provides: ['HCProgram'], requires: ['HC', 'I18N_DATE', 'I18N_HOY', 'TRAINING', 'TRAINING_META'] },
  { file: 'training-dash.js', provides: [], requires: ['DASH', 'HC', 'I18N_DASH', 'I18N_DATE'] },
  {
    file: 'training-activity.js',
    provides: ['HCActivity'],
    requires: ['ACTIVITY', 'DETAIL', 'HC', 'HC_FMT', 'I18N_ACTIVITY', 'I18N_DATE', 'LOCALE'],
  },
  {
    file: 'health.js',
    provides: [],
    requires: ['DETAIL', 'HC', 'HC_FMT', 'HEALTH', 'I18N_DATE', 'I18N_HEALTH', 'LOCALE', 'PROFILE', 'SCORES'],
  },
  {
    file: 'score.js',
    provides: ['scMod', 'HCAdvice'],
    requires: ['DETAIL', 'DIALS', 'HC', 'HCDay', 'HC_FMT', 'I18N_DATE', 'I18N_SCORE', 'LOCALE', 'SCORES'],
  },
  { file: 'monitor.js', provides: [], requires: ['DETAIL', 'HC', 'HCDay', 'HC_FMT', 'I18N_DATE', 'I18N_SCORE', 'LOCALE', 'SCORES'] },
  { file: 'energy.js', provides: [], requires: ['HC', 'HCDay', 'I18N_SCORE', 'SCORES'] },
  {
    file: 'nutri-score.js',
    provides: ['HCNutriScore'],
    requires: [
      'DETAIL', 'HC', 'HCAdherence', 'HCDay', 'HCNutri', 'HC_FMT', 'HC_NSCORE', 'I18N_NUTRI', 'I18N_SCORE', 'INTAKE', 'LOCALE', 'NUTRI',
      'SCORES', 'TRAINING', 'nutriTarget'
    ],
  },
  {
    file: 'timeline.js',
    provides: [],
    requires: ['DETAIL', 'HC', 'HCDay', 'HCProgram', 'HC_FMT', 'I18N_DATE', 'I18N_SCORE', 'LOCALE', 'SCORES'],
  },
  { file: 'profile.js', provides: ['HCProfile'], requires: ['HC', 'HCSettings', 'HCViews', 'I18N_PROFILE', 'PROFILE'] },
  { file: 'onboarding.js', provides: ['HCOnboarding'], requires: ['HC', 'HCViews', 'HC_ENERGY', 'I18N_ONB', 'PROFILE'] },
  { file: 'nav-actions.js', provides: ['HCActions'], requires: [] },
  {
    file: 'home-week.js',
    provides: ['HCWeekPlan'],
    requires: ['DETAIL', 'HC', 'HCAdherence', 'HCDay', 'HCViews', 'I18N_SCORE', 'SCORES', 'TRAINING'],
  },
  {
    file: 'home-dash.js',
    provides: ['HCDash'],
    requires: ['DETAIL', 'HC', 'HCViews', 'HC_FMT', 'I18N_DATE', 'I18N_DETAIL', 'I18N_SCORE', 'LOCALE', 'SCORES'],
  },
  { file: 'journal.js', provides: ['HCJournal'], requires: ['HC', 'HCViews', 'I18N_DATE', 'I18N_SCORE', 'SCORES'] },
  { file: 'deepdive.js', provides: ['HCDeep'], requires: ['HC'] },
  // factories: loading them only assigns window.HCDetailState / HCDetailChart and reads nothing, so they
  // require nothing (the trace proves it, and still runs clean with both moved to the very front). What
  // they read (HC, HC_BAND, SCORES, HCNutriScore, HCSettings, I18N_DATE) is read when detail.js calls
  // them: at its load (traced and declared on detail.js) or later in handlers, which do not count.
  { file: 'detail-state.js', provides: ['HCDetailState'], requires: [] },
  { file: 'detail-chart.js', provides: ['HCDetailChart'], requires: [] },
  {
    file: 'detail.js',
    provides: ['HCDetail'],
    requires: [
      'DETAIL', 'DIALS', 'HC', 'HCDeep', 'HCDetailChart', 'HCDetailState', 'HCNav', 'HCNutri', 'HCProgress', 'HCSettings', 'HCViews', 'HC_FMT', 'I18N_DATE', 'I18N_DETAIL', 'I18N_ONB',
      'LOCALE', 'NAV', 'SCORES'
    ],
  },
  { file: 'freshness.js', provides: [], requires: ['HC', 'I18N_SYNC'] },
];
