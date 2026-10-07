import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendSetupLink } from '../../../src/services/mail.service';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('sendSetupLink', () => {
  it('logs the link outside production', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'development');

    await sendSetupLink('jean.dupont@trinity.com', 'http://front.test/reset-password?token=abc');

    expect(info).toHaveBeenCalledWith(expect.stringContaining('jean.dupont@trinity.com'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('token=abc'));
  });

  it('never logs the link in production', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');

    await sendSetupLink('jean.dupont@trinity.com', 'http://front.test/reset-password?token=abc');

    expect(info).not.toHaveBeenCalled();
  });
});
