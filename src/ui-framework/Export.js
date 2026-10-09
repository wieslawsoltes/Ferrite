import {createUIRuntime} from './Runtime.js';
import {Runtime} from '../runtime/Runtime.js';
import {MirVirtualMachine} from '../runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../runtime/WebAssemblyRuntime.js';
import {UISession} from './UISession.js';

export function scriptJSON(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
const htmlText = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

/** No CDN, fetch, module imports or external runtime assets in the result. */
export function exportHTML(artifact, {backend = 'javascript', title = 'Ferrite Rust UI', css = '', channel = null} = {}) {
  if (artifact?.format !== 'ferrite-ui-v1' || !['javascript', 'wasm', 'mir'].includes(backend)) throw Error('Invalid UI export');
  if (typeof title !== 'string' || title.length > 1000 || typeof css !== 'string' || css.length > 500000) throw Error('UI export text exceeds its limit');
  if (channel !== null && !/^[a-f0-9]{32,128}$/.test(channel)) throw Error('Invalid preview channel');
  const compact = {format: artifact.format, abi: artifact.abi, entry: artifact.entry, maxSteps: artifact.maxSteps, file: artifact.file, source: artifact.source,
    optimizedMir: artifact.optimizedMir, ...(backend === 'javascript' ? {js: artifact.js} : {}), ...(backend === 'wasm' ? {wasm: {bytes: artifact.wasm.bytes}} : {})};
  const bootstrap = `
'use strict';
const createUIRuntime = ${createUIRuntime.toString()};
const UI = createUIRuntime();
const Runtime = ${Runtime.toString()};
const MirVirtualMachine = ${MirVirtualMachine.toString()};
const WebAssemblyRuntime = ${WebAssemblyRuntime.toString()};
const UISession = ${UISession.toString()};
const artifact = ${scriptJSON(compact)};
const style = document.createElement('style'); style.textContent = ${scriptJSON(css)}; document.head.append(style);
const channel = ${scriptJSON(channel)};
let picking = false, scheduled = false;
function send(value) { if (channel) parent.postMessage({type:'ferrite-ui', channel, ...value}, '*'); }
function showError(error) { let node=document.getElementById('ferrite-error'); if(!node){node=document.createElement('pre');node.id='ferrite-error';document.body.append(node);}node.textContent=error.message??String(error);send({event:'error',error:{message:node.textContent,code:error.code,span:error.span}}); }
const session = new UISession(artifact, {backend:${scriptJSON(backend)}, runtime:UI, onError:showError});
session.subscribe(event => {
  if(event.type==='callback'||event.type==='commit'){
    if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;send({event:'snapshot',snapshot:session.inspect()});});}
  } else send({event:event.type,detail:event});
});
if(channel){
  document.addEventListener('click',event=>{if(!picking)return;const node=event.target.closest?.('[data-ferrite-source]');if(node){event.preventDefault();event.stopImmediatePropagation();send({event:'select',id:node.getAttribute('data-ferrite-source')});}},true);
  window.addEventListener('message',event=>{
    const message=event.data;
    if(event.source!==parent||!message||message.type!=='ferrite-ui-command'||message.channel!==channel||typeof message.id!=='string'||message.id.length>100)return;
    try{
      let result;
      if(message.command==='inspect')result=session.inspect();
      else if(message.command==='pick'){picking=!!message.value;result={picking};}
      else if(message.command==='debug.arm')result=session.armDebugger({breakpoints:message.breakpoints??[]});
      else if(['debug.step','debug.step-line','debug.continue','debug.stop'].includes(message.command))result=session.debug(message.command.slice(6));
      else if(message.command==='state.set')result=session.setState(message.handle,message.value);
      else throw Error('Unknown preview command');
      send({reply:message.id,result});
    }catch(error){send({reply:message.id,error:{message:error.message,code:error.code,span:error.span}});}
  });
}
Object.defineProperty(window,'ferriteUI',{value:Object.freeze({version:'0.1.0',inspect:()=>session.inspect(),armDebugger:options=>session.armDebugger(options),debug:command=>session.debug(command),setState:(handle,value)=>session.setState(handle,value),dispose:()=>session.dispose()}),configurable:false});
try{session.mount(document.getElementById('app'));send({event:'ready',snapshot:session.inspect()});}catch(error){showError(error);}
window.addEventListener('pagehide',()=>session.dispose(),{once:true});
`;
  // Input data is encoded with scriptJSON; implementation source contains no HTML
  // terminator. Check rather than applying replacements that could alter JS syntax.
  if (/<\/script/i.test(bootstrap)) throw Error('Unexpected script terminator in export implementation');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${htmlText(title)}</title><style>body{margin:0;font:14px system-ui,sans-serif;color:#20242a}#ferrite-error{white-space:pre-wrap;padding:12px;color:#b42318}button,input,select,textarea{font:inherit}*{box-sizing:border-box}</style></head><body><main id="app"></main><script>${bootstrap}</script></body></html>`;
}
