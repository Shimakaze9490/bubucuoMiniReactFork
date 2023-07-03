// export * from "./src/ReactFiberReconciler";
export * from "./src/ReactFiberHooks";

// export function add() {
//   return 100;
// }


/* HACK 协调的英文就是: reconciler */

// 用vdom 初次渲染更慢, 快的是后续更新 !!

// stask reconciler --> fiber reconciler

// 从上到下, 连续更新不可中断 UI将不连续, 仅有父子关系没有兄弟关系
// 任务颗粒度更小, 更可控: 紧急更新 与 非紧急更新
// 可并发 / 错误边界

// 关系: sibling / child / return

// 2 <<< 3