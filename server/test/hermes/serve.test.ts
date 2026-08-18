import { describe, expect, it } from 'vitest';
import { writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReadyLine, spawnServe } from '../../src/hermes/serve.js';

describe('serve', () => {
  it('parses the ready line', () => {
    expect(parseReadyLine('HERMES_BACKEND_READY port=39123')).toBe(39123);
    expect(parseReadyLine('HERMES_DASHBOARD_READY port=1')).toBe(1);
    expect(parseReadyLine('info: loading config')).toBeNull();
  });

  it('spawns a fake hermes and waits for the ready line', async () => {
    const fake = '#!/bin/sh\nprintf \'HERMES_BACKEND_READY port=48002\\n\'\nwhile :; do :; done\n';
    const path = join(tmpdir(), `fake-hermes-${process.pid}.sh`);
    writeFileSync(path, fake); chmodSync(path, 0o755);
    const { info, child } = await spawnServe(path);
    expect(info.port).toBe(48002);
    expect(info.token).toMatch(/^[0-9a-f]{32}$/);
    child.kill('SIGKILL');
  }, 10000);

  it('strips ANTHROPIC_* env from the child', async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-leak';
    const fake = '#!/bin/sh\n[ -n "$ANTHROPIC_AUTH_TOKEN" ] && exit 1\nprintf \'HERMES_BACKEND_READY port=48003\\n\'\nwhile :; do :; done\n';
    const path = join(tmpdir(), `fake-hermes-strip-${process.pid}.sh`);
    writeFileSync(path, fake); chmodSync(path, 0o755);
    const { info, child } = await spawnServe(path);
    expect(info.port).toBe(48003);
    child.kill('SIGKILL');
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  }, 10000);
});
