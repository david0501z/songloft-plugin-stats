/**
 * 切歌补位（客户端侧）：订阅播放器状态，检测快速切歌，
 * 调服务端挑歌接口，把不同风格歌曲插进「正在播放的队列」。
 *
 * 依赖客户端注入的 window.SongloftPlugin.player（@songloft/client-sdk）：
 *   - player.onStateChange → 检测歌曲切换
 *   - player.getState()   → 拿当前队列与 current_index
 *   - player.insertToQueue(index, id) → 插到队列指定位置（不触发播放）
 *
 * ⚠️ 仅在 Songloft 客户端/Web 播放器 iframe 内打开本页时可用；
 *    独立浏览器标签打开（无宿主）时 player 不存在，自动禁用并提示。
 *    桥接可用性 / 每次插入结果会上报服务端日志（/api/skipinsert/diag）。
 */
import { apiGet, apiPost } from './api.js';
import { showToast } from './ui.js';

let started = false;

// 状态跟踪（模块级：initSkipInsertClient 的回调与 maybeInsert 都要用）
let lastSongId = -1;
let lastSongInfo = null; // {id,title,artist} 上一首（可能刚被切掉）
let lastSongStart = 0;
let lastTriggerAt = 0;

function diag(payload) {
  // fire-and-forget 上报，失败忽略
  try {
    void apiPost('/api/skipinsert/diag', payload);
  } catch {
    /* 忽略 */
  }
}

function setStatus(el, text, color) {
  if (el) {
    el.textContent = text;
    el.style.color = color;
  }
}

/** 由 app.js 初始化：检测客户端桥接并订阅播放状态 */
export function initSkipInsertClient() {
  if (started) return;
  started = true;

  const player = window.SongloftPlugin?.player;
  const statusEl = document.getElementById('siClientStatus');

  const ok =
    !!player &&
    typeof player.onStateChange === 'function' &&
    typeof player.getState === 'function' &&
    typeof player.insertToQueue === 'function';

  diag({
    event: 'init',
    hasPlugin: !!window.SongloftPlugin,
    hasPlayer: !!player,
    hasGetState: !!(player && typeof player.getState === 'function'),
    hasInsertToQueue: !!(player && typeof player.insertToQueue === 'function'),
    hasOnStateChange: !!(player && typeof player.onStateChange === 'function'),
  });

  if (!ok) {
    setStatus(
      statusEl,
      '⚠️ 未检测到客户端桥接：请在 Songloft 客户端内打开本页（不要用浏览器单独打开标签），才能插入播放队列',
      '#e5484d',
    );
    return;
  }

  setStatus(statusEl, '✅ 客户端桥接可用：快速切歌会自动插入播放队列', '#46a758');

  player.onStateChange((state) => {
    const cur = state.current_song;
    const curId = cur ? Number(cur.id) : -1;
    const now = Date.now();

    if (curId === lastSongId) return; // 歌曲没变

    // 上一首歌被切掉：lastSongInfo 是刚被切掉的歌
    const prev = lastSongInfo;
    if (prev && prev.id > 0) {
      const prevPlayedMs = now - lastSongStart;
      void maybeInsert(prev, prevPlayedMs);
    }

    // 更新跟踪
    lastSongId = curId;
    lastSongInfo = cur
      ? { id: curId, title: String(cur.title || ''), artist: String(cur.artist || '') }
      : null;
    lastSongStart = now;
  });
}

async function maybeInsert(prevSong, prevPlayedMs) {
  try {
    // 读配置（enabled / quickSkipSec / debounceSec / count）
    const cfgResp = await apiGet('/api/skipinsert/config');
    if (!cfgResp?.success) return;
    const cfg = cfgResp.data?.config;
    if (!cfg?.enabled) return;

    // 快速切歌判定：播放少于阈值
    const quickSkipSec = Number(cfg.quickSkipSec) || 0;
    if (quickSkipSec > 0 && prevPlayedMs > quickSkipSec * 1000) {
      diag({ event: 'skip_not_quick', prevPlayedMs: Math.round(prevPlayedMs / 1000), quickSkipSec });
      return;
    }

    // 连切防抖
    const debounceSec = Number(cfg.debounceSec) || 10;
    const now = Date.now();
    if (now - lastTriggerAt < debounceSec * 1000) {
      diag({ event: 'debounced' });
      return;
    }
    lastTriggerAt = now;

    // 拿当前队列
    const state = await window.SongloftPlugin.player.getState();
    const queueIds = ((state.queue || []) || []).map((s) => Number(s.id));
    const currentIndex = Number(state.current_index ?? -1);
    diag({
      event: 'skip_detected',
      prevSong: prevSong.title,
      prevPlayedMs: Math.round(prevPlayedMs / 1000),
      currentIndex,
      queueLen: queueIds.length,
    });

    // 挑歌（排除歌单 + 队列内已在的歌，服务端处理）
    const pickResp = await apiPost('/api/skipinsert/pick', {
      lastSong: { id: prevSong.id, title: prevSong.title, artist: prevSong.artist },
      count: Number(cfg.count) || 1,
      queueIds,
    });
    if (!pickResp?.success || !pickResp.data?.songs?.length) {
      diag({ event: 'pick_empty', resp: String(pickResp?.error || '无候选') });
      return;
    }
    diag({ event: 'picked', songs: pickResp.data.songs.map((s) => `${s.title}-${s.artist}`) });

    // 插到当前歌曲之后
    const insertIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    let offset = 0;
    const inserted = [];
    const failed = [];
    for (const song of pickResp.data.songs) {
      try {
        await window.SongloftPlugin.player.insertToQueue(insertIndex + offset, Number(song.songId));
        offset += 1;
        inserted.push(`${song.title}-${song.artist}`);
      } catch (e) {
        failed.push(`${song.title}: ${String(e)}`);
      }
    }
    diag({ event: 'insert_result', inserted, failed });
    if (inserted.length) {
      setStatus(
        document.getElementById('siClientStatus'),
        `✅ 已插入 ${inserted.length} 首到播放队列：${inserted.join('；')}`,
        '#46a758',
      );
      showToast(`切歌补位：已插入 ${inserted.length} 首到播放队列`);
    } else if (failed.length) {
      setStatus(
        document.getElementById('siClientStatus'),
        `⚠️ 插入失败：${failed.join('；')}`,
        '#e5484d',
      );
    }
  } catch (e) {
    diag({ event: 'insert_error', error: String(e) });
    setStatus(document.getElementById('siClientStatus'), `⚠️ 插入出错：${String(e)}`, '#e5484d');
    console.warn('[切歌补位] 插入失败:', e);
  }
}
