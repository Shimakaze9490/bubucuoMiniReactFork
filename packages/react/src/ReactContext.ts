import {ReactContext} from "shared/ReactTypes";
import {REACT_CONTEXT_TYPE, REACT_PROVIDER_TYPE} from "shared/ReactSymbols";

export function createContext<T>(defaultValue: T): ReactContext<T> {

  // 构造context对象
  const context: ReactContext<T> = {
    $$typeof: REACT_CONTEXT_TYPE,
    _currentValue: defaultValue,

    // 组件: jsx -> Element -> fiber
    Provider: null,
    Consumer: null,
  };

  context.Provider = {
    $$typeof: REACT_PROVIDER_TYPE,
    _context: context,
  };
  context.Consumer = context;

  return context;
}
