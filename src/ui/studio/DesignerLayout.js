import {PanelLayout} from '../docking/PanelLayout.js';
const group = (id, ...tabs) => ({type:'group',id,tabs,active:tabs[0]});
const split = (id, axis, ratio, first, second) => ({type:'split',id,axis,ratio,first,second});
export const DESIGNER_PANELS = ['structure','toolbox','canvas','properties','styles','debug','settings'];
export function designerLayout(preset = 'design') {
  const tools = split('navigation','y',.58,group('structure-group','structure'),group('toolbox-group','toolbox'));
  const inspector = group('inspector-group','properties','styles','debug','settings');
  const canvas = group('canvas-group','canvas');
  let root = split('columns','x',.19,tools,split('content','x',.7,canvas,inspector));
  let hidden = ['settings'];
  if (preset === 'canvas') hidden = ['structure','toolbox','styles','debug','settings'];
  else if (preset === 'debug') {
    inspector.tabs = ['properties','styles','settings'];
    root = split('columns','x',.19,tools,split('content','x',.7,split('debug-split','y',.7,canvas,group('debug-group','debug')),inspector));
    hidden = ['settings','toolbox'];
  }
  return {version:1,root,floating:[],hidden,homes:{}};
}

/** Normalize persisted layouts without allowing arbitrary panel identities or aliased state. */
export function restoreDesignerLayout(saved) {
  if (Array.isArray(saved?.hidden) && saved.hidden.length > 64) saved = null;
  return new PanelLayout(DESIGNER_PANELS, designerLayout(), saved).snapshot();
}
