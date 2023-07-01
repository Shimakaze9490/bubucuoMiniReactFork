import {
  NormalPriority,
  PriorityLevel,
  getTimeoutByPriorityLevel,
} from "./SchedulerPriorities";
import { getCurrentTime, isFn, isObject } from "shared/utils";
import { push, peek, pop } from "./SchedulerMinHeap";

/*
  HACK
*/

type Callback = any; // (...args: any[]) => void | any;
export interface Task {
  id: number;
  callback: Callback;
  priorityLevel: PriorityLevel;
  startTime: number;
  expirationTime: number;
  sortIndex: number;
}

type HostCallback = (hasTimeRemaining: boolean, currentTime: number) => boolean;

// 任务存储, 最小堆
const taskQueue: Array<Task> = [];
const timerQueue: Array<Task> = [];

let taskIdCounter: number = 1;

let currentTask: Task | null = null; // 当前正在处理中的任务
let currentPriorityLevel: PriorityLevel = NormalPriority; // 当前处理中的任务的优先级

// 在计时
let isHostTimeoutScheduled: boolean = false;

// 在调度任务
let isHostCallbackScheduled = false;

// This is set while performing work, to prevent re-entrance.
// 防止重复介入 ?? 后续理解
let isPerformingWork = false;

let isMessageLoopRunning = false; // 有点像事件循环的锁, 在requestHostCallback的时间切片要用到

let scheduledHostCallback: HostCallback | null = null; // ??
let taskTimeoutID: any = -1; // 用于维护倒计时, 以及取消倒计时的

let schedulePerformWorkUntilDeadline: Function;

let startTime = -1;
let nddesPaint = false;

let frameInterval = 5; // frameYieldMs;

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

// HACK 最后实现, 有两个地方使用到, 并且参数传入的flushWork如何使用?
// 这个函数requestHostCallback, 实际上是react对浏览器原生api
// requestIdelCallback: MessageChannel 的模拟
// var handle = window.requestIdelCallback(callback, [, options]);
// callback里面会接受到一个对象参数: IdleDeadline
// 里面包含, timeRemaining(), didTimeout 来判断当前回调函数是否存在过期
// 在比较简单的情况下可以直接使用, 兼容性问题
function requestHostCallback(_flushWork: Callback) {
  // 调用flushWork, 需要传入 hasTimeRemaining, initialTime 出处是??

  // 开始调度 scheduledHostCallback全局变量 赋值为flushWork
  // 为什么需要这个全局变量, 因为具体的实现不只是在这一个函数里面
  scheduledHostCallback = _flushWork;

  // isMessageLoopRunning "事件循环"的锁
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;

    // TODO 0701 写到这里了
    // HACK 调度任务 直到 时间结束(时间切片内)
    // 里面使用到一个api, MessageChannel创建宏任务
    schedulePerformWorkUntilDeadline()

      // 1. 如何定义时间切片
      // 2. 
  }

}
function flushWork(hasTimeRemaining: boolean, initialTime: number) {
  isHostCallbackScheduled = false; // 开锁

  // 额外检查, 如果有在倒计时没必要, 一同取消掉
  if (isHostTimeoutScheduled) {
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  // 开始执行, 执行锁
  isPerformingWork = true;

  // 为什么要先取得上一次任务的优先级 ?? 什么用
  let previousPriorityLevel = currentPriorityLevel;

  // 再赋值覆盖

  try {
    return workLoop(hasTimeRemaining, initialTime); // <--- 在这里正式调用 workLoop 时间切片 + callback()
  } finally {
    isPerformingWork = false; // 开锁
    currentTask = null; // 当前任务置空
    currentPriorityLevel = previousPriorityLevel; // 为什么要这样还原优先级 ?? 有什么作用
  }
}

// HACK 正式进入任务的调度, 传入的两个参数:
// 在当前时间切片内, 循环执行任务
function workLoop(hasTimeRemaining: boolean, initialTime: number) {
  // currentTask 当前任务: 为什么设置成全局变量? 方便取消打断 currentTask = null;
  // 所有需要执行的任务都放到了taskQueue里面了, 所以接下来就是遍历其

  // 初始值是initialTime, 后续根据任务前执行完实时获取
  let currentTime = initialTime;

  // 多次随时检查: timerQueue --> taskQueue
  advanceTimers(currentTime); // 首次执行前, 也去检查下timerQueue, 确保取到的是最有效的优先任务
  currentTask = peek(taskQueue) as Task;

  while (currentTask !== null) {
    // 检查过期与否: 没有过期
    // 并且没有剩余时间了, 当前时间切片
    // 没法继续执行了, break掉
    if (currentTask.expirationTime > currentTime && !(hasTimeRemaining)) {
      break;
    }

    const callback = currentTask.callback;
    currentPriorityLevel = currentTask.priorityLevel; // 同时更新优先级, 在scheduleCallback里面添加的优先级

    if (isFn(callback)) {
      // 执行之前, 为什么要置成null
      // 因为是全局变量, 防止其他地方重复执行
      currentTask.callback = null;

      /* 正式执行 !! 需要传递什么参数 ? */

      // 过期了吗
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;

      // 一个任务可能没有执行完, 返回下半段后续执行
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
    return true; // 表明还有剩余任务待执行
  } else {
    // taskQueue没有剩余任务了, 写过很多遍了: 从timerQueue中取
    const firstTimer: Task = peek(timerQueue) as Task;
    if (firstTimer !== null) {
      // 开始倒计时一个任务
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false; // 表明这轮没有剩余任务了
  }
}

/* @He */
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

    // 没有延迟, 校验一下
    // 没有调度中的任务
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true; // 上锁
      // 一共两处地方执行这个方法
      requestHostCallback(flushWork);
    }
  }
}
