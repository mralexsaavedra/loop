/* Rounding helpers shared by the nutrition modules (scale, blocks, amounts, units, reference). Pure. */

/** To 1 decimal (macros as Tablas shows them). */
export const round1 = (v) => Math.round(v * 10) / 10;
/** To 2 decimals (the carb / swap factors, baked line macros, amounts in a label). */
export const round2 = (v) => Math.round(v * 100) / 100;
