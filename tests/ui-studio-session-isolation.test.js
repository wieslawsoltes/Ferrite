import test from 'node:test';
import assert from 'node:assert/strict';
import {UIStudioSession} from '../src/ui/studio/UIStudioSession.js';

test('background event debugger updates its state without stealing the active document', () => {
  let navigations=0, renders=0;
  const studio={artifact:{},root:{hidden:true},snapshot:{},file:'src/background.ui.rs',model:{revision:2},renderState(){renders++;},app:{selection:{select(){navigations++;}}}};
  const message={event:'debug-paused',detail:{state:{next:{file:studio.file,start:0,end:1}}}};
  UIStudioSession.prototype.event.call(studio,message);
  assert.equal(studio.snapshot.debugger,message.detail);assert.equal(renders,1);assert.equal(navigations,0);
  studio.root.hidden=false;UIStudioSession.prototype.event.call(studio,message);assert.equal(navigations,1);
});

test('closed sessions and background canvas events cannot apply source mutations', () => {
  const studio={artifact:{},root:{hidden:true},assertLive(){throw Error('should not edit');},select(){throw Error('should not select');}};
  UIStudioSession.prototype.event.call(studio,{event:'select',id:'old'});
  UIStudioSession.prototype.event.call(studio,{event:'layout',id:'old'});
  studio.disposed=true;studio.root.hidden=false;
  UIStudioSession.prototype.event.call(studio,{event:'select',id:'old'});
});
