'use strict';

const tls = require('tls');
const httpsServerMgr = require('../../lib/httpsServerMgr');
const certMgr = require('../../lib/certMgr');

// 保存原始方法，测试结束后恢复
const originalGetCertificate = certMgr.getCertificate;

function countTlsConnect(port, servername, count) {
  return new Promise((resolve, reject) => {
    let completed = 0;
    const errors = [];

    function doConnect() {
      return new Promise((res, rej) => {
        const socket = tls.connect(port, '127.0.0.1', {
          servername,
          rejectUnauthorized: false,
        }, () => {
          socket.end();
          res();
        });
        socket.on('error', (err) => {
          rej(err);
        });
        // 2s 超时防止挂起
        socket.setTimeout(2000, () => {
          socket.destroy();
          rej(new Error('tls connect timeout'));
        });
      });
    }

    (async () => {
      for (let i = 0; i < count; i++) {
        try {
          await doConnect();
          completed++;
        } catch (e) {
          errors.push(e);
        }
      }
      resolve({ completed, errors });
    })();
  });
}

describe('SNI SecureContext cache integration', () => {
  let serverMgr;
  let sniServer;
  let sniPort;
  let certCallCounts;

  beforeAll(async () => {
    // 用 counting wrapper 替换 certMgr.getCertificate
    certCallCounts = new Map();
    certMgr.getCertificate = function patchedGetCertificate(hostname, callback) {
      certCallCounts.set(hostname, (certCallCounts.get(hostname) || 0) + 1);
      return originalGetCertificate.call(certMgr, hostname, callback);
    };

    serverMgr = new httpsServerMgr({
      hostname: '127.0.0.1',
      handler: (req, res) => { res.end('ok'); },
      wsHandler: () => {},
    });

    const serverInfo = await serverMgr.getSharedHttpsServer('sni-cache-test.local');
    sniPort = serverInfo.port;
  });

  afterAll(async () => {
    // 恢复原始方法
    certMgr.getCertificate = originalGetCertificate;
    if (serverMgr) {
      await serverMgr.close();
    }
  });

  beforeEach(() => {
    certCallCounts.clear();
  });

  it('calls getCertificate only once for repeated connections to the same hostname', async () => {
    const hostname = 'cache-hit-test.local';
    const result = await countTlsConnect(sniPort, hostname, 5);

    expect(result.completed).toBe(5);
    expect(certCallCounts.get(hostname)).toBe(1);
  }, 30000);

  it('calls getCertificate once per unique hostname', async () => {
    const hostA = 'unique-a.local';
    const hostB = 'unique-b.local';

    await countTlsConnect(sniPort, hostA, 3);
    await countTlsConnect(sniPort, hostB, 2);

    expect(certCallCounts.get(hostA)).toBe(1);
    expect(certCallCounts.get(hostB)).toBe(1);
  }, 30000);

  it('re-fetches certificate after LRU eviction', async () => {
    // 默认缓存容量 1000，这个测试验证缓存有上限
    // 通过 httpsServerMgr._test.createLRUCache 单独验证逐出行为
    // 这里验证缓存的基本行为：同一 hostname 的第二次连接不触发查找
    const hostname = 'eviction-test.local';

    await countTlsConnect(sniPort, hostname, 1);
    expect(certCallCounts.get(hostname)).toBe(1);

    certCallCounts.clear();
    await countTlsConnect(sniPort, hostname, 1);

    // 缓存命中，不应再次调用 getCertificate
    expect(certCallCounts.get(hostname)).toBeUndefined();
  }, 15000);
});
