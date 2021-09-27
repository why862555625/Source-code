async function fn(args) {
    // ...
}
//等同于

function fn(args) {
    return spawn(function* () {
        // ...
    });
}

function spawn(genF) { //spawn函数就是自动执行器，跟简单版的思路是一样的，多了Promise和容错处理
    return new Promise(function (resolve, reject) {
        // 初始化generator
        const gen = genF();
        // 开始遍历generator
        step(function () { return gen.next(undefined); });

        function step(nextF) {
            let next;
            try {
                next = nextF();
            } catch (e) {
                return reject(e);
            }
            if (next.done) {
                return resolve(next.value);
            }
            // 避免不是promise报错 全部转为promise
            Promise.resolve(next.value).then(function (v) {
                // 拿到异步结果之后才会继续往下执行
                step(function () { return gen.next(v); });
            }, function (e) {
                step(function () { return gen.throw(e); });
            });
        }
    });
}
