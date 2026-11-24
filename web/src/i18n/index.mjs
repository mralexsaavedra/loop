import es from './es.mjs';
import en from './en.mjs';

const DICTS = { es, en };

/** Resolves a locale ('es'|'en', default 'en') to its dictionary. Used by
 * both Astro frontmatter (server-rendered copy) and build-web.mjs when
 * baking `I18N` for the client scripts.
 * @param {string | null | undefined} locale */
export function getDict(locale) {
  return (locale === 'es' || locale === 'en' ? DICTS[locale] : null) || DICTS.en;
}

export { es, en };
