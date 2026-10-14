# Documentation

Start with the project [`README.md`](../README.md): what this is and the three install levels. Then pick what
you need below. **Guides** are for using and setting up your own copy; the **reference** explains how each area is
built, for anyone changing the code.

## Guides — setting up and using it

| You want to… | Read |
| --- | --- |
| Install it, level by level (local page → LAN services → phone + Strava) | [`README.md`](../README.md) → Levels |
| Try it with no data of your own | [`data/demo/README.md`](../data/demo/README.md) |
| Run the page and the data service at home | [`services/plan-web/README.md`](../services/plan-web/README.md) → Install (host) |
| Send your Apple Health data from the iPhone every day | [`ios-shortcut.md`](ios-shortcut.md) |
| Connect Strava | [`services/health-ingest/README.md`](../services/health-ingest/README.md) → Getting the Strava credentials |
| Set up your profile with Claude Code, or with the page's own assistant | [`onboarding.md`](onboarding.md) |
| Run a second install for another person on the same host | [`services/plan-web/README.md`](../services/plan-web/README.md) → Running a second install |

## Reference — how each area is built

| Area | Doc |
| --- | --- |
| The page: single-file build, tabs, URL hash, look | [`plan-page.md`](plan-page.md) |
| Home tab: dials, advice, "today you eat", monitor, timeline | [`home-tab.md`](home-tab.md) |
| Training tab: today's session, calendar, workouts | [`training.md`](training.md) |
| Health tab: body, activity, energy, running / cycling, recovery, sleep | [`health-tab.md`](health-tab.md) |
| Nutrition: the plan, goals, day types, portion guide, fuelling | [`nutrition.md`](nutrition.md) |
| Food log, products, recipes, progress, consistency | [`nutrition-food-log.md`](nutrition-food-log.md) |
| Journal: daily behaviours vs next-morning recovery | [`journal.md`](journal.md) |
| Detail views: the history sheet behind every card | [`detail-views.md`](detail-views.md) |
| Profile sheet, goal setting, the in-page onboarding | [`profile.md`](profile.md) |
| Design system: tokens, components, the guard test | [`design-system.md`](design-system.md) |
| Data pipeline: Apple Health extract, Shortcut and Strava sync | [`data-pipeline.md`](data-pipeline.md) |
| LAN services: page + data service, sync protocol, security | [`lan-services.md`](lan-services.md) |
| Coach subagents and their knowledge base | [`knowledge-base.md`](knowledge-base.md) |
| The guard hook that keeps personal data out of git | [`guard-hook.md`](guard-hook.md) |
| How every number is computed (analysis framework) | [`../analysis/methodology.md`](../analysis/methodology.md) |

Dated history of changes: [`CHANGELOG.md`](../CHANGELOG.md).
