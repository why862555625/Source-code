/* @flow */
//首先从 0 开始按顺序遍历 queue 中的每一项，在调用 fn 时作为第一个参数传入，当使用者调用了第二个参数的回调时，才进入下一次项，最后遍历完 queue 中所有的项后，调用 cb 回到参数。
export function runQueue(queue: Array<?NavigationGuard>, fn: Function, cb: Function) {
  const step = index => {
    if (index >= queue.length) {
      cb()
    } else {
      if (queue[index]) {
        fn(queue[index], () => {
          step(index + 1)
        })
      } else {
        step(index + 1)
      }
    }
  }
  step(0)
}
