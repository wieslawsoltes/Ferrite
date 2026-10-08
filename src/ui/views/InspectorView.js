import {Dom} from './Dom.js';
import {SpanRegistry} from './SpanRegistry.js';
import {TreeView} from './TreeView.js';
import {GraphView} from './GraphView.js';
import {SelectionModel} from '../model/SelectionModel.js';

/** Stage adapters render compiler contracts; no view invents an unimplemented compiler pass. */
export class InspectorView {
  constructor(root,selection){
    this.root=root;this.selection=selection;this.stage='MIR / CFG';this.instance=null;this.build=null;this.stale=false;
    const controls=Dom.element('div','inspector-selectors');this.stageSelect=Dom.element('select');this.stageSelect.id='stage-select';this.stageSelect.setAttribute('aria-label','Compiler stage');this.functionSelect=Dom.element('select');this.functionSelect.id='instance-select';this.functionSelect.setAttribute('aria-label','Function instance');controls.append(this.stageSelect,this.functionSelect);
    this.caption=Dom.element('div','view-caption');this.content=Dom.element('div','inspector-content');this.content.id='inspector-content';root.append(controls,this.caption,this.content);
    this.registry=new SpanRegistry(selection,'inspector');this.tree=new TreeView(this.content,this.registry);this.graph=new GraphView(this.content,this.registry);
    this.stageSelect.onchange=()=>{this.stage=this.stageSelect.value;this.render();};this.functionSelect.onchange=()=>{this.instance=this.functionSelect.value;this.render();};
    selection.subscribe(({span,origin})=>{if(this.stale||!span||!this.build)return;const kind=this.build.stages.find(s=>s.name===this.stage)?.kind;if(origin==='editor'&&kind==='cfg'){
      const matches=this.build.sem.instances.filter(i=>SelectionModel.overlaps(span,i.span));if(matches.length&&!matches.some(i=>i.key===this.instance)){this.instance=matches[0].key;this.render();}
    }this.registry.highlight(span);});
  }
  setBuild(build){this.build=build;this.stale=false;this.root.classList.remove('is-stale');if(!build.stages.some(s=>s.name===this.stage))this.stage=build.stages[0].name;this.stageSelect.replaceChildren();for(const stage of build.stages){const option=Dom.element('option','',stage.name);option.value=stage.name;this.stageSelect.append(option);}if(!build.sem.instances.some(i=>i.key===this.instance))this.instance=build.entry??build.sem.instances[0]?.key;this.render();}
  invalidate(){this.stale=true;this.registry.clear();this.root.classList.add('is-stale');this.caption.textContent='Source changed — compile to refresh these results.';this.content.replaceChildren(Dom.element('div','empty-state','Compiler results belong to an older source revision. Auto-check will refresh them after editing.'));}
  showStage(name){if(!this.build?.stages.some(s=>s.name===name))return;this.stage=name;this.render();}
  render(){
    if(!this.build||this.stale)return;const stage=this.build.stages.find(s=>s.name===this.stage);this.registry.clear();this.content.replaceChildren();this.stageSelect.value=this.stage;this.functionSelect.hidden=stage.kind!=='cfg';this.functionSelect.replaceChildren();
    for(const instance of this.build.sem.instances){const option=Dom.element('option','',instance.key);option.value=instance.key;this.functionSelect.append(option);}this.functionSelect.value=this.instance;
    const descriptions={tokens:'Lexical tokens · click to reveal the exact source range',tree:'Structured compiler nodes · expand branches to inspect children',cfg:'Executable typed-register MIR · arrows show control flow',callgraph:'Reachable concrete instances · arrows are resolved calls',code:'Generated JavaScript · source-linked instructions emitted from MIR',ownership:'Conservative whole-local ownership analysis · not rustc NLL',types:'Resolved local types and concrete trait obligations',cargo:'Browser Cargo plan · unsupported toolchain features use Native Cargo'};
    this.caption.textContent=descriptions[stage.kind]??`${stage.name} · source-linked compiler results`;
    switch(stage.kind){
      case 'tokens':this.tokens(stage.data);break;
      case 'tree':this.tree.render(stage.data);break;
      case 'cfg':this.graph.renderCfg(stage.data.find(fn=>fn.instance===this.instance)??stage.data[0]);break;
      case 'callgraph':this.graph.renderCallGraph(stage.data);break;
      case 'code':this.code(stage.data);break;
      case 'symbols':this.symbols(stage.data);break;
      case 'instances':this.instances(stage.data);break;
      case 'types':this.types(stage.data);break;
      case 'ownership':this.ownership(stage.data);break;
      case 'cargo':this.cargo(stage.data);break;
      case 'modules':this.modules(stage.data);break;
      case 'expansions':for(const item of stage.data)this.card(item.name,`Built-in macro → ${item.intrinsic}`,item.span);break;
      case 'optimizations':for(const item of stage.data)this.card(item.kind,`${item.function} / ${item.block}${item.detail?' · '+item.detail:''}`,item.span);break;
      case 'queries':this.queries(stage.data);break;
      case 'verification':this.card('MIR verified',`${stage.data.functions} functions · ${stage.data.blocks} blocks · register initialization and control-flow contracts checked`,null,'success');break;
      default:this.tree.render(stage.data);
    }
    if(!this.content.childNodes.length)Dom.empty(this.content,stage.kind==='optimizations'?'No local optimizations changed this program.':'No entries in this stage.');this.registry.highlight(this.selection.value);
  }
  queries(data){
    if(!data){Dom.empty(this.content,'No query data for this compilation.');return;}
    this.caption.textContent=data.projectCacheHit?'Exact project cache hit — showing the dependency graph from the original build.':`${data.hits} reused queries · ${data.misses} evaluated queries · exact-content dependency keys`;
    const nodes=data.nodes.map(n=>({id:n.id,title:n.id,span:n.span,lines:[],badge:n.cacheHit?'reused':'evaluated'}));
    const ids=new Set(nodes.map(n=>n.id));const edges=data.nodes.flatMap(n=>n.dependencies.filter(d=>ids.has(d)).map(d=>({from:n.id,to:d,label:'depends on'})));
    this.graph.render(nodes,edges,nodes.find(n=>n.id.startsWith('mir:main'))?.id??nodes[0]?.id);
  }
  card(title,detail,span,kind=''){const card=Dom.element('section','inspection-card '+kind),header=Dom.element('div','card-heading',title);this.registry.bind(header,span);card.append(header);if(detail)card.append(Dom.element('p','card-detail',detail));this.content.append(card);return card;}
  table(headers,rows){const table=Dom.element('table','data-table'),head=Dom.element('thead'),tr=Dom.element('tr');for(const title of headers)tr.append(Dom.element('th','',title));head.append(tr);const body=Dom.element('tbody');for(const row of rows){const line=Dom.element('tr');for(const value of row.cells)line.append(Dom.element('td','',value));this.registry.bind(line,row.span);body.append(line);}table.append(head,body);this.content.append(table);return table;}
  tokens(tokens){const cloud=Dom.element('div','token-cloud');for(const token of tokens.slice(0,8000)){if(token.kind==='eof')continue;const button=Dom.element('button','token-chip syntax-'+token.kind,token.value);button.type='button';this.registry.bind(button,token.span);cloud.append(button);}this.content.append(cloud);if(tokens.length>8000)this.content.append(Dom.element('p','view-note','First 8,000 tokens shown. Narrow the project for larger token streams.'));}
  symbols(items){this.table(['Symbol','Kind','Source'],items.map(i=>({cells:[i.name,i.kind,Dom.sourceLabel(i.span)],span:i.span})));}
  instances(items){for(const item of items){const card=this.card(item.key,`returns ${item.returnType} · ${item.locals?.length??0} locals · ${item.calls?.length??0} calls`,item.span);const types=Object.entries(item.typeArguments).map(([parameter,type])=>`${parameter} → ${type}`).join('   ');if(types)card.append(Dom.element('code','type-bindings',types));}}
  types(data){for(const obligation of data.traitObligations)this.card(`${obligation.type} : ${obligation.trait}`,obligation.status,obligation.span,'success');for(const instance of data.instances){this.content.append(Dom.element('h3','section-heading',instance.key));this.table(['Local','Type','Storage'],instance.locals.map(local=>({cells:[local.name,local.type,`%${local.slot}${local.mutable?' · mutable':''}`],span:local.span})));}}
  ownership(items){for(const item of items){this.card(item.instance,item.model,item.span);this.table(['Event','Local','Source'],item.events.map(e=>({cells:[e.kind??e.action??'check',e.name??e.local??e.binding??'',Dom.sourceLabel(e.span)],span:e.span})));}}
  cargo(plan){this.card(plan.manifest.package?.name??'Cargo workspace',`${plan.command} · ${plan.entry}`,plan.target?.span);this.table(['Package','Target','Manifest'],plan.packages.map(p=>({cells:[p.name??p.manifest?.package?.name??p.id,p.targets.map(t=>`${t.name} (${t.kind})`).join(', '),p.manifestPath??p.path??p.id],span:p.manifest?.spans?.package})));for(const edge of plan.graph)this.card(`${edge.from} → ${edge.alias}`,edge.to,edge.span);for(const reason of plan.nativeRequired??[])this.card('Native toolchain required',reason,null,'warning');}
  modules(data){for(const file of data.files)this.card(file.file,`${file.tokens.length} tokens · ${file.source.length.toLocaleString()} UTF-16 code units`,file.tokens.find(t=>t.kind!=='eof')?.span);for(const edge of data.edges)this.card('Module edge',`${edge.from} → ${edge.to}`,edge.span);}
  code(data){const lines=data.code.split('\n'),mapping=new Map(data.mappings.map(m=>[m.line,m]));const header=Dom.element('div','code-summary',`${lines.length} JavaScript lines · ${data.mappings.length} source mappings`);this.content.append(header);const pre=Dom.element('div','generated-code');lines.forEach((line,index)=>{const row=Dom.element('div','generated-line');row.append(Dom.element('span','generated-number',index+1),Dom.element('code','',line||' '));const source=mapping.get(index+1);if(source)this.registry.bind(row,source.span);pre.append(row);});this.content.append(pre);}
}
