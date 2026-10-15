/* Shortcut heart-rate samples (`hr_samples`: "ISO;bpm" lines, the Apple Watch samples of the last
 * ~1 day, ungrouped) -> hr-hourly.csv: HOURLY AGGREGATES only, never the raw samples. Pure, zero
 * deps besides lib/extract/samples.mjs; used by data/apple-health/sync-shortcut.mjs
 * and scripts/make-demo-data.mjs.
 *
 * Coverage rule (the one day strain uses, lib/score/strain.mjs): each sample stands for the time
 * until the NEXT sample, capped at SAMPLE_CAP_S (a watch that was off or charging must not stretch
 * one reading over hours); the newest sample covers nothing (its next one is unknown). A sample's
 * whole coverage goes to the clock hour the sample falls in.
 *
 * Columns: date, hour_start (local ISO with offset; keyed by local hour + offset, so a DST
 * fall-back night keeps both 02:00 hours), avg / max / min / n of EVERY sample of the hour,
 * covered_min (all coverage), act_min (the part of it inside a Strava activity window, read from
 * workout-zones.csv `start` + `elapsed_s`), hist = covered SECONDS per whole bpm OUTSIDE those
 * windows ("bpm:s" pairs, space-separated, ascending; bpm < HIST_FLOOR_BPM left out), source.
 * Excluding the activity windows here is what keeps day strain from counting a workout twice: its
 * minutes are already scored from the Strava stream histogram.
 *
 * Loop-free input (zipHrLists): the Shortcut may instead send two parallel newline-joined lists
 * built straight from the Find Health Samples result, `hr_t` (each sample's Start Date, ISO 8601)
 * and `hr_v` (its Value, the leading number is the bpm: "72", "72 count/min", "72,5 lpm"). They
 * are zipped by index into the same samples; lists of different lengths are dropped whole with a
 * warning, never mis-paired. mergeHrSamples unions both inputs of one payload.
 */
import * as S from '../extract/samples.mjs';

const HR_HOURLY_CSV = 'hr-hourly.csv';
// the loop-free parallel lists' payload keys (Start Dates / Values)
const HR_TIMES_KEY = 'hr_t';
const HR_VALUES_KEY = 'hr_v';
const HR_HOURLY_HEADER = 'date,hour_start,avg,max,min,n,covered_min,act_min,hist,source';
// a plausible heart rate: anything outside is a sensor glitch, dropped at parse time
const BPM_MIN = 25;
const BPM_MAX = 240;
const SAMPLE_CAP_S = 600;
// below 50 % of the lowest plausible max HR (100 bpm, lib/training/hr-zones.mjs) a reading is
// always zone 0 (weight 0), so it never needs a histogram slot
const HIST_FLOOR_BPM = 50;

// "2030-01-02 09:07:12 +0100" -> "2030-01-02T09:00:00+01:00" (the clock-hour start, ISO)
const hourStartIso = st => `${st.slice(0, 10)}T${st.slice(11, 13)}:00:00${st.slice(20, 23)}:${st.slice(23, 25)}`;

/** "ISO;bpm" -> {start, value} | null (malformed, or outside BPM_MIN-BPM_MAX). A decimal comma is accepted. */
function parseSample(line) {
  const [ts, val] = String(line || '').split(';');
  const start = S.isoToExportStamp(ts);
  const t = String(val ?? '').trim().replace(',', '.');
  const value = /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  if (!start || value == null || value < BPM_MIN || value > BPM_MAX) return null;
  return { start, value };
}

// newline-joined Shortcut text -> trimmed lines; trailing blank lines (a final newline) dropped,
// blank lines inside kept so the two lists still pair by index
const listLines = raw => {
  const t = typeof raw === 'string' ? raw.replace(/\s+$/, '') : '';
  return t ? t.split(/\r?\n/).map(l => l.trim()) : [];
};

/** `hr_t` + `hr_v` texts -> {samples: [{start, value}], warning: string | null}. Lines pair by
 * index; a line blank in BOTH lists is skipped, a pair that does not parse (or is outside
 * BPM_MIN-BPM_MAX) is dropped alone. Different line counts, or a blank on one side only, drop
 * every sample and return a warning (one list missing counts as zero lines). */
function zipHrLists(hrT, hrV) {
  const ts = listLines(hrT), vs = listLines(hrV);
  const mismatch = why => ({ samples: [], warning: `hr_t / hr_v ${why}: heart-rate lists dropped (never mis-paired)` });
  if (ts.length !== vs.length) return mismatch(`have ${ts.length} vs ${vs.length} lines`);
  const samples = [];
  for (let i = 0; i < ts.length; i++) {
    if (!ts[i] && !vs[i]) continue;
    if (!ts[i] || !vs[i]) return mismatch(`line ${i + 1} is blank on one side only`);
    const m = /^(\d+(?:[.,]\d+)?)/.exec(vs[i]);
    const s = m && parseSample(`${ts[i]};${m[1]}`);
    if (s) samples.push(s);
  }
  return { samples, warning: null };
}

/** One payload -> {samples, warning}: its `hr_samples` lines and its zipped `hr_t` / `hr_v`
 * lists, unioned and deduped by exact timestamp (the lists win a tie). */
function mergeHrSamples(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const byStart = new Map();
  for (const l of listLines(p.hr_samples)) { const s = l && parseSample(l); if (s) byStart.set(s.start, s); }
  const { samples, warning } = zipHrLists(p[HR_TIMES_KEY], p[HR_VALUES_KEY]);
  for (const s of samples) byStart.set(s.start, s);
  return { samples: [...byStart.values()], warning };
}

/** workout-zones.csv text -> [{from, to}] epoch-ms windows of the activities with a start and an
 * elapsed time, sorted and merged; [] without the file or the (later) start / elapsed_s columns. */
function activityWindows(zonesText) {
  if (!zonesText) return [];
  const out = [];
  for (const line of zonesText.split('\n').slice(1)) {
    const c = line.split(',');
    const from = Date.parse(c[14] || '');
    const sec = Number(c[15]);
    if (Number.isFinite(from) && c[15] && sec > 0) out.push({ from, to: from + sec * 1000 });
  }
  out.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const w of out) {
    const last = merged[merged.length - 1];
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else merged.push({ ...w });
  }
  return merged;
}

// ms of [a, b) inside the merged windows, scanning from index j (samples arrive in time order)
function overlapMs(windows, a, b, j) {
  let ms = 0;
  for (let k = j; k < windows.length && windows[k].from < b; k++) ms += Math.max(0, Math.min(b, windows[k].to) - Math.max(a, windows[k].from));
  return ms;
}

/** samples [{start, value}] (deduped) + activity windows -> [{date, line}] hr-hourly.csv rows, by hour. */
function hourlyRows(samples, windows, source) {
  const list = samples.map(s => ({ ...s, t: S.absMs(s.start) })).sort((a, b) => a.t - b.t || (a.start < b.start ? -1 : 1));
  const hours = new Map();
  let j = 0;
  list.forEach((s, i) => {
    const next = list[i + 1];
    const cover = next ? Math.min(next.t - s.t, SAMPLE_CAP_S * 1000) : 0;
    while (j < windows.length && windows[j].to <= s.t) j++;
    const inAct = cover > 0 ? overlapMs(windows, s.t, s.t + cover, j) : 0;
    const key = hourStartIso(s.start);
    let h = hours.get(key);
    if (!h) hours.set(key, (h = { key, date: S.day(s.start), t: s.t, sum: 0, n: 0, max: -Infinity, min: Infinity, cover: 0, act: 0, hist: new Map() }));
    h.sum += s.value; h.n++;
    h.max = Math.max(h.max, s.value); h.min = Math.min(h.min, s.value);
    h.cover += cover; h.act += inAct;
    const bpm = Math.round(s.value);
    if (bpm >= HIST_FLOOR_BPM && cover - inAct > 0) h.hist.set(bpm, (h.hist.get(bpm) || 0) + (cover - inAct) / 1000);
  });
  return [...hours.values()].sort((a, b) => a.t - b.t).map(h => {
    const hist = [...h.hist.entries()].sort((a, b) => a[0] - b[0]).map(([b, sec]) => [b, Math.round(sec)]).filter(([, sec]) => sec > 0)
      .map(([b, sec]) => `${b}:${sec}`).join(' ');
    return { date: h.date, line: [h.date, h.key, (h.sum / h.n).toFixed(1), Math.round(h.max), Math.round(h.min), h.n,
      (h.cover / 60000).toFixed(1), (h.act / 60000).toFixed(1), hist, source].join(',') };
  });
}

export { HR_HOURLY_CSV, HR_TIMES_KEY, HR_VALUES_KEY, HR_HOURLY_HEADER, hourStartIso, parseSample, zipHrLists, mergeHrSamples, activityWindows, hourlyRows };
