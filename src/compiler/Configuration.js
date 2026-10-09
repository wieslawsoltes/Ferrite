import {Diagnostic} from './Diagnostic.js';
import {AttributeParser} from './AttributeParser.js';

/** cfg/cfg_attr/cfg! evaluation. Browser target properties are explicit, never host guesses. */
export class Configuration {
  constructor(options = {}) {
    this.options={features:[],test:false,debugAssertions:true,flags:[],values:{},...options}; this.decisions=[];
    this.flags=new Set(this.options.flags);
    if(this.options.test)this.flags.add('test');
    if(this.options.debugAssertions)this.flags.add('debug_assertions');
    this.values={target_arch:['wasm32'],target_os:['unknown'],target_family:['wasm'],target_pointer_width:['32'],target_endian:['little'],target_env:[''],target_vendor:['unknown'],panic:['unwind'],...this.options.values,feature:this.options.features};
  }
  evaluate(predicate,depth=0){
    if(!predicate||depth>64)throw new Diagnostic('F_CFG','Invalid configuration predicate',predicate?.span);
    if(predicate.kind==='word')return predicate.name==='true'||(predicate.name!=='false'&&this.flags.has(predicate.name));
    if(predicate.kind==='value'){
      if(predicate.valueKind!=='string')throw new Diagnostic('F_CFG','Configuration values must be strings',predicate.span);
      const values=this.values[predicate.name];return Array.isArray(values)?values.includes(predicate.value):values===predicate.value;
    }
    const values=predicate.args.map(p=>this.evaluate(p,depth+1));
    if(predicate.name==='all')return values.every(Boolean);
    if(predicate.name==='any')return values.some(Boolean);
    if(predicate.name==='not'&&values.length===1)return !values[0];
    throw new Diagnostic('F_CFG',`Invalid configuration predicate '${predicate.name}'`,predicate.span);
  }
  attributes(attributes=[],depth=0){
    if(depth>64)throw new Diagnostic('F_CFG','cfg_attr expansion limit exceeded');
    const result=[];let enabled=true;
    for(const attribute of attributes){
      if(attribute.name==='cfg'){
        const args=attribute.meta?.args??[];if(args.length!==1)throw new Diagnostic('F_CFG','cfg requires exactly one predicate',attribute.span);
        const active=this.evaluate(args[0]);enabled=enabled&&active;
        this.decisions.push({kind:'cfg',enabled:active,predicate:args[0],span:attribute.span});
      }else if(attribute.name==='cfg_attr'){
        const args=attribute.meta?.args??[];if(args.length<1)throw new Diagnostic('F_CFG','cfg_attr requires a predicate',attribute.span);
        const active=this.evaluate(args[0]);this.decisions.push({kind:'cfg_attr',enabled:active,predicate:args[0],span:attribute.span});
        if(active){const nested=this.attributes(args.slice(1).map(meta=>AttributeParser.attribute(meta)),depth+1);enabled=enabled&&nested.enabled;result.push(...nested.attributes);}
      }else result.push(attribute);
    }
    return {enabled,attributes:result};
  }
  static apply(ast,options={}){
    const result=structuredClone(ast),decisions=[];
    const visit=(node,inherited)=>{
      if(!node||typeof node!=='object')return node;
      if(Array.isArray(node))return node.map(value=>visit(value,inherited)).filter(value=>value!==null);
      if(node.kind==='cfg'){
        const evaluator=new Configuration(inherited),enabled=evaluator.evaluate(node.predicate);
        decisions.push({kind:'cfg!',enabled,predicate:node.predicate,span:node.span});
        return {...node,kind:'literal',type:'bool',value:enabled};
      }
      const context=node.configuration??inherited;
      if(node.attributes){const evaluator=new Configuration(context),state=evaluator.attributes(node.attributes);decisions.push(...evaluator.decisions);if(!state.enabled)return null;node.attributes=state.attributes;}
      for(const [key,value] of Object.entries(node))if(!['attributes','configuration','span','loc','meta'].includes(key))node[key]=visit(value,context);
      // cfg removes tuple fields before their positional indices are assigned.
      if (node.kind === 'struct' && node.form === 'tuple') node.fields.forEach((field, i) => { field.name = String(i); });
      if (node.kind === 'enumVariant' && node.members) {
        if (node.form === 'tuple') node.members.forEach((field, i) => { field.name = String(i); });
        node.fields = node.members.map(field => field.type);
      }
      return node;
    };
    return {ast:visit(result,options)??{kind:'crate',items:[]},decisions};
  }
}
