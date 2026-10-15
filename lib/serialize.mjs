/* Safe JSON-in-<script> serialization for Astro's baked globals (Bake.astro).
 * `JSON.stringify` alone is not safe to inline
 * inside a classic <script> tag: a literal `<` inside string data could form
 * `</script>` and prematurely close the tag, and the U+2028/U+2029 line and
 * paragraph separators are valid inside JSON strings but ILLEGAL inside a
 * raw JS string literal in some engines/contexts. jsonForScript escapes all
 * three so `<script>var X = ${jsonForScript(data)};</script>` is always safe.
 */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
