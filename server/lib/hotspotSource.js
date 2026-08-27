/**
 * 实时热点源：抖音热点关键词视频搜索（开放平台）+ B站综合热门/游戏分区
 * - 归一化为统一结构 {id, source, title, url, heat, up?, pic?, rank}
 * - 内存缓存（默认 10 分钟），单源失败不影响另一源
 * - 抖音只接收可直达的具体视频，不再使用平台总榜或搜索页链接
 *
 * 注意：本模块在运行时通过 Node 全局 fetch 访问外网，需服务端可联网。
 */
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15';
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟

let cache = { ts: 0, data: null };
let douyinTokenCache = { clientKey: '', token: '', expiresAt: 0 };

function withHttps(pic) {
  if (!pic) return null;
  return pic.startsWith('http') ? pic : 'https:' + pic;
}

function normalizeBili(j) {
  const list = (j && j.data && j.data.list) || [];
  return list.map((x, i) => ({
    id: 'bili-' + x.bvid,
    source: 'B站',
    sourceType: '综合热门榜',
    title: x.title,
    category: x.tname || '游戏',
    url: 'https://www.bilibili.com/video/' + x.bvid,
    heat: x.stat && x.stat.view != null ? x.stat.view : null,
    up: x.owner && x.owner.name,
    pic: withHttps(x.pic),
    rank: i + 1,
    publishedAt: x.pubdate ? new Date(Number(x.pubdate) * 1000).toISOString() : null
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
    gameVertical: true,
    publishedAt: x.pubdate ? new Date(Number(x.pubdate) * 1000).toISOString() : null
  }));
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'User-Agent': UA }, opts.headers || {}),
    body: opts.body,
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

async function getDouyinClientToken(clientKey, clientSecret) {
  const now = Date.now();
  if (douyinTokenCache.clientKey === clientKey && douyinTokenCache.token && douyinTokenCache.expiresAt > now + 60_000) {
    return douyinTokenCache.token;
  }
  const j = await fetchJson('https://open.douyin.com/oauth/client_token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', client_key: clientKey, client_secret: clientSecret }),
    timeout: 10_000
  });
  const data = j && j.data;
  if (!data || Number(data.error_code) !== 0 || !data.access_token) {
    throw new Error((data && data.description) || j.message || '获取抖音 client_token 失败');
  }
  douyinTokenCache = {
    clientKey,
    token: data.access_token,
    expiresAt: now + Math.max(300, Number(data.expires_in) || 7200) * 1000
  };
  return data.access_token;
}

function normalizeDouyinVideos(j, keyword, startRank = 1) {
  const payload = j && j.data && j.data.data;
  const list = (payload && payload.video_list) || [];
  return list.map((x, i) => ({
    id: 'dy-video-' + x.item_id,
    source: '抖音',
    sourceType: '热点关键词视频搜索',
    title: x.title || x.high_quality_text || keyword,
    category: /游戏|手游|攻略|副本|抽卡|开服|公测/.test(keyword) ? '游戏热点' : '网感热点',
    url: x.link || ('https://www.douyin.com/video/' + x.item_id),
    heat: x.statistics && x.statistics.digg_count != null ? x.statistics.digg_count : null,
    up: x.nickname || null,
    pic: x.cover || null,
    rank: startRank + i,
    keyword,
    gameVertical: /游戏|手游|攻略|副本|抽卡|开服|公测/.test(keyword),
    publishedAt: x.create_time ? new Date(Number(x.create_time) * 1000).toISOString() : null
  }));
}

async function fetchDouyin(limit, options = {}) {
  const clientKey = String(options.clientKey || '').trim();
  const clientSecret = String(options.clientSecret || '').trim();
  const deviceId = String(options.deviceId || '').trim();
  if (!clientKey || !clientSecret || !/^\d+$/.test(deviceId)) {
    return { list: [], status: 'needs_config', error: '请配置抖音开放平台 AppID、AppSecret 和设备 ID' };
  }

  try {
    const token = await getDouyinClientToken(clientKey, clientSecret);
    const keywords = [...new Set((options.keywords || ['全网热梗', '热门挑战', '反转整活', '情绪共鸣', '热门BGM', '游戏热梗'])
      .map(x => String(x || '').trim()).filter(Boolean))].slice(0, 12);
    const perKeyword = Math.min(20, Math.max(5, Math.ceil((Number(limit) || 20) / Math.max(1, keywords.length))));
    const settled = await Promise.allSettled(keywords.map(async keyword => {
      const qs = new URLSearchParams({
        device_id: deviceId,
        keyword,
        count: String(perKeyword),
        cursor: '0',
        publish_time: '7',
        sort_type: '0'
      });
      const j = await fetchJson(`https://open.douyin.com/dy_open_api/v1/search/video/?${qs}`, {
        headers: { 'Content-Type': 'application/json', 'access-token': token },
        timeout: 12_000
      });
      if (Number(j && j.err_no) !== 0) throw new Error((j && j.err_msg) || '抖音视频搜索失败');
      return normalizeDouyinVideos(j, keyword);
    }));
    const errors = settled.filter(x => x.status === 'rejected').map(x => x.reason && x.reason.message).filter(Boolean);
    const merged = settled.flatMap(x => x.status === 'fulfilled' ? x.value : []);
    const list = [...new Map(merged.map(item => [item.id, item])).values()]
      .map((item, index) => ({ ...item, rank: index + 1 }))
      .slice(0, Math.max(20, Number(limit) || 20));
    return { list, status: list.length ? 'ok' : (errors.length ? 'error' : 'empty'), error: errors[0] || '' };
  } catch (e) {
    return { list: [], status: 'error', error: e.message || '抖音视频搜索失败' };
  }
}

/**
 * 取实时热点（合并两源），带缓存与降级
 * @param {number} limit 每源最多条数（默认 20）
 * @returns {Promise<{list:Array, biliCount:number, douyinCount:number, fetchedAt:string, sourceStatus:{bili:string,douyin:string}}>}
 */
async function getHotspots(limit, options = {}) {
  const lim = limit || 20;
  const now = Date.now();
  const cacheKey = JSON.stringify({
    clientKey: options.douyin && options.douyin.clientKey || '',
    deviceId: options.douyin && options.douyin.deviceId || '',
    keywords: options.douyin && options.douyin.keywords || []
  });
  if (cache.data && cache.key === cacheKey && now - cache.ts < CACHE_TTL) {
    return pack(cache.data, lim);
  }
  const [biliGameRes, biliGeneralRes, dyRes] = await Promise.allSettled([
    fetchBilibiliGame(lim),
    fetchBilibili(Math.min(100, lim)),
    fetchDouyin(lim, options.douyin || {})
  ]);
  const biliGameList = biliGameRes.status === 'fulfilled' ? biliGameRes.value : [];
  const biliGeneralList = biliGeneralRes.status === 'fulfilled' ? biliGeneralRes.value : [];
  // 综合热门优先进入通用发现池，游戏分区用于补充垂类覆盖，不再让游戏榜占满前列。
  const biliList = [...new Map([...biliGeneralList, ...biliGameList].map(item => [item.url, item])).values()];
  const dyResult = dyRes.status === 'fulfilled'
    ? dyRes.value
    : { list: [], status: 'error', error: dyRes.reason && dyRes.reason.message };
  const dyList = dyResult.list || [];
  const data = {
      bili: biliList,
      biliGameCount: biliGameList.length,
    douyin: dyList,
    douyinStatus: dyResult.status,
    douyinError: dyResult.error || '',
    fetchedAt: new Date().toISOString()
  };
  // 仅当两源都成功才缓存，避免把「抖音抖动为空」缓存成 0 长达 10 分钟
  if (biliList.length) cache = { ts: now, key: cacheKey, data };
  return pack(data, lim);
}

function pack(data, lim) {
  const bili = data.bili.slice(0, lim);
  const douyin = data.douyin.slice(0, lim);
  // 交错排列（抖音/B站/抖音/B站…），保证前列同时出现两种来源，避免 limit 切片把某一源全部切掉
  const list = [];
  const n = Math.max(bili.length, douyin.length);
  for (let i = 0; i < n; i++) {
    if (i < douyin.length) list.push(douyin[i]);
    if (i < bili.length) list.push(bili[i]);
  }
  return {
    list,
    biliCount: bili.length,
    biliGameCount: data.biliGameCount || bili.filter(item => item.gameVertical).length,
    douyinCount: douyin.length,
    fetchedAt: data.fetchedAt,
    sourceStatus: {
      bili: bili.length ? 'ok' : 'fail',
      douyin: data.douyinStatus || (douyin.length ? 'ok' : 'fail'),
      douyinMessage: data.douyinError || ''
    }
  };
}

/** 强制刷新缓存（供前端「实时刷新」按钮调用） */
function invalidate() { cache = { ts: 0, key: '', data: null }; }

module.exports = { getHotspots, invalidate, fetchBilibili, fetchBilibiliGame, fetchDouyin };
