/* The shapes of the page globals the module client scripts (*.ts) read. A spike: the globals are `any` until each
 * gets its own type (most are baked JSON whose shapes live in lib/). Classic scripts (*.js) are not type-checked. */
export type PageGlobals = {
  HC: any;
  DETAIL: any;
  SCORES: any;
  TRAINING: any;
  I18N_SCORE: any;
};

// the window.* namespaces other scripts hand this one (and the one it hands back)
declare global {
  interface Window { HCAdherence?: any; HCNutri?: any; HCWeekPlan?: unknown }
  var HCDay: any;
}
