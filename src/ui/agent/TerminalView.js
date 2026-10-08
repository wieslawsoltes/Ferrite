import {Dom} from '../views/Dom.js';
import {VtScreen} from '../../agent/terminal/VtScreen.js';
import {VirtualShell} from '../../agent/terminal/VirtualShell.js';

/** Native PTY and explicitly labelled browser-shell tabs in the same safe terminal renderer. */
export class TerminalView {
  static palette = ['#202124','#d75f5f','#86b971','#d7ba7d','#82aaff','#b68ae6','#70c0c4','#d4d4d4','#737880','#ff7b72','#aff5b4','#ffe49c','#a5c8ff','#e2b5ff','#b3f0f0','#ffffff'];
  constructor(root, client, model, {onError = () => {}, onConnect = () => {}} = {}) {
    this.root=root;this.client=client;this.model=model;this.onError=onError;this.onConnect=onConnect;this.sessions=new Map();this.active='browser';this.polling=false;this.disposed=false;this.frame=null;
    root.classList.add('terminal-workbench');const controls=Dom.element('div','terminal-controls');
    this.tabs=Dom.element('select');this.tabs.setAttribute('aria-label','Terminal session');this.tabs.id='agent-terminal-tabs';this.tabs.onchange=()=>{this.active=this.tabs.value;this.draw();};
    this.launch=Dom.element('select');this.launch.setAttribute('aria-label','Native terminal program');
    for(const [id,title] of [['shell','Native shell'],['codex','Codex CLI'],['claude','Claude Code CLI'],['gemini','Gemini CLI'],['codex-login','Codex sign in'],['claude-login','Claude sign in']]){const option=Dom.element('option','',title);option.value=id;this.launch.append(option);}
    controls.append(this.tabs,this.launch,Dom.button('New native',()=>this.openNative().catch(onError)),Dom.button('Connect',onConnect),Dom.button('Interrupt',()=>this.send('\x03')),Dom.button('Close',()=>this.closeActive()),Dom.button('Clear',()=>{this.current().screen.reset();this.draw();}));
    this.status=Dom.element('div','terminal-status','Browser shell · bounded utilities · no native Cargo');
    this.viewport=Dom.element('div','terminal-viewport');this.viewport.tabIndex=0;this.viewport.setAttribute('role','textbox');this.viewport.setAttribute('aria-label','Terminal emulator');this.viewport.setAttribute('aria-multiline','true');
    this.content=Dom.element('div','terminal-screen');this.ime=Dom.element('textarea','terminal-ime');this.ime.setAttribute('aria-label','Native terminal input');this.ime.autocomplete='off';this.ime.spellcheck=false;this.ime.setAttribute('autocapitalize','off');this.viewport.append(this.content,this.ime);this.viewport.addEventListener('click',()=>{if(this.active!=='browser'&&!window.getSelection()?.toString())this.ime.focus({preventScroll:true});});
    this.form=Dom.element('form','terminal-command');this.input=Dom.element('input');this.input.id='browser-terminal-input';this.input.placeholder='Browser shell: help';this.input.autocomplete='off';this.input.spellcheck=false;this.input.setAttribute('aria-label','Browser shell command');this.form.append(Dom.element('span','','❯'),this.input);this.form.onsubmit=event=>{event.preventDefault();this.browserCommand();};
    root.append(controls,this.status,this.viewport,this.form);this.shell=new VirtualShell(model);
    this.sessions.set('browser',{id:'browser',title:'Browser shell',screen:new VtScreen(100,24),cursor:0,closed:false});this.current().screen.write('Ferrite browser workspace shell\r\nType help for supported utilities. Native tools require a trusted bridge.\r\n');this.updateTabs();
    this.historyIndex=0;this.input.onkeydown=event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();this.historyIndex=Math.max(0,Math.min(this.shell.history.length,this.historyIndex+(event.key==='ArrowUp'?-1:1)));this.input.value=this.shell.history[this.historyIndex]??'';}};
    this.viewport.addEventListener('keydown',event=>{if(this.active==='browser'){this.input.focus();return;}if(event.isComposing)return;const data=VtScreen.key(event,this.current().screen.applicationCursor);if(data!==null){event.preventDefault();event.stopPropagation();this.send(data);}});
    this.viewport.addEventListener('paste',event=>{if(this.active==='browser')return;const text=event.clipboardData?.getData('text/plain');if(text!==undefined){event.preventDefault();event.stopPropagation();const screen=this.current().screen;this.send(screen.bracketedPaste?'\x1b[200~'+text+'\x1b[201~':text);}});
    this.ime.addEventListener('compositionstart',()=>{this.composing=true;});this.ime.addEventListener('compositionend',()=>{this.composing=false;queueMicrotask(()=>{if(this.ime.value){this.send(this.ime.value);this.ime.value='';}});});this.ime.addEventListener('input',()=>{if(!this.composing&&this.ime.value){this.send(this.ime.value);this.ime.value='';}});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.viewport);this.draw();this.timer=setInterval(()=>this.poll().catch(onError),180);
  }
  current(){return this.sessions.get(this.active)??this.sessions.get('browser');}
  updateTabs(){const value=this.active;this.tabs.replaceChildren();for(const session of this.sessions.values()){const option=Dom.element('option','',session.title+(session.closed?' · exited '+session.exitCode:''));option.value=session.id;this.tabs.append(option);}this.tabs.value=value;}
  async browserCommand(){const command=this.input.value;if(!command.trim())return;this.input.value='';const session=this.sessions.get('browser');session.screen.write(`\r\n/${this.shell.cwd} ❯ ${command}\r\n`);const result=await this.shell.execute(command);if(result.clear)session.screen.reset();session.screen.write(result.text.replace(/\r?\n/g,'\r\n'));this.historyIndex=this.shell.history.length;this.draw();}
  async openNative(kind=this.launch.value){
    if(!this.client.url){this.onConnect();return;}
    const programs={shell:{executable:'/bin/sh',args:['-i']},codex:{executable:'codex',args:[]},claude:{executable:'claude',args:[]},gemini:{executable:'gemini',args:[]},'codex-login':{executable:'codex',args:['login']},'claude-login':{executable:'claude',args:['auth','login']}};
    const size=this.dimensions(),result=await this.client.request('/v1/terminals/open',{...programs[kind],...size});
    this.attach(result);this.active=result.id;this.updateTabs();this.draw();this.ime.focus();
  }
  attach(metadata){if(this.sessions.has(metadata.id))return;const session={...metadata,title:metadata.executable.split('/').at(-1)+' · '+metadata.id.slice(0,5),cursor:0};session.screen=new VtScreen(metadata.cols,metadata.rows,{onReply:text=>{if(this.client.url&&!session.closed)this.client.request(`/v1/terminals/${session.id}/input`,{text}).catch(this.onError);}});this.sessions.set(session.id,session);this.updateTabs();}
  async reconnect(){for(const metadata of await this.client.request('/v1/terminals'))this.attach(metadata);}
  async poll(){
    if(this.polling||!this.client.url||this.disposed)return;this.polling=true;
    try{const session=this.current();if(session.id==='browser'||session.closed)return;const result=await this.client.request(`/v1/terminals/${session.id}?cursor=${session.cursor}`,undefined,{timeoutMs:5000});
      if(result.gap){session.screen.reset();session.screen.write('[Terminal scrollback gap: older output was evicted]\r\n');}
      for(const event of result.events)if(event.type==='data')session.screen.write(event.text);
      session.cursor=result.cursor;session.closed=result.closed;session.exitCode=result.exitCode;if(result.closed)this.updateTabs();if(result.events.length)this.draw();
    }finally{this.polling=false;}
  }
  async send(text){if(this.active==='browser'){this.input.focus();return;}try{if(new TextEncoder().encode(text).length>65536)throw Error('Paste exceeds 64 KiB; split it into smaller chunks');await this.client.request(`/v1/terminals/${this.active}/input`,{text});}catch(error){this.onError(error);}}
  async closeActive(){if(this.active==='browser')return;try{await this.client.request(`/v1/terminals/${this.active}/close`,{});this.sessions.delete(this.active);this.active='browser';this.updateTabs();this.draw();}catch(error){this.onError(error);}}
  dimensions(){const rect=this.viewport.getBoundingClientRect();return {cols:Math.max(2,Math.min(500,Math.floor((rect.width-24)/7.8)||100)),rows:Math.max(2,Math.min(200,Math.floor((rect.height-16)/18)||24))};}
  resize(){if(!this.viewport.getClientRects().length)return;const {cols,rows}=this.dimensions(),session=this.current();if(session.screen.cols===cols&&session.screen.rows===rows)return;session.screen.resize(cols,rows);if(session.id!=='browser'&&!session.closed&&this.client.url)this.client.request(`/v1/terminals/${session.id}/resize`,{cols,rows}).catch(this.onError);this.draw();}
  static color(value){if(value===null)return null;if(Array.isArray(value))return `rgb(${value.join(',')})`;if(value<16)return TerminalView.palette[value];if(value>=232){const gray=8+(value-232)*10;return `rgb(${gray},${gray},${gray})`;}const n=value-16,level=x=>x?55+x*40:0;return `rgb(${level(Math.floor(n/36))},${level(Math.floor(n/6)%6)},${level(n%6)})`;}
  draw(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.render();});}
  render(){
    const session=this.current(),screen=session.screen,nearBottom=this.viewport.scrollTop+this.viewport.clientHeight>=this.viewport.scrollHeight-40;this.form.hidden=session.id!=='browser';this.status.textContent=session.id==='browser'?`Browser shell · /${this.shell.cwd} · bounded utilities, no native processes`:`Native PTY · ${screen.cols}×${screen.rows} · ${session.closed?'exited '+session.exitCode:'host permissions · not sandboxed'}`;
    const fragment=document.createDocumentFragment(),history=screen.alt?[]:screen.history.slice(-300),lines=[...history,...screen.lines];
    for(let y=0;y<lines.length;y++){
      const row=Dom.element('div','terminal-row');let run=null,lastStyle='';
      for(let x=0;x<lines[y].length;x++){
        const cell=lines[y][x];if(cell.width===0)continue;const cursor=y===history.length+screen.y&&x===screen.x&&screen.cursorVisible&&session.id!=='browser';
        const fg=TerminalView.color(cell.inverse?cell.bg:cell.fg),bg=TerminalView.color(cell.inverse?cell.fg:cell.bg),key=JSON.stringify([fg,bg,cell.bold,cell.faint,cell.italic,cell.underline,cell.strike,cursor]);
        if(key!==lastStyle||!run){run=Dom.element('span',cursor?'terminal-cursor':'');if(fg)run.style.color=fg;if(bg)run.style.backgroundColor=bg;if(cell.inverse&&!bg)run.style.backgroundColor='var(--fg)';if(cell.inverse&&!fg)run.style.color='var(--bg)';if(cell.bold)run.style.fontWeight='700';if(cell.faint)run.style.opacity='.6';if(cell.italic)run.style.fontStyle='italic';run.style.textDecoration=[cell.underline?'underline':'',cell.strike?'line-through':''].filter(Boolean).join(' ');row.append(run);lastStyle=key;}
        run.append(document.createTextNode(cell.text));
      }fragment.append(row);
    }
    this.content.replaceChildren(fragment);if(nearBottom)this.viewport.scrollTop=this.viewport.scrollHeight;
  }
  dispose(){this.disposed=true;clearInterval(this.timer);this.observer.disconnect();if(this.frame)cancelAnimationFrame(this.frame);}
}
