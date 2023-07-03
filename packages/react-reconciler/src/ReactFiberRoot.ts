import {createFiber} from "./ReactFiber";
import {Container, FiberRoot} from "./ReactInternalTypes";
import {HostRoot} from "./ReactWorkTags";

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
