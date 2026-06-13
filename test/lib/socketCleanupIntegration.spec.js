'use strict';

const { basicProxyRequest, proxyServerWithRule } = require('../util.js');
const { startLocalTestServer } = require('../localTestServer');

describe('CONNECT tunnel socket cleanup integration', () => {
  let localTestServer;
  let proxyServer;
  let proxyHost;

  beforeAll(async () => {
    localTestServer = await startLocalTestServer();
    proxyServer = await proxyServerWithRule({}, { silent: true });
    proxyHost = `http://localhost:${proxyServer.proxyPort}`;
  });

  afterAll(async () => {
    if (proxyServer) await proxyServer.close();
    if (localTestServer) await localTestServer.close();
  });

  function waitForCloseEvents(ms = 500) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('clears conns and cltSockets maps after connections close', async () => {
    const url = `${localTestServer.httpsBaseUrl}/uuid`;

    // 发起 3 个 HTTPS 请求（通过 CONNECT 隧道）
    await Promise.all([
      basicProxyRequest(proxyHost, 'GET', url),
      basicProxyRequest(proxyHost, 'GET', url),
      basicProxyRequest(proxyHost, 'GET', url),
    ]);

    // 等待 socket close 事件传播
    await waitForCloseEvents();

    const conns = proxyServer.requestHandler.conns;
    const cltSockets = proxyServer.requestHandler.cltSockets;

    expect(conns).toBeDefined();
    expect(cltSockets).toBeDefined();
    expect(conns.size).toBe(0);
    expect(cltSockets.size).toBe(0);
  }, 15000);

  it('does not accumulate stale entries over many sequential connections', async () => {
    const url = `${localTestServer.httpsBaseUrl}/uuid`;

    for (let i = 0; i < 10; i++) {
      await basicProxyRequest(proxyHost, 'GET', url);
    }

    await waitForCloseEvents();

    const conns = proxyServer.requestHandler.conns;
    const cltSockets = proxyServer.requestHandler.cltSockets;

    expect(conns.size).toBe(0);
    expect(cltSockets.size).toBe(0);
  }, 30000);
});
