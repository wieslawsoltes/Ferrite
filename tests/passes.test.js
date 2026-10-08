import {test} from "node:test";
import assert from "node:assert/strict";
import {Lexer} from "../src/compiler/Lexer.js";
import {Parser} from "../src/compiler/Parser.js";
import {SemanticAnalyzer} from "../src/compiler/SemanticAnalyzer.js";
import {MirLowerer} from "../src/compiler/MirLowerer.js";
import {JavaScriptEmitter} from "../src/compiler/JavaScriptEmitter.js";
import {CompilerCache} from "../src/compiler/CompilerCache.js";
import {compile} from "../src/engine.js";
test("standalone compiler passes compose consistently",()=>{
 const source='fn main(){ let x=4u32; println!("{}",x); }';
 const tokens=Lexer.tokenize(source);
 const ast=Parser.parse(tokens);
 const semantic=SemanticAnalyzer.analyze(ast);
 const mir=MirLowerer.lower(semantic);
 const js=JavaScriptEmitter.emit(semantic);
 assert.equal(tokens.at(-1).value,"EOF");
 assert.equal(ast.items[0].name,"main");
 assert(mir[0].blocks.length>0);
 assert.equal(js,compile(source).js);
});
test("LRU compilation cache evicts oldest and promotes hits",()=>{
 const cache=new CompilerCache(2);
 cache.set("a",1);cache.set("b",2);
 assert.equal(cache.get("a"),1);
 cache.set("c",3);
 assert.equal(cache.get("b"),undefined);
 assert.deepEqual(cache.stats,{hits:1,misses:1,entries:2});
});
test("primitive Copy trait bound supports generic specialization",()=>{
 const code='fn value<T: Copy>(x:T){ println!("{}",x); } fn main(){ value(7u32); }';
 const result=compile(code);
 assert(result.sem.obligations.includes("u32: Copy"));
});
