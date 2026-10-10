import {Dom} from './Dom.js';

/** One keyboard-accessible popup; listeners and focus ownership have a bounded lifetime. */
export class ContextMenu {
  static current = null;
  static open(items, {x = 0, y = 0, anchor = document.activeElement, onError = console.error} = {}) {
    this.current?.(); const controller = new AbortController(), menu = Dom.element('div','context-menu');
    menu.setAttribute('role','menu'); menu.setAttribute('popover','manual');
    const close = (restore = true) => { controller.abort(); if (menu.matches(':popover-open')) menu.hidePopover(); menu.remove(); if (ContextMenu.current === close) ContextMenu.current = null; if (restore && anchor?.isConnected) anchor.focus({preventScroll:true}); };
    ContextMenu.current = close;
    for (const item of items) {
      if (!item) { const line = Dom.element('hr'); line.setAttribute('role','separator'); menu.append(line); continue; }
      const button = Dom.button(item.label, async () => { close(); try { await item.execute(); } catch (error) { onError(error); } }, {icon:item.icon});
      button.setAttribute('role','menuitem'); button.disabled = !!item.disabled; if (item.shortcut) button.append(Dom.element('kbd','',item.shortcut)); menu.append(button);
    }
    document.body.append(menu); if (typeof menu.showPopover === 'function') menu.showPopover(); const box = menu.getBoundingClientRect();
    menu.style.left = Math.max(4,Math.min(x,window.innerWidth-box.width-4))+'px'; menu.style.top = Math.max(4,Math.min(y,window.innerHeight-box.height-4))+'px';
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')]; buttons[0]?.focus();
    menu.addEventListener('keydown', event => {
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); }
      else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus();
      }
    });
    document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) close(false); }, {capture:true, signal:controller.signal});
    window.addEventListener('resize', () => close(false), {signal:controller.signal}); return close;
  }
}
