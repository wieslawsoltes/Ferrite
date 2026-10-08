import {CompilerSession} from './project/CompilerSession.js';
export {CompilerSession};
const defaultSession = new CompilerSession();
/** Compatibility API; use separate CompilerSessions for independent IDE workspaces. */
export function compileProject(files, command = 'check', options = {}) { return defaultSession.compile(files, command, options); }
