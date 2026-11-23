/* The shapes of the page globals the module client scripts (*.ts) read. A spike: the globals are `any` until each
 * gets its own type (most are baked JSON whose shapes live in lib/). Classic scripts (*.js) are not type-checked. */
export type PageGlobals = {
  HC: any;
  DETAIL: any;
  SCORES: any;
  TRAINING: any;
  I18N_SCORE: any;
  I18N_SYNC: any;
  HC_BAND: any;
  DASH: any;
  I18N_DASH: any;
  I18N_DETAIL: any;
  NAV: any;
  I18N_DATE: any;
  I18N_PROFILE: any;
  LOCALE: any;
  PROFILE: any;
  ACTIVITY: any;
  HC_FMT: any;
  HC_ENERGY: any;
  I18N_ACTIVITY: any;
  I18N_ONB: any;
  HCProgram: any;
  HEALTH: any;
  I18N_HEALTH: any;
  DIALS: any;
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
  I18N_HOY: any;
  I18N_INTAKE: any;
  I18N_NUTRI: any;
  INTAKE: any;
  NUTRI: any;
  NUTRI_ARC: any;
  TRAINING_META: any;
  nutriTarget: any;
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
  }
  var HCDay: any;
}
