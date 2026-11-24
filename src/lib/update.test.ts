import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate,
  isNewerVersion,
  parseVersion,
  pickLatestRelease,
  snoozeUpdate,
  type GithubRelease,
} from './update';
import { APP_VERSION } from './version';

const release = (
  tag: string,
  overrides: Partial<GithubRelease> = {},
): GithubRelease => ({
  tag_name: tag,
  html_url: `https://github.com/Orabi20266/tadabbur-quran/releases/tag/${tag}`,
  published_at: '2026-11-24T00:00:00Z',
  ...overrides,
});

function mockFetch(releases: GithubRelease[]) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => releases,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  });
});

describe('version comparison', () => {
  it('parses plain and prefixed semantic versions', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('v1.2.3-rc.1')).toEqual([1, 2, 3]);
  });

  it('ignores non-semantic release tags', () => {
    expect(parseVersion('native-preview')).toBeNull();
    expect(isNewerVersion(APP_VERSION, 'native-preview')).toBe(false);
  });

  it('compares numeric parts, not strings', () => {
    expect(isNewerVersion('1.0.0', '1.0.10')).toBe(true);
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(true);
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(false);
  });
});

describe('pickLatestRelease', () => {
  it('chooses the highest newer non-draft release with an APK', () => {
    const found = pickLatestRelease(
      [
        release('native-preview'),
        release('v0.9.0'),
        release('v1.0.0'),
        release('v1.2.0', { draft: true }),
        release('v1.1.0', {
          assets: [
            {
              name: 'tadabbur-android-debug.apk',
              browser_download_url: 'https://example.test/app.apk',
            },
          ],
        }),
      ],
      APP_VERSION,
    );

    expect(found?.version).toBe('1.1.0');
    expect(found?.downloadUrl).toBe('https://example.test/app.apk');
  });

  it('returns null when nothing newer exists', () => {
    expect(pickLatestRelease([release('native-preview'), release('v1.0.0')])).toBeNull();
  });
});

describe('checkForUpdate', () => {
  it('caches a successful check and can be forced to refresh', async () => {
    const fn = mockFetch([release('v1.1.0')]);

    expect((await checkForUpdate())?.version).toBe('1.1.0');
    expect((await checkForUpdate())?.version).toBe('1.1.0');
    expect(fn).toHaveBeenCalledTimes(1);

    await checkForUpdate(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honours snooze until the next check interval', async () => {
    const fn = mockFetch([release('v1.1.0')]);
    await checkForUpdate();
    snoozeUpdate();

    expect(await checkForUpdate()).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stays silent when GitHub cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await checkForUpdate()).toBeNull();
  });
});
