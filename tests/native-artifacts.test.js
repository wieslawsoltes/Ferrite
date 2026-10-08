import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,symlink,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {NativeArtifactCollector} from '../src/native/NativeArtifactCollector.js';
import {NativeSourceMapper} from '../src/native/NativeSourceMapper.js';
import {NativeControlFlow} from '../src/ui/model/NativeControlFlow.js';
import {NativeCargoRunner} from '../src/native/NativeCargoRunner.js';
const source='fn main() {\n    println!("Zażółć 🚀");\n}\n';
test('native LLVM debug mappings follow metadata scope chains and reject external files',()=>{
 const text=`define void @main() !dbg !2 {
entry:
  call void @output(), !dbg !4
  ret void
}
!1 = !DIFile(filename: "src/main.rs", directory: "/owned")
!2 = distinct !DISubprogram(name: "main", file: !1, line: 1)
!3 = distinct !DILexicalBlock(scope: !2)
!4 = !DILocation(line: 2, column: 5, scope: !3)
!5 = !DIFile(filename: "src/main.rs", directory: "/outside")
!6 = !DILocation(line: 2, scope: !5)
  call void @external(), !dbg !6`;
 const maps=new NativeSourceMapper('/owned',{'src/main.rs':source}).llvm(text);
 assert.equal(maps.length,2);assert.equal(maps[1].span.file,'src/main.rs');assert.equal(maps[1].span.line,2);
 assert.equal(source.slice(maps[1].span.start,maps[1].span.end),'    println!("Zażółć 🚀");');
});
test('native assembly .file/.loc mappings use submitted source only',()=>{
 const text='.file 1 "/owned" "src/main.rs"\n.loc 1 2 5\n\tcall output\n.file 2 "/rust" "src/main.rs"\n.loc 2 2 0\n\tret q\n';
 const map=new NativeSourceMapper('/owned',{'src/main.rs':source}).assembly(text);assert.equal(map.length,1);assert.equal(map[0].line,3);
});
test('artifact collector uses bounded regular-file reads and never downloads partial objects',async()=>{
 const collector=await NativeArtifactCollector.create({maxTextBytes:8,maxBinaryBytes:4});
 try{
  await writeFile(join(collector.directory,'program.mir'),'abcdefghijk');await writeFile(join(collector.directory,'program.o'),Buffer.alloc(8));
  const items=await collector.collect('/owned',{});assert(items.find(a=>a.kind==='mir').truncated);assert.equal(items.find(a=>a.kind==='mir').content,'abcdefgh');
  assert(items.find(a=>a.kind==='obj').omitted);assert(!items.find(a=>a.kind==='obj').content);
 }finally{await collector.dispose();}
});
test('artifact collector rejects symlink outputs',async()=>{
 const collector=await NativeArtifactCollector.create();try{await writeFile(join(collector.directory,'real'),'x');await symlink(join(collector.directory,'real'),join(collector.directory,'program.mir'));await assert.rejects(()=>collector.collect('/owned',{}));}finally{await collector.dispose();}
});
test('native CFG display reads actual basic blocks instead of fabricating pipeline nodes',()=>{
 const artifact={kind:'mir',content:'fn main() -> () {\n    bb0: {\n        goto -> bb1;\n    }\n    bb1: {\n        return;\n    }\n}\n'};
 const f=NativeControlFlow.parse(artifact)[0];assert.deepEqual(f.nodes.map(n=>n.id),['bb0','bb1']);assert.deepEqual(f.edges,[{from:'bb0',to:'bb1',label:''}]);
 const llvm=NativeControlFlow.parse({kind:'llvm-ir',content:'define void @f() {\nentry:\n br label %next\nnext:\n ret void\n}'});assert.equal(llvm[0].edges[0].to,'next');
});
test('native inspect delegates to cargo rustc with explicit emission paths',async()=>{
 const runner=new NativeCargoRunner();let argv;
 runner.process={run:async(executable,args)=>{assert.equal(executable,'cargo');argv=args;const emit=args.find(a=>a.startsWith('--emit=')).slice(7);for(const item of emit.split(',')){const [kind,path]=item.split('=');await writeFile(path,kind==='obj'?Buffer.from([0x7f,69,76,70]):'fn main() {}');}return {exitCode:0,stdout:'',stderr:''};}};
 try{const result=await runner.run({files:{'Cargo.toml':'[package]\nname="demo"\nversion="0.1.0"','src/main.rs':'fn main(){}'}},'inspect',{json:true,args:['--bin','demo']});assert.equal(argv[0],'rustc');assert(argv.includes('--'));assert(argv.includes('-Cdebuginfo=2'));assert.equal(result.compilerArtifacts.length,4);}finally{await runner.dispose();}
});
