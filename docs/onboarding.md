# Onboarding a new user (first run)

> `CLAUDE.md` keeps only the first-run check that points here. Run this flow when `profile/about-me.md` does NOT exist (only the `.example` template is
> present): the clone is fresh and the user has not been onboarded. Do NOT attempt an analysis
> against empty data.

Installation (dependencies, Apple Health export, LAN services, Shortcut, Strava) is the `/setup` skill
(`.claude/skills/setup/SKILL.md`), the entry point on a fresh clone; it hands over to this flow at
Level 1. This file covers only the coaching intake.

**Two ways to start.** With Claude Code, the intake below. Without it, the LAN page's own assistant
(Level 2; `docs/profile.md` → In-page onboarding): a full-screen flow, one question per screen, that collects
sex, date of birth, height, weight, activity, the sports the person does (session length and times a week)
and the goal, runs the same safety screen, and computes the daily targets per day type
(`lib/nutrition/energy.mjs`); it saves them with the sports to the ingest service and the build uses them
(`loop-data/profile/onboarding.json`): the sports set each day type's exercise, which runs and swims count as long
days, and the names the page shows for the day types (`docs/nutrition.md`). The page works fully either way; what needs Claude Code is the coaching:
reports, the coach subagents, an agent that logs food or plans sessions for you. When a user who started
with the page assistant later runs this intake, read `loop-data/profile/onboarding.json` first (including its
`sports`) and do not ask again what it already holds.

When `profile/about-me.md` is missing, your job is to BUILD the user's profile with them,
conversationally — do not make them fill a form alone. Replicate a real coach intake:

1. **Explain briefly** what you're about to do: "Before I can coach you with real data, I
   need to learn who you are and capture a baseline. I'll ask a few questions, then write
   your profile for you. Your answers stay local — these files are gitignored."
2. **Interview, don't dump.** Walk the sections of `profile/about-me.example.md` (Basics,
   Lifestyle, Goal, Training, Health context, Nutrition habits, Gear). Ask **one topic at a
   time** in small batches, follow up where an answer is vague, and skip what's irrelevant
   to their goal. Never paste the whole template and ask them to complete it.
3. **Write the profile.** As sections complete, write the real answers into
   `profile/about-me.md` (create it — it's gitignored), removing the template prompts. Do
   NOT invent values; if something is unknown, write "unknown" or leave it for later rather
   than guessing.
4. **Capture the baseline.** Walk `profile/baseline.example.md` into `profile/baseline.md`.
   If an Apple Health `export.xml` is already present, offer to run
   `node data/apple-health/extract.mjs` and pull weight / RHR / VO2max / body-fat from the
   cached CSVs instead of asking. Mark every self-reported or estimated number as such, and
   record device/app provenance (bioimpedance body-fat is trend-only, ±3–5%).
5. **Configure the coaches.** Walk `profile/coaches.example.md` into `profile/coaches.md`
   (gitignored): reply language, country / jurisdiction (supplement limits, food database), then
   per coach (cycling, HYROX / hybrid, nutrition, and `training-coach` for any other sport they do — its
   **Sports** key) the knowledge sources they want (name, folder under `knowledge/`, how to cite,
   commercial ties), their gear (with a local manual under `loop-data/files/manuals/` if they have one) and where
   their current program lives. List only sources that already exist under `knowledge/` or that they
   will ingest now (`knowledge/README.md`); never suggest or invent creators for them. Nothing to
   add yet → write only `## Common`: the coaches then answer from the evidence base and the user's
   data and say no source is configured.
6. **Point them at their data.** Explain the data-drop steps (README → Setup, by level: Apple Health
   export → `loop-data/files/import/`, then `extract.mjs`; nutrition → the Level 2 food log, or legacy
   notes in a copy of `food-log.example.md` → `food-log.md`; **training → copy `data/training/training-data.example.json` →
   `loop-data/cache/training.json`** and transcribe their program by date from whatever their coach/app
   provides (PDF grids → render to PNG and read visually; a login-gated training app → have them
   paste/screenshot the sessions), see `docs/training.md` — then
   `npm run generate`). The Home tab (Inicio in Spanish) then shows today's programmed session and the
   Training tab (Entreno) fills itself from the Apple Health workouts already extracted in step 4. Don't block onboarding on this — profile + baseline are enough to start.
7. **Confirm and offer the first analysis.** Summarize what you captured, ask them to
   correct anything, then offer to run an initial analysis (the `/analysis` skill,
   `.claude/skills/analysis/SKILL.md`).

Honor the same output principles (`CLAUDE.md` → Output principles) during onboarding: ground everything in what they tell you,
flag gaps, never fabricate. After onboarding, persist a session summary (if a memory tool is
available) so the next session resumes with their context.
