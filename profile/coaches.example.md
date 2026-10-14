# Coach config — per-user sources, gear, program and locale

Template for `profile/coaches.md` (gitignored). Copy it, then replace every `<placeholder>` with your
own data — or let onboarding build it with you (`docs/onboarding.md`). The coach subagents
(`.claude/agents/*-coach.md`) read it FIRST: `## Common` plus their own section. Without it they say
so and work from the evidence base and your data only — they never invent a source. A **Knowledge
folder** you leave out falls back to the default written next to it.

Rules: list only sources that exist under `knowledge/` (ingest them first, see `knowledge/README.md`);
leave a section out rather than guess. Facts that go stale (weight, goal, event dates) do NOT go
here — they live in `profile/profile.json`, `data/profile/settings.json` and the extract.

## Common

- **Language**: <reply language by default, e.g. Spanish (`es`)>; the coaches reply in the language
  of the question when it differs.
- **Locale / jurisdiction**: <country, e.g. Spain> — products, legal limits and food databases follow
  it unless you say otherwise.
- **Section labels** (optional, in your language): <e.g. "Lo que dice <short name>", "Evidencia /
  metodología del repo", "Contradicciones", "Aplicado a ti">.

## cycling-coach

### Knowledge sources

| Name | Short name | Type | Folder | How to cite |
| --- | --- | --- | --- | --- |
| <expert name (role, channel)> | <short name used in answers> | <YouTube transcripts / podcast / book notes> | `knowledge/cycling/<source>/` | <e.g. video title + `https://www.youtube.com/watch?v=<id>&t=<seconds>s`> |

- **Commercial ties**: <brands, own platforms, affiliate links of the source — or "see
  `knowledge/cycling/<source>/index.md`">. The coach flags any recommendation that touches one.

### FTP stance (optional)

<Where your source explains how to train without a known FTP, e.g. `topics/<file>.md` + a video title.>

### Gear

| Device | Manual (optional, a local text / Markdown file) |
| --- | --- |
| <bike computer, power meter, smart trainer…> | <`data/gear/<manual>.txt` or "none"> |

## hybrid-coach

- **Knowledge folder**: <`knowledge/hybrid/` (the default)>.

### Knowledge sources (read in this order, under the knowledge folder)

1. `knowledge/hybrid/index.md` and `knowledge/hybrid/topics/*.md` when they exist (cross-source
   syntheses; name another folder here if yours differs, e.g. `temas/`).
2. <podcast / channel name> — <folder>/videos/*.md, <folder>/raw/*.md, <folder>/manifest.json.
   Cite: episode title + `&t=<seconds>s` URL.
3. <past coach / program name, dates you followed it> — <folder and file layout>. Cite: file +
   month / week / day.
4. **Current program** — <where it lives: a `knowledge/hybrid/<program>/` folder, or sessions in
   `data/training/training-data.json`; note any availability window>.

### Events / goals pointers

- Race dates: `profile/profile.json` `events`; which program you followed when: `profile/about-me.md`.
- <rulebook / division / season to check, e.g. the current official HYROX rulebook for your division>.

## nutrition-coach

- **Knowledge folder**: <`knowledge/nutrition/` (the default)>.
- **Evidence folder**: <`knowledge/nutrition/evidence/` (the default; `evidencia/` is also found)>.

### Evidence base (the evidence folder)

<Documents you saved, e.g. AIS Sports Supplement Framework, IOC 2018 supplement consensus, ISSN
position stands, WADA Prohibited List, your national food-safety agency's supplement limits.>

### Practitioner sources

| Name | Short name | Type | Folder | How to cite |
| --- | --- | --- | --- | --- |
| <dietitian / podcast name> | <short name> | <YouTube transcripts / podcast episodes> | `knowledge/nutrition/<source>/` | <video title + `&t=<seconds>s` URL> |

### Cross-domain passages (optional)

- <nutrition topic files inside the cycling / hybrid sources, e.g. `knowledge/cycling/<source>/topics/<file>.md`>

### Jurisdiction rules

<Example for Spain — supplement maximum amounts: AESAN; food-supplement law: Real Decreto 1487/2009;
anti-doping: CELAD (plus the WADA list); food composition: BEDCA; professional title:
dietista-nutricionista. Replace with your country's equivalents.>

## training-coach

For any sport without its own coach (running, swimming, strength, team sports, yoga / pilates…).
Optional: with no sources it answers from your data and `analysis/methodology.md` and says it has no
expert sources.

- **Sports**: <the sport(s) to coach, e.g. running (10K, half marathon), strength 2×/week>.
- **Knowledge folder**: <`knowledge/training/` (the default)>.

### Knowledge sources (optional)

| Name | Short name | Sport | Folder | How to cite |
| --- | --- | --- | --- | --- |
| <coach / channel / book> | <short name used in answers> | <running / swimming / …> | `knowledge/training/<source>/` | <video title + `&t=<seconds>s` URL, or book + chapter> |

- **Commercial ties**: <brands, own platforms, affiliate links of the source — or "none known">.
