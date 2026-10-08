import {Dom} from './Dom.js';
import {SpanRegistry} from './SpanRegistry.js';
export class DiagnosticsView {
  constructor(root,selection){this.root=root;this.registry=new SpanRegistry(selection,'diagnostics');}
  render(diagnostics){this.registry.clear();this.root.replaceChildren();if(!diagnostics.length){Dom.empty(this.root,'No problems found in the supported language subset.');return;}for(const diagnostic of diagnostics){const row=Dom.element('section','problem-item');row.dataset.code=diagnostic.code??'';row.dataset.level=diagnostic.level??'error';row.append(Dom.icon('warning'));const body=Dom.element('div');const heading=Dom.element('strong','',`${diagnostic.code??'Error'} · ${diagnostic.message}`);this.registry.bind(heading,diagnostic.span);body.append(heading,Dom.element('small','',Dom.sourceLabel(diagnostic.span)));for(const note of diagnostic.notes??[])body.append(Dom.element('p','',typeof note==='string'?note:note.message??''));row.append(body);this.root.append(row);}}
}
