/** Pure additive feature closure, including namespaced and weak dependency features. */
export class FeatureResolver {
  constructor(declarations = {}, dependencies = {}) {
    this.declarations=declarations; this.dependencies=dependencies;
    this.suppressed=new Set(Object.values(declarations).filter(Array.isArray).flat().filter(x=>typeof x==='string'&&x.startsWith('dep:')).map(x=>x.slice(4)));
  }
  available(){return [...new Set([...Object.keys(this.declarations),...Object.entries(this.dependencies).filter(([name,spec])=>spec.optional&&!this.suppressed.has(name)).map(([name])=>name)])].sort();}
  resolve(requested = [], {defaults=true,all=false} = {}){
    const enabled=new Set(),active=new Set(Object.keys(this.dependencies).filter(name=>!this.dependencies[name].optional)),forwarded=new Map(),errors=[],seen=new Set();
    const queue=[...requested,...(all?this.available():[])];if(defaults&&Object.hasOwn(this.declarations,'default'))queue.push('default');
    while(queue.length){
      const name=queue.pop();if(typeof name!=='string'){errors.push('Feature names must be strings');continue;}if(seen.has(name))continue;seen.add(name);
      if(name.startsWith('dep:')){
        const dependency=name.slice(4),spec=this.dependencies[dependency];
        if(!spec||!spec.optional)errors.push(`Feature '${name}' must name an optional dependency`);else active.add(dependency);
      }else if(name.includes('/')){
        const match=/^([^/?]+)(\?)?\/([^/]+)$/.exec(name),spec=match&&this.dependencies[match[1]];
        if(!match||!spec){errors.push(`Unknown dependency feature '${name}'`);continue;}
        if(!match[2]){active.add(match[1]);if(spec.optional&&!this.suppressed.has(match[1]))queue.push(match[1]);}
        if(!forwarded.has(match[1]))forwarded.set(match[1],new Set());forwarded.get(match[1]).add(match[3]);
      }else if(Object.hasOwn(this.declarations,name)){
        enabled.add(name);const list=this.declarations[name];
        if(!Array.isArray(list))errors.push(`Feature '${name}' must be an array`);else queue.push(...list);
      }else if(this.dependencies[name]?.optional&&!this.suppressed.has(name)){
        enabled.add(name);active.add(name);
      }else errors.push(`Unknown feature '${name}'`);
      if(seen.size>10000){errors.push('Feature expansion budget exceeded');break;}
    }
    return {enabled:[...enabled].sort(),dependencies:[...active].sort(),available:this.available(),
      dependencyFeatures:Object.fromEntries([...forwarded].filter(([name])=>active.has(name)).map(([name,values])=>[name,[...values].sort()])),errors};
  }
}
