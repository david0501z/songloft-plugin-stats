/**
 * 智能推荐页：推荐模式、规则歌单、自动刷新、tag 插件联动
 */
import { apiGet, apiPost } from './api.js';
import { escapeHtml, pct, showDialog, showToast } from './ui.js';

// ── 智能推荐 ──────────────────────────────────────────────────────────────────

const RECOMMEND_MODE_INFO = {
  shuffle: { name: '随便听听', desc: '综合热度与时段偏好，混入少量未听过的探索曲目' },
  gems: { name: '久未听的宝藏', desc: '曾经高频播放但最近 30 天以上没听过的歌' },
  daypart: { name: '当前时段偏好', desc: '你在当前时段最常听的歌' },
  noskip: { name: '免切歌精选', desc: '切歌率最低、最耐听的歌' },
  genrefav: { name: '最爱流派', desc: '近 30 天你听得最多的流派，从中混听（依赖歌曲流派标签）' },
};

let currentRecommendMode = 'shuffle';
let recommendLoading = false;

export async function loadRecommend() {
  if (recommendLoading) return;
  recommendLoading = true;
  const regenBtn = document.getElementById('btnRegenRecommend');
  regenBtn.disabled = true;
  const list = document.getElementById('recommendList');
  const info = RECOMMEND_MODE_INFO[currentRecommendMode];
  document.getElementById('recommendTitle').textContent = info.name;
  document.getElementById('recommendDesc').textContent = info.desc;
  list.innerHTML = '<li class="history-list__empty">加载中…</li>';

  try {
    const resp = await apiGet(`/api/recommend?mode=${currentRecommendMode}&limit=30`);
    if (!resp.success) throw new Error(resp.error || '加载失败');
    const items = resp.data.items || [];
    if (!items.length) {
      list.innerHTML = '<li class="history-list__empty">数据不足，先去听几首歌吧</li>';
      return;
    }
    list.innerHTML = items
      .map(
        (r) =>
          `<li>` +
          `<span class="history-list__song">${escapeHtml(r.artist)} — ${escapeHtml(r.title)}</span>` +
          `<span class="history-list__meta">${escapeHtml(r.reason || '')}</span>` +
          `</li>`,
      )
      .join('');
  } catch (e) {
    list.innerHTML = `<li class="history-list__empty">加载失败：${escapeHtml(String(e.message || e))}</li>`;
    showToast('推荐加载失败：' + String(e.message || e), false);
  } finally {
    recommendLoading = false;
    regenBtn.disabled = false;
  }
}

async function applyRecommend() {
  const btn = document.getElementById('btnApplyRecommend');
  btn.disabled = true;
  btn.textContent = '生成中…';
  try {
    const resp = await apiPost('/api/recommend/apply', { mode: currentRecommendMode, limit: 30 });
    if (!resp.success) throw new Error(resp.error || '生成失败');
    const d = resp.data;
    showToast(`歌单「${d.playlistName}」已${d.created ? '创建' : '刷新'}，共 ${d.songCount} 首`);
  } catch (e) {
    showToast('生成歌单失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成歌单';
  }
}

// ── 切歌补位 ──────────────────────────────────────────────────────────────────

let skipInsertLoaded = false;

/** 加载"切歌补位"配置到表单 */
export async function loadSkipInsert() {
  const box = document.getElementById('siEnabled');
  if (!box) return;
  skipInsertLoaded = true;
  try {
    const resp = await apiGet('/api/skipinsert/config');
    if (!resp.success) throw new Error(resp.error || '加载失败');
    const c = resp.data.config || {};
    document.getElementById('siEnabled').checked = !!c.enabled;
    document.getElementById('siCount').value = c.count ?? 1;
    document.getElementById('siQuick').value = c.quickSkipSec ?? 60;
    document.getElementById('siDebounce').value = c.debounceSec ?? 10;
    document.getElementById('siUseAi').checked = !!c.useAi;
  } catch (e) {
    showToast('切歌补位配置加载失败：' + String(e.message || e), false);
  }
}

/** 保存"切歌补位"配置 */
async function saveSkipInsert() {
  const btn = document.getElementById('btnSaveSkipInsert');
  if (!btn) return;
  btn.disabled = true;
  try {
    const payload = {
      enabled: document.getElementById('siEnabled').checked,
      count: Number(document.getElementById('siCount').value) || 1,
      quickSkipSec: Number(document.getElementById('siQuick').value) || 0,
      debounceSec: Number(document.getElementById('siDebounce').value) || 10,
      useAi: document.getElementById('siUseAi').checked,
    };
    const resp = await apiPost('/api/skipinsert/config', payload);
    if (resp.success) showToast('切歌补位配置已保存');
    else showToast('保存失败：' + String(resp.error || ''), false);
  } catch (e) {
    showToast('保存失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

/** 初始化切歌补位卡片事件 */
export function initSkipInsert() {
  const btn = document.getElementById('btnSaveSkipInsert');
  if (btn) btn.addEventListener('click', saveSkipInsert);
}

// ── 新歌同步 ──────────────────────────────────────────────────────────────────

let syncNewLoaded = false;

/** 加载"新歌同步"配置 */
export async function loadSyncNew() {
  if (!document.getElementById('snEnabled')) return;
  syncNewLoaded = true;
  try {
    // 先填目标歌单下拉框
    const plResp = await apiGet('/api/syncnew/playlists');
    const select = document.getElementById('snPlaylist');
    if (select && plResp.success) {
      const playlists = (plResp.data && plResp.data.playlists) || [];
      select.innerHTML = playlists
        .map((p) => `<option value="${Number(p.id)}">${escapeHtml(p.name)}</option>`)
        .join('');
    }
    // 榜单（多平台，按平台分组）；无洛雪插件时隐藏整个新歌同步卡片
    const bResp = await apiGet('/api/syncnew/boards');
    const boardsBox = document.getElementById('snBoardsList');
    const card = document.getElementById('syncnewCard');
    if (bResp.success) {
      const { available = false, platforms = [] } = bResp.data || {};
      if (!available) {
        if (card) card.style.display = 'none';
        return;
      }
      if (card) card.style.display = '';
      if (boardsBox) {
        if (platforms.length) {
          boardsBox.innerHTML = platforms
            .map(
              (p) =>
                `<div style="width:100%;margin-bottom:4px;"><span class="form-desc" style="font-weight:600;">${escapeHtml(p.name)}</span></div>` +
                `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;width:100%;">` +
                (p.boards || [])
                  .map(
                    (b) =>
                      `<label class="md-checkbox"><input type="checkbox" data-board="${escapeHtml(b.id)}"> ${escapeHtml(b.name)}</label>`,
                  )
                  .join('') +
                `</div>`,
            )
            .join('');
        } else {
          boardsBox.innerHTML = '<span class="form-desc">榜单列表获取失败</span>';
        }
      }
    } else if (boardsBox) {
      boardsBox.innerHTML = '<span class="form-desc">榜单列表获取失败</span>';
    }
    const resp = await apiGet('/api/syncnew/config');
    if (!resp.success) throw new Error(resp.error || '加载失败');
    const c = resp.data.config || {};
    document.getElementById('snEnabled').checked = !!c.enabled;
    document.getElementById('snLimit').value = c.limit ?? 10;
    const targetId = String(c.playlistId ?? 4);
    if (select) select.value = targetId;
    document.getElementById('snHour').value = c.hour ?? 9;
    document.getElementById('snMinute').value = c.minute ?? 0;
    // 勾选已配置的榜单
    const cfgBoards = (c.boards || 'wy__3779629,wy__19723756').split(',').map((x) => x.trim()).filter(Boolean);
    if (boardsBox) {
      boardsBox.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        cb.checked = cfgBoards.includes(cb.dataset.board);
      });
    }
    document.getElementById('snExcludeRap').checked = c.excludeRap !== false;
    document.getElementById('snExcludeKids').checked = c.excludeKids !== false;
    document.getElementById('snExcludeKeywords').value = c.excludeKeywords || '';
    renderExcludeKeywords();
  } catch (e) {
    showToast('新歌同步配置加载失败：' + String(e.message || e), false);
  }
}

/** 保存"新歌同步"配置 */
/** 渲染自定义关键词标签列表 */
function renderExcludeKeywords() {
  const box = document.getElementById('snExcludeKeywordsList');
  if (!box) return;
  const kws = String(document.getElementById('snExcludeKeywords').value || '')
    .split(/[,，;；]/).map((x) => x.trim()).filter(Boolean);
  box.innerHTML = '';
  if (!kws.length) {
    const empty = document.createElement('span');
    empty.className = 'sn-kw-empty';
    empty.textContent = '无自定义关键词';
    box.appendChild(empty);
    return;
  }
  const delHandler = "var api=window.SongloftPlugin&&window.SongloftPlugin.apiPost;if(!api)return;var kws=(document.getElementById('snExcludeKeywords').value||'').split(/[,，;；]/).map(function(x){return x.trim();}).filter(Boolean);var i=kws.indexOf(this.dataset.kw);if(i>-1)kws.splice(i,1);document.getElementById('snExcludeKeywords').value=kws.join(',');var chip=this.closest('.sn-kw-chip');if(chip)chip.remove();api('/api/syncnew/config',{enabled:document.getElementById('snEnabled').checked,limit:Number(document.getElementById('snLimit').value)||10,playlistId:Number(document.getElementById('snPlaylist').value)||4,hour:Number(document.getElementById('snHour').value)||9,minute:Number(document.getElementById('snMinute').value)||0,boards:Array.from(document.querySelectorAll('#snBoardsList input[type=checkbox]:checked')).map(function(cb){return cb.dataset.board;}).filter(Boolean).join(',')||'wy__3779629,wy__19723756',excludeRap:document.getElementById('snExcludeRap').checked,excludeKids:document.getElementById('snExcludeKids').checked,excludeKeywords:kws.join(',')});return false;";
  for (const k of kws) {
    const chip = document.createElement('span');
    chip.className = 'sn-kw-chip';
    chip.textContent = k;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-kw-del';
    del.dataset.kw = k;
    del.textContent = '×';
    del.title = '删除';
    del.setAttribute('onclick', delHandler);
    chip.appendChild(del);
    box.appendChild(chip);
  }
}

/** 添加自定义关键词（支持逗号分隔多个） */
function addExcludeKeyword() {
  const inp = document.getElementById('snExcludeKeywordsInput');
  const h = document.getElementById('snExcludeKeywords');
  if (!inp || !h) return;
  const raw = (inp.value || '').split(/[,，;；]/).map((x) => x.trim()).filter(Boolean);
  if (!raw.length) return;
  const kws = (h.value || '').split(/[,，;；]/).map((x) => x.trim()).filter(Boolean);
  for (const k of raw) {
    const clean = k.replace(/["'<>]/g, '');
    if (clean && !kws.includes(clean)) kws.push(clean);
  }
  h.value = kws.join(',');
  inp.value = '';
  renderExcludeKeywords();
  saveSyncNew();
}

async function saveSyncNew() {
  const btn = document.getElementById('btnSaveSyncNew');
  if (!btn) return;
  btn.disabled = true;
  try {
    const boardsBox = document.getElementById('snBoardsList');
    const boards = boardsBox
      ? [...boardsBox.querySelectorAll('input[type=checkbox]:checked')].map((cb) => cb.dataset.board).filter(Boolean)
      : [];
    const payload = {
      enabled: document.getElementById('snEnabled').checked,
      limit: Number(document.getElementById('snLimit').value) || 10,
      playlistId: Number(document.getElementById('snPlaylist').value) || 4,
      hour: Number(document.getElementById('snHour').value) || 9,
      minute: Number(document.getElementById('snMinute').value) || 0,
      boards: boards.join(',') || 'wy__3779629,wy__19723756',
      excludeRap: document.getElementById('snExcludeRap').checked,
      excludeKids: document.getElementById('snExcludeKids').checked,
      excludeKeywords: document.getElementById('snExcludeKeywords').value.trim(),
    };
    const resp = await apiPost('/api/syncnew/config', payload);
    if (resp.success) {
      showToast('新歌同步配置已保存');
      setSyncStatus('已保存，每天 ' + String(payload.hour).padStart(2, '0') + ':' + String(payload.minute).padStart(2, '0') + ' 自动同步');
    } else {
      showToast('保存失败：' + String(resp.error || ''), false);
    }
  } catch (e) {
    showToast('保存失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

function setSyncStatus(text) {
  const el = document.getElementById('snStatus');
  if (el) el.textContent = text || '';
}

/** 立即同步（真实入库，非 dry-run） */
async function runSyncNow() {
  const btn = document.getElementById('btnSyncNow');
  if (!btn) return;
  btn.disabled = true;
  setSyncStatus('同步中…');
  try {
    const resp = await apiPost('/api/syncnew/run', { dryRun: false });
    const d = resp.data || {};
    if (resp.success && d.ok) {
      setSyncStatus('同步完成：入库 ' + d.added + ' 首（候选 ' + d.candidates + '，跳过 ' + d.skipped + '）');
    } else {
      setSyncStatus('同步失败：' + String(d.reason || resp.error || '未知错误'));
      showToast('同步失败：' + String(d.reason || resp.error || ''), false);
    }
  } catch (e) {
    setSyncStatus('同步失败：' + String(e.message || e));
    showToast('同步失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

/** 初始化新歌同步卡片事件 */
export function initSyncNew() {
  const saveBtn = document.getElementById('btnSaveSyncNew');
  if (saveBtn) saveBtn.addEventListener('click', saveSyncNew);
  const runBtn = document.getElementById('btnSyncNow');
  if (runBtn) runBtn.addEventListener('click', runSyncNow);
  const addKwBtn = document.getElementById('btnAddExcludeKeyword');
  if (addKwBtn) addKwBtn.addEventListener('click', addExcludeKeyword);
  const addKwInp = document.getElementById('snExcludeKeywordsInput');
  if (addKwInp) addKwInp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addExcludeKeyword(); }
  });
}

// ── 排除歌单 ──────────────────────────────────────────────────────────────────

let excludeLoading = false;

/** 加载"排除歌单"设置：列出可用歌单并以勾选框呈现，勾选后即时保存 */
export async function loadExclude() {
  if (excludeLoading) return;
  excludeLoading = true;
  const box = document.getElementById('excludePlaylistList');
  if (!box) {
    excludeLoading = false;
    return;
  }
  try {
    const resp = await apiGet('/api/recommend/exclude');
    if (!resp.success) throw new Error(resp.error || '加载失败');
    const { exclude = [], playlists = [] } = resp.data || {};
    if (!playlists.length) {
      box.innerHTML = '<span class="form-desc">没有可选的歌单</span>';
      return;
    }
    box.innerHTML = playlists
      .map((p) => {
        const checked = exclude.includes(p.name) ? 'checked' : '';
        return `<label class="md-checkbox" style="margin-bottom:6px;"><input type="checkbox" data-name="${escapeHtml(p.name)}" ${checked}>${escapeHtml(p.name)}</label>`;
      })
      .join('');
    box.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const names = [...box.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.dataset.name);
        try {
          const r = await apiPost('/api/recommend/exclude', { exclude: names });
          if (r.success) showToast('排除歌单已保存');
          else showToast('保存失败：' + String(r.error || ''), false);
        } catch (e) {
          showToast('保存失败：' + String(e.message || e), false);
        }
      });
    });
  } catch (e) {
    box.innerHTML = `<span class="form-desc">加载失败：${escapeHtml(String(e.message || e))}</span>`;
  } finally {
    excludeLoading = false;
  }
}

// ── 规则歌单 ──────────────────────────────────────────────────────────────────

let facetsLoaded = false;

/** 标签数据变更后调用，下次进入规则页会重新拉取分面 */
export function invalidateFacets() {
  facetsLoaded = false;
}

export async function loadRuleFacets() {
  if (facetsLoaded) return;
  try {
    const resp = await apiGet('/api/recommend/facets');
    if (!resp.success) return;
    const sel = document.getElementById('ruleGenreSelect');
    const hint = document.getElementById('ruleGenreHint');
    const genres = resp.data.genres || [];
    sel.innerHTML =
      '<option value="">不限</option>' +
      genres.map((g) => `<option value="${escapeHtml(g.genre)}">${escapeHtml(g.genre)}（${g.count} 首）</option>`).join('');
    // 曲库没有任何流派标签时，下拉框只剩「不限」，需告知用户原因和解决办法
    if (hint) {
      if (genres.length === 0) {
        hint.textContent = '曲库中没有歌曲带流派标签，暂无可选项。可通过上方「曲库标签质量」一键补全，或安装标签刮削插件后重试。';
        hint.style.display = '';
      } else {
        hint.style.display = 'none';
      }
    }
    facetsLoaded = true;
  } catch (e) {
    // 分面加载失败不影响其他功能
  }
}

export function describeRuleUi(rule) {
  const parts = [];
  if (rule.genre) parts.push(`流派=${rule.genre}`);
  if (rule.artist) parts.push(`艺术家含“${rule.artist}”`);
  if (rule.album) parts.push(`专辑含“${rule.album}”`);
  if (rule.onlyFavorite) parts.push('仅收藏');
  if (rule.yearFrom || rule.yearTo) parts.push(`年份 ${rule.yearFrom || '…'}~${rule.yearTo || '…'}`);
  if (rule.minPlays) parts.push(`播放≥${rule.minPlays}次`);
  if (rule.notPlayedDays) parts.push(`${rule.notPlayedDays}天未听`);
  parts.push(`${rule.size || 50} 首`);
  return parts.join('，');
}

export async function loadRules() {
  const container = document.getElementById('ruleList');
  try {
    const resp = await apiGet('/api/recommend/rules');
    if (!resp.success) throw new Error(resp.error || '加载失败');
    const rules = resp.data || [];
    if (!rules.length) {
      container.innerHTML = '<p class="form-desc">暂无规则</p>';
      return;
    }
    container.innerHTML = rules
      .map(
        (r) =>
          `<div class="backup-server-item">
            <div class="backup-server-info">
              <div class="backup-server-name">${escapeHtml(r.name)}</div>
              <div class="backup-server-url">${escapeHtml(describeRuleUi(r))}</div>
            </div>
            <button class="btn-text rule-apply" data-id="${escapeHtml(r.id)}" style="font-size:0.8rem;padding:4px 8px;">生成</button>
            <button class="btn-text rule-delete" data-id="${escapeHtml(r.id)}" style="color:var(--md-error);font-size:0.8rem;padding:4px 8px;">删除</button>
          </div>`,
      )
      .join('');

    container.querySelectorAll('.rule-apply').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '生成中…';
        try {
          const resp2 = await apiPost('/api/recommend/rules/apply', { id: btn.dataset.id });
          if (!resp2.success) throw new Error(resp2.error || '生成失败');
          const d = resp2.data;
          showToast(`歌单「${d.playlistName}」已${d.created ? '创建' : '刷新'}，共 ${d.songCount} 首`);
        } catch (e) {
          showToast('生成失败：' + String(e.message || e), false);
        } finally {
          btn.disabled = false;
          btn.textContent = '生成';
        }
      });
    });

    container.querySelectorAll('.rule-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await showDialog('确认删除', '确定要删除该规则吗？已生成的歌单不会被删除。', '删除', '取消');
        if (!confirmed) return;
        try {
          await apiPost('/api/recommend/rules', { action: 'delete', id: btn.dataset.id });
          showToast('已删除规则');
          loadRules();
        } catch (e) {
          showToast('删除失败：' + String(e.message || e), false);
        }
      });
    });
  } catch (e) {
    container.innerHTML = `<p class="form-desc">加载失败：${escapeHtml(String(e.message || e))}</p>`;
  }
}

async function saveRule() {
  const btn = document.getElementById('btnSaveRule');
  const rule = {
    name: document.getElementById('ruleNameInput').value,
    genre: document.getElementById('ruleGenreSelect').value,
    artist: document.getElementById('ruleArtistInput').value,
    album: document.getElementById('ruleAlbumInput').value,
    onlyFavorite: document.getElementById('ruleOnlyFavoriteCheck').checked,
    yearFrom: parseInt(document.getElementById('ruleYearFromInput').value) || 0,
    yearTo: parseInt(document.getElementById('ruleYearToInput').value) || 0,
    minPlays: parseInt(document.getElementById('ruleMinPlaysInput').value) || 0,
    notPlayedDays: parseInt(document.getElementById('ruleNotPlayedDaysInput').value) || 0,
    size: parseInt(document.getElementById('ruleSizeInput').value) || 0,
  };
  if (!rule.name.trim()) {
    showToast('请填写歌单名称', false);
    return;
  }
  btn.disabled = true;
  try {
    const resp = await apiPost('/api/recommend/rules', { rule });
    if (!resp.success) throw new Error(resp.error || '保存失败');
    showToast('规则已保存');
    document.getElementById('ruleNameInput').value = '';
    loadRules();
  } catch (e) {
    showToast('保存失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

// ── 自动刷新设置 ───────────────────────────────────────────────────────────

const REC_MODE_CHECKS = {
  shuffle: 'recModeShuffleCheck',
  gems: 'recModeGemsCheck',
  daypart: 'recModeDaypartCheck',
  noskip: 'recModeNoskipCheck',
  genrefav: 'recModeGenrefavCheck',
};

export async function loadRecSchedule() {
  try {
    const resp = await apiGet('/api/recommend/schedule');
    if (!resp.success) return;
    const s = resp.data;
    document.getElementById('recScheduleEnabledCheck').checked = !!s.enabled;
    document.getElementById('recScheduleHourInput').value = s.hour;
    document.getElementById('recScheduleMinuteInput').value = s.minute;
    for (const [mode, id] of Object.entries(REC_MODE_CHECKS)) {
      document.getElementById(id).checked = (s.modes || []).includes(mode);
    }
    document.getElementById('recRefreshRulesCheck').checked = !!s.refreshRules;
  } catch (e) {
    // 忽略，保持默认值
  }
}

async function saveRecSchedule() {
  const btn = document.getElementById('btnSaveRecSchedule');
  const hour = parseInt(document.getElementById('recScheduleHourInput').value);
  const minute = parseInt(document.getElementById('recScheduleMinuteInput').value);
  if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
    showToast('请填写有效的刷新时间', false);
    return;
  }
  const modes = Object.entries(REC_MODE_CHECKS)
    .filter(([, id]) => document.getElementById(id).checked)
    .map(([mode]) => mode);
  btn.disabled = true;
  try {
    const resp = await apiPost('/api/recommend/schedule', {
      enabled: document.getElementById('recScheduleEnabledCheck').checked,
      hour,
      minute,
      modes,
      refreshRules: document.getElementById('recRefreshRulesCheck').checked,
    });
    if (!resp.success) throw new Error(resp.error || '保存失败');
    showToast('自动刷新设置已保存');
  } catch (e) {
    showToast('保存失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

async function refreshRecommendNow() {
  const btn = document.getElementById('btnRefreshNow');
  btn.disabled = true;
  btn.textContent = '刷新中…';
  try {
    const resp = await apiPost('/api/recommend/refresh', {});
    if (!resp.success) throw new Error(resp.error || '刷新失败');
    const d = resp.data;
    if (d.refreshed.length === 0 && d.failed.length === 0) {
      showToast('没有需要刷新的歌单，请先勾选刷新内容并保存', false);
    } else if (d.failed.length === 0) {
      showToast(`已刷新 ${d.refreshed.length} 个歌单`);
    } else {
      showToast(`刷新完成：成功 ${d.refreshed.length}，失败 ${d.failed.length}`, false);
    }
  } catch (e) {
    showToast('刷新失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
    btn.textContent = '立即刷新一次';
  }
}

// ── 标签刮削插件联动 ────────────────────────────────────────────────────────────

let tagProgressTimer = null;

export async function loadTagStatus() {
  const card = document.getElementById('tagLinkageCard');
  try {
    const resp = await apiGet('/api/linkage/tag/status');
    if (!resp.success) throw new Error(resp.error || '检测失败');
    const s = resp.data;
    if (!s.installed) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    const gp = pct(s.genreCovered, s.total);
    const yp = pct(s.yearCovered, s.total);
    document.getElementById('tagCoverageInfo').textContent =
      `共 ${s.total} 首：流派标签 ${gp}%（${s.genreCovered} 首），年份标签 ${yp}%（${s.yearCovered} 首）` +
      (gp < 60 || yp < 60 ? '，建议补全后再用规则歌单' : '');
  } catch (e) {
    // tag 插件不可用时隐藏卡片，不打扰用户
    card.style.display = 'none';
  }
}

async function startTagScrape() {
  const btn = document.getElementById('btnTagScrape');
  btn.disabled = true;
  btn.textContent = '启动中…';
  try {
    const resp = await apiPost('/api/linkage/tag/scrape', {});
    if (!resp.success) throw new Error(resp.error || '启动失败');
    const d = resp.data;
    if (!d.taskId) {
      showToast(d.message || '没有需要刮削的新歌曲');
      btn.disabled = false;
      btn.textContent = '一键补全标签';
      return;
    }
    showToast(`已启动刮削，共 ${d.total} 首`);
    btn.textContent = '刮削中…';
    pollTagProgress(d.taskId);
  } catch (e) {
    showToast('启动刮削失败：' + String(e.message || e), false);
    btn.disabled = false;
    btn.textContent = '一键补全标签';
  }
}

function pollTagProgress(taskId) {
  const progressEl = document.getElementById('tagScrapeProgress');
  const btn = document.getElementById('btnTagScrape');
  progressEl.style.display = '';
  clearInterval(tagProgressTimer);

  tagProgressTimer = setInterval(async () => {
    try {
      const resp = await apiGet(`/api/linkage/tag/progress?taskId=${encodeURIComponent(taskId)}`);
      if (!resp.success) throw new Error(resp.error || '查询失败');
      const p = resp.data;
      progressEl.textContent = `刮削进度：${p.current}/${p.total}（成功 ${p.success}，跳过 ${p.skipped}，失败 ${p.failed}）`;
      if (p.status === 'done') {
        clearInterval(tagProgressTimer);
        tagProgressTimer = null;
        progressEl.textContent += ' — 已完成';
        showToast(`刮削完成：成功 ${p.success}，失败 ${p.failed}`);
        btn.disabled = false;
        btn.textContent = '一键补全标签';
        // 标签已更新，刷新覆盖率与流派下拉框
        invalidateFacets();
        loadTagStatus();
        loadRuleFacets();
      }
    } catch (e) {
      clearInterval(tagProgressTimer);
      tagProgressTimer = null;
      progressEl.textContent = '进度查询失败：' + String(e.message || e);
      btn.disabled = false;
      btn.textContent = '一键补全标签';
    }
  }, 3000);
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

export function initRecommend() {
  document.getElementById('recommendModeTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    currentRecommendMode = tab.dataset.mode;
    document.querySelectorAll('#recommendModeTabs .tab').forEach((t) => {
      t.classList.toggle('tab--active', t.dataset.mode === currentRecommendMode);
    });
    loadRecommend();
  });
  document.getElementById('btnRegenRecommend').addEventListener('click', loadRecommend);
  document.getElementById('btnApplyRecommend').addEventListener('click', applyRecommend);
  document.getElementById('btnSaveRule').addEventListener('click', saveRule);
  document.getElementById('btnSaveRecSchedule').addEventListener('click', saveRecSchedule);
  document.getElementById('btnRefreshNow').addEventListener('click', refreshRecommendNow);
  document.getElementById('btnTagScrape').addEventListener('click', startTagScrape);
}
