> **English** · [Español](page-tour.es.md)

# A tour of the page

What each tab shows, what each card tells you and where its numbers come from. For people who just
installed it and are opening it for the first time.

The page (it calls itself **LOOP**) is built only from your own data: Apple Health, Strava, your food log
and the plan and profile files you filled in. Nothing is made up. A card with no data says so, or stays
hidden. **Tap any card to see its history**: a sheet opens with the day-by-day values and W / M / 6M / 1Y
ranges. The ⓘ next to a title explains how to read that block. The four tabs sit in the dock at the
bottom. The **"+"** button next to them only shows up on the LAN page (see below).

## Home

Today at a glance. The date pill at the top has ‹ and › arrows, so you can step back and see an earlier
day.

| Card | What it tells you | Where the data comes from |
| --- | --- | --- |
| **Sleep** dial | Last night's sleep against your sleep need | Apple Watch sleep (Apple Health) |
| **Recovery** dial | Last night's recovery, ranked against your previous 90 days (a "No baseline" note shows until enough nights build up) | HRV, resting heart rate and sleep from Apple Health |
| **Load** dial | Today's training strain (0–21) once there are enough days of all-day heart rate. Until then, today's Relative Effort against your typical training day | Heart rate from Apple Health; Relative Effort from Strava |
| **Health monitor** tile | How many overnight signals sit outside your own normal range; tap it to open the full list on Health | Apple Health |
| **Stress monitor** tile | A stress estimate for the latest scored hour, based on heart rate only | Apple Health heart rate |
| **My day**: *Your daily outlook* | One sentence of advice for the day | Your recovery and load |
| **My day**: *Energy bank* | Our own estimate of your energy through the day (0–100). It is not a medical measure | Recovery, heart rate and stress |
| **My day**: *Nutrition* | How close yesterday came to your kcal, protein and fat targets. While you are still logging today, how far along today is | Your food log against your plan |
| **Today's activities** | Last night's sleep, today's workouts and the session your program has for today | Apple Health, Strava, your training program |
| **Today you eat** | Today's day type with its target kcal and macros for your goal | Your nutrition plan |
| **Tonight's sleep** | A suggested bedtime: your usual wake time minus your sleep target | Your recent nights |
| **My journal** | Which of the last 7 days you filled in your journal | Your journal (LAN page) |
| **My plan** | Your week so far: nights slept to target, training days, days with food logged, days on your kcal target | All of the above |
| **My dashboard** | Your chosen metrics against their 30-day average. Use *Customize* to pick and order them | Apple Health |

How it's built: [Home tab](../home-tab.md), [detail views](../detail-views.md).

## Training

| Card | What it tells you | Where the data comes from |
| --- | --- | --- |
| **Load** (gym / run / bike) | Your last scored session in each sport, and whether your 7-day load is above, below or in line with your 42-day load | Relative Effort from Strava |
| **Activity** | Total training time for the week, month or 6 months (W / M / 6M) against the period before it; sessions, training days, days per week; the split by sport; a 30-day calendar | Apple Watch workouts and Strava |
| **Running** / **Cycling** | One row per run or ride: distance, time, pace, heart rate, effort, elevation | Apple Watch workouts and Strava |
| **Weekly cardiovascular load** | Your training load per week, and how your HRV and resting heart rate compare in harder and easier weeks | Workouts with heart rate; Apple Health |
| **Intensity (HR)** | Average heart rate in each sport over recent weeks. Strength work reads low because heart rate measures cardio effort, not muscle effort | Apple Health and Strava |

Today's programmed session shows up on Home as a row under *Today's activities*. Tap it to see the whole
session. It comes from the training program you loaded. Without a program, the row is left out.

How it's built: [Training tab](../training.md).

## Health

Every row shows the newest value with your 30-day average under it. A ▲ or ▼ marks the change, teal
when it is better and orange when it is worse. Values more than 3 days old are greyed out.

| Section | What it shows | Where the data comes from |
| --- | --- | --- |
| **Health monitor** | Respiratory rate, resting heart rate, HRV, sleeping wrist temperature and sleep duration, each marked Normal, High or Low against your own normal range | Apple Health |
| **Recovery** | Last night's recovery % and its recent trend | Apple Health |
| **Fitness** | Fitness age (set `sex` in your profile to get it), VO₂max, walking heart rate | Apple Health |
| **Sleep** | Last night, the share of nights you hit your target, bedtime and wake time, and sleep stages when your watch records them | Apple Watch sleep |
| **Body composition** | Weight, body fat, lean mass, waist | Apple Health (for example a smart scale) |
| **Activity** | Steps, exercise minutes, distance, flights climbed | Apple Health |
| **Energy** | Daily expenditure (active + resting). On rides with a power meter, the ride's measured energy replaces the watch's figure | Apple Watch; Strava for power-meter rides |

How it's built: [Health tab](../health-tab.md).

## Nutrition

| Card | What it tells you | Where the data comes from |
| --- | --- | --- |
| **Today's summary** | Today's day type, your kcal target and macros, and how much you have eaten so far | Your plan and your food log |
| **Log food** | What you ate today (LAN page only) | Your food log |
| **Today's plan** | A portion guide for breakfast, lunch, dinner and extras, scaled to today's budget | Your nutrition plan |
| **Ride fuelling** | Fuelling for the ride (bike days only) | Your plan |
| **Balance** | Intake against expenditure, and your macro split | Food log and Apple Health |
| **Progress** | Your weight trend against your goal | Weigh-ins and your goal |
| **Consistency** | How regularly you log your food (LAN page only) | Your food log |
| **My products** / **My recipes** | The foods and recipes you saved (LAN page only) | Your food log |
| **Equivalences** | A fixed reference table per food (a piece, a tablespoon or 100 g). It never changes with the day | The ingredient list |

How it's built: [nutrition plan](../nutrition.md), [food log, progress and consistency](../nutrition-food-log.md).

## Logging food and your journal

The **"+"** button only appears on the LAN page, where the data service can save what you enter. In a
static copy or the example page, it stays hidden. It offers only the actions that work right now:

- **Add food**: log a product or recipe you saved. To add a new product, copy it from its label, or look
  it up by barcode or name on Open Food Facts and check each value against the label before saving.
  The day's totals update straight away. Unknown macros stay unknown; they are never guessed.
- **Complete your journal**: a few yes/no questions about your day (late caffeine, alcohol, a nap, a
  stressful day…), plus notes. Under *Behaviors* you can switch off anything you do not track. After
  enough days, *Behavior insights* shows how your next-morning recovery differed after each one. That
  is an association, not proof of cause.
- **Sync**: the same as the Sync button in the top bar (see below).

How it's built: [food log](../nutrition-food-log.md), [journal](../journal.md).

## Your profile

The round **avatar** in the top bar opens your profile:

- **Goal**: Maintain, Lose or Gain. Each option shows its gentle daily kcal change. Changing the goal
  updates every target on the page at once. On the LAN page you can also set a **Target weight**, and
  the goal is saved on your server.
- **Edit** (LAN page only) opens the setup assistant again: your body, sports, goal and a summary of
  your targets.
- **Body, Gear, Devices, Upcoming events, Supplements**: these come from your profile file and from
  Strava (name, photo, bikes, shoes, the devices your activities were recorded with). Age is worked out
  from your birthdate. Weight is your latest weigh-in.

How it's built: [profile](../profile.md), [onboarding](../onboarding.md).

## When a card looks empty or stale

Every card is only as fresh as its source:

- **Apple Health** (sleep, recovery, health, energy) arrives through the iOS Shortcut, usually once a
  day. The one-off Apple Health export only fills in your history. If the Shortcut has not run, these
  cards fall behind and show a grey "Data N d old" note.
- **Strava** (Relative Effort, rides, runs, gear) arrives with each sync.
- **Food log, journal, goal** live on your LAN server, so they are current as soon as you save.

On the LAN page, the top bar shows a freshness dot. Tap it to see when the **Shortcut**, **Strava** and
the **Page** last updated, with a hint for whichever one is late. The **Sync** button pulls fresh data
and rebuilds the page. A card that stays empty after that usually means its source is not connected
yet. Setup steps: [iOS Shortcut](../ios-shortcut.md), [data pipeline](../data-pipeline.md),
[LAN services](../lan-services.md).

*This page describes your data. It is not medical advice.*
