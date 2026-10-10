import {WorkspaceModel as WorkspaceState} from './WorkspaceState.js';
import {restoreDesignerLayout} from '../studio/DesignerLayout.js';

/** Document presentation extends text-project state without changing source revisions. */
export class WorkspaceModel extends WorkspaceState {
  setDocumentState(path, values) {
    const next = {...values};
    if (Object.hasOwn(next, 'designerLayout')) next.designerLayout = restoreDesignerLayout(next.designerLayout);
    return super.setDocumentState(path, next);
  }
  loadWorkspace(data, notify = true) {
    super.loadWorkspace(data, false);
    for (const [path, value] of Object.entries(data.documents ?? {})) {
      const state = this.documentStates.get(path);
      if (state && value?.designerLayout) state.designerLayout = restoreDesignerLayout(value.designerLayout);
    }
    if (notify) this.emit('replace');
  }
}
