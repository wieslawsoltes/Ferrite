import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MirVerifier} from '../src/compiler/MirVerifier.js';
import {initializationGraph, referenceInitialization} from './fixtures/mir-initialization.js';

for (const registers of [3,31,32,33,63,64,65,127,128,129,257]) test(`packed must-analysis agrees with Set oracle for ${registers} registers`, () => {
  for (let seed=0; seed<60; seed++) {
    const fn = initializationGraph(seed,registers,1+seed%25,seed%3!==0);
    const missing = referenceInitialization(fn);
    if (missing === null) assert.doesNotThrow(()=>MirVerifier.verify([fn]), `seed=${seed}`);
    else assert.throws(()=>MirVerifier.verify([fn]), e=>e.code==='F_MIR' && e.message.includes(`%${missing} may be uninitialized`), `seed=${seed}`);
  }
});

test('a back edge cannot initialize a register on its first loop iteration', () => {
  const fn=initializationGraph(8,65,2,false);
  fn.blocks[0].instructions=[];
  fn.blocks[1].instructions=[{op:'copy',target:2,value:64},{op:'const',dest:64,type:'i32',value:'1'}];
  fn.blocks[1].terminator={kind:'goto',target:0};
  assert.throws(()=>MirVerifier.verify([fn]), /%64 may be uninitialized/);
});

test('all predecessor paths must initialize a joined local, including bit 31', () => {
  const fn=initializationGraph(7,65,4,false);
  fn.blocks=[
    {id:0,instructions:[],terminator:{kind:'branch',condition:0,true:1,false:2}},
    {id:1,instructions:[{op:'const',dest:31,type:'i32',value:'1'}],terminator:{kind:'goto',target:3}},
    {id:2,instructions:[],terminator:{kind:'goto',target:3}},
    {id:3,instructions:[{op:'copy',target:64,value:31}],terminator:{kind:'return',value:1}},
  ];
  assert.throws(()=>MirVerifier.verify([fn]), /%31 may be uninitialized/);
  fn.blocks[2].instructions.push({op:'const',dest:31,type:'i32',value:'2'});
  assert.doesNotThrow(()=>MirVerifier.verify([fn]));
});

test('unreachable uses do not participate but their invalid register identities still fail', () => {
  const fn=initializationGraph(1,65,2,false);
  fn.blocks[0].terminator={kind:'return',value:1};
  fn.blocks[1].instructions=[{op:'copy',target:64,value:31}];
  assert.doesNotThrow(()=>MirVerifier.verify([fn]));
  fn.blocks[1].instructions[0].value=65;
  assert.throws(()=>MirVerifier.verify([fn]),/Invalid register 65/);
});
