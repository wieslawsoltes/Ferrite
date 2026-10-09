/** Independent synchronous runtime: migrated function components, not React ABI. */
export type Key = string | number | bigint;
export type ReactNode = ReactElement | string | number | bigint | boolean | null | undefined | readonly ReactNode[];
export interface ReactElement<P = Record<string, unknown>> { readonly $$typeof: symbol; readonly type: ElementType; readonly key: string | null; readonly props: P }
export type ComponentType<P = Record<string, unknown>> = (props: P) => ReactNode;
/** Descriptor interpreted by createElement/JSX; do not invoke it as a function. */
export interface ExoticComponent<P> { (props: P): ReactNode; readonly $$kind?: string }
export type ElementType<P = any> = string | symbol | ComponentType<P> | ExoticComponent<P>;
export interface MutableRefObject<T> { current: T }
export type Ref<T> = MutableRefObject<T | null> | ((value: T | null) => void) | null;
export type Dispatch<A> = (value: A) => void;
export type SetStateAction<S> = S | ((previous: S) => S);
export type DependencyList = readonly unknown[];
export interface Context<T> extends ExoticComponent<{value: T; children?: ReactNode}> {
  defaultValue: T; displayName: string; Provider: Context<T>; Consumer: ComponentType<{children: (value: T) => ReactNode}>;
}
export interface RootOptions { onError?: (error: Error) => void; throwErrors?: boolean; maxNodes?: number; identifierPrefix?: string; onRecoverableError?: (error: Error) => void }
export interface Root { render(node: ReactNode): Root; unmount(): void; flushEffects(): void; subscribe(listener: (event: Record<string, unknown>) => void): () => void; inspect(): Record<string, unknown> }
export function createElement<P>(type: ElementType<P>, props?: (P & {key?: Key; ref?: Ref<any>}) | null, ...children: ReactNode[]): ReactElement<P>;
export const h: typeof createElement;
export const Fragment: ExoticComponent<{children?: ReactNode}>;
export const Suspense: ExoticComponent<{children?: ReactNode; fallback?: ReactNode}>;
export const ErrorBoundary: ExoticComponent<{children?: ReactNode; fallback?: ReactNode | ((error: Error) => ReactNode); onError?: (error: Error) => void}>;
export function createRoot(container: Element, options?: RootOptions): Root;
export function hydrateRoot(container: Element, node: ReactNode, options?: RootOptions): Root;
export function createPortal(children: ReactNode, container: Element, key?: Key | null): ReactElement;
export function flushSync(action?: () => void): void;
export function createRef<T = unknown>(): MutableRefObject<T | null>;
export function createContext<T>(defaultValue: T): Context<T>;
export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, Dispatch<A>];
export function useReducer<S, A, I>(reducer: (state: S, action: A) => S, initial: I, init: (initial: I) => S): [S, Dispatch<A>];
export function useRef<T>(initial: T): MutableRefObject<T>;
export function useRef<T = unknown>(): MutableRefObject<T | null>;
export function useEffect(setup: () => void | (() => void), dependencies?: DependencyList): void;
export const useLayoutEffect: typeof useEffect;
export function useMemo<T>(factory: () => T, dependencies?: DependencyList): T;
export function useCallback<T extends Function>(callback: T, dependencies?: DependencyList): T;
export function useContext<T>(context: Context<T>): T;
export function useId(): string;
export function useImperativeHandle<T>(ref: Ref<T>, create: () => T, dependencies?: DependencyList): void;
export function useSyncExternalStore<T>(subscribe: (changed: () => void) => void | (() => void), getSnapshot: () => T, getServerSnapshot?: () => T): T;
export function use<T>(resource: PromiseLike<T> | Context<T>): T;
export function memo<P>(component: ComponentType<P> | ExoticComponent<P>, compare?: (oldProps: P, nextProps: P) => boolean): ExoticComponent<P>;
export function forwardRef<T, P = Record<string, unknown>>(render: (props: P, ref: Ref<T>) => ReactNode): ExoticComponent<P & {ref?: Ref<T>}>;
export function lazy<P>(load: () => Promise<{default: ComponentType<P>} | ComponentType<P>>): ComponentType<P>;
export function cloneElement<P>(element: ReactElement<P>, props?: Partial<P> & {key?: Key}, ...children: ReactNode[]): ReactElement<P>;
export function isValidElement<P = Record<string, unknown>>(value: unknown): value is ReactElement<P>;
export const Children: {
  toArray(children: ReactNode): Exclude<ReactNode, boolean | null | undefined | readonly ReactNode[]>[];
  count(children: ReactNode): number;
  only<P>(child: ReactElement<P>): ReactElement<P>;
  map(children: ReactNode, callback: (child: ReactNode, index: number) => ReactNode, thisArg?: unknown): ReactNode[] | null | undefined;
  forEach(children: ReactNode, callback: (child: ReactNode, index: number) => void, thisArg?: unknown): void;
};
export interface RuntimeAPI {
  version: string; createElement: typeof createElement; h: typeof h; Fragment: typeof Fragment; Suspense: typeof Suspense; ErrorBoundary: typeof ErrorBoundary;
  createRoot: typeof createRoot; hydrateRoot: typeof hydrateRoot; createPortal: typeof createPortal; flushSync: typeof flushSync; createRef: typeof createRef; createContext: typeof createContext;
  useState: typeof useState; useReducer: typeof useReducer; useRef: typeof useRef; useEffect: typeof useEffect; useLayoutEffect: typeof useLayoutEffect;
  useMemo: typeof useMemo; useCallback: typeof useCallback; useContext: typeof useContext; useId: typeof useId; useImperativeHandle: typeof useImperativeHandle;
  useSyncExternalStore: typeof useSyncExternalStore; use: typeof use; memo: typeof memo; forwardRef: typeof forwardRef; lazy: typeof lazy;
  cloneElement: typeof cloneElement; isValidElement: typeof isValidElement; Children: typeof Children;
  jsx(type: ElementType, props: Record<string, unknown> | null, key?: Key): ReactElement;
  jsxs: RuntimeAPI['jsx'];
}
declare const React: RuntimeAPI;
export default React;
