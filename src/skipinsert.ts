/**
 * 切歌补位：快速切歌后，挑不同风格歌曲插入「正在播放的队列」。
 *
 * 触发链路（客户端侧）：插件页面订阅 `window.SongloftPlugin.player.onStateChange`
 * → 检测到快速切歌（上一首播放时长 < 阈值）→ 调服务端 POST /api/skipinsert/pick
 * → 拿到候选 → `player.insertToQueue(current_index + 1, id)` 插进播放队列。
 *
 * 服务端只负责「挑歌」：读配置、排除「排除歌单」与已在队列的歌、AI/规则挑不同风格。
 * 不再往歌单里插——播放队列在客户端，歌单写入不会更新正在播放的队列。
 * 全程异步 + try/catch，绝不阻断播放；AI 超时/失败自动回退规则挑选。
 */
import { chatComplete } from './ai/client';
import { fetchLibrary } from './recommend/profile';
import type { LibrarySong } from './recommend/profile';
import { loadExcludedSongIds } from './recommend/playlists';

// ── 配置 ──────────────────────────────────────────────────────────────────────
const CONFIG_KEY = 'skip_insert_config';

export interface SkipInsertConfig {
  /** 开关 */
  enabled: boolean;
  /** 每次切歌插入数量 1-5 */
  count: number;
  /** 快速切歌阈值（秒）：播放少于该时长即算快速切歌；0 表示不过滤 */
  quickSkipSec: number;
  /** 是否用 AI 挑不同风格（失败自动回退规则挑选） */
  useAi: boolean;
  /** 连切防抖（秒）：间隔内只响应一次 */
  debounceSec: number;
}

const DEFAULT_CONFIG: SkipInsertConfig = {
  enabled: true,
  count: 1,
  quickSkipSec: 60,
  useAi: true,
  debounceSec: 10,
};

const clampCount = (n: number): number => Math.min(5, Math.max(1, Math.round(n) || 1));

export async function loadSkipInsertConfig(): Promise<SkipInsertConfig> {
  try {
    const raw = await songloft.storage.get(CONFIG_KEY);
    if (raw == null) return { ...DEFAULT_CONFIG };
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      enabled: d.enabled !== false,
      count: clampCount(Number(d.count) || 1),
      quickSkipSec: Math.max(0, Number(d.quickSkipSec) || DEFAULT_CONFIG.quickSkipSec),
      useAi: d.useAi !== false,
      debounceSec: Math.max(1, Number(d.debounceSec) || DEFAULT_CONFIG.debounceSec),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveSkipInsertConfig(input: Partial<SkipInsertConfig>): Promise<SkipInsertConfig> {
  const cur = await loadSkipInsertConfig();
  const next: SkipInsertConfig = {
    enabled: input.enabled !== undefined ? !!input.enabled : cur.enabled,
    count: clampCount(Number(input.count ?? cur.count) || cur.count),
    quickSkipSec: Math.max(0, Number(input.quickSkipSec ?? cur.quickSkipSec) || 0),
    useAi: input.useAi !== undefined ? !!input.useAi : cur.useAi,
    debounceSec: Math.max(1, Number(input.debounceSec ?? cur.debounceSec) || 1),
  };
  await songloft.storage.set(CONFIG_KEY, JSON.stringify(next));
  return next;
}

// ── 挑歌（服务端，供客户端调用）────────────────────────────────────────────────

export interface PickResult {
  songId: number;
  title: string;
  artist: string;
}

/**
 * 客户端快速切歌后调用：挑不同风格歌曲。
 * @param lastSong 刚被切掉的歌（客户端从 player 状态里拿）
 * @param count 要挑几首
 * @param queueIds 当前播放队列的歌曲 id（避免插入已在队列的歌）
 * @returns 挑中的歌（已排除「排除歌单」与队列内歌）
 */
export async function pickForSkip(
  lastSong: { id: number; title: string; artist: string },
  count: number,
  queueIds: number[],
): Promise<PickResult[]> {
  const cfg = await loadSkipInsertConfig();
  const library = await fetchLibrary();
  const excluded = await loadExcludedSongIds();
  const queueSet = new Set<number>(queueIds.map((n) => Number(n)));

  const candidates = library.filter(
    (s) =>
      s.songId !== lastSong.id &&
      !excluded.has(s.songId) &&
      !queueSet.has(s.songId),
  );

  // 规则挑选：不同歌手优先，其次不同流派（若有标签）
  const rulePick = pickByRule(lastSong, candidates, count);
  if (!cfg.useAi) return rulePick;

  // AI 优先，超时/失败回退规则挑选
  try {
    const aiPick = await pickByAi(lastSong, candidates, count);
    if (aiPick.length) return aiPick;
  } catch (e) {
    songloft.log.warn('[切歌补位] AI 挑歌失败，回退规则挑选: ' + String(e));
  }
  return rulePick;
}

/** 规则挑选：不同歌手，其次不同流派，随机打乱取 count 首 */
function pickByRule(
  lastSong: { title: string; artist: string },
  pool: LibrarySong[],
  count: number,
): PickResult[] {
  const artistLower = lastSong.artist.toLowerCase();
  const diffArtist = pool.filter((s) => s.artist.toLowerCase() !== artistLower);
  const base = diffArtist.length >= count ? diffArtist : pool;
  const shuffled = [...base].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((s) => ({ songId: s.songId, title: s.title, artist: s.artist }));
}

/** AI 挑选：从候选池里选不同风格；失败/超时返回空，由调用方回退 */
async function pickByAi(
  lastSong: { title: string; artist: string },
  pool: LibrarySong[],
  count: number,
): Promise<PickResult[]> {
  const sample = [...pool].sort(() => Math.random() - 0.5).slice(0, 40);
  if (!sample.length) return [];
  const listText = sample
    .map((s, i) => `${i}: ${s.title} - ${s.artist}`)
    .join('\n');
  const prompt =
    `用户刚跳过《${lastSong.title}》（${lastSong.artist}），说明不喜欢这类风格。\n` +
    `请从下面候选中选出 ${count} 首与这首歌风格/口味明显不同、且尽量避免与《${lastSong.title}》同歌手的歌。\n` +
    `只返回 JSON 数组，元素为候选序号（整数），例如 [3, 17]。\n\n候选列表：\n${listText}`;
  const reply = await chatComplete(
    [{ role: 'user', content: prompt }],
    { temperature: 0.2, timeoutMs: 25000, maxTokens: 1024, thinking: false },
  );
  const m = reply.match(/\[[^\]]*\]/);
  if (!m) return [];
  const idx = (JSON.parse(m[0]) as number[]).map((n) => Number(n)).filter((n) => !isNaN(n));
  return idx
    .map((n) => sample[n])
    .filter(Boolean)
    .slice(0, count)
    .map((s) => ({ songId: s.songId, title: s.title, artist: s.artist }));
}
