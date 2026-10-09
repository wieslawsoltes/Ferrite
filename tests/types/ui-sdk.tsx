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
session.armDebugger({breakpoints: [{file: 'src/ui.rs', line: 1}]}); session.dispose();
const html: string = exportHTML(artifact);
const designer = new SourceDesigner(source);
designer.apply({op: 'setTag', node: designer.nodes[0].id, value: 'h2'}, designer.revision);
// @ts-expect-error unknown backend must not compile.
mountUI(source, node, {backend: 'native'});
void html; void invalid;
