import {SelectionModel} from '../model/SelectionModel.js';
import {Dom} from './Dom.js';
/** Indexed visible source-linked elements; no whole-document queries on cursor movement. */
export class SpanRegistry {
  constructor(selection,origin){this.selection=selection;this.origin=origin;this.items=[];this.selected=[];this.unsubscribe=selection.subscribe(e=>this.highlight(e.span));}
  clear(){this.items=[];this.selected=[];}
  bind(element,span){if(!span||!Number.isInteger(span.start))return;element.dataset.sourceFile=span.file;element.dataset.sourceStart=String(span.start);element.dataset.sourceEnd=String(span.end);element.title=Dom.sourceLabel(span);element.classList.add('source-link');
    const navigate=e=>{e.stopPropagation();this.selection.select(span,this.origin);};element.addEventListener('click',navigate);if(element.tagName!=='BUTTON'){element.tabIndex=0;element.setAttribute('role','button');element.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();navigate(e);}});}this.items.push({element,span});
  }
  highlight(span){for(const element of this.selected)element.classList.remove('source-selected');this.selected=[];if(!span)return;
    const matches=this.items.filter(item=>SelectionModel.overlaps(span,item.span));if(!matches.length)return;
    const minimum=Math.min(...matches.map(item=>item.span.end-item.span.start));
    for(const item of matches)if(item.span.end-item.span.start===minimum){item.element.classList.add('source-selected');this.selected.push(item.element);}
  }
}
