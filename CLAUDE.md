# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AnyProxy 是一个基于 Node.js 的可配置 HTTP/HTTPS 代理服务器，支持插件化规则拦截和修改请求/响应。这是从 alibaba/anyproxy 4.1.3 fork 的版本，发布为 `@bachi/anyproxy`。

## 常用命令

```bash
# 安装依赖
pnpm install

# 运行所有测试
npx jest

# 运行单个测试文件
npx jest test/basic.spec.js

# 运行单个测试（按名称匹配）
npx jest -t "test name pattern"

# 代码检查
npx eslint .

# 构建 Web 界面
NODE_ENV=production webpack --config web/webpack.config.js --colors

# 开发 Web 界面（带 watch）
NODE_ENV=test webpack --config web/webpack.config.js --colors --watch

# 启动测试用的外部服务器（某些测试需要）
node test/server/startServer.js

# 生成根 CA 证书
node bin/anyproxy-ca
```

## 架构概览

### 核心入口

`proxy.js` — 导出 `ProxyCore` 类（通过 `ProxyServer` 暴露）。基于 EventEmitter，利用 co/yield 处理异步流程。配置项包括：port、rule 模块、throttle、forceProxyHttps、wsIntercept 等。启动后会触发 `ready` 事件。

### lib/ 核心模块

| 模块 | 职责 |
|------|------|
| `requestHandler.js` | 请求拦截核心：处理 HTTP 代理请求、HTTPS CONNECT 隧道、HTTPS 中间人解密、WebSocket 升级、gzip/brotli 解压、chunk 分块收集。`matchResponseRule` 函数匹配自定义响应替换规则 |
| `httpsServerMgr.js` | SNI 动态证书管理器：为每个 HTTPS 域动态生成证书，管理 SNI 回调。使用 `tls.createSecureContext` 创建安全上下文 |
| `certMgr.js` | 根 CA 证书管理，基于 `node-easy-cert`。证书存储在 `~/.anyproxy/certificates/` |
| `recorder.js` | 请求录制器：使用 nedb 文件数据库存储所有请求/响应记录，支持分页查询。响应 body 大于阈值时写入临时文件 |
| `ruleLoader.js` | 规则模块加载器：支持本地文件、npm 模块、远程 URL 三种规则加载方式 |
| `rule_default.js` | 默认空规则：定义了 `beforeSendRequest`、`beforeSendResponse`、`beforeDealHttpsRequest` 三个生成器函数钩子 |
| `webInterface.js` | Express 服务器，端口默认 8002。提供 Web GUI 界面、REST API、WebSocket 端点 |
| `wsServer.js` | WebSocket 服务端：接收浏览器请求，查询 recorder 并返回请求详情/body |
| `systemProxyMgr.js` | 系统代理设置管理器（macOS） |
| `requestErrorHandler.js` | 错误页面渲染：使用 pug 模板生成 SSL 证书错误页面和 502 错误页面 |

### 规则系统

代理规则是一个模块，导出生成器函数 (generator functions)。三个钩子按优先级调用：

1. **`*beforeDealHttpsRequest(requestDetail)`** — 决定是否拦截某个 HTTPS 请求，必须返回 `true`/`false`
2. **`*beforeSendRequest(requestDetail)`** — 请求发出前，可修改请求信息或返回本地响应来短路请求
3. **`*beforeSendResponse(requestDetail, responseDetail)`** — 响应返回前，可修改响应信息

`rule_sample/` 目录下有各种修改示例（header、data、path、protocol、statusCode、local response）。

### Web 前端

`web/` — React + Redux + Redux-Saga + Ant Design 2.x 的 SPA。Webpack 3 构建，Less 样式，Babel 6 转译。

- `web/src/index.jsx` — 入口组件
- `web/src/reducer/` — Redux store（globalStatus + requestRecord）
- `web/src/saga/rootSaga.js` — WebSocket 消息处理
- `web/src/component/` — UI 组件：record-panel（请求列表）、record-detail（请求详情）、json-viewer 等

### 测试结构

`test/` — Jest 测试，环境为 `node`，10 秒超时，`clearMocks: true`。

- `test/util.js` — 通用测试工具：`proxyServerWithRule()` 创建带有随机可用端口的代理实例，`basicProxyRequest()` 通过代理发起 HTTP 请求
- `test/basic.spec.js` — 集成测试（HTTP/HTTPS 代理、WebSocket、隧道代理等）
- `test/rule/` — 各钩子函数的行为测试
- `test/lib/` — lib 模块单元测试
- `test/fixtures/` — 测试用的规则模块和上传文件

运行需要外部服务器的测试时，需先执行 `node test/server/startServer.js`。
