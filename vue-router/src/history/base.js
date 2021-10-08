/* @flow */

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn } from '../util/warn'
import { START, isSameRoute, handleRouteEntered } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'
import {
  createNavigationDuplicatedError,
  createNavigationCancelledError,
  createNavigationRedirectedError,
  createNavigationAbortedError,
  isError,
  isNavigationFailure,
  NavigationFailureType
} from '../util/errors'

export class History {
  router: Router
  base: string
  current: Route
  pending: ?Route
  cb: (r: Route) => void
  ready: boolean
  readyCbs: Array<Function>
  readyErrorCbs: Array<Function>
  errorCbs: Array<Function>
  listeners: Array<Function>
  cleanupListeners: Function

  // implemented by sub-classes
  +go: (n: number) => void
  +push: (loc: RawLocation, onComplete?: Function, onAbort?: Function) => void
    +replace: (
      loc: RawLocation,
      onComplete?: Function,
      onAbort?: Function
    ) => void
      +ensureURL: (push?: boolean) => void
        +getCurrentLocation: () => string
          + setupListeners: Function

constructor(router: Router, base: ?string) {
  this.router = router
  this.base = normalizeBase(base)
  // start with a route object that stands for "nowhere"
  this.current = START
  this.pending = null
  this.ready = false
  this.readyCbs = []
  this.readyErrorCbs = []
  this.errorCbs = []
  this.listeners = []
}

listen(cb: Function) {
  this.cb = cb
}

onReady(cb: Function, errorCb: ?Function) {
  if (this.ready) {
    cb()
  } else {
    this.readyCbs.push(cb)
    if (errorCb) {
      this.readyErrorCbs.push(errorCb)
    }
  }
}

onError(errorCb: Function) {
  this.errorCbs.push(errorCb)
}

transitionTo(
  location: RawLocation,
  onComplete ?: Function,
  onAbort ?: Function
) {
  // 这里要 try 一下是因为 match 方法内部会在有 redirect 属性时调用它
  // 但用户提供的 redirect 方法可能会发生报错，所以这里需要捕获到错误回调方法
  let route
  // catch redirect option https://github.com/vuejs/vue-router/issues/3201
  try {
    // 这是根据当前位置匹配路由，下面会讲

    route = this.router.match(location, this.current)
  } catch (e) {
    this.errorCbs.forEach(cb => {
      cb(e)
    })
    // 依然要抛出异常，让用户得知

    throw e
  }
  // 记录之前的路由，后面会用到

  const prev = this.current
  // 这个才是真正切换路由的方法，下面会讲

  this.confirmTransition(
    // 传入准备切换的路由
    route,
    // 切换之后的回调
    () => {
      // 更新到当前路由信息 (current)，下面会讲
      this.updateRoute(route)
      // 执行用户传入的 onComplete回调
      onComplete && onComplete(route)
      // 更新浏览器地址栏上的 URL
      this.ensureURL()
      // 执行注册的 afterHooks
      this.router.afterHooks.forEach(hook => {
        hook && hook(route, prev)
      })

      // fire ready cbs once
      if (!this.ready) {
        this.ready = true
        // 执行用户传入的 onReady 回调
        this.readyCbs.forEach(cb => {
          cb(route)
        })
      }
    },
    // 发生错误的回调

    err => {
      if (onAbort) {
        onAbort(err)
      }
      // 执行用户传入的 onError 回调

      if (err && !this.ready) {
        // Initial redirection should not mark the history as ready yet
        // because it's triggered by the redirection instead
        // https://github.com/vuejs/vue-router/issues/3225
        // https://github.com/vuejs/vue-router/issues/3331
        if (!isNavigationFailure(err, NavigationFailureType.redirected) || prev !== START) {
          this.ready = true
          this.readyErrorCbs.forEach(cb => {
            cb(err)
          })
        }
      }
    }
  )
}
// 因为待跳转路由有可能是一个异步组件，所以设计成有回调的方法
confirmTransition(route: Route, onComplete: Function, onAbort ?: Function) {
  // 跳转前的的路由（from）

  const current = this.current
  // 待跳转的路由（to）

  this.pending = route
  // 错误时的回调

  const abort = err => {
    // changed after adding errors with
    // https://github.com/vuejs/vue-router/pull/3047 before that change,
    // redirect and aborted navigation would produce an err == null
    if (!isNavigationFailure(err) && isError(err)) {
      if (this.errorCbs.length) {
        this.errorCbs.forEach(cb => {
          cb(err)
        })
      } else {
        warn(false, 'uncaught error during route navigation:')
        console.error(err)
      }
    }
    onAbort && onAbort(err)
  }
  const lastRouteIndex = route.matched.length - 1
  const lastCurrentIndex = current.matched.length - 1
  // 判断是否相同路径
  if (
    isSameRoute(route, current) &&
    // in the case the route map has been dynamically appended to
    lastRouteIndex === lastCurrentIndex &&
    route.matched[lastRouteIndex] === current.matched[lastCurrentIndex]
  ) {
    // 依旧切换

    this.ensureURL()
    // 报一个重复导航的错误

    return abort(createNavigationDuplicatedError(current, route))
  }
  // 通过 from 和 to的 matched 数组拿到新增、更新、销毁的部分，以便执行组件的生命周期
  // 该方法下面会仔细讲
  const { updated, deactivated, activated } = resolveQueue(
    this.current.matched,
    route.matched
  )
  // 一个队列，存放各种组件生命周期和导航守卫
  // 这里的顺序可以看回前面讲的完整的导航解析流程，具体实现下面会讲
  const queue: Array<?NavigationGuard> = [].concat(
    // 调用此次失活的部分组件的 beforeRouteLeave
    extractLeaveGuards(deactivated),
    // 全局的 before 钩子
    this.router.beforeHooks,
    // 调用此次更新的部分组件的 beforeRouteUpdate
    extractUpdateHooks(updated),
    // 调用此次激活的路由配置的 beforeEach
    activated.map(m => m.beforeEnter),
    // 解析异步组件
    resolveAsyncComponents(activated)
  )
  // 迭代器，每次执行一个钩子，调用 next 时才会进行下一项

  const iterator = (hook: NavigationGuard, next) => {
    // 在当前导航还没有完成之前又有了一个新的导航。
    // 比如，在等待导航守卫的过程中又调用了 router.push
    // 这时候需要报一个 cancel 错误
    if (this.pending !== route) {
      return abort(createNavigationCancelledError(current, route))
    }
    // 执行当前钩子，但用户传入的导航守卫有可能会出错，需要 try 一下

    try {
      // 这就是路由钩子的参数：to、from、next

      hook(route, current, (to: any) => {
        // 我们可以通过 next('/login') 这样的方式来重定向
        // 如果传入 false 则中断当前的导航，并将 URL 重置到 from 路由对应的地址
        if (to === false) {
          // next(false) -> abort navigation, ensure current URL
          this.ensureURL(true)
          abort(createNavigationAbortedError(current, route))
          // 如果传入 next 的参数是一个 Error 实例
          // 则导航会被终止且该错误会被传递给 router.onError() 注册过的回调。
        } else if (isError(to)) {
          // 判断传入的参数是否符合要求

          this.ensureURL(true)
          abort(to)
        } else if (
          typeof to === 'string' ||
          (typeof to === 'object' &&
            (typeof to.path === 'string' || typeof to.name === 'string'))
        ) {
          // next('/') or next({ path: '/' }) -> redirect
          abort(createNavigationRedirectedError(current, route))
          // 判断切换类型

          if (typeof to === 'object' && to.replace) {
            this.replace(to)
          } else {
            this.push(to)
          }
        } else {
          // 不符合则跳转至 to
          // confirm transition and pass on the value
          next(to)
        }
      })
      // 出错时执行 abort 回调

    } catch (e) {
      abort(e)
    }
  }
  // queue 就是上面那个队列
  // iterator 传入 to、from、next，只有执行 next 才会进入下一项
  // cb 回调函数，当执行完整个队列后调用
  runQueue(queue, iterator, () => {
    // wait until async components are resolved before
    // extracting in-component enter guards
    const enterGuards = extractEnterGuards(activated)
    const queue = enterGuards.concat(this.router.resolveHooks)
    runQueue(queue, iterator, () => {
      if (this.pending !== route) {
        return abort(createNavigationCancelledError(current, route))
      }
      this.pending = null
      onComplete(route)
      if (this.router.app) {
        this.router.app.$nextTick(() => {
          handleRouteEntered(route)
        })
      }
    })
  })
}

updateRoute(route: Route) {
  this.current = route
  this.cb && this.cb(route)
}

setupListeners() {
  // Default implementation is empty
}

teardown() {
  // clean up event listeners
  // https://github.com/vuejs/vue-router/issues/2341
  this.listeners.forEach(cleanupListener => {
    cleanupListener()
  })
  this.listeners = []

  // reset current history route
  // https://github.com/vuejs/vue-router/issues/3294
  this.current = START
  this.pending = null
}
}

function normalizeBase(base: ?string): string {
  if (!base) {
    if (inBrowser) {
      // respect <base> tag
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  return base.replace(/\/$/, '')
}

function resolveQueue(
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length)
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  return {
    updated: next.slice(0, i),
    activated: next.slice(i),
    deactivated: current.slice(i)
  }
}
// records: routerRecord 数组
// name 钩子的名字
// bind 就是 bindGuard 方法，下面会讲
// reverse 是否倒序执行
function extractGuards(
  records: Array<RouteRecord>,
  name: string,
  bind: Function,
  reverse?: boolean
): Array<?Function> {
  const guards = flatMapComponents(records, (def, instance, match, key) => {
    const guard = extractGuard(def, name)
    if (guard) {
      return Array.isArray(guard)
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  return flatten(reverse ? guards.reverse() : guards)
}

function extractGuard(
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def)
  }
  return def.options[key]
}

function extractLeaveGuards(deactivated: Array<RouteRecord>): Array<?Function> {
  // 最后一个参数为 true 是因为这个生命周期要倒序执行，先执行子路由的再执行父路由的
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}

function extractUpdateHooks(updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}
// guard：某个生命周期钩子
// instance：执行的 vue 实例
function bindGuard(guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    // 这时只是返回这个方法，没有立即调用

    return function boundRouteGuard() {
      // 调用这个钩子

      return guard.apply(instance, arguments)
    }
  }
}

function extractEnterGuards(
  activated: Array<RouteRecord>
): Array<?Function> {
  return extractGuards(
    activated,
    'beforeRouteEnter',
    (guard, _, match, key) => {
      return bindEnterGuard(guard, match, key)
    }
  )
}

function bindEnterGuard(
  guard: NavigationGuard,
  match: RouteRecord,
  key: string
): NavigationGuard {
  return function routeEnterGuard(to, from, next) {
    return guard(to, from, cb => {
      if (typeof cb === 'function') {
        if (!match.enteredCbs[key]) {
          match.enteredCbs[key] = []
        }
        match.enteredCbs[key].push(cb)
      }
      next(cb)
    })
  }
}
