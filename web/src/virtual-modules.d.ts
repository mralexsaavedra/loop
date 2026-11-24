/* Vite virtual modules the page build defines (web/astro.config.mjs). */
declare module 'virtual:client-modules' {
  /** Each client script's bundled IIFE source, keyed by its file name in web/src/client/. */
  const modules: Record<string, string>;
  export default modules;
}
