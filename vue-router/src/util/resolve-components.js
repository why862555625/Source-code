/* @flow */

import { _Vue } from '../install'
import { warn } from './warn'
import { isError } from '../util/errors'

export function resolveAsyncComponents(matched: Array<RouteRecord>): Function {
  // 返回一个队列钩子函数

  return (to, from, next) => {
    // 用于标记是否异步组件
    let hasAsync = false
    // 待加载的组件数量
    let pending = 0
    // 是否加载错误

    let error = null
    // 这个方法下面会讲，主要作用是依次遍历传入的 matched 数组相关的 component

    flatMapComponents(matched, (def, _, match, key) => {
      // 判断是否异步组件

      if (typeof def === 'function' && def.cid === undefined) {
        hasAsync = true
        pending++
        // webpack 加载这个异步组件的 chunk 后执行

        const resolve = once(resolvedDef => {
          if (isESModule(resolvedDef)) {
            resolvedDef = resolvedDef.default
          }
          // 将它变成一个 vue 组件

          // save resolved on async factory in case it's used elsewhere
          def.resolved = typeof resolvedDef === 'function'
            ? resolvedDef
            : _Vue.extend(resolvedDef)
          // 把解析好的组件更新到当前路由记录中

          match.components[key] = resolvedDef
          pending--
          // 如果已经加载完则调用 next 进入下一个队列

          if (pending <= 0) {
            next()
          }
        })
        // webpack 加载这个异步组件失败后执行

        const reject = once(reason => {
          // 报个错

          const msg = `Failed to resolve async component ${key}: ${reason}`
          process.env.NODE_ENV !== 'production' && warn(false, msg)
          if (!error) {
            error = isError(reason)
              ? reason
              : new Error(msg)
            next(error)
          }
        })

        let res
        try {
          // 这里是调用 webpack 方法加载这个组件，返回的是一个 Promise

          res = def(resolve, reject)
        } catch (e) {
          reject(e)
        }
        if (res) {
          // 这里才真正加载这个组件

          if (typeof res.then === 'function') {
            res.then(resolve, reject)
          } else {
            // new syntax in Vue 2.3
            const comp = res.component
            if (comp && typeof comp.then === 'function') {
              comp.then(resolve, reject)
            }
          }
        }
      }
    })
    // 不是异步则直接 next
    if (!hasAsync) next()
  }
}

export function flatMapComponents(
  matched: Array<RouteRecord>,
  fn: Function
): Array<?Function> {
  return flatten(matched.map(m => {
    return Object.keys(m.components).map(key => fn(
      m.components[key],
      m.instances[key],
      m, key
    ))
  }))
}

export function flatten(arr: Array<any>): Array<any> {
  return Array.prototype.concat.apply([], arr)
}

const hasSymbol =
  typeof Symbol === 'function' &&
  typeof Symbol.toStringTag === 'symbol'

function isESModule(obj) {
  return obj.__esModule || (hasSymbol && obj[Symbol.toStringTag] === 'Module')
}

// in Webpack 2, require.ensure now also returns a Promise
// so the resolve/reject functions may get called an extra time
// if the user uses an arrow function shorthand that happens to
// return that Promise.
function once(fn) {
  let called = false
  return function (...args) {
    if (called) return
    called = true
    return fn.apply(this, args)
  }
}
