import type { Song } from '@songloft/plugin-sdk';

type CreateSongPayload = Parameters<typeof songloft.songs.create>[0][number];

// ── 配置 ──────────────────────────────────────────────────────────────────────
const SYNC_KEY = 'syncnew_config';

// 儿歌关键词（标题命中即跳过；由 excludeKids 控制）
const KIDS_KW = [
  '儿歌', '宝宝', '摇篮', '童谣', '小星星', '两只老虎', '拔萝卜', '世上只有妈妈好',
];
// 说唱关键词（标题命中即跳过；由 excludeRap 控制，另加说唱榜排除）
const RAP_KW = ['说唱', 'rap', 'hiphop', 'hip-hop', 'trap', 'drill', 'freestyle', '嘻哈'];

// 洛雪支持的音源平台（榜单可多平台选择，用户可选）
const PLATFORMS = [
  { id: 'wy', name: '网易云' },
  { id: 'tx', name: 'QQ音乐' },
  { id: 'kg', name: '酷狗' },
  { id: 'kw', name: '酷我' },
  { id: 'mg', name: '咪咕' },
];
// 各平台说唱榜（仅用于排除说唱，不作为可收录榜单）
const RAP_BOARDS = ['wy__991319590', 'tx__58', 'kg__44412'];
const DEFAULT_BOARDS = 'wy__3779629,wy__19723756'; // 网易云新歌榜, 飙升榜（老歌也可，用户确认）
const PAGE_SIZE = 500;
const MAX_SCAN = 5000;

// boardId 形如 `wy__3779629` / `tx__4` —— 前段是平台，后段是榜单 id
function parseBoardId(boardId: string): { source: string; boardId: string } {
  const idx = boardId.indexOf('__');
  if (idx <= 0) return { source: 'wy', boardId };
  return { source: boardId.slice(0, idx), boardId: boardId.slice(idx + 2) };
}

function toName(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v
      .map((x) => (x && typeof x === 'object' ? String((x as Record<string, unknown>).name ?? '') : String(x)))
      .filter(Boolean)
      .join('/');
  }
  if (typeof v === 'object') return String((v as Record<string, unknown>).name ?? '');
  return String(v);
}

export interface SyncNewConfig {
  enabled: boolean;
  limit: number;
  boards: string;
  playlistId: number;
  hour: number;
  minute: number;
  excludeRap: boolean;
  excludeKids: boolean;
  excludeKeywords: string;
}

export async function loadSyncConfig(): Promise<SyncNewConfig> {
  const raw = await songloft.storage.get(SYNC_KEY);
  const cfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) || {};
  return {
    enabled: cfg.enabled ?? false,
    limit: cfg.limit ?? 10,
    boards: cfg.boards ?? DEFAULT_BOARDS,
    playlistId: cfg.playlistId ?? 4,
    hour: cfg.hour ?? 9,
    minute: cfg.minute ?? 0,
    excludeRap: cfg.excludeRap ?? true,
    excludeKids: cfg.excludeKids ?? true,
    excludeKeywords: cfg.excludeKeywords ?? '',
  };
}

export async function saveSyncConfig(patch: Partial<SyncNewConfig>): Promise<SyncNewConfig> {
  const merged = { ...(await loadSyncConfig()), ...patch };
  await songloft.storage.set(SYNC_KEY, merged);
  return merged;
}

function isSkip(title: string, cfg: SyncNewConfig): boolean {
  const t = (title || '').toLowerCase();
  if (cfg.excludeRap && RAP_KW.some((k) => t.includes(k.toLowerCase()))) return true;
  if (cfg.excludeKids && KIDS_KW.some((k) => t.includes(k.toLowerCase()))) return true;
  const custom = String(cfg.excludeKeywords || '')
    .split(/[,，;；]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (custom.some((k) => t.includes(k))) return true;
  return false;
}

// ── 洛雪音源 API（宿主鉴权）──────────────────────────────────────────────────

async function lxFetch(path: string): Promise<Record<string, unknown> | unknown[]> {
  const hostUrl = await songloft.plugin.getHostUrl();
  const token = await songloft.plugin.getToken();
  const url = `${hostUrl}/api/v1/jsplugin/lxmusic/api${path}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`洛雪接口 ${path} HTTP ${resp.status}`);
  }
  return await resp.json();
}

async function fetchBoard(boardId: string): Promise<Record<string, unknown>[]> {
  const { source } = parseBoardId(boardId);
  const data = (await lxFetch(
    `/leaderboard/list?source_id=${encodeURIComponent(source)}&board_id=${encodeURIComponent(boardId)}`,
  )) as Record<string, unknown>;
  const d = (data?.data as Record<string, unknown>) || data || {};
  return (d.list as Record<string, unknown>[]) || (d.songs as Record<string, unknown>[]) || [];
}

/** 洛雪插件是否可用（未安装/未响应 → false，前端据此隐藏新歌同步） */
export async function lxAvailable(): Promise<boolean> {
  try {
    await lxFetch('/leaderboard/boards?source_id=wy');
    return true;
  } catch {
    return false;
  }
}

export interface BoardInfo {
  id: string;
  name: string;
}
export interface PlatformBoards {
  id: string;
  name: string;
  boards: BoardInfo[];
}

/** 列出各平台榜单（排除说唱榜），供前端多平台选择 */
export async function listBoards(): Promise<{ available: boolean; platforms: PlatformBoards[] }> {
  const hostUrl = await songloft.plugin.getHostUrl();
  const token = await songloft.plugin.getToken();
  let available = false;
  const platforms: PlatformBoards[] = [];
  for (const p of PLATFORMS) {
    try {
      const resp = await fetch(`${hostUrl}/api/v1/jsplugin/lxmusic/api/leaderboard/boards?source_id=${p.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) continue;
      available = true;
      const data = (await resp.json()) as { data?: { id: string; name: string }[] };
      const boards = (data?.data || [])
        .filter((b) => b && b.id && !RAP_BOARDS.includes(b.id))
        .map((b) => ({ id: b.id, name: b.name }));
      if (boards.length) platforms.push({ id: p.id, name: p.name, boards });
    } catch {
      // 单个平台失败跳过（如未启用），不影响其它平台
    }
  }
  return { available, platforms };
}

async function getExistingKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let offset = 0;
  while (offset < MAX_SCAN) {
    const page = (await songloft.songs.list({ limit: PAGE_SIZE, offset })) as Song[];
    if (!Array.isArray(page) || page.length === 0) break;
    for (const s of page) {
      if (s.dedup_key) keys.add(s.dedup_key);
    }
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return keys;
}

// ── 执行同步 ─────────────────────────────────────────────────────────────────

export interface SyncResult {
  ok: boolean;
  added: number;
  skipped: number;
  candidates: number;
  reason?: string;
}

export async function runSync(opts?: { dryRun?: boolean }): Promise<SyncResult> {
  const cfg = await loadSyncConfig();
  try {
    const existing = await getExistingKeys();
    const seen = new Set<string>();

    // 各平台说唱榜内歌曲（用户明确不要说唱/嘻哈；按 `平台:musicId` 匹配）
    const rapKeys = new Set<string>();
    if (cfg.excludeRap) {
      for (const rb of RAP_BOARDS) {
        const { source } = parseBoardId(rb);
        for (const s of await fetchBoard(rb)) {
          const mid = String(s.musicId || s.songmid || '');
          if (mid) rapKeys.add(`${source}:${mid}`);
        }
      }
    }

    const candidates: (Record<string, unknown> & { _dk: string; _source: string })[] = [];
    for (const b of String(cfg.boards).split(',').map((x) => x.trim()).filter(Boolean)) {
      const { source } = parseBoardId(b);
      for (const s of await fetchBoard(b)) {
        const mid = String(s.musicId || s.songmid || '');
        const name = String(s.name || '');
        if (!mid || !name) continue;
        const dk = `${source}:${mid}`;
        if (existing.has(dk) || seen.has(dk)) continue;
        if (isSkip(name, cfg)) continue;
        if (rapKeys.has(dk)) continue;
        seen.add(dk);
        candidates.push({ ...s, _dk: dk, _source: source });
      }
    }

    const pick = candidates.slice(0, Math.max(0, cfg.limit));
    if (opts?.dryRun) {
      return { ok: true, added: 0, skipped: candidates.length - pick.length, candidates: candidates.length };
    }
    if (pick.length === 0) {
      return { ok: true, added: 0, skipped: 0, candidates: candidates.length };
    }

    const payloads: CreateSongPayload[] = pick.map((s) => {
      const mid = String(s.musicId || s.songmid || '');
      const name = String(s.name || '');
      const singer = toName(s.singer ?? s.artist);
      const album = String(s.album || '');
      const cover = String(s.img || '');
      const source = String(s._source || 'wy');
      return {
        title: name,
        artist: singer,
        album: album || undefined,
        coverUrl: cover || undefined,
        duration: Number(s.duration) || undefined,
        dedupKey: String(s._dk),
        sourceData: JSON.stringify({
          platform: source,
          quality: 'master',
          songInfo: {
            name,
            singer,
            album,
            source,
            musicId: s.musicId ?? undefined,
            duration: Number(s.duration) || 0,
            songmid: s.songmid ?? undefined,
            albumId: s.albumId ?? undefined,
          },
        }),
        lyricRemoteUrl: mid
          ? `/api/v1/jsplugin/lxmusic/api/direct/lyric?source=${encodeURIComponent(source)}&musicId=${mid}`
          : undefined,
        isVideo: false,
      };
    });

    const created = (await songloft.songs.create(payloads)) as Song[];
    const ids = (created || []).map((s) => s.id).filter((id): id is number => typeof id === 'number');
    if (ids.length > 0 && cfg.playlistId) {
      await songloft.playlists.addSongs(cfg.playlistId, ids);
    }
    songloft.log.info(
      `[新歌同步] 入库 ${ids.length} 首 -> 歌单 ${cfg.playlistId} (候选 ${candidates.length}, 跳过 ${candidates.length - pick.length})`,
    );
    return { ok: true, added: ids.length, skipped: candidates.length - pick.length, candidates: candidates.length };
  } catch (e) {
    songloft.log.error(`[新歌同步] 失败: ${String(e)}`);
    return { ok: false, added: 0, skipped: 0, candidates: 0, reason: String(e) };
  }
}

// ── 每日定时调度（与推送/备份一致）────────────────────────────────────────────

let syncTimerId: number | null = null;

export function scheduleNextSync(): void {
  if (syncTimerId !== null) {
    clearTimeout(syncTimerId);
    syncTimerId = null;
  }
  loadSyncConfig()
    .then((cfg) => {
      if (!cfg.enabled) return;
      const now = Date.now();
      const next = new Date(now);
      next.setHours(cfg.hour, cfg.minute, 0, 0);
      let fire = next.getTime();
      if (fire <= now) fire += 86400000;
      const delay = fire - now;
      songloft.log.info(
        `[新歌同步] 下次同步: ${new Date(fire).toLocaleString('zh-CN')} (延迟 ${Math.round(delay / 60000)} 分钟)`,
      );
      syncTimerId = setTimeout(async () => {
        await runSync();
        scheduleNextSync();
      }, delay);
    })
    .catch((err: unknown) => {
      songloft.log.error(`[新歌同步] 调度加载失败: ${String(err)}`);
      setTimeout(() => scheduleNextSync(), 5 * 60 * 1000);
    });
}
