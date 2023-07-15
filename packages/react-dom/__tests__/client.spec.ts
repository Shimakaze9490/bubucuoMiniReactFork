/* DebugReact/src/react/packages/react-dom/src/__tests__/ReactDOMRoot-test.js */
import { describe, expect, beforeEach, expectTypeOf, vi, it } from 'vitest';
import * as ReactDOM from '../src/client';
// import * as ReactDOM from '../../react-dom';
// import { createRoot } from ('../../react-dom/index');
// import { ReactDOM }from ('../../react-dom/index');
// ReactDOM = require('react-dom');

describe('client createRoot', () => {
  it('createRoot is Function', () => {
    expectTypeOf(ReactDOM.createRoot).toBeFunction();
  });
})

describe('ReactDOMRoot', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
  })

  it('createRoot call', () => {
    const spy_createRoot = vi.spyOn(ReactDOM, 'createRoot'); // spy 间谍监听
    const spy_createFiber = vi.spyOn(ReactDOM, 'createFiberRoot');

    /* 执行 */
    const root = ReactDOM.createRoot(container);

    expect(spy_createRoot).toHaveBeenCalledTimes(1); // 调用次数
    // expect(spy_createFiber).toHaveBeenCalledTimes(1); // ??? 0次

    expect(root).toBeInstanceOf(ReactDOM.ReactDOMRoot); // 判断实例
    expectTypeOf(root).toBeObject(); // 对象
    expect(root._name).toBe('Class_ReactDOMRoot') // 属性
    expect('render' in root).toBeTruthy(); // 方法

  })

  it('render', () => {
    // expect(ReactDOM.updateContainer).toHaveBeenCalledTimes(1); // ?
    const root = ReactDOM.createRoot(container);
    const spy_render = vi.spyOn(root, 'render');
    // spy_render
    // root.render(<div></div>);
  })
})