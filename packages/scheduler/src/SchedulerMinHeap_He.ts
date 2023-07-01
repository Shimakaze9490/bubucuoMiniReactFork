// 节点单位
// 比较节点compare: 先sortIndex, 后id
export type Node = {
  id: number;
  sortIndex: number;
};

export type Heap = Array<Node>; // []

/*
  HACK 核心关系公式: 完全二叉树 --> 数组!!

  parentIdx = (leftIdx - 1) / 2;
  parentIdx = (rightIdx - 2) / 2;
  leftIdx = parentIdx * 2 + 1
  rightIdx = parentIdx * 2 + 2
*/

// NOTE 往堆里添加元素, 先放到数列尾部, 然后上浮到合适的位置
export function push(heap: Heap, node: Node): void {
  const idx = heap.length; // ?? 为什么需要这里的idx
  heap.push(node);
  siftUp(heap, node, idx);
}

// NOTE 如果为空返回null, 否则返回第一个元素
export function peek(heap: Heap): Node | null {
  return heap.length === 0 ? null : heap[0];
}

// HACK 删除, 区分peek
export function pop(heap: Heap): null | Node {
  if (heap.length === 0) {
    return null;
  }
  const first = heap[0];
  const last = heap.pop();

  // 剩下还有元素才调整
  if (last !== first) {
    heap[0] = last!;
    siftDown(heap, last!, 0);
  }

  return first; // 返回删除的节点
}

// NOTE
// 1. 为什么需要siftUp --> 因为不是minHeap了, 重新变成minHeap
// 2. 结束条件, idx === 0, 或者 node > parent
// 3. 通用执行 while(idx > 0) {}
function siftUp(heap: Heap, node: Node, i: number) {
  // parentIdx = (leftIdx - 1) / 2;
  // parentIdx = (rightIdx - 2) / 2;
  let index = i;
  while (index > 0) {
    const parentIndex = (index - 1) >>> 1;
    const parent = heap[parentIndex];
    if (compare(parent, node) > 0) {
      // The parent is larger. Swap positions.
      heap[parentIndex] = node;
      heap[index] = parent;
      index = parentIndex;
    } else {
      // The parent is smaller. Exit.
      return;
    }
  }
}

//
function siftDown(heap: Heap, node: Node, i: number) {
  let index = i;
  const length = heap.length;
  const halfLength = length >>> 1; // 右移一位, 一半 ?? 为什么

  while (index < halfLength) {
    // 找到左右子节点, 还是公式
    const leftIndex = (index + 1) * 2 - 1;
    const left = heap[leftIndex];
    const rightIndex = leftIndex + 1;
    const right = heap[rightIndex];

    // 比较左节点, 父节点
    if (compare(left, node) < 0) {
      if (rightIndex < length && compare(right, left) < 0) {
        heap[index] = right;
        heap[rightIndex] = node;
        index = rightIndex;
      } else {
        heap[index] = left;
        heap[leftIndex] = node;
        index = leftIndex;
      }
    } else if (rightIndex < length && compare(right, node) < 0) {
      // 右节点可能不存在, 用下标 rightIndex < length
      heap[index] = right;
      heap[rightIndex] = node;
      index = rightIndex;
    } else {
      // Neither child is smaller. Exit.
      return;
    }
  }
}

function compare(a: Node, b: Node) {
    // Compare sort index first, then task id.
    const diff = a.sortIndex - b.sortIndex;
    return diff !== 0 ? diff : a.id - b.id;
}
