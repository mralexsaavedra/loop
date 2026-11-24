/* Test-only global: scripts/gen-food-calc.test.mjs's twice() reads K, the hidden constant the module
 * lib/build/esm-module.mjs emits around it declares (`const K = 3`); the function's text is copied, never run here. */
declare const K: number;
