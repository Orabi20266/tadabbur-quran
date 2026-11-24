import { APP_VERSION } from './version';

export const RELEASES_URL =
  'https://api.github.com/repos/Orabi20266/tadabbur-quran/releases?per_page=20';

const CACHE_KEY = 'tadabbur.update.v1';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_EVENT = 'tadabbur:update';

type Version = [number, number, number];

export interface GithubRelease {
  tag_name: string;
  html_url: string;
  name?: string | null;
  body?: string | null;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{
    name: string;
    browser_download_url: string;
    content_type?: string;
  }>;
}

export interface UpdateInfo {
  version: string;
  releaseUrl: string;
  downloadUrl: string | null;
  publishedAt: string | null;
}

interface CachedCheck {
  checkedAt: number;
  update: UpdateInfo | null;
}

export function parseVersion(tag: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i.exec(tag.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(candidate);
  if (!a || !b) return false;
  return compareVersions(b, a) > 0;
}

function findApk(release: GithubRelease): string | null {
  const apk = release.assets?.find((asset) => /\.apk$/i.test(asset.name));
  return apk?.browser_download_url ?? null;
}

/** Pick the highest semantic version newer than the installed build. */
export function pickLatestRelease(
  releases: GithubRelease[],
  current = APP_VERSION,
): UpdateInfo | null {
  let best: { version: Version; info: UpdateInfo } | null = null;

  for (const release of releases) {
    if (release.draft) continue;
    const version = parseVersion(release.tag_name);
    if (!version || !isNewerVersion(current, release.tag_name)) continue;

    const info: UpdateInfo = {
      version: release.tag_name.replace(/^v/i, ''),
      releaseUrl: release.html_url,
      downloadUrl: findApk(release),
      publishedAt: release.published_at ?? null,
    };

    if (
      !best ||
      compareVersions(version, best.version) > 0 ||
      (compareVersions(version, best.version) === 0 &&
        (info.publishedAt ?? '') > (best.info.publishedAt ?? ''))
    ) {
      best = { version, info };
    }
  }

  return best?.info ?? null;
}

function readCache(): CachedCheck | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCheck>;
    if (typeof parsed.checkedAt !== 'number') return null;
    return {
      checkedAt: parsed.checkedAt,
      update: parsed.update ?? null,
    };
  } catch {
    return null;
  }
}

function writeCache(update: UpdateInfo | null): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ checkedAt: Date.now(), update } satisfies CachedCheck),
    );
  } catch {
    /* storage unavailable: the check simply runs again next time */
  }
}

/** Remember that the user postponed this reminder until the next check. */
export function snoozeUpdate(): void {
  writeCache(null);
}

/** GitHub API check with a short timeout; network failures are intentionally silent. */
export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  const cached = readCache();
  if (
    !force &&
    cached &&
    Date.now() - cached.checkedAt < CHECK_INTERVAL_MS
  ) {
    return cached.update;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const releases = (await response.json()) as GithubRelease[];
    const update = pickLatestRelease(releases);
    writeCache(update);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: update }));
    }
    return update;
  } catch {
    return cached?.update ?? null;
  } finally {
    clearTimeout(timer);
  }
}
