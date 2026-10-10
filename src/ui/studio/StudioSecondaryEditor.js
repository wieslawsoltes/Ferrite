import {Dom} from '../views/Dom.js';
import {CodeEditor} from '../views/CodeEditor.js';
import {SelectionModel} from '../model/SelectionModel.js';
/** Workbench operations; the owning UIStudio controls document and editor lifetimes. */
export const StudioSecondaryEditor = {
  split(path=this.model.active,orientation='right') {
    if(!path)return;this.model.setDocumentState(path,{mode:'split',orientation});
    if(this.isView(path)){this.open(path);return;}
    if(!this.secondary){
      const root=Dom.element('section','secondary-editor'),bar=Dom.element('div','secondary-toolbar'),select=Dom.element('select'),host=Dom.element('div','editor-root');
      select.setAttribute('aria-label','Split editor file');bar.append(select,Dom.button('Unsplit',()=>{this.closeSecondary();this.sync();},{icon:'close'}));root.append(bar,host);this.workspace.append(root);
      const positions=new Map(),model=this.model,proxy=new Proxy(model,{get(target,key){if(key==='positions')return positions;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
      const selection=new SelectionModel();selection.reset(model.revision);const editor=new CodeEditor(host,proxy,selection);editor.textarea.id='split-source';editor.textarea.setAttribute('aria-label','Split source editor');
      this.secondary={root,select,editor,path};select.onchange=()=>{this.secondary.path=select.value;editor.open(select.value);};
    }else this.secondary.path=path;
    this.secondary.root.hidden=false;this.secondary.editor.open(path);this.refreshSecondaryFiles();this.sync();this.focusDocument();
  },
  refreshSecondaryFiles() {
    const group=this.secondary;if(!group)return;const names=Object.keys(this.model.files).sort();
    if(group.select.options.length!==names.length||[...group.select.options].some((option,i)=>option.value!==names[i])){group.select.replaceChildren();for(const path of names){const option=Dom.element('option','',path);option.value=path;group.select.append(option);}}
    group.select.value=group.path;
  },
  closeSecondary() { if(!this.secondary)return;this.secondary.editor.dispose();this.secondary.root.remove();this.secondary=null;this.sync(); }
};
