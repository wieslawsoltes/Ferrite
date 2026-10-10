import {UIAnalysis} from '../../language/UIAnalysis.js';

// A dedicated module worker keeps live UI type/ownership analysis off the UI thread.
// It never evaluates source, loads a native toolchain, or mutates the workspace.
self.onmessage = ({data}) => {
  const {id, files, command, options} = data;
  try {
    if (command !== 'ui-language') throw Error('Unsupported UI language operation');
    self.postMessage({id, build:UIAnalysis.compile(files, options)});
  } catch (error) {
    self.postMessage({id, error:{code:error.code ?? 'UI_LANGUAGE', message:error.message, span:error.span, notes:error.notes}});
  }
};
