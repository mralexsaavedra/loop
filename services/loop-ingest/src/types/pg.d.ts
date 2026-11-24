/* pg ships no type declarations (and @types/pg is not a dependency): the one surface this service uses, the
 * Pool constructor, typed as db.js's own Pool. */
declare module 'pg' {
  const pg: { Pool: new (config: object) => import('../db.js').Pool };
  export default pg;
}
