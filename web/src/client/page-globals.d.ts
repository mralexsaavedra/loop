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
  }
  var HCDay: any;
}
