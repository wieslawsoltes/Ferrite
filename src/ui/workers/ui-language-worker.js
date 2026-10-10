import {UIAnalysis} from '../../language/UIAnalysis.js';

self.onmessage = ({data}) => {
  const {id, files, command, options} = data;
  try {
    if (command !== 'ui-language') throw Error('Unsupported UI language operation');
    self.postMessage({id, build:UIAnalysis.compile(files, options)});
  } catch (error) {
    self.postMessage({id, error:{code:error.code ?? 'UI_LANGUAGE', message:error.message, span:error.span, notes:error.notes ?? []}});
  }
};
