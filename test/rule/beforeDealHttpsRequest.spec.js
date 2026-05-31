const fs = require('fs');
const path = require('path');
const { basicProxyRequest, proxyServerWithRule, } = require('../util.js');
const { startLocalTestServer } = require('../localTestServer');

const RULE_PAYLOAD = 'this is something in rule';
let localTestServer;

const rule = {
  *beforeSendRequest(requestDetail) {
    const requestOptions = requestDetail.requestOptions;
    return {
      requestOptions,
      requestData: RULE_PAYLOAD,
    };
  },

  *beforeDealHttpsRequest(requestDetail) {
    return requestDetail.host.indexOf('localhost') >= 0;
  }
};

describe('Rule beforeDealHttpsRequest', () => {
  let proxyServer;
  let proxyPort;
  let proxyHost;

  beforeAll(async () => {
    localTestServer = await startLocalTestServer();
    proxyServer = await proxyServerWithRule(rule);
    proxyPort = proxyServer.proxyPort;
    proxyHost = `http://localhost:${proxyPort}`;
  });

  afterAll(async () => {
    if (proxyServer) {
      await proxyServer.close();
    }
    if (localTestServer) {
      await localTestServer.close();
    }
  });
  it('Should replace the https request body', async () => {
    const url = `${localTestServer.httpsBaseUrl}/put`;
    const payloadStream = fs.createReadStream(path.resolve(__dirname, '../fixtures/upload.txt'));
    const postHeaders = {
      anyproxy_header: 'header_value',
    };

    await basicProxyRequest(proxyHost, 'PUT', url, postHeaders, {}, payloadStream).then((result) => {
      const proxyRes = result.response;
      const body = JSON.parse(result.body);
      expect(proxyRes.statusCode).toBe(200);
      expect(body.data).toEqual(RULE_PAYLOAD);
      expect(body.url.indexOf('/put')).toBeGreaterThan(0);
    });
  });
});
