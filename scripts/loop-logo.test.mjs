/* The LOOP logo geometry (scripts/loop-logo.mjs) and the committed assets it generates
 * (web/src/assets/loop-*.svg / .png, written by scripts/make-logo.mjs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ringGeometry, ringMarkup, iconSvg, wordmarkSvg, wordmarkLayout, ICONS, COLORS, WORDMARK } from './loop-logo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'web', 'src', 'assets');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('ring geometry: r = 50 − sw/2, three arcs of third − sw − 3 with round caps leave 3-unit gaps', () => {
  const g = ringGeometry(18);
  near(g.r, 41);
  near(g.C, 2 * Math.PI * 41);
  near(g.third, g.C / 3);
  near(g.arc, g.third - 18 - 3);
  // visible gap between two arcs = the dash gap minus both round caps (sw/2 each)
  near(g.third - g.arc - 18, 3);
  near(g.starts[0], -90 + ((g.third - g.arc) / g.C) * 360 / 2);
  near(g.starts[1] - g.starts[0], 120);
  near(g.starts[2] - g.starts[0], 240);
});

test('ring markup: the three arcs clockwise from 12 o\'clock are sleep, recovery, strain; dasharray "L C−L"', () => {
  const m = ringMarkup(18, 'arcs');
  const arcs = [...m.matchAll(/<circle [^>]*stroke-dasharray="([\d.]+) ([\d.]+)"[^>]*>/g)];
  assert.equal(arcs.length, 3);
  const g = ringGeometry(18);
  for (const a of arcs) {
    near(Number(a[1]), Number(g.arc.toFixed(3)), 1e-3);
    near(Number(a[2]), Number((g.C - g.arc).toFixed(3)), 1e-3);
    assert.match(a[0], /stroke-linecap="round"/);
  }
  const colours = arcs.map((a) => /stroke="(#[0-9a-f]{6})"/.exec(a[0])[1]);
  assert.deepEqual(colours, [COLORS.sleep, COLORS.recovery, COLORS.strain]);
  assert.deepEqual(arcs.map((a) => /class="(lw-\w+)"/.exec(a[0])[1]), ['lw-sleep', 'lw-recovery', 'lw-strain']);
  // the plain ring: one white circle, same stroke width, no dashes
  const plain = ringMarkup(18, 'plain');
  assert.match(plain, /<circle cx="50" cy="50" r="41" fill="none" stroke="currentColor" stroke-width="18"\/>/);
});

test('wordmark layout: rings 0.71em, bottom 0.02em under the baseline, the same 0.14em INK gap between every pair', () => {
  // side bearings differ (P's left one is wide): spacing is measured ink to ink, not advance to advance
  const glyph = (adv, minX, maxX) => ({ d: 'M0 0Z', advance: adv, minX, maxX });
  const lay = wordmarkLayout({ unitsPerEm: 1000, L: glyph(800, 100, 760), P: glyph(900, 105, 850) });
  const inks = [
    [100, 760],
    [lay.rings[0].x, lay.rings[0].x + 710],
    [lay.rings[1].x, lay.rings[1].x + 710],
    [lay.p.x + 105, lay.p.x + 850],
  ];
  for (let i = 1; i < inks.length; i++) near(inks[i][0] - inks[i - 1][1], 140);
  for (const r of lay.rings) {
    near(r.size, 710);
    near(r.y + r.size, 20, 1e-9);
  }
  near(lay.viewBox.x, 100);
  near(lay.viewBox.y, -690);
  near(lay.viewBox.h, 710);
  near(lay.viewBox.x + lay.viewBox.w, lay.p.x + 850);
});

test('wordmark svg: role img + LOOP label, letters and the plain ring in currentColor, token classes on the arcs', () => {
  const glyph = (adv) => ({ d: 'M0 0L10 10Z', advance: adv, minX: 0, maxX: adv });
  const svg = wordmarkSvg({ unitsPerEm: 1000, L: glyph(800), P: glyph(900) });
  assert.match(svg, /^<svg [^>]*role="img"[^>]*aria-label="LOOP"/);
  assert.equal([...svg.matchAll(/<path [^>]*fill="currentColor"/g)].length, 2, 'L and P outlines');
  assert.match(svg, /lw-sleep/);
  assert.match(svg, new RegExp(`stroke-width="${WORDMARK.sw}"`));
  assert.doesNotMatch(svg, /<text|font-family|<style/, 'outlines only, no font');
});

test('icons: a dark tile with the #283037 → #111619 vertical gradient around the three-arc ring', () => {
  const svg = iconSvg(ICONS.icon);
  assert.match(svg, /<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#283037"\/><stop offset="1" stop-color="#111619"\/><\/linearGradient>/);
  assert.match(svg, /<rect width="128" height="128" rx="\d+" fill="url\(#t\)"\/>/);
  assert.match(svg, /stroke-width="11"/);
  assert.equal([...svg.matchAll(/stroke-dasharray/g)].length, 3);
  // the touch icon is a full square: iOS rounds the corners itself
  assert.match(iconSvg(ICONS.touch), /<rect width="180" height="180" fill="url\(#t\)"\/>/);
});

test('the committed icon assets are exactly what the generator writes (never hand-edited)', () => {
  assert.equal(fs.readFileSync(path.join(ASSETS, 'loop-icon.svg'), 'utf8'), iconSvg(ICONS.icon));
  assert.equal(fs.readFileSync(path.join(ASSETS, 'loop-favicon.svg'), 'utf8'), iconSvg(ICONS.favicon));
  const png = fs.readFileSync(path.join(ASSETS, 'loop-touch-icon.png'));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 180]);
  const mark = fs.readFileSync(path.join(ASSETS, 'loop-wordmark.svg'), 'utf8');
  assert.match(mark, /aria-label="LOOP"/);
});

test('the Syncopate outlines ship with their Apache 2.0 licence and attribution', () => {
  const lic = fs.readFileSync(path.join(ROOT, 'web', 'src', 'fonts', 'LICENSE-Syncopate.txt'), 'utf8');
  assert.match(lic, /Astigmatic/);
  assert.match(lic, /Apache License\s+Version 2\.0/);
});
