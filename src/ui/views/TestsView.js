import {Dom} from './Dom.js';
import {SpanRegistry} from './SpanRegistry.js';
export class TestsView {
  constructor(root,selection){this.root=root;this.registry=new SpanRegistry(selection,'tests');this.results=[];}
  reset(){this.results=[];this.render();}
  append(result){this.results.push(result);this.render();}
  render(){this.registry.clear();this.root.replaceChildren();if(!this.results.length){Dom.empty(this.root,'Test discovers supported #[test] functions, including #[ignore] and #[should_panic]. Use Native Cargo for the full test harness.');return;}
    for(const result of this.results){const row=Dom.element('div','test-result '+result.status);row.append(Dom.icon(result.status==='failed'?'warning':'check'));const title=Dom.element('strong','',result.name);this.registry.bind(title,result.span);row.append(title,Dom.element('span','',result.status));if(result.message)row.append(Dom.element('code','',result.message));this.root.append(row);}
  }
}
