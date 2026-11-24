/* lib/nutrition/targets.mjs — day types, goals and the (goal × day type) targets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_TYPES, GOALS, BASE_DAY, DEFAULT_BY_GOAL, carbsOf, resolveTargets, validateTargets, resolveGoal,
} from './targets.mjs';

test('seven day types (S1: in order of demand, gym = strength), three goals, each day type maps to a base day plan', () => {
  assert.deepEqual(DAY_TYPES, ['rest', 'gym', 'hybrid', 'indoor', 'run', 'bike', 'bikeLong']);
  assert.deepEqual(GOALS, ['maintain', 'cut', 'bulk']);
  assert.deepEqual(BASE_DAY, { rest: 'rest', gym: 'train', hybrid: 'train', indoor: 'train', run: 'train', bike: 'train', bikeLong: 'train' });
});

test('the default targets are the generic example seed (70 kg reference adult), not anyone\'s plan', () => {
  assert.deepEqual(DEFAULT_BY_GOAL.maintain, {
    rest: { kcal: 2300, p: 125, f: 65 }, gym: { kcal: 2700, p: 125, f: 65 },
    hybrid: { kcal: 2950, p: 125, f: 65 }, indoor: { kcal: 3000, p: 125, f: 65 }, run: { kcal: 3000, p: 125, f: 65 },
    bike: { kcal: 3100, p: 125, f: 65 }, bikeLong: { kcal: 3600, p: 125, f: 65 },
  });
  assert.deepEqual(DEFAULT_BY_GOAL.cut, {
    rest: { kcal: 1950, p: 140, f: 55 }, gym: { kcal: 2350, p: 140, f: 55 },
    hybrid: { kcal: 2600, p: 140, f: 55 }, indoor: { kcal: 2650, p: 140, f: 55 }, run: { kcal: 2650, p: 140, f: 55 },
    bike: { kcal: 3100, p: 140, f: 55 }, bikeLong: { kcal: 3600, p: 140, f: 55 },
  });
  assert.deepEqual(DEFAULT_BY_GOAL.bulk, {
    rest: { kcal: 2600, p: 125, f: 70 }, gym: { kcal: 3000, p: 125, f: 70 },
    hybrid: { kcal: 3250, p: 125, f: 70 }, indoor: { kcal: 3300, p: 125, f: 70 }, run: { kcal: 3300, p: 125, f: 70 },
    bike: { kcal: 3400, p: 125, f: 70 }, bikeLong: { kcal: 3900, p: 125, f: 70 },
  });
});

test('the default seed follows analysis/methodology.md for a 70 kg reference', () => {
  const KG = 70;
  for (const d of DAY_TYPES) {
    const m = DEFAULT_BY_GOAL.maintain[d];
    for (const g of GOALS) {
      const t = DEFAULT_BY_GOAL[g][d];
      assert.ok(t.p / KG >= 1.6 && t.p / KG <= 2.2, `${g}.${d}: protein ${t.p} g outside 1.6-2.2 g/kg`);
      assert.ok(t.f / KG >= 0.6 && t.f / KG <= 1.0, `${g}.${d}: fat ${t.f} g outside 0.6-1.0 g/kg`);
      assert.ok(carbsOf(t) > 0, `${g}.${d}: no room for carbs`);
    }
    const cut = DEFAULT_BY_GOAL.cut[d].kcal / m.kcal - 1;
    const bulk = DEFAULT_BY_GOAL.bulk[d].kcal / m.kcal - 1;
    if (d !== 'bike' && d !== 'bikeLong') assert.ok(cut <= -0.1 && cut >= -0.2, `cut.${d}: ${cut} outside a 10-20 % deficit`);
    else assert.equal(cut, 0, `cut.${d}: long-ride days stay fuelled at maintenance`);
    assert.ok(bulk >= 0.05 && bulk <= 0.15, `bulk.${d}: ${bulk} outside a 5-15 % surplus`);
  }
});

test('a plan with every byGoal cell ignores the defaults entirely', () => {
  /** @type {Record<string, Record<string, {kcal: number, p: number, f: number}>>} */
  const own = {};
  for (const g of GOALS) {
    own[g] = {};
    for (const d of DAY_TYPES) own[g][d] = { kcal: 2000 + DAY_TYPES.indexOf(d) * 100, p: 101, f: 51 };
  }
  const t = resolveTargets({ targets: { byGoal: own } });
  for (const g of GOALS) for (const d of DAY_TYPES) {
    assert.deepEqual(t[g][d], { ...own[g][d], c: carbsOf(own[g][d]) });
  }
});

test('carbs are the remainder: (kcal - 4p - 9f) / 4, rounded', () => {
  assert.equal(carbsOf({ kcal: 2500, p: 150, f: 60 }), 340);
  assert.equal(carbsOf({ kcal: 2150, p: 160, f: 55 }), 254); // 1015 / 4 = 253.75
});

test('resolveTargets: a plan without targets.byGoal gets every default cell, carbs computed', () => {
  const t = resolveTargets({});
  for (const g of GOALS) for (const d of DAY_TYPES) {
    const cell = t[g][d];
    assert.deepEqual({ kcal: cell.kcal, p: cell.p, f: cell.f }, DEFAULT_BY_GOAL[g][d]);
    assert.equal(cell.c, carbsOf(cell));
  }
});

test('resolveTargets: a partial byGoal overrides only its cells', () => {
  const t = resolveTargets({ targets: { byGoal: { cut: { rest: { kcal: 2000, p: 170, f: 50 } } } } });
  assert.deepEqual(t.cut.rest, { kcal: 2000, p: 170, f: 50, c: 218 });
  assert.equal(t.cut.gym.kcal, DEFAULT_BY_GOAL.cut.gym.kcal);
  assert.equal(t.maintain.rest.kcal, DEFAULT_BY_GOAL.maintain.rest.kcal);
});

test('S2 the new day types: hybrid +250, indoor +300, run +300 kcal over each goal\'s gym seed, same p / f', () => {
  for (const g of GOALS) {
    const gym = DEFAULT_BY_GOAL[g].gym;
    assert.deepEqual(DEFAULT_BY_GOAL[g].hybrid, { kcal: gym.kcal + 250, p: gym.p, f: gym.f });
    assert.deepEqual(DEFAULT_BY_GOAL[g].indoor, { kcal: gym.kcal + 300, p: gym.p, f: gym.f });
    assert.deepEqual(DEFAULT_BY_GOAL[g].run, { kcal: gym.kcal + 300, p: gym.p, f: gym.f });
  }
});

test('S2 resolveTargets: a plan without hybrid / indoor / run cells uses ITS OWN gym cell for them', () => {
  const old = { targets: { byGoal: {
    cut: { rest: { kcal: 1800, p: 160, f: 60 }, gym: { kcal: 2100, p: 160, f: 60 }, bike: { kcal: 2600, p: 160, f: 60 }, bikeLong: { kcal: 3300, p: 160, f: 60 } },
  } } };
  const t = resolveTargets(old);
  for (const d of ['hybrid', 'indoor', 'run']) assert.deepEqual(t.cut[d], { kcal: 2100, p: 160, f: 60, c: carbsOf({ kcal: 2100, p: 160, f: 60 }) }, d);
  // no gym cell in that goal: the defaults, as for every other missing cell
  for (const d of ['hybrid', 'indoor', 'run']) assert.equal(t.maintain[d].kcal, DEFAULT_BY_GOAL.maintain[d].kcal, d);
  // a plan's own new cell wins over its gym cell
  const own = resolveTargets({ targets: { byGoal: { cut: { gym: { kcal: 2100, p: 160, f: 60 }, run: { kcal: 2400, p: 160, f: 60 } } } } });
  assert.equal(own.cut.run.kcal, 2400);
  assert.equal(own.cut.hybrid.kcal, 2100);
  // the other day types keep the default fallback (a missing bike cell never copies gym)
  assert.equal(t.maintain.bike.kcal, DEFAULT_BY_GOAL.maintain.bike.kcal);
  assert.equal(resolveTargets({ targets: { byGoal: { cut: { gym: { kcal: 2100, p: 160, f: 60 } } } } }).cut.bike.kcal, DEFAULT_BY_GOAL.cut.bike.kcal);
});

test('validateTargets: the new day types are accepted', () => {
  const cell = { kcal: 2400, p: 160, f: 60 };
  assert.deepEqual(validateTargets({ targets: { byGoal: { cut: { hybrid: cell, indoor: cell, run: cell } } } }), []);
});

test('validateTargets: a valid or absent block has no errors', () => {
  assert.deepEqual(validateTargets({}), []);
  assert.deepEqual(validateTargets(/** @type {import('./targets.mjs').TargetsPlan} */ ({ targets: { train: { p: 150 } } })), []);
  assert.deepEqual(validateTargets({ targets: { byGoal: DEFAULT_BY_GOAL }, page: { goal: 'cut' } }), []);
});

test('validateTargets: unknown goal / day type, bad numbers, negative carbs, bad page.goal are errors', () => {
  const errs = validateTargets({
    targets: { byGoal: { recomp: {}, cut: { tempo: {}, rest: { kcal: -1, p: 150, f: 60 }, gym: { kcal: 1000, p: 200, f: 60 } } } },
    page: { goal: 'shred' },
  });
  const all = errs.join('\n');
  assert.match(all, /byGoal\.recomp: unknown goal/);
  assert.match(all, /byGoal\.cut\.tempo: unknown day type/);
  assert.match(all, /byGoal\.cut\.rest\.kcal/);
  assert.match(all, /byGoal\.cut\.gym: .*carbs/);
  assert.match(all, /page\.goal/);
  assert.equal(validateTargets({ targets: { byGoal: [] } }).length, 1);
});

test('resolveGoal: page.goal when valid, else maintain', () => {
  assert.equal(resolveGoal({}), 'maintain');
  assert.equal(resolveGoal({ page: { goal: 'bulk' } }), 'bulk');
  assert.equal(resolveGoal({ page: { goal: 'nope' } }), 'maintain');
});
