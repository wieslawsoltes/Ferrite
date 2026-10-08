export class MirLowerer {
 static lower(sem){
  return sem.instances.map(instance=>{
    let id=0;const blocks=[];const fresh=()=>({id:"bb"+id++,statements:[],terminator:null});
    let current=fresh();blocks.push(current);
    function append(block){for(const statement of block.body){
      if(statement.kind==="if"){const yes=fresh(),no=fresh(),merge=fresh();current.terminator={kind:"switch",condition:statement.condition,true:yes.id,false:no.id};blocks.push(yes,no,merge);current=yes;append(statement.then);if(!current.terminator)current.terminator={kind:"goto",target:merge.id};current=no;if(statement.otherwise)append(statement.otherwise);if(!current.terminator)current.terminator={kind:"goto",target:merge.id};current=merge;}
      else if(statement.kind==="for"){const test=fresh(),yes=fresh(),done=fresh();current.statements.push({kind:"rangeInit",name:statement.name,value:statement.from,loc:statement.loc});current.terminator={kind:"goto",target:test.id};blocks.push(test,yes,done);test.terminator={kind:"rangeSwitch",name:statement.name,end:statement.to,inclusive:statement.inclusive,true:yes.id,false:done.id,loc:statement.loc};current=yes;append(statement.then);if(!current.terminator){current.statements.push({kind:"rangeStep",name:statement.name,loc:statement.loc});current.terminator={kind:"goto",target:test.id};}current=done;}
      else if(statement.kind==="while"){const test=fresh(),yes=fresh(),done=fresh();current.terminator={kind:"goto",target:test.id};blocks.push(test,yes,done);test.terminator={kind:"switch",condition:statement.condition,true:yes.id,false:done.id};current=yes;append(statement.then);if(!current.terminator)current.terminator={kind:"goto",target:test.id};current=done;}
      else if(statement.kind==="return"){current.terminator={kind:"return",value:statement.value};current=fresh();blocks.push(current);}
      else current.statements.push(statement);
    }}
    append(instance.fn.body);if(!current.terminator)current.terminator={kind:"return",value:instance.fn.body.tail};
    return {instance:instance.key,blocks};
  });
}
}
