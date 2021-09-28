'use strict'



const onFinished = require('on-finished')
const response = require('./response')
const context = require('./context')
const request = require('./request')
const statuses = require('statuses')
const Emitter = require('events')
const util = require('util')
const Stream = require('stream')
const http = require('http')
const only = require('only')
const { HttpError } = require('http-errors')
    //1. 每次请求上下文应该是独立的
    //2.每个应用创建的上下文也是不一样的
module.exports = class Application extends Emitter {
    constructor() {
        super();
        this.middleware = []
            // 每次实例化都需要不同的上下文  互不影响
        this.context = Object.create(context)
        this.request = Object.create(request)
        this.response = Object.create(response)
    }
    toJSON() {
        return only(this, [
            'subdomainOffset',
            'proxy',
            'env'
        ])
    }
    inspect() {
        return this.toJSON()
    }

    listen(...args) {
        // 开启监听端口
        // 将callback抽离
        const server = http.createServer(this.callback())
        return server.listen(...args)
    }

    use(fn) {
        // 将中间件保存
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!')
        this.middleware.push(fn)
        return this
    }
    createContext(req, res) {
        const context = Object.create(this.context)
        const request = context.request = Object.create(this.request)
        const response = context.response = Object.create(this.response)
        context.app = request.app = response.app = this
        context.req = request.req = response.req = req
        context.res = request.res = response.res = res
        request.ctx = response.ctx = context
        request.response = response
        response.request = request
        context.originalUrl = request.originalUrl = req.url
        context.state = {}
        return context
    }
    callback() {
        // 洋葱模型的实现
        // fn=dispatch(0)  fn等于中间件递归循环的开始
        const fn = this.compose(this.middleware)
        const handleRequest = (req, res) => {
            const ctx = this.createContext(req, res)
            return this.handleRequest(ctx, fn)
        }
        return handleRequest
    }
    compose(middleware) {
        // 错误检测
        if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an array!')
        for (const fn of middleware) {
            if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
        }

        return function(context, next) {
            let index = -1
                // 从0（也就是第一个）开始递归调用
            return dispatch(0)

            function dispatch(i) {
                // next 只能调用一次   （）
                if (i <= index) return Promise.reject(new Error('next() called multiple times'))
                index = i
                let fn = middleware[i]
                    // 全部调用完毕  promise循环调用结束 开始回溯
                if (i === middleware.length) fn = next
                if (!fn) return Promise.resolve()
                try {
                    // 如果没有调用完毕  继续返回promise  next=dispatch.bind(null, i + 1) 就是下一个中间件
                    return Promise.resolve(fn(context, dispatch.bind(null, i + 1)))
                } catch (err) {
                    return Promise.reject(err)
                }
            }
        }
    }
    handleRequest(ctx, fnMiddleware) {
        const res = ctx.res
        res.statusCode = 404
        const onerror = err => ctx.onerror(err)
        const handleResponse = () => this.respond(ctx)
        onFinished(res, onerror)
        return fnMiddleware(ctx).then(handleResponse).catch(onerror)
    }

    respond(ctx) {
        // 对ctx 进行进一步处理
        if (ctx.respond === false) return
        if (!ctx.writable) return

        const res = ctx.res
        let body = ctx.body
        const code = ctx.status


        if (ctx.method === 'HEAD') {
            if (!res.headersSent && !ctx.response.has('Content-Length')) {
                const { length } = ctx.response
                if (Number.isInteger(length)) ctx.length = length
            }
            return res.end()
        }

        // status body
        if (body == null) {
            if (ctx.response._explicitNullBody) {
                ctx.response.remove('Content-Type')
                ctx.response.remove('Transfer-Encoding')
                ctx.length = 0
                return res.end()
            }
            if (ctx.req.httpVersionMajor >= 2) {
                body = String(code)
            } else {
                body = ctx.message || String(code)
            }
            if (!res.headersSent) {
                ctx.type = 'text'
                ctx.length = Buffer.byteLength(body)
            }
            return res.end(body)
        }

        // responses
        if (Buffer.isBuffer(body)) return res.end(body)
        if (typeof body === 'string') return res.end(body)
        if (body instanceof Stream) return body.pipe(res)

        // body: json
        body = JSON.stringify(body)
        if (!res.headersSent) {
            ctx.length = Buffer.byteLength(body)
        }
        res.end(body)
    }


    onerror(err) {
        // When dealing with cross-globals a normal `instanceof` check doesn't work properly.
        // See https://github.com/koajs/koa/issues/1466
        // We can probably remove it once jest fixes https://github.com/facebook/jest/issues/2549.
        const isNativeError =
            Object.prototype.toString.call(err) === '[object Error]' ||
            err instanceof Error
        if (!isNativeError) throw new TypeError(util.format('non-error thrown: %j', err))

        if (err.status === 404 || err.expose) return
        if (this.silent) return

        const msg = err.stack || err.toString()
        console.error(`\n${msg.replace(/^/gm, '  ')}\n`)
    }

    /**
     * Help TS users comply to CommonJS, ESM, bundler mismatch.
     * @see https://github.com/koajs/koa/issues/1513
     */

    static get default() {
        return Application
    }

}