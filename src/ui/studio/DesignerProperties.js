import {literalTextValue} from './DesignerLiterals.js';
import {Dom} from '../views/Dom.js';
import {CanvasLayout} from '../../ui-framework/CanvasLayout.js';

/** Only literal pixel geometry is projected. CSS auto/%/expressions stay unset. */
export function literalRectangle(node) {
  const style=node.attributes?.find(attribute=>attribute.name==='style');
  const rectangle={x:'',y:'',width:'',height:''};if(!style||style.kind!=='string')return rectangle;
  try {
    for(const declaration of CanvasLayout.declarations(style.value)){
      const name={left:'x',top:'y',width:'width',height:'height'}[declaration.name];if(!name)continue;
      const value=style.value.slice(declaration.valueStart,declaration.valueEnd).trim();
      rectangle[name]=(/^-?(?:\d+(?:\.\d+)?|\.\d+)px$/i.test(value)||/^[+-]?0(?:\.0+)?$/.test(value))?String(parseFloat(value)):'';
    }
  }catch { /* The compiler remains the authority; incomplete CSS has no fake geometry. */ }
  return rectangle;
}
export function renderDesignerProperties(s) {
  s.properties.replaceChildren();const node=s.designer?.index.get(s.selected);
  if(!node){s.properties.append(Dom.element('p','studio-hint','Select an element in Structure or use Pick element on the canvas.'));return;}
  s.propertySections??=new Map();
  const section=(title,open=true)=>{
    const details=Dom.element('details','studio-property-section'),body=Dom.element('div','studio-section-body');details.open=s.propertySections.get(title)??open;
    details.append(Dom.element('summary','',title),body);details.ontoggle=()=>s.propertySections.set(title,details.open);s.properties.append(details);return body;
  };
  const applyOnEnter=(input,action)=>{input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();event.stopPropagation();Promise.resolve().then(action).catch(error=>s.error(error));}});};
  const selection=Dom.element('div','studio-selection-summary');selection.append(Dom.element('strong','',node.tag?`<${node.tag}>`:node.kind),Dom.element('span','studio-hint',`${s.file.split('/').pop()}:${node.span.line}`));s.properties.append(selection);
  const actions=Dom.element('div','studio-toolbar studio-selection-actions');
  actions.append(s.button('Source',()=>s.select(node.id),'code'));
  if(s.designer.parents.has(node.id))actions.append(s.button('Duplicate',()=>s.edit({op:'duplicate',node:node.id})),s.button('Delete',()=>s.edit({op:'remove',node:node.id}),'trash'));
  actions.append(s.button('Undo edit',async()=>{if(s.model.undoTransaction()){s.model.save();await s.build();}},'reset'));s.properties.append(actions);
  const content=section('Content');
  if(node.kind!=='element'){
    const literal=literalTextValue(node);
    if(literal===undefined)content.append(Dom.element('p','studio-hint','This is a Rust expression. Set text replaces it with a literal; use Source to edit the expression.'));
    const value=s.input('Selected text',literal??'');const apply=()=>s.edit({op:'setText',node:node.id,value:value.value});applyOnEnter(value,apply);
    content.append(s.field('Literal text',value),s.button('Set text',apply));return;
  }
  if(node.tag){
    const tag=s.input('Element tag',node.tag),row=Dom.element('div','studio-inline-field'),apply=()=>s.edit({op:'setTag',node:node.id,value:tag.value});applyOnEnter(tag,apply);row.append(s.field('Tag',tag),s.button('Change tag',apply));content.append(row);
  }
  const text=node.children?.length===1?node.children[0]:null,literal=literalTextValue(text);
  if(text&&literal!==undefined){const input=s.input('Element text',literal),apply=()=>s.edit({op:'setText',node:text.id,value:input.value});applyOnEnter(input,apply);content.append(s.field('Text',input),s.button('Apply text',apply));}
  if(node.tag){
    const attributes=section('Attributes');
    for(const attribute of node.attributes){
      const input=s.input(`Attribute ${attribute.name}`,attribute.kind==='boolean'?'true':attribute.value);
      const row=Dom.element('div','studio-property'),apply=()=>s.edit({op:'setAttribute',node:node.id,name:attribute.name,kind:attribute.kind,value:input.value});
      input.readOnly=attribute.kind==='boolean';input.title=attribute.kind==='expression'?'Rust expression — validated before writing source':attribute.kind==='boolean'?'Presence means true; use Remove to clear it':'';
      applyOnEnter(input,apply);row.append(s.field(`${attribute.name} · ${attribute.kind}`,input));
      const set=s.button('Apply',apply,'check'),remove=s.button('Remove',()=>s.edit({op:'removeAttribute',node:node.id,name:attribute.name}),'close');set.title=`Apply ${attribute.name}`;remove.title=`Remove ${attribute.name}`;set.setAttribute('aria-label',set.title);remove.setAttribute('aria-label',remove.title);row.append(set,remove);attributes.append(row);
    }
    const add=Dom.element('div','studio-new-attribute'),name=s.input('New attribute name','className'),value=s.input('New attribute value');name.placeholder='Attribute';value.placeholder='Value';
    const kind=s.selectInput('New attribute kind',[['string','String'],['expression','Rust expression'],['boolean','Boolean']]);
    const apply=()=>s.edit({op:'setAttribute',node:node.id,name:name.value,value:value.value,kind:kind.value});applyOnEnter(name,apply);applyOnEnter(value,apply);
    add.append(name,value,kind,s.button('Add attribute',apply,'plus'));attributes.append(add);
  }
  if(node.tag&&!/^[A-Z]/.test(node.tag)&&!node.tag.includes('::')){
    const layout=section('Absolute canvas rectangle',false),initial=literalRectangle(node),fields=Dom.element('div','studio-geometry-grid');
    const geometry=Object.fromEntries(Object.entries(initial).map(([name,value])=>{
      const input=s.input(`Canvas ${name}`,value);input.type='number';input.step='any';input.placeholder='auto';if(name==='width'||name==='height')input.min='1';fields.append(s.field(name,input));return [name,input];
    }));
    layout.append(Dom.element('p','studio-hint','Absolute positioning only. For normal flow use Row, Column, Grid or CSS. Unset values are not fabricated.'),fields,s.button('Set canvas rectangle',()=>{
      if(Object.values(geometry).some(input=>!input.value.trim()))throw Error('Set all four rectangle values, or use Move / Resize on the canvas to start from actual bounds');
      return s.edit({op:'setLayout',node:node.id,rectangle:Object.fromEntries(Object.entries(geometry).map(([key,input])=>[key,Number(input.value)])),grid:s.project?.settings.grid??8,snap:s.project?.settings.snap??true});
    }));
  }
  const add=section('Children',false);add.append(Dom.element('p','studio-hint','Choose a component in the Toolbox. The insertion selector supports children and siblings.'),s.button('Open Toolbox',()=>s.dock.open('toolbox'),'plus'));
}
