import test from 'node:test';
import assert from 'node:assert/strict';
import {UIStudioSession as UIStudio} from '../src/ui/studio/UIStudioSession.js';

function fixture() {
  const heading = {id: 'heading', span: {file: 'src/app.ui.rs', start: 4, end: 20}};
  const button = {id: 'button', span: {file: 'src/app.ui.rs', start: 21, end: 40}};
  const counters = {outline: 0, properties: 0, open: 0, reveal: 0};
  const studio = {
    file: 'src/app.ui.rs', selected: heading.id, draft: 'data-design',
    designer: {index: new Map([[heading.id, heading], [button.id, button]])},
    renderOutline() { counters.outline++; },
    renderProperties() { counters.properties++; this.draft = 'className'; },
    model: {revision: 7, open(file) { assert.equal(file, studio.file); counters.open++; }},
    app: {studio: {revealSource(_session, action) { action(); }}, selection: {select(span, origin, revision) {
      assert.equal(origin, 'ui-studio'); assert.equal(revision, 7); counters.reveal++;
      // Reproduce the editor's delayed selection echo without a timing sleep.
      UIStudio.prototype.select.call(studio, studio.selected, false);
    }}},
  };
  return {studio, counters, heading};
}

test('repeated source selection preserves unsubmitted inspector edits', () => {
  const {studio, counters, heading} = fixture();
  assert.deepEqual(UIStudio.prototype.select.call(studio, 'heading', false), {id: 'heading', span: heading.span});
  assert.equal(studio.draft, 'data-design');
  assert.deepEqual(counters, {outline: 0, properties: 0, open: 0, reveal: 0});
});

test('same-node explicit reveal still navigates but its selection echo does not reset input', () => {
  const {studio, counters} = fixture();
  UIStudio.prototype.select.call(studio, 'heading', true);
  assert.equal(studio.draft, 'data-design');
  assert.deepEqual(counters, {outline: 0, properties: 0, open: 1, reveal: 1});
});

test('a different source node rebuilds the inspector exactly once despite editor echo', () => {
  const {studio, counters} = fixture();
  UIStudio.prototype.select.call(studio, 'button', true);
  assert.equal(studio.selected, 'button'); assert.equal(studio.draft, 'className');
  assert.deepEqual(counters, {outline: 1, properties: 1, open: 1, reveal: 1});
});

test('stale source identities do not change selection, input, or editor navigation', () => {
  const {studio, counters} = fixture();
  assert.throws(() => UIStudio.prototype.select.call(studio, 'removed'), /no longer exists/);
  assert.equal(studio.selected, 'heading'); assert.equal(studio.draft, 'data-design');
  assert.deepEqual(counters, {outline: 0, properties: 0, open: 0, reveal: 0});
});
