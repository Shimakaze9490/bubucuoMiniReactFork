import {ReactElement} from "shared/ReactTypes";
import {isFn} from "shared/utils";
import {NoFlags} from "./ReactFiberFlags";
import {Fiber} from "./ReactInternalTypes";
import {isStr} from "../../shared/utils";
import {
  ContextConsumer,
  ContextProvider,
  Fragment,
  HostComponent,
  HostText,
} from "./ReactWorkTags";
import {
  IndeterminateComponent,
  WorkTag,
  ClassComponent,
  FunctionComponent,
} from "./ReactWorkTags";
import {REACT_FRAGMENT_TYPE, REACT_PROVIDER_TYPE} from "shared/ReactSymbols";
import {REACT_CONTEXT_TYPE} from "../../shared/ReactSymbols";

// NOTE 梳理下调用链: createFiberFromElement / createFiberFromTypeAndProps / createFiberFromText --> createFiber --> new FiberNode();
// 三个二级方法 -> 一级方法 -> 构造函数

// 基础方法createFiber: "工厂方法" 返回FoberNode构造函数的实例
// 创建一个fiber
export function createFiber(
  tag: WorkTag,
  pendingProps: any,
  key: null | string,
  returnFiber: Fiber | null, // returnFiber 代表父级fiber, 每一个fiber诞生都需要知道父fiber
): Fiber {
  return new FiberNode(tag, pendingProps, key, returnFiber);
}

function FiberNode(
  tag: WorkTag,
  pendingProps: any,
  key: null | string,
  returnFiber: Fiber
) {
  // Instance
  // 标记组件类型
  this.tag = tag;
  // 定义组件在当前层级下的唯一性
  this.key = key;
  // 组件类型
  this.elementType = null;
  // 组件类型
  this.type = null;
  // 不同的组件的  stateNode 定义也不同
  // 原生标签：string
  // 类组件：实例
  this.stateNode = null;

  // HACK Fiber 关系
  this.return = returnFiber; //null;
  this.child = null;
  this.sibling = null;
  // 记录了节点在兄弟节点中的位置下标，用于diff时候判断节点是否需要发生移动
  this.index = 0;

  this.pendingProps = pendingProps; // <----- Element.props, 里面包含children属性

  this.memoizedProps = null;
  this.updateQueue = null;
  // 不同的组件的 memoizedState 指代也不同
  // 函数组件 hook0
  // 类组件 state
  this.memoizedState = null;

  // Effects, 操作flags: Placement 新增
  this.flags = NoFlags;
  this.subtreeFlags = NoFlags;
  // 记录要删除的子节点
  this.deletions = null;

  // 缓存fiber
  this.alternate = null;

  // Context
  this.dependencies = null;
}

// 根据 Element 创建Fiber
// Element 不可直接用
export function createFiberFromElement(
  element: ReactElement,
  returnFiber: Fiber
) {

  // export type ReactElement = {
  //   $$typeof: any;
  //   type: any; <--- 'div'
  //   key: any;
  //   ref: any;
  //   props: any; <--- props包含所有属性，其中最重要的是children: Element[] | Element | string | null
  //   _owner: any; // ReactFiber
  // };

  const {type, key} = element;

  /* HACK 特别注意pendingProps属性是哪里来的 ? Element的props */
  const pendingProps = element.props;
  const fiber = createFiberFromTypeAndProps(
    type,
    key,
    pendingProps,
    returnFiber
  );
  return fiber;
}

// 更具 TypeAndProps 创建fiber
export function createFiberFromTypeAndProps(
  type: any,
  key: null | string,
  pendingProps: any,
  returnFiber: Fiber
) {
  // fiberTag 就是 this.tag = tag;
  // 函数组件 tag = FunctionComponent;
  // 类组件 tag = ClassComponent;
  let fiberTag: WorkTag = IndeterminateComponent; // 初始化为未知的组件类型

  /* 然后通过一系列判断, 确定组件具体类型: 函数组件 / 类组件 / 文本 / 原生标签 / Fragment / .... */
  // 原型上 isReactComponent = {}
  if (isFn(type)) {
    // 判断函数组件还是类组件
    if (shouldConstruct(type)) {
      fiberTag = ClassComponent;
    } else {
      fiberTag = FunctionComponent;
    }
  } else if (isStr(type)) {
    // 原生标签
    fiberTag = HostComponent;
  } else if (type === REACT_FRAGMENT_TYPE) {
    fiberTag = Fragment;
  } else if (type.$$typeof === REACT_PROVIDER_TYPE) {
    fiberTag = ContextProvider;
  } else if (type.$$typeof === REACT_CONTEXT_TYPE) {
    fiberTag = ContextConsumer;
  }

  const fiber = createFiber(fiberTag, pendingProps, key, returnFiber);
  fiber.elementType = type;
  fiber.type = type;
  return fiber;
}

// 判断是否是类组件: boolean
function shouldConstruct(Component: Function): boolean {
  const prototype = Component.prototype;

  return !!(prototype && prototype.isReactComponent);
}

export function createFiberFromText(
  content: string,
  returnFiber: Fiber
): Fiber {
  const fiber = createFiber(HostText, content, null, returnFiber);
  return fiber;
}
