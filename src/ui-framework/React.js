/** Public import adapter for migrated function components; not React internals. */
import {UI} from './Runtime.js';
export const {
  createElement, h, createRoot, createPortal, flushSync, Fragment, Suspense, ErrorBoundary, createContext, createRef,
  useState, useReducer, useRef, useEffect, useLayoutEffect, useMemo, useCallback,
  useContext, useId, useImperativeHandle, useSyncExternalStore, use,
  memo, forwardRef, lazy, cloneElement, isValidElement, Children
} = UI;
export default UI;
