const http = require('http');
const https = require('https');
const { URL } = require('url');
const WebSocket = require('ws');

const certMgr = require('../lib/certMgr');
const { getFreePort } = require('../lib/util');

function getCertificate(commonName) {
  return new Promise((resolve, reject) => {
    certMgr.getCertificate(commonName, (error, key, cert) => {
      if (error) {
        reject(error);
      } else {
        resolve({ key, cert });
      }
    });
  });
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString());
    });
  });
}

function writeJson(res, statusCode, payload, headers) {
  res.writeHead(statusCode, Object.assign({
    'Content-Type': 'application/json',
  }, headers || {}));
  res.end(JSON.stringify(payload));
}

function formatHeadersForEcho(headers) {
  return Object.keys(headers).reduce((result, key) => {
    const normalizedKey = key
      .replace(/_/g, '-')
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('-');
    result[normalizedKey] = headers[key];
    return result;
  }, {});
}

async function requestHandler(req, res, protocol) {
  const parsedUrl = new URL(req.url, `${protocol}://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/status/302') {
    res.statusCode = 302;
    res.setHeader('Location', '/redirect-target');
    res.end('');
    return;
  }

  if (/^\/status\/\d+$/.test(pathname)) {
    const statusCode = parseInt(pathname.split('/').pop(), 10);
    res.statusCode = statusCode;
    res.end(`status ${statusCode}`);
    return;
  }

  if (pathname === '/brotli' || pathname === '/deflate' || pathname === '/gzip') {
    writeJson(res, 200, {
      brotli: pathname === '/brotli',
      deflated: pathname === '/deflate',
      gzipped: pathname === '/gzip',
    });
    return;
  }

  if (pathname === '/uuid') {
    writeJson(res, 200, { uuid: 'local-test-uuid' });
    return;
  }

  if (pathname === '/get' || pathname === '/post' || pathname === '/put' || pathname === '/patch' || pathname === '/delete') {
    const data = method === 'GET' ? undefined : await readRequestBody(req);
    writeJson(res, 200, {
      args: Object.fromEntries(parsedUrl.searchParams.entries()),
      data,
      headers: formatHeadersForEcho(req.headers),
      url: `${protocol}://${req.headers.host}${req.url}`,
    });
    return;
  }

  res.statusCode = 404;
  res.end('not-found');
}

function attachEchoWsServer(server) {
  const wsServer = new WebSocket.Server({ server });
  wsServer.on('connection', (socket) => {
    socket.on('message', (message) => {
      socket.send(message);
    });
  });
  return wsServer;
}

function trackSockets(server) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });
  return sockets;
}

async function startLocalTestServer() {
  const httpPort = await getFreePort();
  const httpsPort = await getFreePort();
  const tlsCert = await getCertificate('localhost');

  const httpServer = http.createServer((req, res) => {
    requestHandler(req, res, 'http');
  });
  const httpsServer = https.createServer({
    key: tlsCert.key,
    cert: tlsCert.cert,
  }, (req, res) => {
    requestHandler(req, res, 'https');
  });

  const httpSockets = trackSockets(httpServer);
  const httpsSockets = trackSockets(httpsServer);
  const httpWsServer = attachEchoWsServer(httpServer);
  const httpsWsServer = attachEchoWsServer(httpsServer);

  await Promise.all([
    new Promise((resolve) => httpServer.listen(httpPort, resolve)),
    new Promise((resolve) => httpsServer.listen(httpsPort, resolve)),
  ]);

  return {
    httpPort,
    httpsPort,
    httpBaseUrl: `http://127.0.0.1:${httpPort}`,
    httpsBaseUrl: `https://localhost:${httpsPort}`,
    wsBaseUrl: `ws://127.0.0.1:${httpPort}`,
    wssBaseUrl: `wss://localhost:${httpsPort}`,
    close() {
      httpSockets.forEach((socket) => socket.destroy());
      httpsSockets.forEach((socket) => socket.destroy());
      return Promise.all([
        new Promise((resolve) => httpWsServer.close(() => resolve())),
        new Promise((resolve) => httpsWsServer.close(() => resolve())),
        new Promise((resolve) => httpServer.close(() => resolve())),
        new Promise((resolve) => httpsServer.close(() => resolve())),
      ]);
    },
  };
}

module.exports = {
  startLocalTestServer,
};
