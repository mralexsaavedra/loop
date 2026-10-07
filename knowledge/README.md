# knowledge/ — local knowledge base

Transcripts (and, later, summaries) of expert content the coach subagents read. Everything here
except this README is **gitignored**: it is third-party content kept for personal use and is never
committed or published.

## Layout

```
knowledge/
  <domain>/<source>/          e.g. cycling/<coach>/
    manifest.json             one entry per video: title, date, duration, subs, file, words, fetchedAt
    raw/<YYYY-MM-DD>-<id>.md  clean transcript: header + "[mm:ss]" paragraphs (~30-60 s each)
    index.md                  optional: overview / map of the source (written by hand or by Claude)
    temas/*.md                optional: topic syntheses with citations to the videos
    videos/*.md               optional: per-video summaries
```

`subs` in the manifest is `manual` (uploaded subtitles), `auto` (YouTube automatic captions —
names and numbers can be misheard: verify them in the video) or `none` (no subtitles in the
requested language; no transcript file).

## Ingest a YouTube channel

Needs the external [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) binary (`$YT_DLP`, else `yt-dlp` on
PATH, else `~/.local/bin/yt-dlp`). Only subtitles are downloaded, never media.

```
node scripts/ingest-youtube.mjs --channel https://www.youtube.com/@<handle> \
  --out knowledge/<domain>/<source> [--tabs videos,streams] [--limit N] [--lang es]
```

The run is incremental: videos already in `manifest.json` are skipped, so re-running it later only
fetches new uploads. Shorts are never listed. Requests are paced (1–2 s apart) and retried twice
with backoff; a failed video is reported and retried on the next run. To re-fetch one video, remove
its entry from `manifest.json`.

## Tell the coaches about a source

The coach subagents only read the sources listed in your gitignored `profile/coaches.md` (template:
`profile/coaches.example.md`): after ingesting a source, add a row for it under the coach that should
use it (name, short name, folder, how to cite, commercial ties).

## Citing

A transcript line `[12:34]` maps to `https://www.youtube.com/watch?v=<id>&t=754s`. Subagents cite
the video title + that URL for every claim taken from the source.
