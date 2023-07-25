import { isFn } from "shared/utils";
import {
  Flags,
  Passive as PassiveEffect,
  Update as UpdateEffect,
} from "./ReactFiberFlags";
import { scheduleUpdateOnFiber } from "./ReactFiberWorkLoop";
import {
  HookFlags,
  HookHasEffect,
  HookLayout,
  HookPassive,
} from "./ReactHookEffectTags";
import { Fiber, FiberRoot } from "./ReactInternalTypes";
import { HostRoot } from "./ReactWorkTags";
import { ReactContext } from "../../shared/ReactTypes";
import { readContext } from "./ReactNewContext";

// 一个单位的hook数据结构
type Hook = {
  memoizedState: any; // HACK 特别注意, fiber上也有个memoizedState, 注意区分!
  next: Hook | null;
};

// 一个副作用effect数据结构
type Effect = {
  tag: HookFlags;
  create: () => (() => void) | void;
  deps: Array<unknown> | void | null;
  next: Effect | null;
};

// 当前的fiber对象
let currentlyRenderingFiber: Fiber = null;
// 这里有两个hook ?? 区别是
let workInProgressHook: Hook = null;
let currentHook: Hook = null;

// HACK 这里是hooks的入口 !!!
// 获取当前正在执行的函数组件的fiber
// renderHooks 这个函数仅仅初始化, 没有任何具体的操作逻辑
// 更具体的要到 useReducer, useRffect 里面去找
export function renderHooks(workInProgress: Fiber) {
  currentlyRenderingFiber = workInProgress; // fiber
  currentlyRenderingFiber.updateQueue = null; // fiber上面updateQueue = []; 维护的是什么?
  workInProgressHook = null; // 正在处理中的具体hook
}

function updateWorkInProgressHook(): Hook {
  let hook: Hook;

  // alternate "备份"
  // TODO 下次从这里继续
  const current = currentlyRenderingFiber.alternate;

  if (current) {
    // 首先 复用整个 hooks 链表, 再一个个更新值
    currentlyRenderingFiber.memoizedState = current.memoizedState;

    if (workInProgressHook) {
      workInProgressHook = hook = workInProgressHook.next;
      currentHook = currentHook.next;
    } else {
      hook = workInProgressHook = currentlyRenderingFiber.memoizedState;
      currentHook = current.memoizedState;
    }
    // 更新
  } else {
    // 初次渲染
    currentHook = null;
    hook = {
      memoizedState: null,
      next: null,
    };

    if (workInProgressHook) {
      workInProgressHook = workInProgressHook.next = hook;
    } else {
      // hook0
      workInProgressHook = currentlyRenderingFiber.memoizedState = hook;
    }
  }
  return hook;
}

export function useReducer(reducer: Function, initialState: any) {
  const hook = updateWorkInProgressHook();

  if (!currentlyRenderingFiber.alternate) {
    // 函数组件初次渲染
    hook.memoizedState = initialState;
  }

  const dispatch = dispatchReducerAction.bind(
    null,
    currentlyRenderingFiber,
    hook,
    reducer
  );

  return [hook.memoizedState, dispatch];
}

function dispatchReducerAction(
  fiber: Fiber,
  hook: Hook,
  reducer: Function,
  action: any
) {
  // 更新 memoizedState , 通过执行reducer
  hook.memoizedState = reducer ? reducer(hook.memoizedState, action) : action;

  // TODO
  const root = getRootForUpdatedFiber(fiber);
  fiber.alternate = { ...fiber };
  scheduleUpdateOnFiber(root, fiber);
}

// 根据 sourceFiber 找根节点
function getRootForUpdatedFiber(sourceFiber: Fiber): FiberRoot {
  let node = sourceFiber;
  let parent = node.return;

  while (parent !== null) {
    node = parent;
    parent = node.return;
  }

  return node.tag === HostRoot ? node.stateNode : null;
}

// HACK useState --> useReducer
// initialState: 函数 | state
export function useState(initialState: any) {
  return useReducer(null, isFn(initialState) ? initialState() : initialState);
}

// 流程完全一样, 标记不同
export function useEffect(
  create: () => (() => void) | void,
  deps: Array<unknown> | void | null
) {
  return updateEffectImpl(PassiveEffect, HookPassive, create, deps);
}

export function useLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<unknown> | void | null
) {
  return updateEffectImpl(UpdateEffect, HookLayout, create, deps);
}

function updateEffectImpl(
  fiberFlags: Flags, // fiber.flags 代表具体操作
  hookFlags: HookFlags, // 标记 effect 的执行阶段
  create: () => (() => void) | void,
  deps: Array<unknown> | void | null
) {
  const hook = updateWorkInProgressHook();

  const nextDeps = deps === undefined ? null : deps;

  // current = fiber.alternate; 备份
  // currentHook <-- current.memorizedState;

  // TODO 是否为更新
  if (currentHook) {
    // 检查deps的变化
    const prevEffect = currentHook.memoizedState; // 上一次的hook

    if (deps) {
      const prevDeps = prevEffect.deps; // 上一次的依赖
      if (areHookInputsEqual(deps /* 新 */, prevDeps /* 旧 */)) {
        return; // HACK 阻止了执行
      }
    }
  }

  // 默认是执行本次create函数的

  currentlyRenderingFiber.flags |= fiberFlags;
  // HookHasEffect
  hook.memoizedState = pushEffect(HookHasEffect | hookFlags, create, nextDeps);
}

function pushEffect(
  tag: HookFlags,
  create: () => (() => void) | void,
  deps: Array<unknown> | void | null
) {
  // 新effect
  const effect: Effect = {
    tag,
    create,
    deps,
    next: null,
  };

  // 单向循环链表 fiber.updateQueue
  let componentUpdateQueue = currentlyRenderingFiber.updateQueue;

  if (componentUpdateQueue === null) {
    // 第一个effect
    componentUpdateQueue = { lastEffect: null };
    currentlyRenderingFiber.updateQueue = componentUpdateQueue;

    // HACK *** 循环
    // 1. effect.next --> effect 自己指向自己 一个节点形成环 A -> B -> C -> A
    // 2. componentUpdateQueue.lastEffect = effect.next 连接上入口 lastEffect -> A
    componentUpdateQueue.lastEffect = effect.next = effect;
  } else {
    // HACK 形成环后的插入一个节点
    // lastEffect --> effect --> firstEffect
    // 在原先的 effect 后面累加
    const lastEffect = componentUpdateQueue.lastEffect;
    const firstEffect = lastEffect.next;
    effect.next = firstEffect;
    lastEffect.next = effect;
    componentUpdateQueue.lastEffect = effect; // 收尾连上, lastEffect 永远指向最后最新一个; effect 是尾
  }

  return effect;
}

export function areHookInputsEqual(
  nextDeps: Array<unknown>,
  prevDeps: Array<unknown> | null
): boolean {
  // 没有依赖项每次都更新
  // 空数组不更新
  if (prevDeps === null) {
    return false;
  }

  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    // === == 都不太相等
    if (Object.is(nextDeps[i], prevDeps[i])) {
      continue;
    }
    return false;
  }
  return true;
}

// 不涉及到要去刷新组件, useMemo是被刷新的一方
// 人数: 100, 人数: 200
export function useMemo<T>(
  nextCreate: () => T,
  deps: Array<unknown> | void | null
) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;

  // 之前存下的值 [nextValue, nextDeps];
  const prevState = hook.memoizedState;

  // 更新阶段
  if (prevState !== null) {
    if (nextDeps !== null) {
      const prevDeps = prevState[1];
      // Object.is
      if (areHookInputsEqual(nextDeps as any, prevDeps)) {
        return prevState[0];
      }
    }
  }

  // 必须执行一遍昂贵的操作
  const nextValue = nextCreate(); // Promise<{ pending... }>

  hook.memoizedState = [nextValue, nextDeps];
  return hook.memoizedState[0];
}

// useMemo 模拟 useCallback
// useMemo 多包一层函数 () => () => {}

// 复组件传了个callback函数给子组件
// 子组件即使用了pureComponent也无法阻止被迫更新, (prev, next) => boolean;
// callback1 !== callback2 函数地址永远不相等
// 场景2 作为其他hook的依赖
export function useCallback<T>(
  callback: T,
  deps: Array<unknown> | void | null
): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;

  // [callback, nextDeps]
  const prevState = hook.memoizedState;

  // 更新
  if (prevState !== null) {
    if (nextDeps !== null) {
      const prevDeps = prevState[1];
      if (areHookInputsEqual(nextDeps as any, prevDeps)) {
        return prevState[0];
      }
    }
  }

  hook.memoizedState = [callback, nextDeps];
  return hook.memoizedState[0];
}

// 也没有刷新页面, 也不在组件刷新的流程中
// useRef的更新, 最单纯的 ref.current = newVal; 也不触发组件更新
export function useRef<T>(initialValue: T): { current: T } {
  const hook = updateWorkInProgressHook();

  // 初始化
  if (!currentHook) {
    const ref = { current: initialValue }; // 构造一个对象
    hook.memoizedState = ref;
  }

  return hook.memoizedState;
}

export function useContext<T>(context: ReactContext<T>): T {
  return readContext(context);
}
