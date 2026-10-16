# Documentation

Start with the project [`README.md`](../README.md): what this is and the two install paths (server, coach). Then pick what
you need below. **Guides** are for using and setting up your own copy; the **reference** explains how each area is
built, for anyone changing the code.

## Guides — setting up and using it

| You want to… | Read |
| --- | --- |
| Install it: the server (Docker images, no clone) and / or the coach (a clone opened in Claude Code) | [`README.md`](../README.md#setup) → Setup |
| Understand what each tab and card tells you | [`guides/page-tour.md`](guides/page-tour.md) |
| Make the nutrition and training plan yours | [`guides/your-plan.md`](guides/your-plan.md) |
| Fix something that is not working | [`guides/troubleshooting.md`](guides/troubleshooting.md) |
| Update your install to the latest version (and back up first) | [`guides/upgrading.md`](guides/upgrading.md) |
| Try it with no data of your own | [`data/demo/README.md`](../data/demo/README.md) |
| Run the page and the data service at home | [`README.md`](../README.md#server--the-page-the-food-log-and-the-iphone-sync-docker-no-clone) → Server; the older host mode: [`services/loop-web/README.md`](../services/loop-web/README.md) → Install (host) |
| Send your Apple Health data from the iPhone every day | [`ios-shortcut.md`](ios-shortcut.md) |
| Connect Strava | [`services/loop-ingest/README.md`](../services/loop-ingest/README.md) → Getting the Strava credentials |
| Set up your profile with Claude Code, or with the page's own assistant | [`onboarding.md`](onboarding.md) |
| Run a second install for another person on the same host | [`lan-services.md`](lan-services.md#a-second-install) → A second install |

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
| LOOP server: the images, page + data service, sync protocol, security | [`lan-services.md`](lan-services.md) |
| Coach subagents and their knowledge base | [`knowledge-base.md`](knowledge-base.md) |
| The guard hook that keeps personal data out of git | [`guard-hook.md`](guard-hook.md) |
| How every number is computed (analysis framework) | [`../analysis/methodology.md`](../analysis/methodology.md) |

Changing the code: [`development.md`](development.md) (commands, tests, generated files, guards, workflow).
Dated history of changes: [`CHANGELOG.md`](../CHANGELOG.md).
