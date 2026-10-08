import {Dom} from './Dom.js';
import {SpanRegistry} from './SpanRegistry.js';
import {GraphView} from './GraphView.js';
import {NativeControlFlow} from '../model/NativeControlFlow.js';

/** Actual compiler artifacts remain distinct from Ferrite's pedagogical MIR and Wasm backend. */
export class NativeArtifactsView {
  constructor(root,selection){
    this.root=root;this.registry=new SpanRegistry(selection,'native-artifacts');this.artifacts=[];this.selected=0;
    this.toolbar=Dom.element('div','native-artifact-toolbar');this.select=Dom.element('select');this.select.setAttribute('aria-label','Native compiler artifact');this.select.id='native-artifact-select';
    this.mode=Dom.element('select');this.mode.setAttribute('aria-label','Native artifact presentation');
    for(const [value,label] of [['text','Source / hex'],['cfg','Control flow']]){const o=Dom.element('option','',label);o.value=value;this.mode.append(o);}
    this.downloadButton=Dom.button('Download',()=>this.download(),{icon:'export'});this.toolbar.append(this.select,this.mode,this.downloadButton);
    this.caption=Dom.element('p','view-note');this.content=Dom.element('div','native-artifact-content');this.graph=new GraphView(this.content,this.registry);root.append(this.toolbar,this.caption,this.content);
    this.select.onchange=()=>{this.selected=Number(this.select.value);this.render();};this.mode.onchange=()=>this.render();this.invalidate();
  }
  update(artifacts){this.artifacts=artifacts??[];this.selected=0;this.select.replaceChildren();
    this.artifacts.forEach((a,index)=>{const o=Dom.element('option','',a.kind+' · '+a.name);o.value=index;this.select.append(o);});this.render();}
  invalidate(){this.artifacts=[];this.registry.clear();this.select.replaceChildren();this.downloadButton.disabled=true;this.caption.textContent='Inspect with Native Cargo to emit rustc MIR, LLVM IR, assembly and object bytes.';Dom.empty(this.content,'No native artifacts for the current source revision.');}
  render(){
    this.registry.clear();this.content.replaceChildren();const artifact=this.artifacts[this.selected];this.downloadButton.disabled=!artifact?.content;
    if(!artifact){Dom.empty(this.content,'No emitted compiler artifacts. Check native compiler diagnostics.');return;}
    this.caption.textContent=`Actual rustc ${artifact.kind} · ${artifact.size.toLocaleString()} bytes${artifact.truncated?' · truncated text preview':''} · debug mappings have whole-line precision. ${artifact.omitted?artifact.reason:''}`;
    if(artifact.omitted){Dom.empty(this.content,artifact.reason);return;}
    if(this.mode.value==='cfg'){
      const functions=NativeControlFlow.parse(artifact);if(!functions.length){Dom.empty(this.content,'No recognized CFG in this output. Text / hex remains available.');return;}
      const choose=Dom.element('select','native-function-select');choose.setAttribute('aria-label','Native CFG function');functions.forEach((fn,i)=>{const o=Dom.element('option','',fn.name);o.value=i;choose.append(o);});
      const host=Dom.element('div','native-cfg');this.content.append(choose,host);const graph=new GraphView(host,this.registry);
      const display=()=>{this.registry.clear();const fn=functions[Number(choose.value)];graph.render(fn.nodes,fn.edges,fn.entry);};choose.onchange=display;display();return;
    }
    if(artifact.format==='binary'){
      const bytes=Uint8Array.from(atob(artifact.content),c=>c.charCodeAt(0));const rows=[];
      for(let offset=0;offset<Math.min(bytes.length,65536);offset+=16)rows.push(offset.toString(16).padStart(8,'0')+'  '+Array.from(bytes.slice(offset,offset+16),n=>n.toString(16).padStart(2,'0')).join(' '));
      this.content.append(Dom.element('pre','native-hex',rows.join('\n')));if(bytes.length>65536)this.content.append(Dom.element('p','view-note','First 64 KiB shown; Download returns the complete captured object.'));return;
    }
    const mappings=new Map((artifact.mappings??[]).map(m=>[m.line,m.span]));const lines=artifact.content.split('\n'),fragment=document.createDocumentFragment();
    for(let i=0;i<Math.min(lines.length,12000);i++){
      const row=Dom.element('div','native-output-line');row.dataset.nativeLine=i+1;row.append(Dom.element('span','native-line-number',i+1),Dom.element('code','',lines[i]||' '));this.registry.bind(row,mappings.get(i+1));fragment.append(row);
    }this.content.append(fragment);if(lines.length>12000)this.content.append(Dom.element('p','view-note','First 12,000 lines rendered; download contains all captured text.'));
  }
  download(){const a=this.artifacts[this.selected];if(!a?.content)return;const data=a.format==='binary'?Uint8Array.from(atob(a.content),c=>c.charCodeAt(0)):a.content;
    const url=URL.createObjectURL(new Blob([data],{type:a.format==='binary'?'application/octet-stream':'text/plain'}));const link=Dom.element('a');link.href=url;link.download=a.truncated?a.name+'.partial.txt':a.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
}
