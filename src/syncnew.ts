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

const RAP_BOARD = 'wy__991319590';               // 说唱榜（用于排除说唱）
const DEFAULT_BOARDS = 'wy__3779629,wy__19723756'; // 新歌榜, 飙升榜（老歌也可，用户确认）
const PAGE_SIZE = 500;
const MAX_SCAN = 5000;

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
  const data = (await lxFetch(
    `/leaderboard/list?source_id=wy&board_id=${encodeURIComponent(boardId)}`,
  )) as Record<string, unknown>;
  const d = (data?.data as Record<string, unknown>) || data || {};
  return (d.list as Record<string, unknown>[]) || (d.songs as Record<string, unknown>[]) || [];
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

    // 说唱榜内歌曲（用户明确不要说唱/嘻哈）
    const rapIds = new Set<string>();
    if (cfg.excludeRap) {
      for (const s of await fetchBoard(RAP_BOARD)) {
        const mid = String(s.musicId || s.songmid || '');
        if (mid) rapIds.add(mid);
      }
    }

    const candidates: (Record<string, unknown> & { _dk: string })[] = [];
    for (const b of String(cfg.boards).split(',').map((x) => x.trim()).filter(Boolean)) {
      for (const s of await fetchBoard(b)) {
        const mid = String(s.musicId || s.songmid || '');
        const name = String(s.name || '');
        if (!mid || !name) continue;
        const dk = `wy:${mid}`;
        if (existing.has(dk) || seen.has(dk)) continue;
        if (isSkip(name, cfg)) continue;
        if (rapIds.has(mid)) continue;
        seen.add(dk);
        candidates.push({ ...s, _dk: dk });
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
      const singer = String(s.singer || s.artist || '');
      const album = String(s.album || '');
      const cover = String(s.img || '');
      return {
        title: name,
        artist: singer,
        album: album || undefined,
        coverUrl: cover || undefined,
        duration: Number(s.duration) || undefined,
        dedupKey: String(s._dk),
        sourceData: JSON.stringify({
          platform: 'wy',
          quality: 'master',
          songInfo: {
            name,
            singer,
            album,
            source: 'wy',
            musicId: s.musicId ?? undefined,
            duration: Number(s.duration) || 0,
            songmid: s.songmid ?? undefined,
            albumId: s.albumId ?? undefined,
          },
        }),
        lyricRemoteUrl: mid
          ? `/api/v1/jsplugin/lxmusic/api/direct/lyric?source=wy&musicId=${mid}`
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
