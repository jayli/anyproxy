process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const http = require('http');
const request = require('request');

const { proxyServerWithRule } = require('./util.js');

jest.setTimeout(30000);

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, () => {
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  if (!server) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function proxyRequest(proxyHost, method, url, body) {
  return new Promise((resolve, reject) => {
    request({
      method,
      url,
      body,
      proxy: proxyHost,
      followRedirect: false,
      rejectUnauthorized: false,
      headers: {
        'via-anyproxy': 'true',
        Connection: 'keep-alive',
      },
    }, (error, response, responseBody) => {
      if (error) {
        reject(error);
      } else {
        resolve({
          response,
          body: responseBody,
        });
      }
    });
  });
}

describe('requestHandler retry behavior', () => {
  let proxyServer;
  let proxyHost;
  let upstreamServer;
  let upstreamBaseUrl;
  let nextSocketId;
  let socketIds;
  let socketRequestCounts;
  let requestLog;
  let postBodies;

  beforeEach(async () => {
    nextSocketId = 1;
    socketIds = new Map();
    socketRequestCounts = new Map();
    requestLog = [];
    postBodies = [];

    upstreamServer = http.createServer((req, res) => {
      let socketId = socketIds.get(req.socket);
      if (!socketId) {
        socketId = nextSocketId++;
        socketIds.set(req.socket, socketId);
      }

      const requestCount = (socketRequestCounts.get(req.socket) || 0) + 1;
      socketRequestCounts.set(req.socket, requestCount);
      requestLog.push({
        url: req.url,
        method: req.method,
        socketId,
        requestCount,
      });

      if (req.url === '/warmup') {
        res.end('warmup-ok');
        return;
      }

      if (req.url === '/retry-get') {
        if (requestCount === 2) {
          req.socket.destroy();
          return;
        }
        res.end('retry-get-ok');
        return;
      }

      if (req.url === '/retry-post') {
        const chunks = [];
        req.on('data', (chunk) => {
          chunks.push(chunk);
        });
        req.on('end', () => {
          postBodies.push(Buffer.concat(chunks).toString());
          if (requestCount === 2) {
            req.socket.destroy();
            return;
          }
          res.end('retry-post-ok');
        });
        return;
      }

      res.statusCode = 404;
      res.end('not-found');
    });

    const address = await listen(upstreamServer);
    upstreamBaseUrl = `http://127.0.0.1:${address.port}`;

    proxyServer = await proxyServerWithRule({}, { silent: true });
    proxyHost = `http://localhost:${proxyServer.proxyPort}`;
  });

  afterEach(async () => {
    await closeServer(upstreamServer);
    if (proxyServer) {
      await proxyServer.close();
    }
  });

  it('retries GET on a fresh connection after a reused socket resets', async () => {
    const warmupResult = await proxyRequest(proxyHost, 'GET', `${upstreamBaseUrl}/warmup`);
    expect(warmupResult.response.statusCode).toBe(200);
    expect(warmupResult.body).toBe('warmup-ok');

    const retryResult = await proxyRequest(proxyHost, 'GET', `${upstreamBaseUrl}/retry-get`);
    expect(retryResult.response.statusCode).toBe(200);
    expect(retryResult.body).toBe('retry-get-ok');

    const warmupEntry = requestLog.find((entry) => entry.url === '/warmup');
    const retryEntries = requestLog.filter((entry) => entry.url === '/retry-get');

    expect(retryEntries).toHaveLength(2);
    expect(retryEntries[0].socketId).toBe(warmupEntry.socketId);
    expect(retryEntries[1].socketId).not.toBe(warmupEntry.socketId);
  });

  it('does not retry POST after a reused socket resets', async () => {
    const warmupResult = await proxyRequest(proxyHost, 'GET', `${upstreamBaseUrl}/warmup`);
    expect(warmupResult.response.statusCode).toBe(200);

    const postResult = await proxyRequest(proxyHost, 'POST', `${upstreamBaseUrl}/retry-post`, 'payload-body');
    expect(postResult.response.statusCode).toBe(500);
    expect(postBodies).toEqual(['payload-body']);

    const warmupEntry = requestLog.find((entry) => entry.url === '/warmup');
    const postEntries = requestLog.filter((entry) => entry.url === '/retry-post');

    expect(postEntries).toHaveLength(1);
    expect(postEntries[0].socketId).toBe(warmupEntry.socketId);
  });
});
