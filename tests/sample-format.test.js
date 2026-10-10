import test from 'node:test';
import assert from 'node:assert/strict';
import {RustFormatter, viewSignature, rustSignature} from '../tools/sample-format/RustFormatter.mjs';
import {formatCss} from '../tools/sample-format/CssFormatter.mjs';
import {literals, template, isRust} from '../tools/sample-format/EmbeddedSamples.mjs';
import {ViewSyntax} from '../src/ui-framework/ViewSyntax.js';

function markup(source) {
  // Unit-test the view printer without making rustfmt a Node-test dependency.
  // The separate CI formatting check exercises the pinned native formatter too.
  const formatter = new RustFormatter();
  formatter.expression = value => value.trim();
  const parser = new ViewSyntax(source);
  return `fn app() { view! {\n    ${formatter.element(parser.scan()[0].node,source,4)}\n} }`;
}

test('multiline view formatting preserves mixed content and significant spaces', () => {
  for (const contents of [
    '<p>Hello, {name}!</p>',
    '<label>Duration: {n} seconds<input value={n} type="range" /></label>',
    '<p><span>A</span> <span>B</span></p>',
    '<p>  Keep both edges  </p>',
    '<pre>same  internal   spaces</pre>',
    '<label>Departure<input value={date} placeholder="dd.mm.yyyy" /></label>'
  ]) {
    const before = `fn app() { view! { ${contents} } }`;
    const after = markup(before);
    assert.deepEqual(viewSignature(after),viewSignature(before),contents);
    assert.equal(markup(after),after);
  }
});

test('structural markup, long prose and attribute lists expand on separate lines', () => {
  const before = `fn app(){view!{<section><input aria-label="Name" value={name} on:input={change}/><p>${'long explanation '.repeat(10).trim()}</p></section>}}`;
  const after = markup(before);
  assert.match(after, /<input\n\s+aria-label="Name"\n\s+value=\{name\}\n\s+on:input=\{change\}\n\s+\/>/);
  assert.deepEqual(viewSignature(after),viewSignature(before));
  assert.ok(after.split('\n').every(line=>line.length<=100));
});

test('view equivalence rejects changed literals, operators, bindings and child order', () => {
  const before='fn app(){view!{<p>Hello, {x+1}!<input value={x}/></p>}}';
  for(const after of [before.replace('Hello, ','Hello,'),before.replace('x+1','x-1'),before.replace('value={x}','value={y}'),before.replace('!<input','?<input')]) {
    assert.notDeepEqual(viewSignature(after),viewSignature(before));
  }
});

test('Rust equivalence ignores layout/trailing separators but not operands or literals', () => {
  assert.deepEqual(rustSignature('struct A{x:i32} fn f(a:i32){g(a);}'),rustSignature('struct A {\n x: i32,\n}\n\nfn f(a: i32) {\n g(a,);\n}\n'));
  assert.notDeepEqual(rustSignature('fn f(){g(1);}'),rustSignature('fn f(){g(2);}'));
  assert.notDeepEqual(rustSignature('fn f(){g("a b");}'),rustSignature('fn f(){g("ab");}'));
});

test('CSS formatting keeps quoted delimiters, URLs, escapes and descendant selectors intact', () => {
  const css=String.raw`.a .b, [data-x="a,b"]{content:"x;{y}:z";background:url("data:image/svg+xml;a,b");--text:a\;b}@media(max-width:500px){.a{color:red}}`;
  const after=formatCss(css);
  assert.ok(after.includes('.a .b,\n[data-x="a,b"] {'));
  assert.ok(after.includes('content: "x;{y}:z";'));
  assert.ok(after.includes('url("data:image/svg+xml;a,b")'));
  assert.ok(after.includes(String.raw`--text: a\;b;`));
  assert.equal(formatCss(after),after);
  assert.throws(()=>formatCss('.a{color:"oops'),/Unbalanced/);
});

test('static embedded Rust templates round-trip escaping without executing interpolation', () => {
  for(const value of ['fn main(){println!("\\n");}\n', 'fn main(){println!("${globalThis.secret}`🦀");}\n', "fn borrow<'a>(){}\n"]) {
    const literal=template(value);
    assert.equal(literals(`const sample=${literal};`)[0].value,value);
    assert.equal(isRust(value),true);
  }
  assert.deepEqual(literals('const value=`${doNotExecute()}`;'),[]);
  assert.equal(isRust('Compiler diagnostic'),false);
});
