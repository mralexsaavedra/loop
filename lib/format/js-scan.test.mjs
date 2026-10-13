/* lib/format/js-scan.mjs: the string-aware comment / literal stripper behind classicGlobal's renamed-constant
 * scan and the web/src/client registerView static scan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments, stripCommentsAndStrings } from './js-scan.mjs';

test('stripComments: line and block comments go, their line breaks stay; code around them is kept', () => {
  assert.equal(stripComments('a(); // note\nb();'), 'a();  \nb();');
  assert.equal(stripComments('a/* x\ny */b'), 'a \nb');
  assert.equal(stripComments('/* unterminated'), ' ');
});

test('stripComments: comment markers inside strings, templates and regexes are not comments', () => {
  assert.equal(stripComments('var u = "http://x"; go();'), 'var u = "http://x"; go();');
  assert.equal(stripComments("var s = '/*'; go(); var t = '*/';"), "var s = '/*'; go(); var t = '*/';");
  assert.equal(stripComments('var t = `a // b ${c /* d */} e`;'), 'var t = `a // b ${c  } e`;');
  assert.equal(stripComments("s.replace(/\\/\\//g, '') // x"), "s.replace(/\\/\\//g, '')  ");
  assert.equal(stripComments("x.split(/[/*]/) + y"), "x.split(/[/*]/) + y");
  assert.equal(stripComments('return /\'/.test(s); // q'), 'return /\'/.test(s);  ');
  assert.equal(stripComments('var s = "a\\"// b"; go();'), 'var s = "a\\"// b"; go();');
});

test('stripComments: a slash after an operand is a division, not a regex', () => {
  assert.equal(stripComments('var r = a / b / c; // x'), 'var r = a / b / c;  ');
  assert.equal(stripComments('f(x) / 2 /* y */'), 'f(x) / 2  ');
  assert.equal(stripComments('arr[0] / n // z'), 'arr[0] / n  ');
  assert.equal(stripComments('typeof /a/ // t'), 'typeof /a/  ');
});

test('stripCommentsAndStrings: literal contents are emptied, template expressions stay code', () => {
  assert.equal(stripCommentsAndStrings(`go('NAME', "NAME$2") // NAME$3`), `go('', "")  `);
  assert.equal(stripCommentsAndStrings('`NAME$1 ${NAME$2.x + `in ${NAME$3}`} tail`'), '`${NAME$2.x + `${NAME$3}`}`');
  assert.equal(stripCommentsAndStrings('var o = { a: `${ {b: 1}.b }` };'), 'var o = { a: `${ {b: 1}.b }` };');
  assert.equal(stripCommentsAndStrings('return /NAME$4/gi.test(s) / 2'), 'return / /gi.test(s) / 2');
  assert.equal(stripCommentsAndStrings("x = 'it\\'s'; y"), "x = ''; y");
});
