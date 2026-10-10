import {TOOL_SIDES, TOOL_SLOTS, clamp, slotSide} from './ToolWindowState.js';

/** Viewport projection. Never writes preferred sizes, split ratios or visibility. */
export function measureToolWindows(state, width, height, {overlay = null, maximized = null} = {}) {
  width = Math.max(0, Number.isFinite(width) ? width : 0);
  height = Math.max(0, Number.isFinite(height) ? height : 0);
  const panels = [], regions = {}, dividers = [], slotRects = {};
  const compact = side => side === 'left' ? width < 600 : side === 'right' ? width < 1000 : false;
  const active = slot => state.slots[slot].active;
  const reserved = side => TOOL_SLOTS.filter(slot => slotSide(slot) === side && active(slot) && !compact(side) && ['docked', 'unpinned'].includes(state.windows[active(slot)].mode));
  const slots = Object.fromEntries(TOOL_SIDES.map(side => [side, reserved(side)]));
  let left = slots.left.length ? state.sizes.left : 0, right = slots.right.length ? state.sizes.right : 0;
  const horizontalGap = Number(left > 0) + Number(right > 0), available = Math.max(0, width - Math.min(240, width * .45) - horizontalGap);
  if (left + right > available) { const ratio = available / (left + right); left *= ratio; right *= ratio; }
  let bottom = slots.bottom.length ? Math.min(state.sizes.bottom, Math.max(0, height - Math.min(160, height * .55))) : 0;
  bottom = Math.max(0, bottom);
  const lg = left > 0 ? 1 : 0, rg = right > 0 ? 1 : 0, bg = bottom > 0 ? 1 : 0;
  const centerX = left + lg, centerWidth = Math.max(0, width - left - right - lg - rg), upperHeight = Math.max(0, height - bottom - bg);
  const editor = {x: centerX, y: 0, width: centerWidth, height: upperHeight};
  regions.left = {x: 0, y: 0, width: left, height: state.wide ? height : upperHeight};
  regions.right = {x: width - right, y: 0, width: right, height: state.wide ? height : upperHeight};
  regions.bottom = {x: state.wide ? centerX : 0, y: height - bottom, width: state.wide ? centerWidth : width, height: bottom};
  if (left) dividers.push({kind: 'size', side: 'left', rect: {x: left, y: 0, width: lg, height: regions.left.height}, value: left});
  if (right) dividers.push({kind: 'size', side: 'right', rect: {x: width - right - rg, y: 0, width: rg, height: regions.right.height}, value: right});
  if (bottom) dividers.push({kind: 'size', side: 'bottom', rect: {x: regions.bottom.x, y: height - bottom - bg, width: regions.bottom.width, height: bg}, value: bottom});
  for (const side of TOOL_SIDES) {
    const list = slots[side], region = regions[side];
    if (!list.length) continue;
    const horizontal = side === 'bottom', dimension = horizontal ? 'width' : 'height', coordinate = horizontal ? 'x' : 'y';
    if (list.length === 1) slotRects[list[0]] = {...region};
    else {
      const gap = Math.min(1, region[dimension]), total = Math.max(0, region[dimension] - gap), min = Math.min(horizontal ? 180 : 100, total / 2);
      const first = clamp(total * state.splits[side], min, total - min);
      slotRects[list[0]] = {...region, [dimension]: first};
      slotRects[list[1]] = {...region, [coordinate]: region[coordinate] + first + gap, [dimension]: Math.max(0, total - first)};
      dividers.push({kind: 'split', side, rect: {...region, [coordinate]: region[coordinate] + first, [dimension]: gap}, bounds: region, value: state.splits[side]});
    }
    for (const slot of list) panels.push({id: active(slot), slot, rect: slotRects[slot], overlay: false});
  }
  for (const slot of TOOL_SLOTS) {
    const id = active(slot); if (!id) continue;
    const side = slotSide(slot), mode = state.windows[id].mode;
    if (mode === 'floating' || (!compact(side) && mode !== 'sliding')) continue;
    if (compact(side) && overlay !== id) continue;
    const w = side === 'bottom' ? width : Math.min(state.sizes[side], Math.max(0, width - 16));
    const h = side === 'bottom' ? Math.min(state.sizes.bottom, Math.max(0, height - 32)) : height;
    const rect = {x: side === 'right' ? width - w : 0, y: side === 'bottom' ? height - h : 0, width: w, height: h};
    panels.push({id, slot, rect, overlay: true}); slotRects[slot] = rect;
  }
  if (maximized && state.windows[maximized]?.mode !== 'floating') {
    const id = maximized, slot = state.windows[id].anchor, rect = {x: 0, y: 0, width, height};
    return {editor, panels: [{id, slot, rect, overlay: false}], regions, dividers: [], slotRects: {[slot]: rect}, compact: width < 1000};
  }
  return {editor, panels, regions, dividers, slotRects, compact: width < 1000};
}

/** Explicit six-position targets; the central editor never becomes a tool tab. */
export function toolDropTargets(width, height) {
  const w = Math.min(100, width / 3), h = Math.min(44, height / 6), inset = Math.min(12, width / 16);
  return [
    {slot: 'left-top', x: inset, y: height * .22, width: w, height: h},
    {slot: 'left-bottom', x: inset, y: height * .58, width: w, height: h},
    {slot: 'right-top', x: Math.max(0, width - w - inset), y: height * .22, width: w, height: h},
    {slot: 'right-bottom', x: Math.max(0, width - w - inset), y: height * .58, width: w, height: h},
    {slot: 'bottom-left', x: Math.max(0, width * .3 - w / 2), y: Math.max(0, height - h - inset), width: w, height: h},
    {slot: 'bottom-right', x: Math.min(width - w, width * .7 - w / 2), y: Math.max(0, height - h - inset), width: w, height: h}
  ];
}
export const containsPoint = (rect, x, y) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
