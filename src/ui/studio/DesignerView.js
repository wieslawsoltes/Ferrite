import {Dom} from '../views/Dom.js';
import {PanelDock} from '../docking/PanelDock.js';
import {designerLayout} from './DesignerLayout.js';
import {UI_SAMPLE_CSS} from '../../ui-framework/Samples.js';

export const TOOLBOX = [
  ['Layout','Container','<div></div>','div section panel'],
  ['Layout','Row','<div style="display:flex;gap:12px;align-items:center"></div>','horizontal flex stack'],
  ['Layout','Column','<div style="display:flex;flex-direction:column;gap:12px"></div>','vertical flex stack'],
  ['Layout','Grid','<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px"></div>','columns rows'],
  ['Text','Heading','<h2>Heading</h2>','title h1 h2'],['Text','Text','<p>Text</p>','paragraph p'],
  ['Text','List','<ul><li>Item</li></ul>','ul li items'],
  ['Forms','Button','<button>Button</button>','click action'],['Forms','Input','<input placeholder="Type here" />','textbox field'],
  ['Forms','Label','<label>Label</label>','caption'],['Forms','Checkbox','<input type="checkbox" />','check toggle'],
  ['Forms','Select','<select><option>Option</option></select>','dropdown combobox']
];
export function insertElement(studio,markup,nodeId=studio.selected,placement=studio.insertPosition?.value??'inside') {
  let node=studio.designer?.index.get(nodeId);if(!node)throw Error('Select a destination in Structure or on the canvas first');
  let parent=studio.designer.parents.get(node.id);
  if(placement!=='inside') {
    if(!parent)throw Error('A root view has no sibling insertion position');
    const siblings=parent.children,index=siblings.findIndex(child=>child.id===node.id);
    return studio.edit({op:'insert',node:parent.id,markup,before:placement==='before'?node.id:siblings[index+1]?.id??null});
  }
  if(node.kind!=='element')node=parent;
  if(!node||/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(node.tag))throw Error('This node cannot contain children. Choose Before selection or After selection.');
  return studio.edit({op:'insert',node:node.id,markup});
}

export function createDesignerView(s) {
  const controls=Dom.element('div','studio-toolbar studio-main-toolbar');
  s.pathLabel=Dom.element('span','studio-document-path',s.file);s.pathLabel.title=s.file;
  s.files=s.selectInput('UI source file',[]);s.files.onchange=()=>{s.file=s.files.value;s.app.studio.revealSource(s,()=>s.model.open(s.file));s.selected=null;s.refreshSource({invalidate:false});};
  s.entryFiles=s.selectInput('UI project entry file',[]);s.entryFiles.onchange=()=>s.app.studio.open(s.entryFiles.value);
  s.backendSelect=s.selectInput('UI backend',[['javascript','JavaScript'],['wasm','WebAssembly'],['mir','MIR / trace']]);
  s.backendSelect.onchange=()=>{s.backend=s.backendSelect.value;s.saveProject();s.markStale();};
  s.entryInput=s.input('UI entry function','app');s.entryInput.onchange=()=>{s.entry=s.entryInput.value;s.saveProject();s.refreshSource();};
  const panels=s.button('Panels',()=>s.dock.launcher(panels,[{label:'Reset designer layout',layout:designerLayout()},{label:'Wide canvas layout',layout:designerLayout('canvas')},{label:'Debug layout',layout:designerLayout('debug')}] ),'split');panels.setAttribute('aria-haspopup','dialog');
  s.panelLauncher=panels;
  const focus=s.button('Focus canvas',()=>s.dock.action('canvas','maximize'),'fit');
  controls.append(s.pathLabel,s.button('Preview',()=>s.build(),'run'),panels,focus,s.backendSelect,s.button('Settings / Export',()=>s.dock.open('settings'),'settings'));
  s.status=Dom.element('div','studio-status','Preview to compile this view.');s.status.setAttribute('role','status');
  const workspace=Dom.element('div','studio-workspace');
  const structure=Dom.element('section','studio-structure studio-panel');structure.setAttribute('aria-label','UI Structure');
  s.outlineSearch=s.input('Filter UI structure');s.outlineSearch.placeholder='Find a tag, text or attribute…';s.outlineSearch.type='search';s.outlineSearch.oninput=()=>s.renderOutline();
  s.outline=Dom.element('div','studio-outline');s.outline.setAttribute('role','tree');s.outline.setAttribute('aria-label','UI source outline');
  structure.append(s.files,s.outlineSearch,s.outline);
  const toolbox=Dom.element('section','studio-toolbox studio-panel');toolbox.setAttribute('aria-label','UI Toolbox');
  s.toolboxSearch=s.input('Search toolbox');s.toolboxSearch.type='search';s.toolboxSearch.placeholder='Search components…';
  s.insertPosition=s.selectInput('Toolbox insertion position',[['inside','Inside selection'],['before','Before selection'],['after','After selection']]);
  const items=Dom.element('div','studio-toolbox-items'),hint=Dom.element('p','studio-hint','Click to insert. Drag onto a Structure item to choose its parent.');
  const renderTools=()=>{
    items.replaceChildren();const query=s.toolboxSearch.value.trim().toLowerCase();let previous=null;
    for(const [category,label,markup,aliases] of TOOLBOX){
      if(query&&!`${category} ${label} ${aliases}`.toLowerCase().includes(query))continue;
      if(category!==previous){items.append(Dom.element('h3','',category));previous=category;}
      const button=s.button(label,()=>insertElement(s,markup),'plus');button.draggable=true;button.dataset.toolboxItem=label;
      button.ondragstart=event=>{event.dataTransfer.setData('application/x-ferrite-ui-markup',markup);event.dataTransfer.effectAllowed='copy';};items.append(button);
    }
    if(!items.children.length)items.append(Dom.element('p','studio-hint','No matching components.'));
  };s.toolboxSearch.oninput=renderTools;renderTools();toolbox.append(s.toolboxSearch,s.insertPosition,items,hint);
  const previewArea=Dom.element('section','studio-preview-area');previewArea.setAttribute('aria-label','UI Preview');
  const previewBar=Dom.element('div','studio-toolbar studio-canvas-toolbar');
  s.pickButton=s.button('Pick element',()=>s.pick(),'fit');s.pickButton.setAttribute('aria-pressed','false');
  s.interactButton=s.button('Interact',()=>s.interact(),'run');
  s.viewport=s.selectInput('Preview width',[['100%','Responsive'],['375px','Phone · 375'],['768px','Tablet · 768'],['1280px','Desktop · 1280']]);s.viewport.onchange=()=>{s.frame.style.width=s.viewport.value;s.saveProject();};
  s.layoutMode=s.selectInput('Canvas editing',[['off','No geometry edits'],['move','Move element'],['resize','Resize element']]);s.layoutMode.dataset.activeMode='off';s.layoutMode.onchange=()=>s.configureLayout().catch(error=>s.error(error));
  previewBar.append(s.pickButton,s.interactButton,s.layoutMode,s.viewport);
  s.breadcrumbs=Dom.element('nav','studio-breadcrumbs');s.breadcrumbs.setAttribute('aria-label','Selected element ancestors');
  const canvas=Dom.element('div','studio-canvas');s.frame=Dom.element('iframe','studio-preview');s.frame.title=`Sandboxed Rust UI preview: ${s.file}`;canvas.append(s.frame);
  s.canvasHint=Dom.element('div','studio-canvas-hint','Pick element selects without clicking the app. Interact runs the app. Move / Resize writes absolute CSS.');
  previewArea.append(previewBar,s.breadcrumbs,canvas,s.canvasHint);
  s.properties=Dom.element('div','studio-properties');s.source=Dom.element('textarea');
  s.css=Dom.element('textarea','studio-source');s.css.setAttribute('aria-label','UI application CSS');s.css.spellcheck=false;s.css.value=UI_SAMPLE_CSS;s.css.oninput=()=>{s.saveProject();s.markStale();};
  const styles=Dom.element('div','studio-style-panel');styles.append(Dom.element('p','studio-hint','Stylesheet for this view. Edit CSS here; Preview applies it to the running app.'),s.css);
  const debug=Dom.element('div','studio-debug-panel'),debugBar=Dom.element('div','studio-toolbar');
  debugBar.append(s.button('Inspect',()=>s.inspect(),'tree'));
  for(const [label,command,icon] of [['Arm events','arm','debug'],['Instruction','step','step'],['Source line','step-line','line'],['Back instruction','back','step'],['Back line','back-line','line'],['Restart event','restart','debug'],['Continue','continue','run'],['Disarm','stop','stop']])debugBar.append(s.button(label,()=>s.debug(command),icon));
  s.states=Dom.element('div','studio-states');s.debugOutput=Dom.element('pre','studio-debug');debug.append(debugBar,s.states,s.debugOutput);
  const settings=Dom.element('div','studio-settings-panel');settings.append(s.field('Entry file',s.entryFiles),s.field('Entry function',s.entryInput),s.button('Export HTML',()=>s.download(),'export'),s.button('Export hydrated HTML',()=>s.download({hydrate:true}),'export'));
  s.nativeInput=Dom.element('input');s.nativeInput.type='file';s.nativeInput.accept='.wasm,application/wasm';s.nativeInput.hidden=true;s.nativeInput.setAttribute('aria-label','Load trusted Cargo UI Wasm');
  s.nativeInput.onchange=()=>{
    const file=s.nativeInput.files?.[0];s.nativeInput.value='';if(!file)return;
    if(file.size>8*1024*1024){s.error(Error('Native UI binaries are limited to 8 MiB'));return;}
    const generation=s.generation;
    file.arrayBuffer().then(buffer=>{if(generation!==s.generation||s.disposed)throw new DOMException('Source changed while loading the binary','AbortError');return s.buildNative(new Uint8Array(buffer),{name:file.name});}).catch(error=>s.error(error));
  };
  settings.append(Dom.element('p','studio-hint','Load only trusted native Cargo UI binaries. Native preview supports inspection/export, not browser source-node editing.'),s.button('Load Cargo Wasm',()=>s.nativeInput.click(),'run'),s.nativeInput);
  s.root.append(controls,s.status,workspace);
  s.dock=new PanelDock(workspace,[['structure','Structure',structure],['toolbox','Toolbox',toolbox],['canvas','Canvas',previewArea],['properties','Properties',s.properties],['styles','Styles',styles],['debug','Debug',debug],['settings','Settings / Export',settings]].map(([id,title,element])=>({id,title,element})),{
    initial:designerLayout(),saved:s.model.documentState(s.entryFile).designerLayout,onError:error=>s.error(error),
    onReveal:id=>{if(id!=='canvas'&&s.root.dataset.mode==='preview')s.app.studio.setMode('design');},
    onChange:layout=>{if(s.disposed||!Object.hasOwn(s.model.files,s.entryFile))return;s.model.setDocumentState(s.entryFile,{designerLayout:layout});s.model.save();}
  });
}
