import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/engine.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVerifier} from '../src/compiler/MirVerifier.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';

const source = 'enum E{A=5,B}fn read(e:E)->i32{e as i32}fn main(){let f:fn(E)->i32=read;println!("{}",f(E::B));}';
const execute = c => new MirVirtualMachine(c.optimizedMir, {entry:c.entry}).run().output;
const instructions = mir => mir.flatMap(fn => fn.blocks.flatMap(block => block.instructions));

for (const [name, change] of [
  ['wrong function target', instruction => { instruction.callee = '__missing'; }],
  ['wrong stored signature', instruction => { instruction.signature = 'fn(bool)->i32'; }],
]) test('MIR pointer rejects ' + name, () => {
  const mir = structuredClone(compile(source).mir);
  change(instructions(mir).find(i => i.op === 'function'));
  assert.throws(() => MirVerifier.verify(mir), e => e.code === 'F_MIR');
});

for (const [name, change] of [
  ['missing arguments', instruction => { instruction.args = []; }],
  ['wrong pointer register', instruction => { instruction.value = instruction.args[0]; }],
  ['wrong argument type', instruction => { instruction.args[0] = instruction.value; }],
]) test('MIR indirect call rejects ' + name, () => {
  const mir = structuredClone(compile(source).mir);
  change(instructions(mir).find(i => i.op === 'callIndirect'));
  assert.throws(() => MirVerifier.verify(mir), e => e.code === 'F_MIR');
});

test('callable verification does not weaken enum table verification', () => {
  const mir = structuredClone(compile(source).mir);
  instructions(mir).find(i => i.op === 'discriminant').table = null;
  assert.throws(() => MirVerifier.verify(mir), e => e.code === 'F_MIR');
});

test('function pointers and enum tables remain fresh across cached source and body edits', () => {
  const session = new CompilerSession();
  const project = text => session.compile({'Cargo.toml':'[package]\nname="callbacks"\nversion="0.1.0"', 'src/main.rs':text});
  const first = project(source), snapshot = JSON.stringify(first.mir);
  assert.equal(execute(first), '6\n');
  assert.equal(execute(project(source.replace('A=5', 'A=19'))), '20\n');
  assert.equal(execute(project(source.replace('e as i32', '(e as i32)+7'))), '13\n');
  assert.equal(JSON.stringify(first.mir), snapshot);
  assert.equal(execute(project(source)), '6\n');
});

test('function pointer source relocation retains the new file offsets', () => {
  const first = compile(source), moved = compile('\n\n' + source);
  const a = instructions(first.mir).find(i => i.op === 'callIndirect');
  const b = instructions(moved.mir).find(i => i.op === 'callIndirect');
  assert.equal(b.span.start, a.span.start + 2);
  assert.equal(execute(moved), '6\n');
});
