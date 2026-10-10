import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Compile the same checked-in domain modules with rustc: no replacement model,
// UI host imports, registry downloads or generated JavaScript in this gate.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/7guis/native');fs.mkdirSync(out,{recursive:true});
const probes={
  temperature:`let s=model::change(model::initial(),String::from("100"),true);assert_eq!(s.fahrenheit,"212");let s=model::change(s,String::from("invalid"),true);assert_eq!(s.fahrenheit,"212");`,
  flight:`assert_eq!(model::date(String::from("29.02.1900")),None);assert_eq!(model::date(String::from("29.02.2000")),Some(20000229));assert!(!model::allowed(String::from("10.10.2026"),String::from("09.10.2026"),true));`,
  timer:`let mut t=model::tick(model::Timer{elapsed:0.0,duration:1.0},700.0);t.duration=0.5;t=model::tick(t,400.0);assert_eq!(t.elapsed,0.7);t.duration=1.0;t=model::tick(t,400.0);assert_eq!(t.elapsed,1.0);`,
  crud:`let p=model::delete(model::initial(),0);let p=model::create(p,String::from("Ada"),String::from("Lovelace"));assert_eq!(p.rows[2].id,3);let p=model::update(p,2,String::from("Changed"),String::from("Surname"));assert_eq!(p.rows[1].name,"Changed");`,
  circles:`let d=model::create(model::create(model::initial(),100.0,100.0),160.0,100.0);let d=model::preview(d,0,140.0);assert_eq!(model::nearest(&d.circles,155.0,100.0),1);let d=model::finish(d,0,30.0);assert_eq!(d.cursor,3);let d=model::undo(d);assert_eq!(d.circles[0].diameter,30.0);let d=model::redo(d);assert_eq!(d.circles[0].diameter,140.0);`,
  cells:`let s=model::set(model::initial(),0,String::from("2"));let s=model::set(s,1,String::from("=A0*3"));let s=model::set(s,2,String::from("=sum(A0:B0)"));assert_eq!(s.cells[2].display,"8");let s=model::set(s,0,String::from("4"));assert_eq!(s.cells[2].display,"16");assert_eq!(s.evaluations,3);let s=model::set(s,0,String::from("=B0"));assert_eq!(s.cells[2].display,"#CYCLE!");let s=model::set(s,0,String::from("5"));assert_eq!(s.cells[2].display,"20");let s=model::set(s,3,String::from("=A100"));assert_eq!(s.cells[3].display,"#REF!");`
};
const primitive=`assert_eq!("+42".parse::<i64>().unwrap(),42);assert!("18446744073709551616".parse::<u64>().is_err());assert_eq!("18446744073709551615".parse::<u64>().unwrap(),18446744073709551615);assert!(" 1".parse::<f64>().is_err());assert!("0xff".parse::<f64>().is_err());assert_eq!("-1.25e2".parse::<f64>().unwrap(),-125.0);assert!(!"NaN".parse::<f64>().unwrap().is_finite());let s=String::from("Zażółć 🦀");assert_eq!(s.into_bytes().len(),15);assert_eq!((-2.5_f64).round(),-3.0);`;
function run(command,args){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:60000});if(result.error||result.status!==0)throw Error(`${command} ${args.join(' ')}\n${result.error??result.stderr??result.stdout}`);return result.stdout;}
const results=[];
for(const [name,body] of Object.entries(probes)){
  const source=path.join(out,`${name}.rs`),binary=path.join(out,`${name}${process.platform==='win32'?'.exe':''}`);
  fs.writeFileSync(source,`#![allow(dead_code)]\nmod model { include!(${JSON.stringify(path.join(root,`examples/7guis/${name}/model.rs`))}); }\nfn main(){${primitive}\n${body}\nprintln!("PASS ${name}");}\n`);
  run('rustc',['--edition=2021',source,'-o',binary]);results.push({name,result:run(binary,[]).trim()});console.log(results.at(-1).result);
}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({rustc:run('rustc',['--version']).trim(),results},null,2)+'\n');
