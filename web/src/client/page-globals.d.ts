/* The shapes of the page globals the module client scripts (*.ts) read: HC, LOCALE, the copy tables (I18N_*) and
 * SCORES / DETAIL / DIALS / DASH / INTAKE / ACTIVITY / HEALTH / NUTRI / FOOD_BASICS (from their builders), NUTRI_ARC,
 * TRAINING_META, PROFILE, NAV and FOOD_CONST are typed; TRAINING (lib/training/program.mjs) and
 * the HC_* globals (the lib CLIENT descriptors web/src/client/lib-globals.ts publishes) too. */
/** A lib global web/src/client/lib-globals.ts publishes from a module's `CLIENT` descriptor: its public
 * constants and functions (`hidden` constants are the module's own, never exposed). */
type ClientOf<C extends { consts?: object; fns?: object }> = C['consts'] & C['fns'];
/** A copy table the scripts also index by a runtime key (a kind, a range, a metric): each nested table keeps its
 * named keys and also takes any string key (an unknown key reads `undefined` at runtime, as before). */
type Lookup<T> = T extends readonly unknown[]
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { [K in keyof T]: Lookup<T[K]> } & { [key: string]: Lookup<T[keyof T]> }
      : T;
/** A copy module's baked strings: the `en` table (every locale has the same keys, web/test/i18n.test.mjs). */
type Copy<M extends { en: unknown }> = Lookup<M['en']>;

export type PageGlobals = {
  /** util.ts's helper library (its own inferred type: every helper's parameters and result). */
  HC: import('./util').HCApi;
  DETAIL: ReturnType<typeof import('../../../lib/detail/detail.mjs').detailFrom>;
  SCORES: ReturnType<typeof import('../../../lib/score/index.mjs').buildScoresFrom>;
  /** training-data.json's `days` (Bake.astro): the programmed sessions by ISO date (lib/training/program.mjs). */
  TRAINING: Record<string, import('../../../lib/training/program.mjs').ProgramSession>;
  I18N_SCORE: Copy<typeof import('../i18n/score-templates.mjs')>;
  I18N_SYNC: Copy<typeof import('../i18n/sync-templates.mjs')>;
  HC_BAND: ClientOf<typeof import('../../../lib/score/recovery.mjs')['CLIENT']>;
  DASH: ReturnType<typeof import('../bakes.mjs').computeBakes>['dash'];
  I18N_DASH: Copy<typeof import('../i18n/dash-templates.mjs')>;
  I18N_DETAIL: Copy<typeof import('../i18n/detail-templates.mjs')>;
  /** Plan.astro's one baked copy of lib/nav/tabs.mjs: the tab keys and the maps (section / detail metric / view /
   * anchor -> its tab) the scripts look up with a runtime key. */
  NAV: { tabs: readonly string[]; sectionTab: Readonly<Record<string, string>>; detailTab: Readonly<Record<string, string>>;
    detailAlias: Readonly<Record<string, string>>;
    viewTab: Readonly<Record<string, string | null>>; anchorTab: Readonly<Record<string, string>>;
    day: typeof import('../../../lib/nav/tabs.mjs')['DAY_HASH'] };
  I18N_DATE: Copy<typeof import('../i18n/date-templates.mjs')>;
  I18N_PROFILE: Copy<typeof import('../i18n/profile-templates.mjs')>;
  LOCALE: 'es' | 'en';
  /** computeBakes' profile (lib/profile/read.mjs loadProfile + the goal options) with `photo` reduced to a flag (Avatar.astro). */
  PROFILE: Omit<ReturnType<typeof import('../bakes.mjs').computeBakes>['profile'], 'photo'> & { photo: boolean };
  ACTIVITY: ReturnType<typeof import('../../../lib/training/activity.mjs').activityBake>;
  HC_FMT: ClientOf<typeof import('../../../lib/format/numbers.mjs')['CLIENT']>;
  HC_ENERGY: ClientOf<typeof import('../../../lib/nutrition/energy.mjs')['CLIENT']>;
  I18N_ACTIVITY: Lookup<Omit<typeof import('../i18n/activity-templates.mjs')['en'], 'head'>>; // Bake drops `head`
  I18N_ONB: Copy<typeof import('../i18n/onboarding-templates.mjs')>;
  HCProgram: any;
  HEALTH: ReturnType<typeof import('../bakes.mjs').computeBakes>['health'];
  I18N_HEALTH: Copy<typeof import('../i18n/health-templates.mjs')>;
  DIALS: ReturnType<typeof import('../view/dial.mjs').buildDials>;
  HCFoodInternal: any;
  HCDeep: any;
  HCDetailChart: any;
  HCDetailState: any;
  HCNav: any;
  HCNutri: any;
  HCProgress: any;
  HCSettings: any;
  HCViews: any;
  FOOD_BASICS: ReturnType<typeof import('../../../lib/nutrition/basics.mjs').buildBasics>;
  /** Dia.astro's food log constants (lib/nutrition/foodlog.mjs + slots.mjs). */
  FOOD_CONST: { meals: typeof import('../../../lib/nutrition/foodlog.mjs')['FOOD_MEALS']; stores: typeof import('../../../lib/nutrition/foodlog.mjs')['FOOD_STORES']; units: typeof import('../../../lib/nutrition/foodlog.mjs')['FOOD_UNITS']; limits: typeof import('../../../lib/nutrition/foodlog.mjs')['FOOD_LIMITS'];
    goals: typeof import('../../../lib/nutrition/foodlog.mjs')['SETTINGS_GOALS']; groups: typeof import('../../../lib/nutrition/slots.mjs')['MEAL_GROUPS']; mainSlots: typeof import('../../../lib/nutrition/slots.mjs')['MAIN_SLOTS']; addonGroup: typeof import('../../../lib/nutrition/slots.mjs')['ADDON_GROUP'];
    addonSlot: typeof import('../../../lib/nutrition/slots.mjs')['ADDON_SLOT']; lateNightHour: typeof import('../../../lib/nutrition/slots.mjs')['LATE_NIGHT_HOUR'] };
  HCAdherence: any;
  HCFood: any;
  HC_ADH: ClientOf<typeof import('../../../lib/nutrition/adherence.mjs')['CLIENT']>;
  HC_NSCORE: ClientOf<typeof import('../../../lib/nutrition/nutri-score.mjs')['CLIENT']>;
  HC_PROG: ClientOf<typeof import('../../../lib/nutrition/progress.mjs')['CLIENT']>;
  I18N_HOY: Copy<typeof import('../i18n/hoy-templates.mjs')>;
  I18N_INTAKE: Copy<typeof import('../i18n/intake-templates.mjs')>;
  I18N_NUTRI: Copy<typeof import('../i18n/nutri-templates.mjs')>;
  INTAKE: ReturnType<typeof import('../bakes.mjs').computeBakes>['intake'];
  NUTRI: ReturnType<typeof import('../../../lib/nutrition/today.mjs').buildNutriToday>;
  NUTRI_ARC: string; // view/dial.mjs arcPath(0, 1): the empty kcal dial's SVG path
  /** Bake.astro's trainingMeta prop (the program's header line). */
  TRAINING_META: ReturnType<typeof import('../../../lib/training/program.mjs').trainingMeta>;
  nutriTarget: any;
  HC_DAYTYPE: ClientOf<typeof import('../../../lib/nutrition/daytype.mjs')['CLIENT']>;
  HC_FUEL: ClientOf<typeof import('../../../lib/nutrition/fuel.mjs')['CLIENT']>;
  HC_GUIDE: Pick<typeof import('../../../lib/nutrition/num.mjs'), 'fin'> & Pick<typeof import('../../../lib/nutrition/amounts.mjs'), 'floorToStep'> & Pick<typeof import('../../../lib/nutrition/names.mjs'), 'foldName'> & ClientOf<typeof import('../../../lib/nutrition/guide.mjs')['CLIENT']>;
  HC_SCALE: ClientOf<typeof import('../../../lib/nutrition/amounts.mjs')['CLIENT']> & Pick<typeof import('../../../lib/nutrition/num.mjs'), 'round2'> & ClientOf<typeof import('../../../lib/nutrition/units.mjs')['CLIENT']> & ClientOf<typeof import('../../../lib/nutrition/fill.mjs')['CLIENT']> & ClientOf<typeof import('../../../lib/nutrition/fuel.mjs')['CLIENT']> & ClientOf<typeof import('../../../lib/nutrition/scale.mjs')['CLIENT']>;
  intakeWaiting: any;
  foodTotals: any;
  intakeRefresh: any;
  HCNutriScore: any;
  HC_FOODLOG: ClientOf<typeof import('../../../lib/nutrition/foodlog.mjs')['CLIENT']>;
  I18N_FOOD: Copy<typeof import('../i18n/food-templates.mjs')>;
};

// the window.* namespaces other scripts hand this one (and the one it hands back)
declare global {
  interface Window {
    HCAdherence?: any;
    HCNutri?: any;
    HCWeekPlan?: unknown;
    HCViews?: Record<string, unknown>;
    HCDetail?: any;
    HCActions?: { refresh: () => void; open: () => void; close: (restore: boolean) => void; run: (name: string) => boolean };
    HCHomeOrder?: unknown;
    HCJournal?: unknown;
    HCProfile?: unknown;
    HCProgress?: any;
    HCSettings?: any;
    HCActivity?: unknown;
    HCDash?: unknown;
    HCDay?: any;
    HCFood?: any;
    HCOnboarding?: unknown;
    HCProgram?: any;
    HCAdvice?: unknown;
    HCScore?: unknown;
    HCDeep?: any;
    HCDetailChart?: any;
    HCDetailState?: any;
    HCFoodInternal?: any;
    HCNav?: any;
    HCNutriScore?: any;
    foodTotals?: any;
    intakeRefresh?: any;
    intakeWaiting?: any;
    nutriTarget?: any;
    HC?: any;
    currentTab?: any;
    jump?: any;
    jumpOr?: any;
    setTab?: any;
  }
  var HCDay: any;
}
