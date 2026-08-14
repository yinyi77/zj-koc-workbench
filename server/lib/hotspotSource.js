/**
 * 实时热点源：抖音热榜（官方 aweme 接口）+ B站热门（popular 接口）
 * - 归一化为统一结构 {id, source, title, url, heat, up?, pic?, rank}
 * - 内存缓存（默认 10 分钟），单源失败不影响另一源
 * - 抖音失败回退到备用聚合源；两源均失败返回空列表并标记状态
 *
 * 注意：本模块在运行时通过 Node 全局 fetch 访问外网，需服务端可联网。
 */
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15';
const BILI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟

let cache = { ts: 0, data: null };

function withHttps(pic) {
  if (!pic) return null;
  return pic.startsWith('http') ? pic : 'https:' + pic;
}

function normalizeBili(j) {
  const list = (j && j.data && j.data.list) || [];
  return list.map((x, i) => ({
    id: 'bili-' + x.bvid,
    source: 'B站',
    title: x.title,
    category: x.tname || '游戏',
    url: 'https://www.bilibili.com/video/' + x.bvid,
    heat: x.stat && x.stat.view != null ? x.stat.view : null,
    up: x.owner && x.owner.name,
    pic: withHttps(x.pic),
    rank: i + 1
  }));
}

function normalizeBiliGame(j) {
  const list = (j && j.data && j.data.list) || [];
  return list.map((x, i) => ({
    id: 'bili-game-' + x.bvid,
    source: 'B站',
    sourceType: '游戏分区榜',
    title: x.title,
    url: 'https://www.bilibili.com/video/' + x.bvid,
    heat: x.stat && x.stat.view != null ? x.stat.view : null,
    up: x.owner && x.owner.name,
    pic: withHttps(x.pic),
    rank: i + 1,
    gameVertical: true
  }));
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

function parseCount(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text || text === '--') return null;
  if (text.endsWith('万')) return Math.round((Number.parseFloat(text) || 0) * 10000);
  return Number(String(text).replace(/,/g, '')) || null;
}

function normalizeBiliSearch(j, keyword) {
  const list = (j && j.data && j.data.result) || [];
  return list.map((x, i) => ({
    id: 'bili-search-' + x.bvid,
    source: 'B站',
    sourceType: '定向搜索',
    title: stripHtml(x.title),
    category: '定向搜索',
    url: 'https://www.bilibili.com/video/' + x.bvid,
    heat: parseCount(x.play),
    up: stripHtml(x.author),
    pic: withHttps(x.pic),
    rank: i + 1,
    publishedAt: x.pubdate ? new Date(Number(x.pubdate) * 1000).toISOString() : null,
    targeted: true,
    searchKeyword: keyword
  }));
}

function normalizeDouyin(j) {
  const wl = (j && j.data && j.data.word_list) || [];
  return wl.map((x, i) => ({
    id: 'dy-' + encodeURIComponent(x.word || ''),
    source: '抖音',
    title: x.word,
    url: 'https://www.douyin.com/search/' + encodeURIComponent(x.word || ''),
    heat: x.hot_value != null ? x.hot_value : null,
    sentenceTag: x.sentence_tag != null ? Number(x.sentence_tag) : null,
    hotLabel: x.label != null ? Number(x.label) : null,
    up: null,
    pic: null,
    rank: i + 1
  }));
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, {
    headers: Object.assign({ 'User-Agent': UA }, opts.headers || {}),
    signal: AbortSignal.timeout(opts.timeout || 8000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function fetchBilibili(limit) {
  // B站单页上限有限，分页抓取后去重，扩大候选池而不是只看榜单前几十名。
  const wanted = Math.max(20, Number(limit) || 20);
  const pageSize = Math.min(50, wanted);
  const pages = Math.min(4, Math.ceil(wanted / pageSize));
  const results = [];
  for (let pn = 1; pn <= pages; pn++) {
    const j = await fetchJson(`https://api.bilibili.com/x/web-interface/popular?ps=${pageSize}&pn=${pn}`, {
      headers: { Referer: 'https://www.bilibili.com' }
    });
    results.push(...normalizeBili(j).map((item, index) => ({ ...item, rank: (pn - 1) * pageSize + index + 1 })));
  }
  return [...new Map(results.map(item => [item.id, item])).values()].slice(0, wanted);
}

async function fetchBilibiliGame(limit) {
  // rid=4 为 B站游戏分区榜，直接使用垂类榜而非综合热门二次筛选。
  const j = await fetchJson('https://api.bilibili.com/x/web-interface/ranking/v2?rid=4&type=all', {
    headers: { Referer: 'https://www.bilibili.com/v/game/' }
  });
  return normalizeBiliGame(j).slice(0, Math.max(20, Number(limit) || 20));
}

async function fetchBilibiliSearch(keywords, limit = 20) {
  const terms = [...new Set((keywords || []).map(x => String(x || '').trim()).filter(Boolean))].slice(0, 7);
  if (!terms.length) return [];
  const pageSize = Math.min(30, Math.max(10, Number(limit) || 20));
  // B站搜索对瞬时并发较敏感，顺序请求可避免部分关键词因 412 丢失。
  const merged = [];
  for (const keyword of terms) {
    try {
      const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=pubdate&page=1&page_size=${pageSize}&keyword=${encodeURIComponent(keyword)}`;
      const j = await fetchJson(url, { headers: { 'User-Agent': BILI_UA, Referer: 'https://search.bilibili.com/', Origin: 'https://search.bilibili.com', Accept: 'application/json, text/plain, */*' } });
      merged.push(...normalizeBiliSearch(j, keyword));
    } catch (e) {
      try {
        // 按发布时间搜索偶发 412 时，回退到综合搜索；后续仍会用 publishedAt 做 45 天时效过滤。
        const fallbackUrl = `https://api.bilibili.com/x/web-interface/search/all/v2?page=1&keyword=${encodeURIComponent(keyword)}`;
        const fallback = await fetchJson(fallbackUrl, { headers: { 'User-Agent': BILI_UA, Referer: 'https://search.bilibili.com/', Origin: 'https://search.bilibili.com', Accept: 'application/json, text/plain, */*' } });
        const videoGroup = (fallback?.data?.result || []).find(group => group.result_type === 'video');
        merged.push(...normalizeBiliSearch({ data: { result: videoGroup?.data || [] } }, keyword));
      } catch (fallbackError) {
        console.warn(`[hotspotSource] B站定向搜索失败(${keyword}):`, e.message, fallbackError.message);
      }
    }
  }
  return [...new Map(merged.map(item => [item.url, item])).values()];
}

async function fetchDouyin(limit) {
  // 优先用稳定的第三方聚合源（官方 aweme 接口在服务器端常被反爬拦截，仅作回退）
  // 聚合源偶发抖动，做一次重试以提升稳定性
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await fetchJson('https://v2.xxapi.cn/api/douyinhot', { timeout: 8000 });
      const arr = (j && j.data) || [];
      if (arr.length) return normalizeXxapi(j);
    } catch (e) { lastErr = e; }
  }
  // 回退官方源
  try {
    const j = await fetchJson('https://aweme.snssdk.com/aweme/v1/hot/search/list/?device_id=1&aid=1703');
    return normalizeDouyin(j);
  } catch (e2) {
    console.warn('[hotspotSource] 抖音全源失败:', (lastErr && lastErr.message) || '', e2.message);
    return [];
  }
}

function normalizeXxapi(j) {
  const arr = (j && j.data) || [];
  return arr.map((x, i) => ({
    id: 'dy-' + encodeURIComponent(x.word || ''),
    source: '抖音',
    title: x.word,
    url: 'https://www.douyin.com/search/' + encodeURIComponent(x.word || ''),
    heat: x.hot_value != null ? x.hot_value : null,
    sentenceTag: x.sentence_tag != null ? Number(x.sentence_tag) : null,
    hotLabel: x.label != null ? Number(x.label) : null,
    up: null,
    pic: null,
    rank: x.position != null ? x.position : (i + 1)
  }));
}

/**
 * 取实时热点（合并两源），带缓存与降级
 * @param {number} limit 每源最多条数（默认 20）
 * @returns {Promise<{list:Array, biliCount:number, douyinCount:number, fetchedAt:string, sourceStatus:{bili:string,douyin:string}}>}
 */
async function getHotspots(limit, { searchKeywords = [] } = {}) {
  const lim = limit || 20;
  const now = Date.now();
  const cacheKey = searchKeywords.map(x => String(x || '').trim()).filter(Boolean).join('|');
  if (cache.data && cache.key === cacheKey && now - cache.ts < CACHE_TTL) {
    return pack(cache.data, lim);
  }
  const [biliGameRes, biliGeneralRes, dyRes, targetedRes] = await Promise.allSettled([
    fetchBilibiliGame(lim),
    fetchBilibili(Math.min(50, lim)),
    fetchDouyin(lim),
    fetchBilibiliSearch(searchKeywords, 20)
  ]);
  const biliGameList = biliGameRes.status === 'fulfilled' ? biliGameRes.value : [];
  const biliGeneralList = biliGeneralRes.status === 'fulfilled' ? biliGeneralRes.value : [];
  const biliList = [...new Map([...biliGameList, ...biliGeneralList].map(item => [item.url, item])).values()];
  const dyList = dyRes.status === 'fulfilled' ? dyRes.value : [];
  const targetedList = targetedRes.status === 'fulfilled' ? targetedRes.value : [];
  const data = {
    bili: biliList,
    biliGameCount: biliGameList.length,
    douyin: dyList,
    targeted: targetedList,
    fetchedAt: new Date().toISOString()
  };
  // 仅当两源都成功才缓存，避免把「抖音抖动为空」缓存成 0 长达 10 分钟
  if (biliList.length && dyList.length) cache = { ts: now, key: cacheKey, data };
  return pack(data, lim);
}

function pack(data, lim) {
  const bili = data.bili.slice(0, lim);
  const douyin = data.douyin.slice(0, lim);
  const targeted = (data.targeted || []).slice(0, Math.min(100, lim));
  // 交错排列（抖音/B站/抖音/B站…），保证前列同时出现两种来源，避免 limit 切片把某一源全部切掉
  const list = [];
  const n = Math.max(bili.length, douyin.length);
  for (let i = 0; i < n; i++) {
    if (i < douyin.length) list.push(douyin[i]);
    if (i < bili.length) list.push(bili[i]);
  }
  // 定向搜索是「杖剑相关」的专用补充源，优先交给后续分类器判断。
  list.unshift(...targeted);
  return {
    list,
    biliCount: bili.length,
    biliGameCount: data.biliGameCount || bili.filter(item => item.gameVertical).length,
    douyinCount: douyin.length,
    targetedCount: targeted.length,
    fetchedAt: data.fetchedAt,
    sourceStatus: {
      bili: bili.length ? 'ok' : 'fail',
      douyin: douyin.length ? 'ok' : 'fail'
    }
  };
}

/** 强制刷新缓存（供前端「实时刷新」按钮调用） */
function invalidate() { cache = { ts: 0, key: '', data: null }; }

module.exports = { getHotspots, invalidate, fetchBilibili, fetchBilibiliGame, fetchBilibiliSearch, fetchDouyin };
