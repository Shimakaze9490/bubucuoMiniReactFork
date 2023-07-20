import {
  NormalPriority,
  PriorityLevel,
  getTimeoutByPriorityLevel,
} from "./SchedulerPriorities";
import { getCurrentTime, isFn, isObject } from "shared/utils";
import { push, peek, pop } from "./SchedulerMinHeap";

declare global {
  interface Window {
    count_scheduleCallback: number;
  }
}

// 统计调用次数
window.count_scheduleCallback = 0;


// *** 这是最后具体执行的"任务"内容
// 如, scheduleUpdateOnFiber里面的workLoop(reconcile) 和 commitRoot里面的flushPassiveEffect
type Callback = any;

// 一个callback构造成一个单位的任务
export interface Task {
  id: number;
  callback: Callback;
  priorityLevel: PriorityLevel;
  startTime: number;
  expirationTime: number;
  sortIndex: number;
}

type HostCallback = (hasTimeRemaining: boolean, currentTime: number) => boolean;

// 两个任务池: 立即执行任务池 与 延时执行任务池, 用minHeap来操作
const taskQueue: Array<Task> = [];
const timerQueue: Array<Task> = [];

// 唯一的任务id
let taskIdCounter: number = 1;

let currentTask: Task | null = null; // 当前正在处理中的任务
let currentPriorityLevel: PriorityLevel = NormalPriority; // 当前处理中的任务的优先级

// 定时任务锁
let isHostTimeoutScheduled: boolean = false;

// 调度任务锁
let isHostCallbackScheduled = false;

// 执行任务锁, 最后执行callback使用
// This is set while performing work, to prevent re-entrance.
let isPerformingWork = false;

// 宏任务锁, MessageChannel使用
let isMessageLoopRunning = false; // 有点像事件循环的锁, 在requestHostCallback的时间切片要用到

// 就是callback的全局状态, 便于跨函数，跨事件循环操作
let scheduledHostCallback: HostCallback | null = null;

// 倒计时的返回值，便于取消倒计时
let taskTimeoutID: any = -1;

// performWorkUntilDeadline中使用, 触发MessageChannel的postMessage
// 也就是当前这轮事件循环的结束, 开启下一轮事件循环
let schedulePerformWorkUntilDeadline: Function;

let startTime = -1; // 每一个时间切片的开始时刻, 在 宏任务入口赋值, performWorkUnitDeadline
let nddesPaint = false;

let frameInterval = 5; // frameYieldMs;

export function cancelCallback (task: Task) {
  // 由于堆里面不能直接删除, 把回调置为空就能防止被执行
  task.callback = null;
}

// 随时获取当前任务优先级
export function getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel;
}

// 保证只倒计时一个任务, 加上一个控制锁, 保证唯一性
// isHostTimeoutScheduled: boolean = false;
// 当前是否有正在倒计时的一个任务 isHostTimeoutScheduled

// 区分两个锁: isHostCallbackScheduled 与 isHostTimeoutScheduled
// 取消锁 与 重新执行倒计时

// 设置倒计时setTimeout; 与之对应的 就是取消倒计时, 如果有比他更倒计时更短的任务
function requestHostTimeout(callback: Callback, ms: number) {
  taskTimeoutID = setTimeout(() => {
    callback(getCurrentTime());
  }, ms);
}
function cancelHostTimeout() {
  clearTimeout(taskTimeoutID);
  taskTimeoutID = -1; // 重置
}

// 走秒, 向前
// timerQueue --> timer --> taskQueue;
// 检查timerQueue中的任务, 是否有任务到期了呢, 到期了就移动到taskQueue中, 但是不能立即执行!
// advanceTimers什么时候调用, 是handleTimeout倒计时结束, 考虑让下一个任务开始倒计时
// handleTimeout --> advanceTimers
// 再检查 timerQueue中从上往下检查是否有 到期的 timer.startTime <= currentTime
// 再检查 timer.callback 是否有效
// 移动过程: pop(timerQueue), push(taskQueue, timer)
// 重写sortIndex: timer.sortIndex = timer.expirationTime;
function advanceTimers(currentTime: number) {
  // 先检查堆顶元素, 依次向下检查, 因为如果堆顶都还没到期, 其他的任务也不会到期
  let timer: Task = peek(timerQueue) as Task;
  while (timer !== null) {
    // 额外检查下callback, 因为可能为Null, 中途被取消掉的任务! 跳过
    // 这里只有有效任务才移动到taskQueue
    if (timer.startTime <= currentTime) {
      // 证明该timer已经到期了: 从timerQueue中取出, 放入到taskQueue中
      pop(timerQueue); // 自动shifDown

      // 判断有效任务
      if (timer.callback !== null) {
        // 中间需要额外做一件事情, 切换/重写 sortIndex
        timer.sortIndex = timer.expirationTime;
        push(taskQueue, timer);
      }
    } else {
      return; // 全部都没有到期, 直接结束
    }
    // 注意中间执行的 pop(timerQueue), 已经改变了timerQueue
    timer = peek(timerQueue) as Task;
  }
}

/* HACK handleTimeout是什么作用,
  倒计时结束需要执行的内容! 到点了
*/
function handleTimeout(currentTime: number) {
  isHostTimeoutScheduled = false; // 打开锁

  // 检查timerQueue中是否还有其他等待着倒计时的任务
  // 传递给下一个任务倒计时
  advanceTimers(currentTime);

  // 准备正式执行这个任务, 先检查任务调度锁
  // 前面都是从timerQueue中处理, 这里回归到taskQueue中处理
  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true; // 上锁

      // TODO 开始任务调度, 涉及到两个函数: requestHostCallback / flushWork
      requestHostCallback(flushWork);
    } else {
      // 如果taskQueue中没有任务怎么办
      // 去timerQueue中找, 提前执行延时任务 ??

      // 倒计时任务, 堆顶的那个任务
      const firstTimer: Task = peek(timerQueue) as Task;
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

// 宏任务 为什么不用setTimeout ?? 最小4ms延迟
const channel = new MessageChannel();

schedulePerformWorkUntilDeadline = () => {
  // 一端发送消息
  channel.port1.postMessage(null)
}

// 一端接收消息
channel.port2.onmessage = performWorkUnitDeadline

// 宏任务内执行函数链: performWorkUnitDeadline --> 
function performWorkUnitDeadline () {

  // 要去执行内容函数flushWork, 实际存在全局变量 scheduledHostCallback
  if (scheduledHostCallback !== null) {
    const currentTime = getCurrentTime();

    // Keep track of the start time so we can measure how long the main thread has been blocked.
    // 记录本次宏任务(时间切片) 的开始时间
    startTime = currentTime;

    const hasTimeRemaining = true; // 固定为true
    let hasMoreWork = true;

    try {
      /* 本轮事件循环, 没有执行完全部的任务, 但是时间切片已经用完 */
      hasMoreWork = scheduledHostCallback(hasTimeRemaining, currentTime); // 就是执行flushWork
    } finally {
      if (hasMoreWork) {

      } else {
        // 没有更多需要执行的任务: 这轮事件循环宏任务, 结束
        isMessageLoopRunning = false;
        // 这轮的调用函数flushWork清空
        scheduledHostCallback = null;
      }
    }
  } else {
    // 没有执行内容flushWork, 直接开锁结束
    isMessageLoopRunning = false;
  }
}

// HACK 最后实现, 有两个地方使用到, 并且参数传入的flushWork如何使用?
// 这个函数requestHostCallback, 实际上是react对浏览器原生api
// requestIdelCallback: MessageChannel 的模拟
// var handle = window.requestIdelCallback(callback, [, options]);
// callback里面会接受到一个对象参数: IdleDeadline
// 里面包含, timeRemaining(), didTimeout 来判断当前回调函数是否存在过期
// 在比较简单的情况下可以直接使用, 兼容性问题

// HACK 理解 事件循环 / 宏任务
// 为什么react要自己实现 ?? 更高的控制权 / 兼容性
function requestHostCallback(_flushWork: Callback) {

  // 保持api参数的一致性
  // 调用flushWork, 需要传入 hasTimeRemaining, initialTime 出处是??

  // 开始调度 scheduledHostCallback全局变量 赋值为flushWork
  // 为什么需要这个全局变量, 因为具体的实现不只是在这一个函数里面
  // 全局变量的好处 --> 分开多处处理, 因为涉及到宏任务, 不能直接调用
  scheduledHostCallback = _flushWork;

  // isMessageLoopRunning "事件循环"的锁
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;

    // HACK 调度任务 直到 时间结束(时间切片内)
    // 里面使用到一个api, MessageChannel创建宏任务
    // 重点理解: 为什么需要创建宏任务, 为什么一个宏任务 消费一个时间切片
    // postMessage()
    schedulePerformWorkUntilDeadline();
  }

}
/* 调用链 scheduleCallback -> requestHostCallback -> '宏任务: MessageChannel' ->  flushWork -> workLoop ->  */
/* 消耗1单位的时间切片 */
function flushWork(hasTimeRemaining: boolean, initialTime: number): boolean /* hasMoreWork */ {
  isHostCallbackScheduled = false; // 开锁

  // 额外检查, 如果有在倒计时没必要, 先取消掉
  // 因为防止干扰主线程
  if (isHostTimeoutScheduled) {
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  // 开始执行, 执行锁
  isPerformingWork = true;

  // 为什么要先取得上一次任务的优先级 ?? 什么用
  // 因为在workLoop执行多个具体任务时随时会更新
  // 而在执行完我们需要还原为开始值
  let previousPriorityLevel = currentPriorityLevel;

  try {
    return workLoop(hasTimeRemaining, initialTime); // 一个单位的时间切片内多个任务执行
  } finally {
    currentTask = null; // 当前任务置空
    isPerformingWork = false; // 执行锁, 开锁
    currentPriorityLevel = previousPriorityLevel; // 还原优先级为 执行workLoop之前
  }
}

// 判断当前时间切片是否消耗完, 是否该交还控制权给浏览器, 进入下一个宏任务周期
function shouldYieldToHost(): boolean {
  // 用当前时间 减去 时间切片开始时间
  const timeElapsed = getCurrentTime() - startTime; // startTime 在哪里赋值的 ?

  // frameInterval = 5ms; 为什么不是16.7ms, 不考虑帧对齐(window.requestAnimationFrame)
  // 默认会小于16.7 防止浏览器需要执行其他的内容
  if (timeElapsed < frameInterval) {
    // The main thread has only been blocked for a really short amount of time;
    // smaller than a single frame. Don't yield yet.
    return false;
  }
  return true;
}

// hasTimeRemaining = true
// initialTime = startTime = 时间切片开始时刻
function workLoop(hasTimeRemaining: boolean, initialTime: number): boolean /* hasMoreWork */ {
  // currentTask 当前任务: 为什么设置成全局变量? 方便取消打断 currentTask = null;
  // 所有需要执行的任务都放到了taskQueue里面了, 所以接下来就是遍历其

  // 初始值是initialTime, 后续根据任务前执行完实时获取
  let currentTime = initialTime;

  // 多次随时检查: timerQueue --> taskQueue
  advanceTimers(currentTime); // 首次执行前, 也去检查下timerQueue, 确保取到的是最有效的优先任务
  currentTask = peek(taskQueue) as Task;

  while (currentTask !== null) {
    const should = shouldYieldToHost();
    // 1. 检查该任务到执行时间吗
    // 2. 检查是否该交还控制权: 也就是时间切片耗尽
    // 3. hasTimeRemaining, 固定为true, 因为是内部自行判断剩余时间的
    // should 与 hasTimeRemaining 满足一个就行, 因为是相同含义
    if (currentTask.expirationTime > currentTime && (should || !hasTimeRemaining)) {
      break;
    }

    const callback = currentTask.callback;
    currentPriorityLevel = currentTask.priorityLevel; // 更新全局的优先级

    if (isFn(callback)) {
      // 执行之前, 为什么要置成null
      // 因为是全局变量, 防止其他地方重复执行
      currentTask.callback = null;

      // 过期了吗
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;

      // 一个任务可能没有执行完, 返回下半段后续执行: () => () => {}
      const continuationCallback = callback(didUserCallbackTimeout);
      if (isFn(continuationCallback)) {
        // 说明任务没有执行完, currentTask继续任务池里呆着; 同时callback更新为下半段
        currentTask.callback = didUserCallbackTimeout;
      } else {
        // 没有下半段, 说明callback已经执行完了 !! 需要从任务池中清除掉currentTask
        // 检查确定, 当前任务在动态变化, 还是堆顶
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
      }

      // 因为中途执行callback花费时间不固定, 所以重新更新获取最新的时间
      currentTime = getCurrentTime();

      // 每次执行完任务, 都执行一下advanceTimers, 检查是否有到期任务
      // 新的过期任务: 从timerQueue 移到 taskQueue, 保证下一轮执行的任务优先级合理
      advanceTimers(currentTime);
    } else {
      // 当callback不是函数的情况, 可能被取消掉, 或者被执行过了
      // 直接删掉
      pop(taskQueue);
    }

    // 向后移动一位
    currentTask = peek(taskQueue) as Task;
  }

  // HACK break掉上方的while循环, 有两种情况: 任务执行完了 / 时间切片完了
  if (currentTask !== null) {
    return true; /* hasMoreWork */
  } else {
    // taskQueue没有剩余任务了, 空闲了, 写过很多遍了: 从timerQueue中取
    const firstTimer: Task = peek(timerQueue) as Task;
    if (firstTimer !== null) {
      // 开始倒计时一个任务
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

/* HACK Scheduler 入口 */
// !! 要从这里看起

// callback 就是待执行的内容函数, 组装成任务
// 任务考虑优先级, 减少卡顿, 加上优先级
// 任务分两类: 延迟执行的任务, 立即执行的任务
export function scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: Callback,
  options?: {
    delay?: number;
  }
) {
  // 可以发现一次执行流程, scheduleCallback执行了两边
  // 也就是产生了两个任务来调度:
  // 协调fiber时 scheduleUpdateOnFiber 和 提交节点时 commitRoot
  // 这两个任务的优先级都是默认优先级: NormalPriority, 都是及时执行的任务, 没有delay延时
  window.count_scheduleCallback += 1;
  // 维护, 存储, 池子
  // const taskQueue: Array<Task> = [];
  // const timerQueue: Array<Task> = [];
  // 两个池子, 区分delay
  // 为什么不全排序? 如何数组 --> Heap
  // 顺序动态，随时会变
  // 用到最小堆
  // 有delay的放到timerQueue, 减少排序的量
  // 理解为什么会有两个任务池, 以及delay什么用

  // 获取当前时间, performance.now()
  const currentTime = getCurrentTime();

  // 注意delay是个时间单位!! 具体延迟的时间
  const delay = options?.delay ?? 0;

  // if (isObject(options)) {}

  // 理论上任务开始调度的时间, 如果有delay需要加上
  // currentTime 不一定等于 startTime, 需要考虑delay的影响
  // 如果没有delay, 那么startTime就等于currentTime
  const startTime = currentTime + options?.delay;

  // 过期时间 = 开始时间 + 等待时间
  // 而等待时间, 由优先级转换生成, 不同优先级不同等待时间
  // getTimeoutByPriorityLevel, 通过switch...case返回不同的等待常量
  // 优先级最高的, 等待时间为-1; Idle的等待最久
  const timeout = getTimeoutByPriorityLevel(priorityLevel); // ms
  const expirationTime = startTime + timeout;

  // 1. 构造新任务newTask
  const newTask: Task = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime, // 开始时间
    expirationTime, // 过期时间
    // 数字, 最小堆中排序的依据
    // 暂时初始化为-1, 后续再调整
    sortIndex: -1,
  };

  // 2. 判断应该将新任务放入那个堆, taskQueue, timerQueue
  // 判断依据, 是否有delay; 或者 startTime > currentTime
  if (startTime > currentTime) {
    newTask.sortIndex = startTime;
    // 有延迟的任务, push -> shifUp
    push(timerQueue, newTask);

    // 每次都只能调度一个任务, 如果 taskQueue 执行完了, 就去检查timerQueue, 倒计时最近的一个任务
    // timerQueue --> taskQueue
    // 如何检查taskQueue是否为空? 两种方式 length 或者 peek()检查堆顶
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // 恰好, newTask 就是需要倒计时处理的任务
      // 每次只需要setTimeout, 倒计时一个任务, 倒计时多个任务是没有意义的

      // HACK 检查锁
      if (isHostTimeoutScheduled) {
        // 已经有一个任务正在倒计时, 但是当前newTask优先级更高, 于是取消掉既有的倒计时, 换成新的
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true; // 上锁
      }

      // 实现倒计时
      requestHostTimeout(
        handleTimeout,
        startTime - currentTime /* 其实就是delay */
      );
    }
  } else {
    newTask.sortIndex = expirationTime;
    // 无延迟的任务
    push(taskQueue, newTask);

    // 没有延迟, 校验一下, 现在没有调度中的任务, 那就去调度嘛
    // 这里的判断: 没有调度中 / 没有执行中
    // isPerformingWork --> 任务执行中 (因为具体的任务执行可能会比较慢, 也是为了保证锁)
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true; // 上锁
      // 一共两处地方执行这个方法
      requestHostCallback(flushWork);
    }
  }
}
