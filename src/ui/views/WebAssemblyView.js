import {Dom} from './Dom.js';

/** Binary disassembly map: emitted byte intervals, actual hex, exports and host ABI. */
export class WebAssemblyView {
  constructor(root,registry){this.root=root;this.registry=registry;}
  render(artifact){
    const {bytes,metadata}=artifact;
    const summary=Dom.element('section','inspection-card');
    summary.append(Dom.element('h3','','WebAssembly binary · '+bytes.length.toLocaleString()+' bytes'),
      Dom.element('p','card-detail',`${metadata.functions.length} compiled functions · ${metadata.imports.length} checked host imports · native br_table control flow`),
      Dom.element('p','view-note','Values use externref and the Ferrite checked host runtime. This is real WebAssembly, but not a freestanding WASI or native object module.'),
      Dom.element('code','wasm-magic',bytes.slice(0,8).map(v=>v.toString(16).padStart(2,'0')).join(' ')));
    this.root.append(summary);
    const exports=Dom.element('div','wasm-exports');
    for(const fn of metadata.functions){const row=Dom.element('button','inspection-card wasm-export',`${fn.name} (${fn.params} parameters) → ${fn.returnType}`);this.registry.bind(row,fn.span);exports.append(row);}this.root.append(exports);
    const table=Dom.element('table','data-table wasm-instructions'),head=Dom.element('tr');
    for(const label of ['Offset','MIR operation','Emitted bytes'])head.append(Dom.element('th','',label));table.append(head);
    for(const map of metadata.sourceMap.slice(0,4000)){
      const row=Dom.element('tr');row.dataset.wasmOffset=map.start;
      row.append(Dom.element('td','',`0x${map.start.toString(16)}`),Dom.element('td','',map.operation+(map.synthetic?' · generated':'')),
        Dom.element('td','wasm-hex',bytes.slice(map.start,map.end).map(v=>v.toString(16).padStart(2,'0')).join(' ')));
      this.registry.bind(row,map.span);table.append(row);
    }
    this.root.append(table);
    if(metadata.sourceMap.length>4000)this.root.append(Dom.element('p','view-note','First 4,000 byte mappings shown.'));
    const details=Dom.element('details','wasm-imports');details.append(Dom.element('summary','',`Host imports (${metadata.imports.length})`));
    for(const spec of metadata.imports)details.append(Dom.element('div','generated-line',`ferrite.${spec.importName} · ${spec.op}${spec.name?' '+spec.name:''} (${spec.params.join(', ')}) → ${spec.result??'void'}`));
    this.root.append(details);
  }
}
