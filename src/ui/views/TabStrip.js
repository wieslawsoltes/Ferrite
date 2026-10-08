import {Dom} from './Dom.js';
export class TabStrip {
  constructor(root,model){this.root=root;this.model=model;}
  render(){this.root.replaceChildren();for(const path of this.model.tabs){const tab=Dom.element('div','document-tab');tab.classList.toggle('active',this.model.active===path);const button=Dom.button(path.split('/').at(-1),()=>this.model.open(path),{icon:path.endsWith('.rs')?'file':'cargo'});button.title=path;button.dataset.file=path;button.setAttribute('aria-selected',String(this.model.active===path));tab.append(button);if(this.model.dirty(path))tab.append(Dom.element('span','dirty-dot','•'));tab.append(Dom.button('',()=>this.model.close(path),{icon:'close',className:'icon-button tab-close',title:`Close ${path}`}));this.root.append(tab);}}
}
