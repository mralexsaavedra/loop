import es from './es.mjs';
import en from './en.mjs';

const DICTS = { es, en };

/** Resolves a locale ('es'|'en', default 'en') to its dictionary. Used by
 * both Astro frontmatter (server-rendered copy) and build-web.mjs when
 * baking `I18N` for the client scripts. */
export function getDict(locale) {
  return DICTS[locale] || DICTS.en;
}

export { es, en };
