/** Pointer transactions inside the opaque preview. Only the parent may commit source. */
export class CanvasController {
  constructor(document, send) {
    this.document = document; this.send = send; this.mode = 'off'; this.drag = null; this.grid = 8; this.snap = true;
    this.listeners = {pointerdown: event => this.begin(event), pointermove: event => this.move(event), pointerup: event => this.end(event), pointercancel: () => this.cancel(),
      keydown: event => { if (event.key === 'Escape') { this.cancel(); event.preventDefault(); } }, click: event => { if (this.mode !== 'off') { event.preventDefault(); event.stopImmediatePropagation(); } }};
    for (const [name, handler] of Object.entries(this.listeners)) document.addEventListener(name, handler, true);
  }
  configure({mode = 'off', grid = 8, snap = true} = {}) {
    if (!['off', 'move', 'resize'].includes(mode) || !Number.isFinite(grid) || grid < 1 || grid > 256 || typeof snap !== 'boolean') throw Error('Invalid canvas editing mode');
    this.cancel(); this.mode = mode; this.grid = grid; this.snap = snap;
    this.document.documentElement.style.cursor = mode === 'move' ? 'move' : mode === 'resize' ? 'nwse-resize' : '';
    return {mode, grid, snap};
  }
  begin(event) {
    if (this.mode === 'off' || event.button !== 0 || this.drag) return;
    const node = event.target.closest?.('[data-ferrite-source]'); if (!node || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const view = this.document.defaultView;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      const style = view.getComputedStyle(ancestor);
      if (style.transform !== 'none' || style.rotate && style.rotate !== 'none' || style.scale && style.scale !== 'none' || style.translate && style.translate !== 'none' || !['1', 'normal'].includes(style.zoom) || style.writingMode !== 'horizontal-tb') {
        this.send({event: 'error', error: {message: 'Canvas drag requires untransformed horizontal CSS coordinates; edit transformed layouts in source.'}}); return;
      }
    }
    const parent = node.offsetParent ?? this.document.documentElement, r = node.getBoundingClientRect(), p = parent.getBoundingClientRect();
    const rectangle = {x: r.left - p.left - parent.clientLeft + parent.scrollLeft, y: r.top - p.top - parent.clientTop + parent.scrollTop, width: r.width, height: r.height};
    this.drag = {node, id: node.getAttribute('data-ferrite-source'), pointer: event.pointerId, startX: event.clientX, startY: event.clientY, rectangle, next: rectangle, original: node.getAttribute('style'), mode: this.mode};
    node.setPointerCapture?.(event.pointerId); this.send({event: 'select', id: this.drag.id});
  }
  move(event) {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    let dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (event.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
    const snap = n => this.snap && !event.altKey ? Math.round(n / this.grid) * this.grid : n;
    const r = drag.rectangle, next = drag.mode === 'move' ? {...r, x: snap(r.x + dx), y: snap(r.y + dy)} : {...r, width: Math.max(1, snap(r.width + dx)), height: Math.max(1, snap(r.height + dy))};
    if (Object.values(next).some(n => !Number.isFinite(n) || Math.abs(n) > 1000000)) return;
    drag.next = next;
    Object.assign(drag.node.style, {position: 'absolute', left: next.x + 'px', top: next.y + 'px', width: next.width + 'px', height: next.height + 'px', right: 'auto', bottom: 'auto', margin: '0', boxSizing: 'border-box', outline: '2px solid Highlight'});
  }
  end(event) {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return;
    this.move(event); this.cancel(); event.preventDefault(); event.stopImmediatePropagation();
    if (Object.keys(drag.next).some(key => drag.next[key] !== drag.rectangle[key])) this.send({event: 'layout', id: drag.id, rectangle: drag.next});
  }
  cancel() {
    const drag = this.drag; this.drag = null; if (!drag) return;
    if (drag.original === null) drag.node.removeAttribute('style'); else drag.node.setAttribute('style', drag.original);
    if (drag.node.hasPointerCapture?.(drag.pointer)) drag.node.releasePointerCapture(drag.pointer);
  }
  dispose() { this.cancel(); for (const [name, handler] of Object.entries(this.listeners)) this.document.removeEventListener(name, handler, true); }
}
