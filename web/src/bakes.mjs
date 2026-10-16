/* computeBakes(env) — the build-time view-models the page bakes, computed from the resolved env
 * (web/src/env.mjs resolveEnv: plan, ingredients, extractDir, repoRoot, dataMode). This is the
 * page's composition root: web/pages/index.astro calls it and only renders the result, so the
 * golden guard (web/test/golden-bake.test.mjs, scripts/golden-bake.mjs) runs exactly the code path
 * the page runs. Plain object out, no Astro dependency.
 */
import { buildNutrition } from '../../lib/nutrition/macros.mjs';
import { dashboardFrom } from '../../lib/training/dashboard.mjs';
import { activityFrom } from '../../lib/training/activity.mjs';
import { healthFrom } from '../../lib/health/aggregate.mjs';
import { buildScoresFrom } from '../../lib/score/index.mjs';
import { readExtract } from '../../lib/extract/read.mjs';
import { intakeFrom } from '../../lib/nutrition/intake.mjs';
import { buildFoodlogBake } from '../../lib/nutrition/read.mjs';
import { dayViewModel } from './view/day-totals.mjs';
import { detailFrom } from '../../lib/detail/detail.mjs';
import { loadProfile } from '../../lib/profile/read.mjs';
import { newestWeight } from '../../lib/profile/profile.mjs';
import { goalOptions } from '../../lib/profile/goal.mjs';
import { resolveTargets } from '../../lib/nutrition/targets.mjs';

export function computeBakes(env) {
  const { plan, ingredients, extractDir, repoRoot, dataMode, onboarding = null, paths = null } = env;
  const nut = buildNutrition(ingredients, plan);
  // the extract, read once (lib/extract/read.mjs): the deep-frozen inputs of every pure *From core below;
  // nothing else here reads the extract (the food log and the profile JSONs are not extract files)
  const inputs = readExtract(extractDir);
  const dash = dashboardFrom(inputs);
  const activity = activityFrom(inputs);
  const health = healthFrom(inputs);
  // the avatar + profile sheet: manual profile.json + the Strava snapshot + the latest weigh-in (all optional),
  // plus the Goal setting's options (kcal/day vs maintain per goal, from the plan's resolved targets)
  const weight = newestWeight(inputs.series.weight);
  const profile = { ...loadProfile({ repoRoot, dataMode, weight, onboarding, paths }), goals: goalOptions(resolveTargets(plan), onboarding ? onboarding.goals : undefined) };
  // the profile's sex picks the fitness-age reference curve (lib/score/fitness-age.mjs)
  const scores = buildScoresFrom(inputs, { sex: profile.sex });
  // the detail sheet behind every card: the last 365 days per metric (only the data's own dates)
  const detail = detailFrom(inputs, { sex: profile.sex });
  // intake rings target = the same day totals Mi día shows for a train / rest day
  // + `log`: the synced food log's last 90 days (the example: the demo extract's), the nutrition score's
  // input on every page (client/nutri-score.js; the LAN page's live summary overrides it day by day)
  const intake = { ...intakeFrom(inputs, { train: dayViewModel(nut, 'train').totals, rest: dayViewModel(nut, 'rest').totals }), log: buildFoodlogBake({ repoRoot, dataMode, extractDir, paths }) };
  return { nut, dash, activity, health, profile, scores, detail, intake };
}
