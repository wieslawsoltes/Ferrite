import {Dom} from './Dom.js';
import {SpanRegistry} from './SpanRegistry.js';

/** Shared executable-MIR inspector for worker programs and retained UI callbacks. */
export class DebuggerView {
  constructor(root, selection, onCommand, {onSelect = null, ui = false} = {}) {
    this.root = root; this.selection = selection; this.onSelect = onSelect; this.ui = ui; this.frame = 0;
    this.registry = new SpanRegistry(selection, 'debugger'); this.controls = new Map();
    this.toolbar = Dom.element('div', 'debug-toolbar'); this.toolbar.setAttribute('role', 'toolbar'); this.toolbar.setAttribute('aria-label', 'Debugger controls');
    const labels = ui ? ['Continue','Instruction','Source line','Disarm'] : ['Resume','Step instruction','Step line','Stop debugging'];
    for (const [label, command, icon] of [['Arm events','arm','debug'],[labels[0],'continue','run'],['Pause','pause','pause'],[labels[1],'step','step'],[labels[2],'step-line','line'],['Step over','step-over','line'],['Step out','step-out','step'],['Back instruction','back','step'],['Back line','back-line','line'],['Restart event','restart','reset'],[labels[3],'stop','stop']]) {
      const button = Dom.button(label, () => onCommand(command), {icon}); button.dataset.debugCommand = command; this.controls.set(command, button); this.toolbar.append(button);
    }
    this.body = Dom.element('div', 'debug-body'); root.append(this.toolbar, this.body); this.render(null);
  }
  renderUI(debug, {live = true} = {}) { this.render(debug?.state ?? null, {debug: debug ?? {status: 'disarmed', armed: false}, live}); }
  render(state, {debug = null, live = true} = {}) {
    this.state = state; this.debug = debug; this.registry.clear(); this.body.replaceChildren();
    const isUI = !!debug || this.ui, running = debug?.status === 'running', armed = !!debug?.armed, history = state?.history?.available > 0;
    for (const [command, button] of this.controls) {
      button.hidden = !isUI && ['arm','restart'].includes(command);
      const enabled = command === 'arm' ? isUI && !armed : command === 'stop' ? isUI ? armed : !!state : command === 'pause' ? isUI ? armed && (running || !state) : !!state && !state.done : command === 'continue' ? isUI ? armed && !running && !debug.error : !!state && !state.done : ['back','back-line','restart'].includes(command) ? history && !running : !!state && !state.done && !running && !debug?.error;
      button.disabled = !live || !enabled;
    }
    const status = debug ? debug.status ?? (state ? 'paused' : 'waiting') : state?.done ? 'finished' : state ? 'paused' : 'idle';
    this.root.dataset.debugStatus = status;
    const summary = Dom.element('div', 'debug-summary', debug ? `${status} · ${debug.reason ?? ''}` : state ? `${state.done ? 'Finished' : 'Paused'} · ${state.steps.toLocaleString()} instructions` : 'No debug session');
    summary.setAttribute('role', 'status'); this.body.append(summary);
    if (debug?.error) this.body.append(Dom.element('pre', 'view-note error', `${debug.error.code}: ${debug.error.message}`));
    if (!state) this.body.append(Dom.element('p', 'view-note', !live ? 'Preview is stale. Debug recompiles the current source.' : isUI ? armed ? 'Interact with the preview. Breakpoints and Pause apply to Rust event and timer callbacks.' : 'Start Debug or Arm events to inspect Rust UI callbacks.' : 'Start Debug to inspect executable MIR call frames and registers.'));
    else {
      if (debug) this.body.append(Dom.element('p', 'view-note', `${debug.event ?? 'event'} · ${state.steps.toLocaleString()} instructions · ${debug.queued ?? 0} queued · ${Dom.sourceLabel(state.next ?? state.last?.span)}`));
      const split = Dom.element('div', 'debug-split'), frames = Dom.element('div', 'stack-frames'), locals = Dom.element('div', 'stack-locals');
      frames.setAttribute('aria-label','Call stack'); locals.setAttribute('aria-label','Locals and registers'); split.append(frames,locals); this.body.append(split);
      const displayed = [...state.frames].reverse(); this.frame = Math.min(this.frame, Math.max(0, displayed.length - 1));
      displayed.forEach((frame, index) => {
        const button = Dom.button(`${frame.function} / ${frame.block}`, () => { this.frame = index; this.render(state, {debug, live}); this.navigate(frame.span); }, {icon:'code',className:'stack-frame'});
        button.classList.toggle('active', index === this.frame); frames.append(button);
      });
      const frame = displayed[this.frame];
      if (frame) {
        const filter = Dom.element('input', 'text-field'); filter.placeholder = 'Filter locals / registers'; filter.setAttribute('aria-label','Filter debugger locals');
        const table = Dom.element('table','data-table');
        const renderLocals = () => { table.replaceChildren(); const query = filter.value.toLowerCase();
          for (const local of frame.locals) {
            if (query && !`${local.name} ${local.slot} ${local.type}`.toLowerCase().includes(query)) continue;
            const row = Dom.element('tr'); row.append(Dom.element('td','',`${local.name} · %${local.slot}`),Dom.element('td','',local.type),Dom.element('td','',local.value));
            if (this.onSelect) { row.tabIndex = 0; row.onclick = () => this.navigate(local.span); row.onkeydown = e => { if (e.key === 'Enter') this.navigate(local.span); }; }
            else this.registry.bind(row,local.span); table.append(row);
          }
        }; filter.oninput = renderLocals; renderLocals(); locals.append(filter, table);
      } else locals.append(Dom.element('p','view-note',`Result: ${state.result ?? 'unit'}`));
      if (state.history) this.body.append(Dom.element('p','view-note',`Reverse history: ${state.history.available} instructions · boundary: ${state.history.boundary}`));
    }
    if (debug) {
      if (debug.stagedStates?.length) this.details('Staged state (not yet committed)', debug.stagedStates, true);
      this.details(`Breakpoints (${debug.breakpoints?.length ?? 0})`, debug.breakpointBindings ?? debug.breakpoints ?? []);
      this.details('MIR trace', debug.trace ?? []);
      const boundary = Dom.element('details'); boundary.append(Dom.element('summary','','Debugger scope and reverse-execution boundaries'),Dom.element('p','view-note',debug.boundary ?? 'Rendering and external browser effects are synchronous.')); this.body.append(boundary);
    }
  }
  details(title, value, open = false) { const details = Dom.element('details'); details.open = open; details.append(Dom.element('summary','',title),Dom.element('pre','studio-debug',JSON.stringify(value,null,2).slice(0,100000))); this.body.append(details); }
  navigate(span) { if (span) this.onSelect ? this.onSelect(span) : this.selection.select(span, 'debugger'); }
  dispose() { this.registry.unsubscribe(); this.registry.clear(); }
}
