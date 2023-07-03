import {ReactContext, ReactElement} from "shared/ReactTypes";
import {NormalPriority, Scheduler } from "scheduler";
import {createFiberFromElement} from "./ReactFiber";
import {FiberRoot, Fiber} from "./ReactInternalTypes";
import {beginWork, updateNode} from "./ReactFiberBeginWork";
import {
  HostComponent,
  HostRoot,
  HostText,
  FunctionComponent,
  ContextProvider,
} from "./ReactWorkTags";
import {Placement, Update, Passive} from "./ReactFiberFlags";
import {
  HookLayout,
  HookFlags,
  // HookHasEffect,
  HookPassive,
} from "./ReactHookEffectTags";
import {popProvider} from "./ReactNewContext";

// HACK Current当前fiber； wip正在构建的fiber
// work in progress 正在工作当中的
let workInProgress: Fiber | null = null;
let workInProgressRoot: FiberRoot | null = null;

// HACK 被调用render()
// Element嵌套 --> Fiber链
export function updateContainer(element: ReactElement, root: FiberRoot) {
  // 需要将element转成fiber，其父级fiber就是root.current
  // 联系起来，fiber.child = childFiber;
  root.current.child = createFiberFromElement(element, root.current);
  // 新fiber默认操作 Placement === 新增
  root.current.child.flags = Placement;

  /* NOTE 开始基于fiber链的更新调度了 */
  scheduleUpdateOnFiber(root, root.current);
}

// ! 基于当前的fiber执行更新: 分为几个任务, 本身 / child / sibling ...
export function scheduleUpdateOnFiber(root: FiberRoot, fiber: Fiber) {

  // fiber需要遍历处理，通过全局变量维护方便点: wip, wipRoot
  workInProgressRoot = root;
  workInProgress = fiber;

  // HACK 就是之前写的scheduleCallback --> callback 封装成任务, 使其被调度 --> workLoop
  Scheduler.scheduleCallback(NormalPriority, workLoop);
}

// callback === '任务本身', 处理一个个的fiber单位
function workLoop() {

  // HACK 两大核心任务: fiber的比较更新 / fiber映射成真实DOM

  // 第一步: 处理所有fiber的内容
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }

  // 第二步: fiber映射成正式节点 "commit", 开端root
  if (!workInProgress && workInProgressRoot) {
    commitRoot();
  }
}

/* HACK 核心函数 */
// 1. 处理当前的fiber，就是workInProgress
// 2. 重新赋值workInProgress
function performUnitOfWork(unitOfWork: Fiber /* workInProgress 下一个fiber */) {

  // 每个fiber上都有一个alternate, 保存上一次更新fiber
  const current = unitOfWork.alternate;

  // !! 真正开始执行, next是子节点
  let next = beginWork(current/* 老 */, unitOfWork/* 新 */); // 1. 处理fiber 2. 返回子节点

  /* 传递关系如何找 --> 树深度优先 */
  if (next === null) {
    // 没有子节点, 找兄弟、叔叔节点、爷爷的兄弟的节点等等
    completeUnitOfWork(unitOfWork);
  } else {
    // 有next子节点, 赋值传递, 重新回到workLoop的while循环
    workInProgress = next;
  }
}

// "树的深度优先" 没有子节点->找兄弟->找叔叔->找爷爷节点
function completeUnitOfWork(unitOfWork: Fiber) {

  // 移动fiber, 找规律与while循环
  let completedWork: Fiber = unitOfWork;

  do {
    // 特殊情况
    if (completedWork.tag === ContextProvider) {
      const context: ReactContext<any> = completedWork.type._context;
      popProvider(context);
    }

    // 1. 先cw.sibling
    const siblingFiber = completedWork.sibling;
    if (siblingFiber !== null) {
      workInProgress = siblingFiber;
      return; // NOTE <-- 直到找到兄弟节点才返回
    }

    // 2. 后cw.return
    const returnFiber = completedWork.return;
    completedWork = returnFiber;
    workInProgress = completedWork;
  } while (completedWork);
}

function commitRoot() {
  commitMutationEffects(workInProgressRoot.current.child, workInProgressRoot);

  const root = workInProgressRoot.current.child;

  Scheduler.scheduleCallback(NormalPriority, () => {
    flushPassiveEffect(root);
    return;
  });

  workInProgressRoot = null;
  workInProgress = null;
}

function commitMutationEffects(finishedWork: Fiber, root: FiberRoot) {
  // 注意: 这个方法是个递归child
  recursivelyTraverseMutationEffects(root, finishedWork);

  // 真正提交的地方
  commitReconciliationEffects(finishedWork);
}

// ?? 作用是: 
function recursivelyTraverseMutationEffects(
  root: FiberRoot,
  parentFiber: Fiber
) {
  let child = parentFiber.child;

  while (child !== null) {
    commitMutationEffects(child, root);
    // TODO
    child = child.sibling;
  }
}

// fiber.flags
// 提交包括操作: 新增插入、移动位置、更新属性、节点删除
function commitReconciliationEffects(finishedWork: Fiber) {
  const flags = finishedWork.flags;

  // 位运算比较
  if (flags & Placement) {
    commitPlacement(finishedWork);
    // 位运算, 去除
    finishedWork.flags &= ~Placement;
  }

  if (flags & Update) {
    switch (finishedWork.tag) {
      case HostComponent:
        if (finishedWork.stateNode) {
          updateNode(
            finishedWork.stateNode,
            finishedWork.alternate.pendingProps,
            finishedWork.pendingProps
          );
        }
        break;

      case FunctionComponent:
        commitHookEffects(finishedWork, HookLayout);
    }

    finishedWork.flags &= ~Update;
  }

  if (finishedWork.deletions) {
    // parentFiber 是 deletions 的父dom节点对应的fiber
    const parentFiber = isHostParent(finishedWork)
      ? finishedWork
      : getHostParentFiber(finishedWork);
    const parent = parentFiber.stateNode;
    commitDeletions(finishedWork.deletions, parent);
    finishedWork.deletions = null;
  }
}

function commitHookEffects(finishedWork: Fiber, hookFlags: HookFlags) {
  const updateQueue = finishedWork.updateQueue;

  const lastEffect = updateQueue != null ? updateQueue.lastEffect : null;
  if (lastEffect) {
    const firstEffect = lastEffect.next;
    let effect = firstEffect;

    do {
      if ((effect.tag & hookFlags) === hookFlags) {
        const create = effect.create;
        effect.destory = create();
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

function flushPassiveEffect(finishedWork: Fiber) {
  recursivelyTraversePassiveMountEffects(finishedWork);
  commitPassiveMountOnFiber(finishedWork);
}

function recursivelyTraversePassiveMountEffects(parentFiber: Fiber) {
  let child = parentFiber.child;

  while (child !== null) {
    commitPassiveMountOnFiber(child);
    child = child.sibling;
  }
}

function commitPassiveMountOnFiber(finishedWork: Fiber) {
  switch (finishedWork.tag) {
    case FunctionComponent:
      if (finishedWork.flags & Passive) {
        commitHookEffects(finishedWork, HookPassive);
      }
      finishedWork.flags &= ~Passive;
      break;
  }
}

function commitDeletions(deletions: Array<Fiber>, parent: Element) {
  deletions.forEach((deletion) => {
    // 找到deletion的dom节点
    parent.removeChild(getStateNode(deletion));
  });
}

// 原生节点：原生标签、文本节点
function isHost(fiber: Fiber) {
  return fiber.tag === HostComponent || fiber.tag === HostText;
}

function getStateNode(fiber: Fiber) {
  let node = fiber;

  while (1) {
    if (isHost(node) && node.stateNode) {
      return node.stateNode;
    }
    node = node.child;
  }
}

// 在dom上，把子节点插入到父节点里
function commitPlacement(finishedWork: Fiber) {
  const parentFiber = getHostParentFiber(finishedWork);

  // 插入父dom
  if (
    finishedWork.stateNode &&
    (finishedWork.tag === HostText || finishedWork.tag === HostComponent)
  ) {
    // 获取父dom节点
    let parent = parentFiber.stateNode;

    if (parent.containerInfo) {
      parent = parent.containerInfo;
    }

    // dom节点
    const before = getHostSibling(finishedWork);
    insertOrAppendPlacementNode(finishedWork, before, parent);
    // parent.appendChild(finishedWork.stateNode);
  }
}

// 返回 fiber 的父dom节点对应的fiber
function getHostParentFiber(fiber: Fiber): Fiber {
  let parent = fiber.return;

  while (parent !== null) {
    if (isHostParent(parent)) {
      return parent;
    }
    parent = parent.return;
  }
}

// 检查 fiber 是否可以是父 dom 节点
function isHostParent(fiber: Fiber): boolean {
  return fiber.tag === HostComponent || fiber.tag === HostRoot;
}

// 返回fiber的下一个兄弟dom节点
// 不一定
function getHostSibling(fiber: Fiber) {
  let node = fiber;

  sibling: while (1) {
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        return null;
      }
      node = node.return;
    }

    node.sibling.return = node.return;
    node = node.sibling;

    while (node.tag !== HostComponent && node.tag !== HostText) {
      if (node.flags & Placement) {
        // Placement表示节点是新增插入或者移动位置
        continue sibling;
      }

      if (node.child === null) {
        continue sibling;
      } else {
        node.child.return = node;
        node = node.child;
      }
    }

    if (!(node.flags & Placement)) {
      return node.stateNode;
    }
  }
}
// 新增插入 | 位置移动
// insertBefore | appendChild
function insertOrAppendPlacementNode(
  node: Fiber,
  before: Element,
  parent: Element
) {
  const {tag} = node;
  const isHost = tag === HostComponent || HostText;
  if (isHost) {
    const stateNode = node.stateNode;
    if (before) {
      parent.insertBefore(stateNode, before);
    } else {
      parent.appendChild(stateNode);
    }
  } else {
    const child = node.child;
    if (child !== null) {
      insertOrAppendPlacementNode(child, before, parent);
      let sibling = child.sibling;
      while (sibling !== null) {
        insertOrAppendPlacementNode(sibling, before, parent);
        sibling = sibling.sibling;
      }
    }
  }
}
