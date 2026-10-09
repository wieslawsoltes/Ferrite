import type {ElementType as UIElementType, Key, ReactElement, ReactNode, Ref, ComponentType, ExoticComponent} from './React.js';
export {Fragment} from './React.js';
export function jsx(type: UIElementType, props: Record<string, unknown> | null, key?: Key): ReactElement;
export const jsxs: typeof jsx;
export function jsxDEV(type: UIElementType, props: Record<string, unknown> | null, key?: Key, staticChildren?: boolean, source?: unknown, self?: unknown): ReactElement;
export namespace JSX {
  type Element = ReactElement<any>;
  type ElementType = string | symbol | ComponentType<any> | ExoticComponent<any>;
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: Key }
  interface DOMProps<T extends globalThis.Element> {
    children?: ReactNode; ref?: Ref<T>; key?: Key; id?: string; className?: string; style?: string | Record<string, string | number | null | undefined>;
    onClick?: (event: MouseEvent) => void; onInput?: (event: Event) => void; onChange?: (event: Event) => void;
    onKeyDown?: (event: KeyboardEvent) => void; onPointerDown?: (event: PointerEvent) => void;
    [attribute: string]: unknown;
  }
  type KnownHTML = {[K in keyof HTMLElementTagNameMap]: DOMProps<HTMLElementTagNameMap[K]>};
  type KnownSVG = {[K in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: DOMProps<SVGElementTagNameMap[K]>};
  interface IntrinsicElements extends KnownHTML, KnownSVG { [tag: `${string}-${string}`]: DOMProps<HTMLElement> }
}
