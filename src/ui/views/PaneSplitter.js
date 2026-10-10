/** Pointer capture and keyboard resizing without document-global move listeners. */
export class PaneSplitter {
  constructor(root, {getValue, setValue, getOrientation = () => 'right', getBounds, label = 'Resize panels'}) {
    this.root = root; root.tabIndex = 0; root.setAttribute('role','separator'); root.setAttribute('aria-label',label);
    const update = value => { setValue(Math.max(20,Math.min(80,value))); this.refresh(); };
    this.refresh = () => { root.setAttribute('aria-orientation',getOrientation() === 'down' ? 'horizontal' : 'vertical'); root.setAttribute('aria-valuemin','20'); root.setAttribute('aria-valuemax','80'); root.setAttribute('aria-valuenow',String(Math.round(getValue()))); };
    root.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); this.dragging = true; root.setPointerCapture(event.pointerId); };
    root.onpointermove = event => { if (!this.dragging) return; const box = getBounds(), vertical = getOrientation() === 'down'; update(100 * (vertical ? event.clientY-box.top : event.clientX-box.left) / Math.max(1,vertical ? box.height : box.width)); };
    for (const name of ['pointerup','pointercancel','lostpointercapture']) root.addEventListener(name,() => { this.dragging = false; });
    root.ondblclick = () => update(50);
    root.onkeydown = event => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return; event.preventDefault(); update(event.key === 'Home' ? 50 : getValue() + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) * (event.shiftKey ? 10 : 2)); };
    this.refresh();
  }
}
