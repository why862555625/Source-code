//利用es6 proxy
const isObject = v => typeof v === 'object' && v !== null
function reactive(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      const res = Reflect.get(target, key, receiver)
      track(target, key)
      console.log('🚀 ~ file: vue3.js ~ line 6 ~ get ~ res', res)
      return isObject(res) ? reactive(res) : res
    },
    set(target, key, value, receiver) {
      const res = Reflect.set(target, key, value, recerver)
      trigger(target, key)
      return res
    },
    deleteProperty(target, key) {
      trigger(target, key)
      const res = Reflect.deleteProperty(target, key)
      console.log('🚀 ~ file: vue3.js ~ line 16 ~ deleteProperty ~ res', res)
    }
  })
}
//临时存储副作用函数
const effecStack = []
//建立传入fn和其内部的依赖之间的映射关系
function effect(fn) {
  //执行fn   触发依赖get的方法
  const e = createReativeEffet(fn)
  return e
}
function createReativeEffet(fn) {
  //封装fn   错误处理  保存到stack
  const effet = function (...args) {
    try {
      //入栈
      effecStack.push(effet)
      return fn(...args)
    } finally {
      effecStack.pop()
    }
  }
  return effet
}
//依赖收集   key=>obj     value=>
const targetMap = new WorkerMap()

function track(target, key) {
  const effet = effecStack[effecStack.length - 1]
  if (effet) {
    //初始化时target这个key不存在
    let depMap = targetMap.get(target)
    if (!depMap) {
      depMap = new Map()
      targetMap.set(target, depMap)
    }
    // 从depMap中获取副作用函数的集合
    let deps = depMap.get(key)
    if (!deps) {
      deps = new Set()
      depMap.set(key, deps)
    }
    //放入新传入的副作用函数
    deps.add(effet)
  }
}
//触发副作用
function trigger(target, key) {
  //获取target ,key 对应的set
  const depMap = targetMap.get(target)
  if (!depMap) {
    return
  }
  const deps = depMap.get(key)
  if (deps) {
    deps.forEach(dep => dep())
  }
}
