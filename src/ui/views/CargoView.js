import {NativeCargoMetadata} from '../../cargo/NativeCargoMetadata.js';
import {Dom} from './Dom.js';
import {cargoPlan} from '../../cargo.js';
/** Local planning and real Cargo are separate, explicitly labeled backends. */
export class CargoView {
  constructor(root,model,client,{onCommand,onOptions,onConnected}){
    this.root=root;this.model=model;this.client=client;this.onCommand=onCommand;this.onOptions=onOptions;this.onConnected=onConnected;this.options={};
    this.header=Dom.element('div','cargo-connection');this.header.append(Dom.element('strong','','Native toolchain'),Dom.element('p','view-note','Optional: run installed Cargo with your local permissions. Browser compilation remains independent.'));
    this.connectButton=Dom.button('Connect native Cargo',()=>this.connect(),{icon:'connect',className:'wide-button'});this.header.append(this.connectButton);
    this.planRoot=Dom.element('div','cargo-plan');this.root.append(this.header,this.planRoot);
  }
  render(){this.connectButton.querySelector('span').textContent=this.client.capabilities?'Native Cargo connected':'Connect native Cargo';this.planRoot.replaceChildren();let plan;
    try{plan=this.repository?NativeCargoMetadata.plan(this.repository,this.options):cargoPlan(this.model.files,'check',this.options);}catch(error){plan={packages:[],features:{},buildOrder:[],graph:[],warnings:[error.message],errors:[]};}
    this.currentPackage=plan.packages.find(p=>p.id===plan.selected)?.name;this.currentTarget=plan.target;
    const group=Dom.element('div','cargo-target-options');const packages=Dom.element('select');packages.id='cargo-package';packages.setAttribute('aria-label','Cargo package');for(const pkg of plan.packages){const option=Dom.element('option','',pkg.name);option.value=pkg.name;packages.append(option);}packages.value=plan.packages.find(p=>p.id===plan.selected)?.name??'';
    const targets=Dom.element('select');targets.id='cargo-target';targets.setAttribute('aria-label','Cargo target');for(const target of plan.packages.find(p=>p.id===plan.selected)?.targets??[]){const option=Dom.element('option','',`${target.name} · ${target.kind}`);option.value=plan.native?`${target.kind}:${target.name}`:target.name;targets.append(option);}targets.value=plan.target?(plan.native?`${plan.target.kind}:${plan.target.name}`:plan.target.name):'';
    packages.onchange=()=>{this.options={...this.options,package:packages.value,target:undefined,targetKind:undefined};this.onOptions(this.options);this.render();};targets.onchange=()=>{const selected=plan.packages.find(p=>p.id===plan.selected)?.targets.find(t=>(plan.native?`${t.kind}:${t.name}`:t.name)===targets.value);this.options={...this.options,target:selected?.name,targetKind:selected?.kind};this.onOptions(this.options);};group.append(Dom.element('label','field-label','Package'),packages,Dom.element('label','field-label','Target'),targets);this.planRoot.append(group);this.features(plan);this.buildOptions();
    const commands=Dom.element('div','cargo-command-list');for(const command of ['check','build','run','test','inspect','metadata','tree','fetch','clippy','fmt','doc','clean']){
      const native=!['check','build','run','test'].includes(command);const button=Dom.button(command==='inspect'?'Inspect MIR / LLVM / assembly':`cargo ${command}`,()=>this.onCommand(command),{icon:command==='run'?'run':command==='test'?'test':'cargo',className:'cargo-command'});if(native&&!this.client.capabilities){button.disabled=true;button.title='Connect Native Cargo for this command';}commands.append(button);
    }this.planRoot.append(commands);
    this.planRoot.append(Dom.element('h3','section-heading',plan.native?'Workspace packages (Cargo schedules the graph)':'Dependency order'));for(const pkg of plan.buildOrder)this.planRoot.append(Dom.element('div','cargo-package-node',pkg));
    for(const edge of plan.graph){const row=Dom.element('div','cargo-dependency');row.append(Dom.element('strong','',edge.alias),Dom.element('small','',edge.to));this.planRoot.append(row);}for(const reason of [...plan.warnings,...plan.errors.map(e=>e.message)])this.planRoot.append(Dom.element('p','warning-note',reason));
    if(this.client.capabilities)this.planRoot.append(Dom.button('Disconnect',()=>{this.client.disconnect();this.onConnected(false);this.render();},{icon:'close',className:'wide-button'}));
  }
  buildOptions(){
    const panel=Dom.element('fieldset','cargo-features');panel.append(Dom.element('legend','','Build configuration'));
    const change=()=>{this.onOptions(this.options);};
    const field=(name,label,placeholder)=>{const wrap=Dom.element('label','field-label',label),input=Dom.element('input','text-field');input.setAttribute('aria-label',label);input.placeholder=placeholder;input.value=this.options[name]??'';input.onchange=()=>{this.options={...this.options,[name]:input.value};change();};wrap.append(input);panel.append(wrap);return input;};
    const workers=field('parseWorkers','Browser parser workers','Auto (up to 4)');workers.type='number';workers.min='1';workers.max='8';
    const jobs=field('jobs','Native parallel Cargo jobs','Auto (bridge CPU budget)');jobs.type='number';jobs.min='1';jobs.max=String(this.client.capabilities?.repositories?.maxJobs??256);
    const limit=field('timeoutSeconds','Native command timeout (seconds)','120');limit.type='number';limit.min='1';limit.max='600';
    field('profile','Cargo profile','Default development profile');field('toolchain','Rust toolchain','Repository toolchain');field('targetTriple','Target architecture','Host');
    const argv=field('programArgs','Program / test arguments (JSON array)','[]');argv.value=JSON.stringify(this.options.programArgs??[]);argv.onchange=()=>{try{const value=JSON.parse(argv.value||'[]');if(!Array.isArray(value)||value.some(x=>typeof x!=='string'))throw Error('Expected a JSON string array');this.options={...this.options,programArgs:value};argv.setCustomValidity('');change();}catch(error){argv.setCustomValidity(error.message);argv.reportValidity();}};
    for(const [name,label] of [['workspace','All workspace members (build/check/test)'],['allTargets','All targets'],['keepGoing','Keep building independent crates after errors'],['timings','Generate Cargo timing report'],['offline','Offline'],['locked','Require unchanged Cargo.lock']]){
      const wrap=Dom.element('label','feature-toggle'),input=Dom.element('input');input.type='checkbox';input.checked=!!this.options[name];input.onchange=()=>{this.options={...this.options,[name]:input.checked};change();};wrap.append(input,document.createTextNode(label));panel.append(wrap);
    }
    panel.append(Dom.element('p','view-note','Jobs change scheduling only, not checks or optimization quality. Browser parsing is parallel; semantic checking and final verification remain ordered.'));this.planRoot.append(panel);
  }
  features(plan){
    const state=plan.features?.[plan.selected];if(!state)return;
    const panel=Dom.element('fieldset','cargo-features');panel.append(Dom.element('legend','','Feature configuration'));
    const toggle=(title,checked,action,id)=>{
      const label=Dom.element('label','feature-toggle'),input=Dom.element('input');input.type='checkbox';input.checked=checked;if(id)input.id=id;
      input.onchange=()=>{action(input.checked);this.onOptions(this.options);this.render();};label.append(input,document.createTextNode(title));panel.append(label);return input;
    };
    toggle('Default features',this.options.defaultFeatures!==false,checked=>this.options={...this.options,defaultFeatures:checked},'cargo-default-features');
    toggle('Analyze native build scripts / procedural macros',!!this.options.expandNativeMacros,checked=>this.options={...this.options,expandNativeMacros:checked},'native-macro-analysis');
    toggle('All features',!!this.options.allFeatures,checked=>this.options={...this.options,allFeatures:checked},'cargo-all-features');
    for(const name of state.available??[]){
      if(name==='default')continue;
      const input=toggle(name,(this.options.features??[]).includes(name),checked=>{
        const requested=new Set(this.options.features??[]);checked?requested.add(name):requested.delete(name);
        this.options={...this.options,features:[...requested].sort()};
      });input.dataset.feature=name;input.disabled=!!this.options.allFeatures;
    }
    panel.append(Dom.element('p','view-note',plan.native?'Native Cargo resolves transitive features during builds.':`Resolved: ${state.enabled.join(', ')||'(none)'}`));this.planRoot.append(panel);
  }
  connect(){
    const dialog=Dom.element('dialog','native-dialog'),form=Dom.element('form');form.method='dialog';form.append(Dom.element('h2','','Connect installed Cargo'),Dom.element('p','dialog-copy','Native Cargo executes build scripts, dependencies, macros and programs as your local user. Only connect for projects you trust. The bearer token stays in memory and is never exported.'));
    form.append(Dom.element('code','bridge-command',`node tools/cargo-bridge.mjs --trust-projects --origin ${location.origin} --port 8787`));
    const address=Dom.element('input','text-field');address.value='http://127.0.0.1:8787';address.name='address';address.setAttribute('aria-label','Cargo bridge address');const token=Dom.element('input','text-field');token.type='password';token.autocomplete='off';token.name='token';token.placeholder='Paste token printed by the local bridge';token.setAttribute('aria-label','Cargo bridge bearer token');
    const trust=Dom.element('label','trust-label'),checkbox=Dom.element('input');checkbox.type='checkbox';trust.append(checkbox,document.createTextNode('I trust this project and authorize native code execution.'));
    const error=Dom.element('p','warning-note'),actions=Dom.element('div','dialog-actions'),connect=Dom.button('Connect',null,{className:'primary-button'});connect.type='submit';connect.disabled=true;checkbox.onchange=()=>connect.disabled=!checkbox.checked;actions.append(Dom.button('Cancel',()=>dialog.close()),connect);form.append(Dom.element('label','field-label','Loopback address'),address,Dom.element('label','field-label','Bearer token'),token,trust,error,actions);dialog.append(form);document.body.append(dialog);
    form.onsubmit=async e=>{e.preventDefault();if(!checkbox.checked)return;connect.disabled=true;try{await this.client.connect(address.value,token.value);token.value='';dialog.close();this.onConnected(true);this.render();}catch(problem){error.textContent=problem.message;connect.disabled=false;}};dialog.addEventListener('close',()=>{token.value='';dialog.remove();},{once:true});dialog.showModal();token.focus();
  }
}
