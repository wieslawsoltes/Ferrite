import test from 'node:test';
import assert from 'node:assert/strict';
import {RustDocument, SEMANTIC_TOKEN_TYPES} from '../src/language/RustDocument.js';
import {SyntaxHighlighter} from '../src/ui/services/SyntaxHighlighter.js';

const assertLossless = text => {
  const document = new RustDocument(text); let offset = 0;
  for (const token of document.tokens) { assert.equal(token.start, offset); assert.ok(token.end > token.start); offset = token.end; }
  assert.equal(offset, text.length); assert.equal(document.tokens.map(t => t.value).join(''), text); return document;
};

test('view! prose, punctuation, apostrophes and Unicode never erase Rust highlighting', () => {
  const text = `fn app() -> ui::Node { let count = ui::use_state(0); view! { <section className="card"><p>It's Rust · UI 🦀 & more</p><button on:click={move || ui::update(count, |n| n + 1)}>+</button></section> } }`;
  const document = assertLossless(text), html = SyntaxHighlighter.html(text, 'src/app.ui.rs');
  for (const kind of ['keyword','function','namespace','type','macro','tag','attribute','string','event','number']) assert.ok(html.includes(`syntax-${kind}`), kind);
  assert.ok(html.includes("It's Rust · UI 🦀 &amp; more")); assert.equal(document.macros.length, 1);
  assert.ok(!html.includes('<section')); assert.ok(!html.includes('<button'));
});
test('raw identifiers, NFC spelling, BOM, CRLF, byte/C strings and lifetimes retain exact text', () => {
  const text = '\ufefffn r#match<\'a>(cafe\u0301: &\'a str) { let r#type = br##"raw"#"##; let x = c"foo"; let y = cr#"raw"#; let z = b\'x\'; }\r\n';
  const document = assertLossless(text), html = SyntaxHighlighter.html(text, 'test.rs');
  assert.ok(html.includes('r#match')); assert.ok(html.includes('cafe\u0301')); assert.ok(html.includes('r#type'));
  assert.ok(document.tokens.some(t => t.kind === 'lifetime')); assert.equal(document.tokens.filter(t => t.kind === 'string').length, 3);
});
test('unfinished lexemes and illegal characters preserve both prefix and suffix highlighting', () => {
  for (const text of ['fn main() { let x = "unterminated', 'fn main() { /* nested /* comment */', 'fn main() { let x = r###"unterminated', 'fn main() { § let y = 2; }', 'fn main() { let x = "\\q"; let y = 1; }']) {
    assertLossless(text); assert.match(SyntaxHighlighter.html(text, 'a.rs'), /syntax-keyword/);
  }
  assert.match(SyntaxHighlighter.html('fn main() { § let y = 2; }', 'a.rs'), /syntax-number/);
});
test('nested views, fragments, raw attribute strings and Rust expression braces have distinct states', () => {
  const text = 'fn app() -> ui::Node { view! { <><input value={if true { r#"}"# } else { "{" }} /><div>{view! { <b>ok</b> }}</div></> } }';
  const document = assertLossless(text); assert.equal(document.macros.length, 2);
  assert.ok(document.tokens.some(t => t.kind === 'keyword' && t.value === 'if'));
  assert.equal(document.tokens.filter(t => t.kind === 'tag' && t.value === 'b').length, 2);
});
test('comments and literals do not create fake views; Rust generics/comparisons are not markup', () => {
  const document = assertLossless('fn f<T>(x: T) { let text = r#"view! { <x/> }"#; /* view! { <y/> } */ if 1 < 2 { f::<i32>(0); } }');
  assert.equal(document.macros.length, 0); assert.equal(document.elements.length, 0);
});
test('partial view tags and attributes retain their completion contexts', () => {
  for (const text of ['fn app() { view! { <', 'fn app() { view! { <but', 'fn app() { view! { <button on:cl', 'fn app() { view! { <button value={ui::ge']) {
    const document = assertLossless(text); assert.equal(document.macros.length, 1);
    assert.ok(document.tokens.some(t => t.kind === 'keyword'));
  }
});
test('semantic token stream is sorted, nonoverlapping UTF-16 and splits multiline CRLF strings', () => {
  const source = 'fn app() {\r\nlet s = "🦀\r\nsecond";\r\nview! { <button on:click={move || {}}>Go</button> }\r\n}';
  const document = assertLossless(source), {data} = document.semanticTokens(); let line = 0, character = 0, previousEnd = 0;
  assert.equal(data.length % 5, 0);
  for (let i = 0; i < data.length; i += 5) {
    line += data[i]; character = data[i] === 0 ? character + data[i+1] : data[i+1];
    assert.ok(data[i+2] > 0); assert.ok(data[i+3] >= 0 && data[i+3] < SEMANTIC_TOKEN_TYPES.length);
    const offset = document.source.lines[line] + character; assert.ok(offset >= previousEnd); previousEnd = offset + data[i+2];
    assert.ok(!/[\r\n]/.test(source.slice(offset, previousEnd)));
  }
});
test('editor budgets preserve every original code unit instead of abandoning the document', () => {
  const source = 'fn f() { '.repeat(1000), document = new RustDocument(source, 'a.rs', {maxTokens: 30, maxDepth: 10});
  assert.equal(document.truncated, true); assert.equal(document.tokens.map(t => t.value).join(''), source); assert.ok(document.tokens.length <= 31);
});
test('bounded deterministic fuzz corpus remains lossless and escapes markup', () => {
  let seed = 7; const chars = [...'view!{}<>/="\'abc:#\r\n*012_😀§'];
  for (let sample = 0; sample < 100; sample++) {
    let text = ''; for (let i = 0; i < 200; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; text += chars[seed % chars.length]; }
    assertLossless(text);
  }
});
