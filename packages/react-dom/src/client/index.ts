// ReactDOM -> react-dom/client -> react-reconciler -> ReactFiber.ts
import {FiberRoot} from "react-reconciler/src/ReactInternalTypes";
import {createFiberRoot} from "react-reconciler/src/ReactFiberRoot";
import {updateContainer} from "react-reconciler/src/ReactFiberWorkLoop";

/* ReactDOMRoot 这一层基本没啥内容，就是原型上拓展了几个方法，如render */
function ReactDOMRoot(internalRoot: FiberRoot) {
  this._internalRoot = internalRoot;
}

// HACK render --> updateContainer; 这里的children就是外面的Element，jsx编译后的产物
ReactDOMRoot.prototype.render = function (children /* jsx -> React.createElement */) {
  console.log(
    "%c [  ]-11",
    "font-size:13px; background:pink; color:#bf2c9f;",
    children
  );

  // 更新到DOM上的流程
  updateContainer(children, this._internalRoot /* internalRoot就是FiberRoot */);
};

// createRoot是暴露给外界使用的方法, 放在client里面; 不在reconciler
// createRoot也是一个工厂方法: 包含两步: createFiberRoot / ReactDOMRoot
export function createRoot(container: Element | Document | DocumentFragment) {

  // 根对象root 其中 root.current才是根fiber; root.containerInfo才是容器信息
  // root.finishedWork = null; root.callbackNode = null;
  const root: FiberRoot = createFiberRoot(container);

  return new ReactDOMRoot(root);
}

export default {
  createRoot,
};
