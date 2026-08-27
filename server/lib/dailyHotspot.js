/**
 * 今日热点每日快照：保证「每日仅抓取一次 + 分析一次」，结果落库持久化。
 *
 * - ensure(db, {force})：若当日快照已存在则直接返回；否则实时抓取热点 + 跑一次
 *   Gemini 分析，写入 daily_hotspot_snapshot 表。force=true 时忽略已有快照、重抓重分析。
 * - getSnapshot(db, {force})：对外统一入口，带「在途锁」避免并发重复抓取/重复烧 API。
 *
 * 设计目标：一天内无论前端刷新多少次、服务是否重启，今日工作页都只读同一份当日快照。
 */
const hotspotSource = require('./hotspotSource');
const gameNews = require('./gameNews');
const ai = require('./ai');

/**
 * 发现层只判断「这是不是值得关注的网感热点」，不再要求它先与当前游戏相关。
 * 当前项目适配由 recommend.js / ai.js 单独完成，避免把可复用的热梗在抓取阶段误删。
 */
const INTERESTS = [
  // 游戏 / 二次元（高权重）
  { k: '游戏', w: 3 }, { k: '手游', w: 3 }, { k: '端游', w: 3 }, { k: '主机', w: 3 }, { k: 'switch', w: 3 }, { k: 'ps5', w: 3 }, { k: 'steam', w: 3 },
  { k: '攻略', w: 3 }, { k: '电竞', w: 3 }, { k: '直播', w: 2 }, { k: '速通', w: 3 }, { k: 'mod', w: 2 }, { k: 'dlc', w: 2 }, { k: '副本', w: 3 }, { k: '坐骑', w: 3 }, { k: '抽卡', w: 3 }, { k: '氪', w: 2 }, { k: '公测', w: 3 }, { k: '内测', w: 3 }, { k: '开服', w: 3 },
  { k: '二次元', w: 3 }, { k: '动漫', w: 3 }, { k: '番剧', w: 3 }, { k: '漫画', w: 2 }, { k: '动画', w: 2 }, { k: '国漫', w: 3 }, { k: 'acg', w: 3 }, { k: 'cos', w: 3 }, { k: '手办', w: 2 }, { k: '同人', w: 2 }, { k: '二创', w: 2 }, { k: '声优', w: 2 }, { k: '配音', w: 2 }, { k: '鬼畜', w: 2 },
  // 泛娱乐 / 创作 / 生活
  { k: 'up主', w: 2 }, { k: 'vlog', w: 2 }, { k: '整活', w: 2 }, { k: '搞笑', w: 1 }, { k: '萌宠', w: 1 }, { k: '美食', w: 1 }, { k: '探店', w: 1 }, { k: '旅游', w: 2 }, { k: '旅行', w: 2 }, { k: '穿搭', w: 1 }, { k: '时尚', w: 1 }, { k: '美妆', w: 2 }, { k: '护肤', w: 1 }, { k: '化妆', w: 1 }, { k: '综艺', w: 1 }, { k: '影视', w: 1 }, { k: '电影', w: 1 }, { k: '电视剧', w: 1 }, { k: '短剧', w: 1 }, { k: '剧', w: 1 }, { k: '挑战', w: 1 }, { k: '变装', w: 1 }, { k: '卡点', w: 1 },
  { k: '绘画', w: 2 }, { k: '插画', w: 2 }, { k: '手绘', w: 2 }, { k: '板绘', w: 2 }, { k: '色彩', w: 2 }, { k: '设计', w: 1 }, { k: '摄影', w: 1 }, { k: '场景', w: 2 }, { k: '建模', w: 2 }, { k: '特效', w: 1 }, { k: '短片', w: 1 },
  { k: '音乐', w: 1 }, { k: '翻唱', w: 1 }, { k: '舞蹈', w: 1 }, { k: '街舞', w: 1 }, { k: '说唱', w: 1 }, { k: 'hiphop', w: 1 },
  // 科技 / AIGC
  { k: '科技', w: 2 }, { k: '数码', w: 2 }, { k: 'aigc', w: 3 }, { k: 'ai', w: 2 }, { k: '人工智能', w: 2 }, { k: '大模型', w: 2 }, { k: '3d', w: 2 }, { k: '剪辑', w: 1 }, { k: '后期', w: 1 },
  // 知识 / 文化 / 其他
  { k: '知识', w: 1 }, { k: '科普', w: 1 }, { k: '学习', w: 1 }, { k: '校园', w: 1 }, { k: '职场', w: 1 }, { k: '情感', w: 1 }, { k: '剧情', w: 1 }, { k: '悬疑', w: 1 }, { k: '治愈', w: 1 }, { k: '国风', w: 2 }, { k: '汉服', w: 2 }, { k: '古风', w: 2 }, { k: '手工', w: 1 }, { k: 'diy', w: 1 }, { k: '编程', w: 1 }, { k: '代码', w: 1 }, { k: '开源', w: 1 }, { k: '健身', w: 1 }
];
// 强无关词：即使有兴趣命中也排除（硬新闻/时政/社会事件）
const HARD_EXCLUDE = ['时政', '政治', '主席', '总理', '书记', '地震', '台风', '洪水', '疫情', '确诊', '股票', '股市', '证券', '军事', '战争', '导弹', '制裁', '冲突', '演习', '事故', '遇难', '去世', '讣告', '逮捕', '起诉', '判决', '勒索', '诈骗', '案件', '猥亵', '强奸', '性侵', '杀人', '刑事', '嫌疑人', '警方通报', '法院宣判', '法律判决'];
const MEME_SIGNALS = ['热梗', '挑战', '整活', '搞笑', '反转', '名场面', '模仿', '跟拍', '变装', '卡点', 'bgm', '离谱', '破防', '治愈', '共鸣', '情绪', '对比', '复刻', '二创', '鬼畜', '抽象', '上头', '沉浸式'];
const ENTERTAINMENT_CATEGORY = /搞笑|鬼畜|娱乐|小剧场|舞蹈|音乐|mv|影视|动漫|动画|明星|综艺|仿妆|cos|手书|宅舞|演奏/i;
const INDUSTRY_NEWS_SIGNALS = ['上线', '定档', '首曝', '发布', '公测', '预约', '测试', '开服', '版本', '更新', '联动', '流水', '营收', '增长', '融资', '新品', '厂商', '数据', '报告', '市场', '收入', '财报', '海外', '全球'];
const MOBILE_SIGNALS = ['手游', '手机游戏', '移动游戏', '移动端', '安卓', 'android', 'ios'];
const MOBILE_SUPPORT_SIGNALS = ['抽卡', '卡池', '公测', '开服', '新服', '预约', '版本更新'];
const MOBILE_GAME_NAMES = ['原神', '崩坏', '星穹铁道', '绝区零', '鸣潮', '王者荣耀', '和平精英', '明日方舟', '第五人格', '火影忍者手游', '英雄联盟手游', '金铲铲', '逆水寒手游', '梦幻西游手游', '蛋仔派对', '恋与深空', '燕云十六声手游'];
const ZHANGJIAN_SIGNALS = ['杖剑传说', '杖剑', '放置冒险', '放置养成', '奇幻冒险', '剑与魔法', '职业养成', '转职', '副本攻略', '秘境', '坐骑', '公会', '多人组队', '角色养成'];
const NON_MOBILE_SIGNALS = ['steam', '主机', 'ps5', 'ps4', 'xbox', 'switch', '单机', '端游', 'pc版', 'pc游戏', '独立游戏', '3a大作'];

function mobileGameScore(title) {
  const text = String(title || '').toLowerCase();
  const mobileHits = MOBILE_SIGNALS.filter(word => text.includes(word)).length;
  const supportHits = MOBILE_SUPPORT_SIGNALS.filter(word => text.includes(word)).length;
  const knownGameHits = MOBILE_GAME_NAMES.filter(word => text.includes(word)).length;
  const zhangjianHits = ZHANGJIAN_SIGNALS.filter(word => text.includes(word)).length;
  const nonMobileHits = NON_MOBILE_SIGNALS.filter(word => text.includes(word)).length;
  // 明确为手游或杖剑相关题材时允许跨端内容；否则端游/主机信号直接排除。
  if (nonMobileHits && !mobileHits && !zhangjianHits) return -1;
  if (!mobileHits && !knownGameHits && !zhangjianHits) return 0;
  return mobileHits * 5 + knownGameHits * 5 + zhangjianHits * 4 + supportHits - nonMobileHits * 2;
}

function relevanceScore(title) {
  if (!title) return 0;
  const t = String(title).toLowerCase();
  let s = 0;
  for (const it of INTERESTS) { if (t.indexOf(it.k) !== -1) s += it.w; }
  for (const e of HARD_EXCLUDE) { if (t.indexOf(e) !== -1) return -1; }
  return s;
}

function classifyHotspot(h) {
  const text = `${h.title || ''} ${h.category || ''} ${h.keyword || ''}`.toLowerCase();
  if (/游戏|手游|电竞|攻略|副本|抽卡|公测|开服|steam|主机|ps5|switch/.test(text)) return '游戏热点';
  if (/挑战|整活|搞笑|反转|鬼畜|名场面|热梗|抽象|离谱/.test(text)) return '热梗模板';
  if (/变装|卡点|bgm|舞蹈|翻唱|摄影|特效|短片|剪辑/.test(text)) return '视觉/形式趋势';
  if (/情感|共鸣|破防|治愈|职场|校园|生活|vlog/.test(text)) return '情绪话题';
  if (/美食|探店|旅行|旅游|穿搭|美妆|健身|萌宠/.test(text)) return '生活方式热点';
  return h.category && !/手游热点/.test(h.category) ? h.category : '网感热点';
}

function classifyIndustry(title) {
  const text = String(title || '').toLowerCase();
  if (/mmo|mmorpg|大型多人|多人在线|公会|团战|逆水寒|天龙八部|梦幻西游|诛仙|剑网|龙之谷/.test(text)) return 'MMO';
  if (/休闲|益智|消除|放置|模拟经营|小游戏|轻量|解压|合成|蛋仔派对|元梦之星|开心消消乐|羊了个羊|保卫萝卜|植物大战僵尸|pvz/.test(text)) return '休闲向';
  if (/rpg|角色扮演|动作角色|回合制|回合|卡牌|养成|冒险|原神|崩坏|星穹铁道|绝区零|鸣潮|明日方舟|杖剑传说|伊莫|阴阳师|恋与深空/.test(text)) return 'RPG';
  if (/派对|音游|音乐|舞蹈|社交|搞笑|娱乐|互动|联动|演唱|综艺/.test(text)) return '娱乐向';
  return '手游';
}

function freshnessScore(h) {
  const raw = h.publishedAt || h.published_at;
  if (!raw) return 5;
  const ageHours = Math.max(0, (Date.now() - new Date(raw).getTime()) / 3600000);
  if (!Number.isFinite(ageHours)) return 5;
  if (ageHours <= 24) return 15;
  if (ageHours <= 72) return 12;
  if (ageHours <= 168) return 8;
  if (ageHours <= 720) return 4;
  return 0;
}

// 仅排除明确不适合营销创意研判的硬新闻，其余真实榜单内容都可进入通用发现池。
function filterRelevant(list) {
  const scored = [];
  for (const h of (list || [])) {
    const interest = relevanceScore(h.title);
    if (interest < 0 || !h.url) continue;
    const text = `${h.title || ''} ${h.keyword || ''}`.toLowerCase();
    const memeHits = MEME_SIGNALS.filter(word => text.includes(word)).length;
    const sourceCategory = String(h.category || '');
    const entertainmentMatch = ENTERTAINMENT_CATEGORY.test(`${sourceCategory} ${text}`);
    const mobileScore = mobileGameScore(text);
    const industryVerticalMatch = /手游|手机游戏|移动游戏|mmo|mmorpg|rpg|角色扮演|休闲游戏|放置游戏|卡牌游戏|新游公测|开服/.test(text)
      && (h.gameVertical || /游戏|电子竞技/.test(sourceCategory));
    const channel = h.industryNews || mobileScore > 0 || industryVerticalMatch ? '行业动态' : '今日焦点';
    // 今日焦点只收泛娱乐内容或有明确模仿/二创信号的热梗，普通科普、资讯和工具教程不进入。
    if (channel === '今日焦点' && !entertainmentMatch && memeHits <= 0) continue;
    const memeScore = Math.min(35, memeHits * 7 + (entertainmentMatch ? 10 : 0) + Math.min(10, Math.max(0, interest)));
    const heat = Math.max(0, Number(h.heat) || 0);
    const rankBonus = Math.max(0, 12 - Math.log2(Math.max(1, Number(h.rank) || 100)) * 2);
    const trendScore = Math.min(35, Math.log10(heat + 1) * 4 + rankBonus);
    const freshScore = freshnessScore(h);
    const sourceScore = h.url ? 10 : 0;
    const industryHits = INDUSTRY_NEWS_SIGNALS.filter(word => text.includes(word)).length;
    const industryScore = Math.min(35, Math.max(0, mobileScore) * 3 + (industryVerticalMatch ? 15 : 0) + (h.industryNews ? 15 : 0) + industryHits * 5);
    const discoveryScore = Math.round(Math.min(100, (channel === '行业动态' ? industryScore : memeScore) + trendScore + freshScore + sourceScore));
    const enriched = {
      ...h,
      sourceCategory,
      channel,
      category: channel === '行业动态' ? '手游行业' : classifyHotspot(h),
      industryCategory: channel === '行业动态' ? classifyIndustry(text) : '',
      relevanceScore: interest,
      memeScore: Math.round(memeScore),
      trendScore: Math.round(trendScore),
      freshnessScore: freshScore,
      discoveryScore,
      candidateScore: discoveryScore
    };
    scored.push({ h: enriched, s: discoveryScore });
  }
  scored.sort((a, b) => b.s - a.s);
  // 两个池分别保留足够容量，避免手游内容挤占泛娱乐焦点，或反过来让行业动态无内容。
  const focus = scored.filter(item => item.h.channel === '今日焦点' && item.s >= 45).slice(0, 60);
  const industry = scored.filter(item => item.h.channel === '行业动态' && item.s >= 40).slice(0, 60);
  const primary = [...focus, ...industry];
  return primary.sort((a, b) => b.s - a.s).map(x => x.h);
}

const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Shanghai';
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
function dateOnly(d) { return DATE_FORMATTER.format(d); }

function buildGameContext(camp) {
  if (!camp) return '《杖剑传说》是一款剑与魔法的奇幻题材手游，适合测评/攻略/剧情/二创/整活类 KOC 内容。';
  return `当前项目：${camp.game_name || '杖剑传说'}；任务：${camp.name}；版本/活动：${camp.version_event || '—'}；目标：${camp.goal || '—'}；重点内容：${camp.focus_content || '—'}；期望方向：${camp.content_directions || '—'}；项目关键词：${camp.keywords || '—'}。只基于这些真实信息判断热点适配，不要补写未提供的项目设定。`;
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? String(row.value || '').trim() : '';
}

function normalizeIndustryNews(items) {
  const cutoff = Date.now() - 45 * 86400000;
  return (items || []).filter(item => {
    const raw = item.pub_date || item.batch_date;
    const time = raw ? new Date(raw).getTime() : Date.now();
    return !Number.isFinite(time) || time >= cutoff;
  }).slice(0, 80).map((item, index) => ({
    id: `industry-news-${item.id || index}`,
    source: item.source || '游戏资讯',
    sourceType: item.source === '伽马数据' ? '产业数据报告' : '游戏行业资讯',
    title: item.title,
    category: item.category || '游戏资讯',
    url: item.url,
    heat: 0,
    rank: index + 1,
    up: item.source || '',
    description: item.summary || '',
    publishedAt: item.pub_date ? `${item.pub_date}T08:00:00.000Z` : null,
    gameVertical: true,
    industryNews: true
  }));
}

function buildDouyinKeywords(camp) {
  const base = ['全网热梗', '热门挑战', '反转整活', '情绪共鸣', '热门BGM', '变装卡点', '休闲手游', '娱乐向手游', 'MMO手游', 'RPG手游'];
  if (camp) {
    base.unshift(camp.game_name || '');
    for (const value of [camp.version_event, camp.focus_content, camp.content_directions]) {
      base.push(...String(value || '').split(/[，,、；;|/\n]/));
    }
  }
  return [...new Set(base.map(x => String(x || '').trim()).filter(x => x && x.length <= 24))].slice(0, 12);
}

async function generate(db, { force } = {}) {
  if (force) hotspotSource.invalidate(); // 强制时先清空热点源内存缓存，确保真正重抓
  const camp = db.prepare("SELECT * FROM campaigns WHERE status='执行中' ORDER BY (is_current=1) DESC, id DESC LIMIT 1").get();
  const [hs, industryNews] = await Promise.all([
    hotspotSource.getHotspots(150, {
      douyin: {
        clientKey: getSetting(db, 'douyin_client_key') || process.env.DOUYIN_CLIENT_KEY || '',
        clientSecret: getSetting(db, 'douyin_client_secret') || process.env.DOUYIN_CLIENT_SECRET || '',
        deviceId: getSetting(db, 'douyin_device_id') || process.env.DOUYIN_DEVICE_ID || '',
        keywords: buildDouyinKeywords(camp)
      }
    }),
    gameNews.getSnapshot(db, { force: Boolean(force) })
  ]);
  // 发现层保留通用热点；推荐层再结合当前策略判断是否值得用于当前项目。
  const list = filterRelevant([...(hs.list || []), ...normalizeIndustryNews(industryNews.items)]);
  const recos = await ai.recommendOpportunities({ hotspots: list, gameContext: buildGameContext(camp), campaign: camp, topN: 20 });
  const now = new Date().toISOString();
  const snap = {
    snap_date: dateOnly(new Date()),
    hotspots_json: JSON.stringify(list),
    recommendations_json: JSON.stringify(recos),
    source_status_json: JSON.stringify({ ...(hs.sourceStatus || {}), industryNews: industryNews.status || {} }),
    fetched_at: hs.fetchedAt || now,
    analyzed_at: now
  };
  db.prepare(`INSERT OR REPLACE INTO daily_hotspot_snapshot
    (snap_date, hotspots_json, recommendations_json, source_status_json, fetched_at, analyzed_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
      snap.snap_date, snap.hotspots_json, snap.recommendations_json,
      snap.source_status_json, snap.fetched_at, snap.analyzed_at);
  return snap;
}

function getSnapshotByDate(db, snapDate) {
  return db.prepare('SELECT * FROM daily_hotspot_snapshot WHERE snap_date=?').get(snapDate) || null;
}

function getLatestSnapshot(db) {
  return db.prepare('SELECT * FROM daily_hotspot_snapshot ORDER BY snap_date DESC LIMIT 1').get() || null;
}

function emptySnapshot(targetDate) {
  return {
    snap_date: targetDate,
    hotspots_json: '[]',
    recommendations_json: '[]',
    source_status_json: '{}',
    fetched_at: null,
    analyzed_at: null
  };
}

// 在途锁：后台更新、自动任务和手动刷新共用同一份任务，避免重复抓取和重复消耗 AI。
let inFlight = null;
let refreshState = {
  status: 'idle',
  targetDate: null,
  startedAt: null,
  finishedAt: null,
  error: ''
};

function beginRefresh(db, { force = false } = {}) {
  const today = dateOnly(new Date());
  if (inFlight) return inFlight;
  const current = getSnapshotByDate(db, today);
  if (!force && current) return Promise.resolve(current);

  refreshState = {
    status: 'running',
    targetDate: today,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: ''
  };
  inFlight = (async () => {
    try {
      const snap = await generate(db, { force });
      refreshState = {
        ...refreshState,
        status: 'completed',
        finishedAt: new Date().toISOString(),
        error: ''
      };
      return snap;
    } catch (e) {
      refreshState = {
        ...refreshState,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: e.message || '今日热点更新失败'
      };
      throw e;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function ensure(db, { force } = {}) {
  const today = dateOnly(new Date());
  if (!force) {
    const row = getSnapshotByDate(db, today);
    if (row) return row;
  }
  return await beginRefresh(db, { force: Boolean(force) });
}

function startBackgroundRefresh(db) {
  const today = dateOnly(new Date());
  if (getSnapshotByDate(db, today)) return false;
  // 同一天的后台任务失败后停在失败态，避免状态轮询不断重新抓取；由手动刷新显式重试。
  if (refreshState.targetDate === today && refreshState.status === 'failed') return false;
  beginRefresh(db, { force: false }).catch(e => {
    console.error('[dailyHotspot] 后台更新失败:', e.message);
  });
  return true;
}

/**
 * 非阻塞读取：优先返回今日快照；若今日不存在则立即返回最近快照并在后台生成今日数据。
 * 数据库完全为空时返回空快照，前端仍可展示“正在生成”状态而不是请求超时。
 */
function readSnapshot(db) {
  const today = dateOnly(new Date());
  const current = getSnapshotByDate(db, today);
  if (!current) startBackgroundRefresh(db);
  const cached = current || getLatestSnapshot(db);
  const snapshot = cached || emptySnapshot(today);
  return {
    snapshot,
    hasSnapshot: Boolean(cached),
    updating: !current && (refreshState.status === 'running' || Boolean(inFlight)),
    stale: Boolean(cached) && snapshot.snap_date !== today,
    targetDate: today,
    updateStatus: current ? 'completed' : refreshState.status,
    updateError: current ? '' : refreshState.error,
    updateStartedAt: refreshState.startedAt,
    updateFinishedAt: refreshState.finishedAt
  };
}

function getRefreshStatus(db) {
  const state = readSnapshot(db);
  return {
    hasSnapshot: state.hasSnapshot,
    updating: state.updating,
    stale: state.stale,
    displayedSnapDate: state.snapshot.snap_date,
    targetSnapDate: state.targetDate,
    status: state.updateStatus,
    error: state.updateError,
    startedAt: state.updateStartedAt,
    finishedAt: state.updateFinishedAt
  };
}

function getSnapshot(db, { force } = {}) {
  return ensure(db, { force });
}

module.exports = {
  getSnapshot, getLatestSnapshot, readSnapshot, getRefreshStatus, startBackgroundRefresh,
  generate, ensure, dateOnly, filterRelevant, relevanceScore, mobileGameScore
};
