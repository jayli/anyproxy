const { EventEmitter } = require('events');
const RequestHandler = require('../../lib/requestHandler');

describe('requestHandler socket map cleanup', () => {
  it('deletes the map entry when the tracked socket closes', () => {
    expect(RequestHandler._test).toBeDefined();

    const map = new Map();
    const socket = new EventEmitter();
    const key = '127.0.0.1:12345';
    map.set(key, socket);

    RequestHandler._test.registerSocketMapCleanup(map, key, socket);
    socket.emit('close');

    expect(map.has(key)).toBe(false);
  });

  it('does not delete a newer socket that replaced the old entry', () => {
    const map = new Map();
    const oldSocket = new EventEmitter();
    const newSocket = new EventEmitter();
    const key = '127.0.0.1:12345';

    map.set(key, oldSocket);
    RequestHandler._test.registerSocketMapCleanup(map, key, oldSocket);

    map.set(key, newSocket);
    oldSocket.emit('close');

    expect(map.get(key)).toBe(newSocket);
  });
});
