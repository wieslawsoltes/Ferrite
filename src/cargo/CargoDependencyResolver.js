import {FeatureResolver} from './FeatureResolver.js';
import {VirtualFileSystem as V} from '../project/VirtualFileSystem.js';

/** Monotone feature unification across local dependency diamonds. Registry work stays native. */
export class CargoDependencyResolver {
  constructor(workspace,command,options={}){
    this.workspace=workspace;this.command=command;this.options=options;this.requests=new Map();this.queue=[];this.states=new Map();
    this.edges=new Map();this.specCache=new Map();this.native=new Set();this.errors=new Set();
  }
  specs(pkg){
    if(this.specCache.has(pkg.id))return this.specCache.get(pkg.id);
    const result=Object.create(null),manifest=pkg.manifest;
    const sections=[['dependencies',manifest.dependencies]];
    if(this.command==='test')sections.push(['dev-dependencies',manifest.sections['dev-dependencies']??{}]);
    for(const [kind,entries] of sections)for(const [name,raw] of Object.entries(entries)){
      let spec=typeof raw==='string'?{version:raw}:raw,base=pkg.directory;
      if(!spec||typeof spec!=='object'||Array.isArray(spec)){this.errors.add(`Invalid dependency ${name}`);continue;}
      if(spec.workspace){
        const inherited=this.workspace.workspace.dependencies?.[name];
        if(!inherited){this.errors.add(`Workspace dependency '${name}' is missing`);continue;}
        const parent=typeof inherited==='string'?{version:inherited}:inherited;
        spec={...parent,...spec,features:[...(parent.features??[]),...(spec.features??[])]};base='';
      }
      if(spec.features!==undefined&&(!Array.isArray(spec.features)||spec.features.some(f=>typeof f!=='string'))){this.errors.add(`Invalid features for dependency ${name}`);continue;}
      const previous=result[name];
      if(previous){
        if(previous.path!==spec.path||previous.version!==spec.version||previous.git!==spec.git){this.errors.add(`Conflicting dependency '${name}'`);continue;}
        spec={...previous,...spec,features:[...(previous.features??[]),...(spec.features??[])],optional:!!previous.optional&&!!spec.optional,
          'default-features':previous['default-features']!==false||spec['default-features']!==false};
      }
      result[name]={...spec,base,kind,span:manifest.spans[`${kind}.${name}`]};
    }
    this.specCache.set(pkg.id,result);return result;
  }
  request(pkg,features=[],defaults=true){
    if(!Array.isArray(features)||features.some(f=>typeof f!=='string')){this.errors.add(`Requested features for ${pkg.name} must be strings`);return;}
    let state=this.requests.get(pkg.id),changed=false;
    if(!state){state={pkg,features:new Set(),defaults:false};this.requests.set(pkg.id,state);changed=true;}
    for(const feature of features)if(!state.features.has(feature)){state.features.add(feature);changed=true;}
    if(defaults&&!state.defaults){state.defaults=true;changed=true;}
    if(changed&&!this.queue.includes(pkg.id))this.queue.push(pkg.id);
  }
  resolve(selected){
    this.request(selected,this.options.features??[],this.options.defaultFeatures!==false);
    let steps=0;
    while(this.queue.length){
      if(++steps>10000){this.errors.add('Cargo feature resolution budget exceeded');break;}
      const id=this.queue.shift(),request=this.requests.get(id),pkg=request.pkg,specs=this.specs(pkg);
      const state=new FeatureResolver(pkg.manifest.sections.features??{},specs).resolve([...request.features],{defaults:request.defaults,all:!!this.options.allFeatures&&id===selected.id});
      this.states.set(id,state);state.errors.forEach(error=>this.errors.add(`${pkg.name}: ${error}`));
      const build=pkg.manifest.package.build;
      if(typeof build==='string'||(build!==false&&Object.hasOwn(this.workspace.files,V.path('build.rs',pkg.directory))))this.native.add(`${pkg.name}: build script requires native Cargo`);
      if(pkg.targets.some(t=>t.procMacro))this.native.add(`${pkg.name}: procedural macros require native Cargo`);
      if(Object.keys(pkg.manifest.sections['build-dependencies']??{}).length)this.native.add(`${pkg.name}: build dependencies require native Cargo`);
      if(Object.keys(pkg.manifest.sections.target??{}).length)this.native.add(`${pkg.name}: target-specific dependency tables require native Cargo`);
      for(const alias of state.dependencies){
        const spec=specs[alias],edge={from:id,alias:alias.replaceAll('-','_'),kind:spec.kind,spec,span:spec.span};
        if(typeof spec.path==='string'){
          let path;try{path=V.path(spec.path+'/Cargo.toml',spec.base);}catch(error){this.errors.add(error.message);continue;}
          if(!Object.hasOwn(this.workspace.files,path)){this.errors.add(`Local dependency ${alias} requires ${path}`);continue;}
          const dependency=this.workspace.package(path);edge.to=dependency.id;
          if(!dependency.targets.some(t=>t.kind==='lib'))this.errors.add(`Dependency ${alias} has no library target`);
          this.request(dependency,[...(spec.features??[]),...(state.dependencyFeatures[alias]??[])],spec['default-features']!==false);
        }else edge.to=spec.git??`registry:${alias}@${spec.version??'*'}`;
        this.edges.set(id+'\0'+alias,edge);
      }
    }
    const graph=[...this.edges.values()],buildOrder=[],visiting=new Set(),visited=new Set();
    const visit=id=>{if(visiting.has(id)){this.errors.add(`Cyclic local dependency involving ${id}`);return;}if(visited.has(id))return;visiting.add(id);
      graph.filter(e=>e.from===id&&this.workspace.packages.has(e.to)).forEach(e=>visit(e.to));visiting.delete(id);visited.add(id);buildOrder.push(id);};visit(selected.id);
    return {graph,buildOrder,features:Object.fromEntries(this.states),nativeRequired:[...this.native],
      dependencies:[...new Set(graph.filter(e=>!this.workspace.packages.has(e.to)).map(e=>e.alias))],errors:[...this.errors].map(message=>({message}))};
  }
}
