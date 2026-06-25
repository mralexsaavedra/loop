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

## 5. What "good or bad" means

Never absolute — always relative to **goal + trend**:
- Intake/training is "on track" if the trend moves toward the goal at a healthy
  rate and is sustainable.
- "Off track" if the trend stalls/reverses, the deficit/surplus is unsafe, protein
  is chronically low, or the pattern isn't sustainable.
- Always weigh adherence: a 90%-followed good-enough plan beats a perfect plan
  abandoned in two weeks.

## 6. Report structure

Each report (`analysis/reports/YYYY-MM-DD.md`) contains:
1. **Snapshot** — current metrics vs baseline vs last report.
2. **Trends** — weight, training, recovery (with the rolling-average numbers).
3. **Nutrition assessment** — only if food data exists; otherwise state the gap.
4. **2–4 actions** — concrete, prioritized, sustainable.
5. **Disclaimer.**

## Safety bounds

- No calorie target below ~1500 (men) / ~1200 (women) without professional supervision.
- No recommendation > 1% bodyweight/week change.
- Defer to a physician/dietitian for any clinical flag.
