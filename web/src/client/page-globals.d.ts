/* The shapes of the page globals the module client scripts (*.ts) read: HC, LOCALE, the copy tables (I18N_*) and
 * SCORES / DETAIL / DIALS / DASH / INTAKE / ACTIVITY / HEALTH (from their builders) are typed; the baked data globals are `any` until each gets its own type (their shapes live in lib/). */
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
  TRAINING: any;
  I18N_SCORE: Copy<typeof import('../i18n/score-templates.mjs')>;
  I18N_SYNC: Copy<typeof import('../i18n/sync-templates.mjs')>;
  HC_BAND: any;
  DASH: ReturnType<typeof import('../bakes.mjs').computeBakes>['dash'];
  I18N_DASH: Copy<typeof import('../i18n/dash-templates.mjs')>;
  I18N_DETAIL: Copy<typeof import('../i18n/detail-templates.mjs')>;
  NAV: any;
  I18N_DATE: Copy<typeof import('../i18n/date-templates.mjs')>;
  I18N_PROFILE: Copy<typeof import('../i18n/profile-templates.mjs')>;
  LOCALE: 'es' | 'en';
  PROFILE: any;
  ACTIVITY: ReturnType<typeof import('../../../lib/training/activity.mjs').activityBake>;
  HC_FMT: any;
  HC_ENERGY: any;
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
  FOOD_BASICS: any;
  FOOD_CONST: any;
  HCAdherence: any;
  HCFood: any;
  HC_ADH: any;
  HC_NSCORE: any;
  HC_PROG: any;
  I18N_HOY: Copy<typeof import('../i18n/hoy-templates.mjs')>;
  I18N_INTAKE: Copy<typeof import('../i18n/intake-templates.mjs')>;
  I18N_NUTRI: Copy<typeof import('../i18n/nutri-templates.mjs')>;
  INTAKE: ReturnType<typeof import('../bakes.mjs').computeBakes>['intake'];
  NUTRI: any;
  NUTRI_ARC: any;
  TRAINING_META: any;
  nutriTarget: any;
  HC_DAYTYPE: any;
  HC_FUEL: any;
  HC_GUIDE: any;
  HC_SCALE: any;
  intakeWaiting: any;
  foodTotals: any;
  intakeRefresh: any;
  HCNutriScore: any;
  HC_FOODLOG: any;
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
