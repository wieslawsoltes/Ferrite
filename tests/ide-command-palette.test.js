import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CommandPalette} from '../src/ui/views/CommandPalette.js';

function fixture(overrides = {}) {
  let opens = 0, prevented = 0, stopped = 0;
  const palette = Object.create(CommandPalette.prototype);
  palette.open = () => { opens++; };
  const event = {key: 'P', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false,
    defaultPrevented: false, isComposing: false, repeat: false,
    target: {closest: () => null},
    preventDefault() { prevented++; }, stopPropagation() { stopped++; }, ...overrides};
  return {palette, event, state: () => ({opens, prevented, stopped})};
}

test('Search Everywhere captures Ctrl/Cmd+Shift+P once before tool panes consume it', () => {
  for (const modifiers of [{ctrlKey: true}, {ctrlKey: false, metaKey: true}]) {
    const {palette, event, state} = fixture(modifiers);
    assert.equal(palette.handleShortcut(event), true);
    assert.deepEqual(state(), {opens: 1, prevented: 1, stopped: 1});
  }
});

test('terminal editing, function keys, AltGr and composition do not become IDE commands', () => {
  for (const overrides of [
    {key: 'p', shiftKey: false}, {key: 'c', shiftKey: false},
    {key: 'w', shiftKey: false}, {key: 's', shiftKey: false},
    {key: 'Enter'}, {key: 'F1', ctrlKey: false, shiftKey: false},
    {key: 'F5', ctrlKey: false, shiftKey: false}, {key: 'Tab'},
    {ctrlKey: false, metaKey: false}, {altKey: true}, {isComposing: true},
    {defaultPrevented: true},
  ]) {
    const {palette, event, state} = fixture(overrides);
    assert.equal(palette.handleShortcut(event), false, JSON.stringify(overrides));
    assert.deepEqual(state(), {opens: 0, prevented: 0, stopped: 0});
  }
});

test('modal dialogs retain keyboard ownership and repeats do not reopen or clear the query', () => {
  const modal = fixture({target: {closest: selector => selector === 'dialog' ? {} : null}});
  assert.equal(modal.palette.handleShortcut(modal.event), false);
  assert.deepEqual(modal.state(), {opens: 0, prevented: 0, stopped: 0});
  const repeated = fixture({repeat: true});
  assert.equal(repeated.palette.handleShortcut(repeated.event), true);
  assert.deepEqual(repeated.state(), {opens: 0, prevented: 1, stopped: 1});
});

test('opening an already visible palette does not call showModal again', () => {
  let shown = 0, rendered = 0, focused = 0;
  const palette = Object.create(CommandPalette.prototype);
  palette.dialog = {open: false, showModal() { this.open = true; shown++; }};
  palette.input = {value: '', focus() { focused++; }};
  palette.render = () => { rendered++; };
  palette.open('Open '); palette.open('New Project');
  assert.equal(shown, 1); assert.equal(rendered, 2); assert.equal(focused, 2);
  assert.equal(palette.input.value, 'New Project');
});

test('disposing removes the capturing listener and prevents future palette commands', () => {
  const {palette, event, state} = fixture();
  let removed = 0, closed = 0, detached = 0;
  palette.shortcut = () => {};
  palette.document = {removeEventListener(type, listener, options) {
    assert.equal(type, 'keydown'); assert.equal(listener, palette.shortcut);
    assert.equal(options.capture, true); removed++;
  }};
  palette.dialog = {open: true, close() { closed++; }, remove() { detached++; }};
  palette.dispose(); palette.dispose();
  assert.equal(removed, 1); assert.equal(closed, 1); assert.equal(detached, 1);
  assert.equal(palette.handleShortcut(event), false);
  assert.deepEqual(state(), {opens: 0, prevented: 0, stopped: 0});
});
