# Analysis methodology

The framework Claude follows to turn raw data into recommendations. Every number
produced in a report must trace back to a method here. If a method can't be
applied because data is missing, the report says so explicitly.

## 1. Energy needs (TDEE)

**BMR — Mifflin-St Jeor:**
- Men:   BMR = 10·weight(kg) + 6.25·height(cm) − 5·age + 5
- Women: BMR = 10·weight(kg) + 6.25·height(cm) − 5·age − 161

**TDEE = BMR × activity factor:**
| Activity | Factor |
|----------|--------|
| Sedentary (little/no exercise) | 1.2 |
| Light (1–3 days/week) | 1.375 |
| Moderate (3–5 days/week) | 1.55 |
| Active (6–7 days/week) | 1.725 |
| Very active (hard daily / physical job) | 1.9 |

Prefer deriving the activity factor from actual workout frequency in the Apple
Health export rather than self-report. TDEE is an estimate (±10%); validate it
against the real weight trend (section 3) and adjust.

## 2. Macronutrient targets

Set by goal, anchored to bodyweight:
- **Protein:** 1.6–2.2 g/kg. Higher end when in a deficit or building muscle.
- **Fat:** 0.6–1.0 g/kg (never below ~0.5 for hormonal health).
- **Carbs:** remaining calories. Scale up with training volume.

Calorie target by goal:
- **Fat loss:** deficit of 10–20% below TDEE (~0.25–0.5 kg/week loss). Never an
  aggressive crash deficit.
- **Muscle gain:** surplus of 5–15% above TDEE (~0.1–0.25 kg/week gain).
- **Maintenance/recomp:** ≈ TDEE, high protein.

## 3. Weight trend analysis

- Use a **7-day rolling average**, not single-day values — daily weight swings
  ±1–2 kg from water/food/sodium and mean nothing in isolation.
- Healthy rate of change: **0.25–0.5 kg/week** (either direction). Faster loss
  risks muscle; faster gain risks fat.
- Compare actual weekly change to the predicted change from the calorie target.
  Mismatch → recalibrate TDEE, not the scale.

## 4. Training analysis (from Apple Health workouts)

- **Frequency:** sessions/week, trend over months.
- **Modality balance:** strength vs cardio vs mobility. Flag lopsided patterns
  relative to the stated goal.
- **Volume & consistency:** total duration/energy per week; spot gaps and
  drop-offs.
- **Recovery signals:** resting HR trend (rising RHR over weeks can signal
  under-recovery), and HRV/sleep if present.
- **Day strain (0–21, our estimate, not the reference app's formula):** all-day cardiovascular
  load = Σ minutes × zone weight (Edwards TRIMP; zones by % of max HR: < 50 % → 0, 50–60 → 1,
  60–70 → 2, 70–80 → 3, 80–90 → 4, ≥ 90 → 5). Strava activities count from their HR-stream
  histogram; the rest of the day from the Watch samples (`hr-hourly.csv`, each sample until the
  next one, ≤ 10 min, activity windows left out). Strain = 21 × (1 − e^(−load / K)), with K set so
  the owner's 95th-percentile full day (≥ 10 h of HR coverage) of the last 90 days = 18
  (K = p95 / ln 7); under 14 full days there is no strain and Inicio keeps the Relative Effort
  dial. It is relative to the owner's own history: compare it with their past days, never with
  another person or app. Code: `lib/score/strain.mjs`.
- **Stress estimate (0–3, heart rate only, our estimate):** per waking clock hour of
  `hr-hourly.csv`, stress = clamp(3 × (HR − RHR) / (0.3 × (HRmax − RHR)), 0, 3): 0 at resting HR,
  3 at resting HR + 30 % of the heart-rate reserve. Bands: low < 1, medium 1–2, high ≥ 2. HR of the
  hour = its sample mean, or the time-weighted mean outside a Strava activity window when one
  touches the hour; scored only with ≥ 30 covered minutes outside workouts. Hours ≥ 30 min inside
  the night (`sleep-daily.csv` bedtime → waketime) are left out. RHR = that day's `rhr.csv` value
  (else the newest of the 3 days before); HRmax = the HR-zones max HR (profile `maxHr`, else the
  highest Strava max HR of 12 months). A day needs ≥ 6 scored hours for a value (the latest hour =
  "now", plus the day average and minutes per band). Limits: no HRV (the reference app uses it),
  and there are no hourly steps, so walking or any movement that is not a recorded workout raises
  it. Not a medical or psychological measure. Code: `lib/score/stress.mjs`.

## 5. What "good or bad" means

Never absolute — always relative to **goal + trend**:
- Intake/training is "on track" if the trend moves toward the goal at a healthy
  rate and is sustainable.
- "Off track" if the trend stalls/reverses, the deficit/surplus is unsafe, protein
  is chronically low, or the pattern isn't sustainable.
- Always weigh adherence: a 90%-followed good-enough plan beats a perfect plan
  abandoned in two weeks.

### 5a. Behaviour journal vs recovery (association only)

The behaviour journal (`journal-daily.csv` in the extract, `docs/journal.md`) can be related to the
NEXT morning's recovery: for a behaviour, mean recovery % (the recovery dial's percentile, the night
scored as the dial showed it that morning) after the "yes" days minus after the "no" days, in points
(`lib/journal/journal.mjs` `behaviorInsights`, the page's Journal insights over the last 90 days).
Rules: quote a difference only when EACH side has ≥ 5 days with a next-morning score, else say "not
enough data"; always call it an association, never a cause (training load, sleep timing and illness
travel with the same days); prefer behaviours with many days on both sides; a single week never
changes an action. Use it to pick what to test (e.g. two weeks without late caffeine), not as proof.

## 6. Report structure

Each report (`analysis/reports/YYYY-MM-DD.md`) is written in **Spanish** (the owner's language),
opens with a short "why now / what changed since the last report" paragraph, and contains:

0. **Data freshness & limits** — a table with the newest date of every source used
   (`_meta.json`, each CSV, `foodlog-daily.meta.json`, `journal-daily.meta.json`, `settings.json` `fetchedAt`) and what is
   missing or partial. Read first: it bounds every conclusion below.
1. **Snapshot** — current metrics vs baseline vs last report, and vs the live goal / target weight.
2. **Trends** — weight / body comp, nutrition (only if food data exists; otherwise state the gap),
   recovery, training load by modality, upcoming events (with the rolling-average numbers).
3. **Follow-up of previous actions** — each action of the previous report with its status
   (done / partial / not followed / owner's decision), backed by data.
4. **2–4 actions** — concrete, prioritized, sustainable.
5. **Disclaimer.**

## Safety bounds

- No calorie target below ~1500 (men) / ~1200 (women) without professional supervision.
- No recommendation > 1% bodyweight/week change.
- Defer to a physician/dietitian for any clinical flag.
