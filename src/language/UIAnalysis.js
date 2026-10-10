import {Configuration} from '../compiler/Configuration.js';
import {MacroExpander} from '../compiler/MacroExpander.js';
import {SemanticAnalyzer} from '../compiler/SemanticAnalyzer.js';
import {OwnershipAnalyzer} from '../compiler/OwnershipAnalyzer.js';
import {prepareUIProject} from '../ui-framework/UIProjectCompiler.js';

/** Original-source typed analysis, without rendering, executing callbacks or emitting code. */
export class UIAnalysis {
  static compile(files, {file, configuration} = {}) {
    if (!Object.hasOwn(files, file)) throw Error('Select an existing UI source file');
    const project = prepareUIProject(files[file], {file, files, configuration});
    const configured = Configuration.apply(project.ast, configuration), expanded = MacroExpander.expand(configured.ast);
    const semantic = SemanticAnalyzer.analyze(expanded.ast, {mode:'library'});
    const ownership = OwnershipAnalyzer.analyze(semantic);
    return {tokens:project.tokens, ast:project.ast, hir:semantic.instances.map(({key,fn}) => ({instance:key, body:fn.body, span:fn.span})),
      sem:{symbols:semantic.symbols, closures:semantic.closures, instances:semantic.instances.map(({key,name,fn,returnType,locals}) => ({key,name,span:fn.span,returnType,locals}))},
      ownership, diagnostics:semantic.warnings, backend:'ferrite-ui', nodes:project.nodes};
  }
}
