import View from './components/view'
import Link from './components/link'

export let _Vue

export function install(Vue) {
  //确保 install 逻辑只执行一次  
  if (install.installed && _Vue === Vue) return
  install.installed = true
  // 把 Vue 存起来并 export 供其它文件使用

  _Vue = Vue
  //判断是否等于undefined函数
  const isDef = v => v !== undefined
  // 递归
  const registerInstance = (vm, callVal) => {
    //看是否有父节点 
    let i = vm.$options._parentVnode
    // router-view 才有 registerRouteInstance 属性
    if (isDef(i) &&
      isDef(i = i.data) &&
      isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }
  // 注册一个全局 mixin
  Vue.mixin({
    beforeCreate() {
      // 初始化
      if (isDef(this.$options.router)) {
        // 根路由设置为自己
        this._routerRoot = this
        //将router挂载到 实例上
        this._router = this.$options.router
        // 调用 router.init()，
        this._router.init(this)
        // 触发组件渲染
        Vue.util.defineReactive(this, '_route', this._router.history.current)
      } else {
        // 如果不是 跟组件向上查找_routerRoot
        this._routerRoot = (this.$parent && this.$parent._routerRoot) || this
      }
      // 注册实例，实际上是挂载 <router-view>
      registerInstance(this, this)
    },
    destroyed() {
      registerInstance(this)
    }
  })
  //数据劫持      把 $router 和 $route 挂载到 Vue 原型上，这样就能在任意 Vue 实例中访问
  Object.defineProperty(Vue.prototype, '$router', {
    get() { return this._routerRoot._router }
  })

  Object.defineProperty(Vue.prototype, '$route', {
    get() { return this._routerRoot._route }
  })
  // 注册router组件
  Vue.component('RouterView', View)
  Vue.component('RouterLink', Link)
  // 利用 Vue 合并策略新增几个相关的生命周期
  const strats = Vue.config.optionMergeStrategies
  // use the same hook merging strategy for route hooks
  strats.beforeRouteEnter = strats.beforeRouteLeave = strats.beforeRouteUpdate = strats.created
}
