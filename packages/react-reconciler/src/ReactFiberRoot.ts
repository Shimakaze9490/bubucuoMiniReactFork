import {createFiber} from "./ReactFiber";
import {Container, FiberRoot} from "./ReactInternalTypes";
import {HostRoot} from "./ReactWorkTags";

// HACK 调用链:
// createRoot[对外暴露: client] --> createFiberRoot[ReactFiberRoot] --> / 实例方法调用 / --> 'render' --> updateContainer

// --> scheduleUpdateOnFiber --> / 调度: Scheduler.scheduleCallback / --> workLoop *** --> 两大任务: performUnitOfWork, commitRoot

// performUnitOfWork: 执行每个单位的任务: beginWork + completeUnitOfWork

// beginWork: 

// complteUnitOfWork: 树的深度优先遍历, Effect链从root节点开始 ??

export function createFiberRoot(containerInfo: Container): FiberRoot {
  const root: FiberRoot = new FiberRootNode(containerInfo);

  /* 外层多了一层，root实例包裹着fiber实例 */
  root.current = createFiber(HostRoot, null, null, null);
  root.current.stateNode = root;

  return root;
}

export function FiberRootNode(containerInfo) {
  this.containerInfo = containerInfo; // 挂载的真实节点
  // this.pendingChildren = null;
  // this.current = createFiber(...);
  this.current = null;

  // commit提交的标志
  this.finishedWork = null;

  // 
  this.callbackNode = null;
}
