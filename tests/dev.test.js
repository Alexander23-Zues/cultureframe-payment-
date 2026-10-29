import { it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { availablePort, portAvailable } from '../scripts/dev.mjs';

it('selects another port without interrupting the process using the preferred port', async () => {
  const listener = net.createServer();
  const base = await availablePort(24000);
  await new Promise(resolve => listener.listen(base, '127.0.0.1', resolve));
  const port = listener.address().port;
  try {
    assert.equal(await portAvailable(port), false);
    const chosen = await availablePort(port);
    assert.notEqual(chosen, port);
    assert.equal(await portAvailable(chosen), true);
    assert.equal(listener.listening, true);
  } finally { await new Promise(resolve => listener.close(resolve)); }
});
it('reserves the web port when selecting the API port', async () => {
  const reserved = await availablePort(24500);
  const chosen = await availablePort(reserved, [reserved]);
  assert.notEqual(chosen, reserved);
  assert.equal(await portAvailable(chosen), true);
});
