import {Ferrite, compileUI, mountUI, exportHTML, SourceDesigner} from 'ferrite-compiler';
import {useState, useRef, useEffect, createContext, useContext, memo, forwardRef, Fragment} from 'ferrite-compiler/react';
import {createRoot} from 'ferrite-compiler/react-dom/client';
const Theme = createContext('light');
function Counter(props: {initial: number}) {
  const [count, setCount] = useState(props.initial);
  const ref = useRef<HTMLInputElement | null>(null);
  const theme: string = useContext(Theme);
  useEffect(() => { ref.current?.focus(); }, []);
  // @ts-expect-error state updates retain their generic type.
  setCount('wrong');
  return <section data-theme={theme}><input ref={ref} /><button onClick={() => setCount(n => n + 1)}>{count}</button></section>;
}
const app = <Counter initial={1}/>;
const Memo = memo(Counter);
const memoElement = <Memo initial={1}/>;
const RefInput = forwardRef<HTMLInputElement, {value: string}>((props, ref) => <input ref={ref} value={props.value}/>);
const refElement = <RefInput value="Rust"/>;
// @ts-expect-error missing required component property.
const invalid = <Counter/>;
const node = document.createElement('div');
createRoot(node).render(<Fragment>{app}{memoElement}{refElement}</Fragment>);
const source = 'fn app() -> ui::Node { view! { <h1>Hello</h1> } }';
const artifact = compileUI(source, {maxSteps: 100000});
const session = mountUI(artifact, document.createElement('div'), {backend: 'wasm', runtime: Ferrite.createUIRuntime()});
session.armDebugger({breakpoints: [{file: 'src/ui.rs', line: 1}], pauseOnEntry: false});
const debugStatus: string = session.debug('step-over').status;
const debugFrames = session.inspectDebugger().state?.frames;
session.setBreakpoints([]); session.debug('pause'); session.debug('step-out'); session.debug('stop');
// @ts-expect-error debug commands are a closed, typed protocol.
session.debug('arbitrary-eval');
void debugStatus; void debugFrames; session.dispose();
const html: string = exportHTML(artifact);
const designer = new SourceDesigner(source);
designer.apply({op: 'setTag', node: designer.nodes[0].id, value: 'h2'}, designer.revision);
// @ts-expect-error unknown backend must not compile.
mountUI(source, node, {backend: 'native'});
void html; void invalid;

import {UIProject, CanvasLayout, renderUIToString, exportHydratedHTML} from 'ferrite-compiler';
import {renderToString} from 'ferrite-compiler/react-dom/server';
import {hydrateRoot} from 'ferrite-compiler/react-dom/client';
const initialMarkup: string = renderToString(app, {identifierPrefix: 'test-'});
hydrateRoot(document.createElement('main'), app, {identifierPrefix: 'test-'});
const rustMarkup: string = renderUIToString(artifact, {backend: 'wasm'});
const hydrated: string = exportHydratedHTML(artifact, {backend: 'javascript'});
const project = UIProject.load({'src/app.rs': source}, 'src/app.rs');
const changed = project.changes({grid: 8}, 'button { padding: 4px }');
designer.apply({op: 'setLayout', node: designer.nodes[0].id, rectangle: CanvasLayout.geometry({x: 1, y: 2, width: 80, height: 40})}, designer.revision);
void initialMarkup; void rustMarkup; void hydrated; void changed;

import {mountNativeUI, exportNativeHTML, decodeNativeBase64} from 'ferrite-compiler';
const nativeBytes = new Uint8Array();
const nativeSession = mountNativeUI(nativeBytes, node, {runtime: Ferrite.createUIRuntime()});
Ferrite.mountNativeUI(nativeBytes, node); Ferrite.exportNativeHTML(nativeBytes);
Ferrite.createNativeWasmHost(Ferrite.createUIRuntime()); Ferrite.decodeNativeBase64('');
exportNativeHTML(nativeBytes); decodeNativeBase64('');
// @ts-expect-error native imports accept Wasm bytes, not a source string.
mountNativeUI('fn main() {}', node);
void nativeSession;
