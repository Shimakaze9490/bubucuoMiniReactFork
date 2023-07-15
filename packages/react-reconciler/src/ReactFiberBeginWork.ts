import {isNum, isStr} from "shared/utils";
import {reconcileChildren} from "./ReactChildFiber";
import {renderHooks} from "./ReactFiberHooks";
import {Fiber} from "./ReactInternalTypes";
import {
  prepareToReadContext,
  pushProvider,
  readContext,
} from "./ReactNewContext";
import {
  HostComponent,
  HostRoot,
  FunctionComponent,
  ClassComponent,
  HostText,
  Fragment,
  ContextProvider,
  ContextConsumer,
} from "./ReactWorkTags";

// ReactFiberBeginWork.js
// HACK 根据标记 ---> 执行不同的内容 "分发模式 Dispatch"
// 函数组件 / 原生组件 / 类组件 / Fragment ...
// 1. 处理当前fiber，因为不同组件对应的fiber处理方式不同，
// 2. 返回子节点
export function beginWork(current: Fiber | null, workInProgress: Fiber) {
  switch (workInProgress.tag) {
    // 原生根标签
    case HostRoot:
      return updateHostRoot(current, workInProgress);

    // 原生标签
    case HostComponent:
      return updateHostComponent(current, workInProgress);

    // 函数组件
    case FunctionComponent:
      return updateFunctionComponent(current, workInProgress);
    // 类组件
    case ClassComponent:
      return updateClassComponent(current, workInProgress);

    // 文本节点
    case HostText:
      return updateHostText(current, workInProgress);

    // 文本节点
    case Fragment:
      return updateFragment(current, workInProgress);

    case ContextProvider:
      return updateContextProvider(current, workInProgress);
    case ContextConsumer:
      return updateContextConsumer(current, workInProgress);
  }
}

// 根fiber: 从jsx开始更新，而不是外壳
function updateHostRoot(current: Fiber | null, workInProgress: Fiber) {
  return workInProgress.child;
}

// 更新原生组件 <div id style><span><img></div>
function updateHostComponent(current: Fiber | null, workInProgress: Fiber) {
  const { type } = workInProgress;
  // div, span ,img

  if (!workInProgress.stateNode) {
    // 创建真实DOM
    workInProgress.stateNode = document.createElement(type);
    // 处理属性props, 包括children
    updateNode(workInProgress.stateNode, {}, workInProgress.pendingProps);
  }

  // fiber对象 { pendingProps: 就是element的第二个参数, 尚未更新到dom的属性 }
  // children 来源于React.createElement 嵌套 -> 数组
  let nextChildren = workInProgress.pendingProps.children;

  // 不作为子节点的文本
  // 特殊情况: 文本 innerText ...
  const isDirectTextChild = shouldSetTextContent(
    type,
    workInProgress.pendingProps
  );

  if (isDirectTextChild) {
    nextChildren = null;
    return null;
  }

  // HACK *** 处理children: Element数组 -> fiber单链表
  // reconcileChildren 协调
  workInProgress.child = reconcileChildren(
    current,
    workInProgress,
    nextChildren
  );

  return workInProgress.child;
}

// 函数组件
function updateFunctionComponent(current: Fiber | null, workInProgress: Fiber) {
  /* Hooks 是函数组件特有的 */
  // HACK hooks渲染的入口在这 renderHooks(fnFiber) (来源 ReactFiberHooks.ts)
  renderHooks(workInProgress);

  prepareToReadContext(workInProgress);
  const {type, pendingProps} = workInProgress;

  // type是函数本身, 执行后返回children, 也就是return的jsx
  const children = type(pendingProps);

  // 再协调children, 转化为fiber链表
  workInProgress.child = reconcileChildren(current, workInProgress, children);
  return workInProgress.child;
}

// 类组件
function updateClassComponent(current: Fiber | null, workInProgress: Fiber) {
  const {type, pendingProps} = workInProgress;

  const context = type.contextType;

  prepareToReadContext(workInProgress);

  const newValue = readContext(context);

  const instance = new type(pendingProps);
  instance.context = newValue;
  workInProgress.stateNode = instance;

  const children = instance.render();

  workInProgress.child = reconcileChildren(current, workInProgress, children);
  return workInProgress.child;
}

// 文本分为两种: 单纯文本作为textContent属性即可; 混入其他节点的 才createTextNode
// 文本节点: 仅处理它本身，没有child的
function updateHostText(current: Fiber | null, workInProgress: Fiber) {
  // Element 如何对待文本节点的
  // document.createTextNode(pendingProps)
  const {pendingProps} = workInProgress;

  if (!workInProgress.stateNode) {
    workInProgress.stateNode = document.createTextNode(pendingProps); // omg文本
  }
  return null;
}

function updateFragment(current: Fiber | null, workInProgress: Fiber) {
  workInProgress.child = reconcileChildren(
    current,
    workInProgress,
    workInProgress.pendingProps.children
  );
  return workInProgress.child;
}

function updateContextProvider(current: Fiber | null, workInProgress: Fiber) {
  const context = workInProgress.type._context;
  const newValue = workInProgress.pendingProps.value;

  pushProvider(context, newValue);

  // context newvalue，存储
  workInProgress.child = reconcileChildren(
    current,
    workInProgress,
    workInProgress.pendingProps.children
  );

  return workInProgress.child;
}

function updateContextConsumer(current: Fiber | null, workInProgress: Fiber) {
  prepareToReadContext(workInProgress);

  const context = workInProgress.type;
  const newValue = readContext(context);

  const render = workInProgress.pendingProps.children;

  const newChildren = render(newValue);

  workInProgress.child = reconcileChildren(
    current,
    workInProgress,
    newChildren
  );

  return workInProgress.child;
}

// textContent = childText
function shouldSetTextContent(type: string, props: any): boolean {
  return (
    type === "textarea" ||
    type === "noscript" ||
    typeof props.children === "string" ||
    typeof props.children === "number" ||
    (typeof props.dangerouslySetInnerHTML === "object" &&
      props.dangerouslySetInnerHTML !== null &&
      props.dangerouslySetInnerHTML.__html != null)
  );
}

// 合成事件
// HACK 处理属性, 关键是: children / 事件
export function updateNode(node, prevVal, nextVal) {
  Object.keys(prevVal)
    // .filter(k => k !== "children")
    .forEach((k) => {

      // 文本
      if (k === "children") {
        // 有可能是文本
        if (isStr(nextVal[k]) || isNum(nextVal[k])) {
          node.textContent = "";
        }
      // 事件
      } else if (k.slice(0, 2) === "on") {
        const eventName = k.slice(2).toLocaleLowerCase();
        node.removeEventListener(eventName, prevVal[k]);
      // 普通属性
      } else {
        if (!(k in nextVal)) {
          node[k] = "";
        }
      }
      // style对象
    });

  Object.keys(nextVal)
    // .filter(k => k !== "children")
    .forEach((k) => {
      if (k === "children") {
        // 有可能是文本
        if (isStr(nextVal[k]) || isNum(nextVal[k])) {
          node.textContent = nextVal[k] + "";
        }
      } else if (k.slice(0, 2) === "on") {
        const eventName = k.slice(2).toLocaleLowerCase();
        node.addEventListener(eventName, nextVal[k]);
      } else {
        node[k] = nextVal[k];
      }
    });
}
