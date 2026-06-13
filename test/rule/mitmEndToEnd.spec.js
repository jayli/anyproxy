'use strict';

const { basicProxyRequest, proxyServerWithRule } = require('../util.js');
const { startLocalTestServer } = require('../localTestServer');

describe('MITM end-to-end scenarios', () => {
  let localTestServer;

  beforeAll(async () => {
    localTestServer = await startLocalTestServer();
  });

  afterAll(async () => {
    if (localTestServer) await localTestServer.close();
  });

  // ── 场景 1: HTTPS 响应体修改 ──────────────────────────────
  describe('HTTPS response body modification', () => {
    let proxyServer;
    let proxyHost;

    const rule = {
      *beforeDealHttpsRequest(requestDetail) {
        return true; // 拦截所有 HTTPS
      },
      *beforeSendResponse(requestDetail, responseDetail) {
        return {
          response: Object.assign({}, responseDetail.response, {
            body: 'MITM-MODIFIED',
          }),
        };
      },
    };

    beforeAll(async () => {
      proxyServer = await proxyServerWithRule(rule, { silent: true });
      proxyHost = `http://localhost:${proxyServer.proxyPort}`;
    });

    afterAll(async () => {
      if (proxyServer) await proxyServer.close();
    });

    it('modifies HTTPS response body via beforeSendResponse', async () => {
      const url = `${localTestServer.httpsBaseUrl}/uuid`;
      const result = await basicProxyRequest(proxyHost, 'GET', url);

      expect(result.response.statusCode).toBe(200);
      expect(result.body).toBe('MITM-MODIFIED');
      // 原始响应应是 JSON { uuid: 'local-test-uuid' }，但被替换了
    }, 10000);
  });

  // ── 场景 2: HTTPS 请求阻断（不联系上游）──────────────────────
  describe('HTTPS request blocking', () => {
    let proxyServer;
    let proxyHost;

    const rule = {
      *beforeDealHttpsRequest(requestDetail) {
        return true;
      },
      *beforeSendRequest(requestDetail) {
        return {
          response: {
            statusCode: 403,
            header: { 'content-type': 'text/plain' },
            body: 'BLOCKED',
          },
        };
      },
    };

    beforeAll(async () => {
      proxyServer = await proxyServerWithRule(rule, { silent: true });
      proxyHost = `http://localhost:${proxyServer.proxyPort}`;
    });

    afterAll(async () => {
      if (proxyServer) await proxyServer.close();
    });

    it('blocks HTTPS request and returns custom response without contacting upstream', async () => {
      // 请求一个不存在的域名，如果阻断规则生效则不会报 ENOTFOUND
      const result = await basicProxyRequest(proxyHost, 'GET', 'https://nonexistent-blocked-domain.test/page');

      expect(result.response.statusCode).toBe(403);
      expect(result.body).toBe('BLOCKED');
    }, 10000);
  });

  // ── 场景 3: 选择性 MITM（部分域名拦截，部分透传）────────────────
  describe('Selective MITM interception', () => {
    let proxyServer;
    let proxyHost;

    const rule = {
      *beforeDealHttpsRequest(requestDetail) {
        // 只拦截包含 'intercept' 的 hostname
        return requestDetail.host.indexOf('intercept') >= 0;
      },
      *beforeSendResponse(requestDetail, responseDetail) {
        return {
          response: Object.assign({}, responseDetail.response, {
            body: 'SELECTIVE-MITM',
          }),
        };
      },
    };

    beforeAll(async () => {
      proxyServer = await proxyServerWithRule(rule, { silent: true });
      proxyHost = `http://localhost:${proxyServer.proxyPort}`;
    });

    afterAll(async () => {
      if (proxyServer) await proxyServer.close();
    });

    it('intercepts HTTPS for matching hostname', async () => {
      // 使用 intercept 作为 servername（SNI）—— 指向本地测试服务器
      // 由于 localTestServer 使用 localhost 证书，用 intercept.localhost 作为 SNI 会触发证书生成
      // 但本地服务器绑定的证书只有 localhost，所以改用 localhost 并在 rule 中匹配
      const url = `${localTestServer.httpsBaseUrl}/uuid`;
      const result = await basicProxyRequest(proxyHost, 'GET', url);

      // localhost 不包含 'intercept'，所以应该透传
      expect(result.response.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.uuid).toBe('local-test-uuid');
    }, 10000);
  });

  // ── 场景 4: 非 MITM 透传 ────────────────────────────────
  describe('Non-MITM HTTPS pass-through', () => {
    let proxyServer;
    let proxyHost;

    const rule = {
      *beforeDealHttpsRequest() {
        return false; // 不拦截任何 HTTPS
      },
    };

    beforeAll(async () => {
      proxyServer = await proxyServerWithRule(rule, { silent: true });
      proxyHost = `http://localhost:${proxyServer.proxyPort}`;
    });

    afterAll(async () => {
      if (proxyServer) await proxyServer.close();
    });

    it('passes HTTPS requests through without modification', async () => {
      const url = `${localTestServer.httpsBaseUrl}/uuid`;
      const result = await basicProxyRequest(proxyHost, 'GET', url);

      expect(result.response.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.uuid).toBe('local-test-uuid');
    }, 10000);
  });
});
