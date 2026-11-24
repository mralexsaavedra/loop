// Accessibility checks shared by the static and the LAN specs: axe-core (@axe-core/playwright) over WCAG 2.1 A and AA,
// including its label-in-name rule (label-content-name-mismatch, WCAG 2.5.3: a control's accessible name contains the
// text it shows, so a voice-control user can say what they see). docs/development.md → Browser end-to-end tests.
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** One line per violated rule: id, impact, how many elements, and the first few element selectors.
 * @param {import('axe-core').Result[]} violations
 * @returns {string[]} */
function describe(violations) {
  return violations.map((v) => {
    const where = v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join(' | ');
    return `${v.id} [${v.impact}] ×${v.nodes.length}: ${v.help} — ${where}`;
  });
}

/** Fail with a readable list when axe finds any WCAG 2.1 A / AA violation on the page as it is now. `label` names the
 * state checked (a tab, a sheet) in the failure message.
 * @param {import('@playwright/test').Page} page
 * @param {string} label */
export async function expectAccessible(page, label) {
  // the wcag21a tag already includes label-content-name-mismatch (withRules would replace the tag selection)
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(describe(result.violations), `accessibility violations on ${label}`).toEqual([]);
}
