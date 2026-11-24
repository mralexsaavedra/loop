/* subset-font (devDependency, scripts/subset-text-font.mjs) ships no type declarations: the call this repo makes
 * (the options as the package's README documents them, passed through). */
declare module 'subset-font' {
  export default function subsetFont(font: Buffer | Uint8Array, text: string, options?: Record<string, unknown>): Promise<Buffer>;
}
