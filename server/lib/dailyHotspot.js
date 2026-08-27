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

/** 热点池只保留三类：杖剑相关、手游共性热点、能被游戏内容直接借用的网络热梗。 */
const MEME_SIGNALS = ['热梗', '玩梗', '梗图', '梗王', '名场面', '挑战', '接力', '整活', '搞笑', '沙雕', '抽象', '离谱', '反差', '变装', '卡点', '二创', '鬼畜', '模仿', '翻拍', '跟拍', '出圈', '刷屏', '爆火', '火了', '上头', '破防', '笑不活', '谁懂', '主打一个', '一整个', '已老实', '求放过', '显眼包', '电子榨菜', '情绪价值', '仪式感', '松弛感', '班味', '发疯', '赛博', '人机感', '听劝', '泼天富贵', '沉浸式', '万万没想到', '没想到', '原来', '当代年轻人', '打工人', '摸鱼', '社恐', '社牛', 'i人', 'e人'];
const MEME_FORMAT_RULES = [
  { label: '参与式挑战', re: /(挑战|接力|大赛|模仿|翻拍|跟拍|变装|卡点|二创|整活|晒出|测试)/ },
  { label: '网络流行表达', re: /(当我|万万没想到|没想到|原来|谁懂|主打一个|一整个|怎么不算|不是.{0,12}而是|没有.{0,12}一开始|用.{1,12}打开|建议查查|千万别|今天才知道)/ },
  { label: '玩家可代入情绪', re: /(打工人|摸鱼|下班|周五|周末|开学|社恐|社牛|i人|e人|班味|松弛感|情绪价值|发疯|破防|听劝|反差|仪式感)/ }
];
// 这些是娱乐行业/人物/作品资讯，不是可让游戏账号参与的网络梗。
const ENTERTAINMENT_NEWS_EXCLUDE = ['影视', '电影', '电视剧', '短剧', '剧集', '综艺', '演唱会', '音乐节', '新歌', '单曲', '专辑', '翻唱', '首映', '定档', '开播', '杀青', '票房', '预告片', '明星', '艺人', '演员', '歌手', '爱豆', '偶像', '男团', '女团', '组合', '粉丝', '超话', '官宣', '退役', '夺冠', '联赛', '球员', '球队', '比分'];
const HARD_EXCLUDE = ['时政', '政治', '主席', '总理', '书记', '总统', '首相', '政府', '外交', '关税', '地震', '台风', '洪水', '洪灾', '洪涝', '溃口', '暴雨', '暴雪', '火灾', '爆炸', '坠毁', '疫情', '确诊', '感染', '病例', '疾控', '股票', '股市', '证券', '军事', '战争', '导弹', '制裁', '冲突', '演习', '事故', '遇难', '伤亡', '死亡', '失联', '救援', '抢险', '封堵', '遇险', '预警', '去世', '讣告', '警方', '法院', '检察', '犯罪', '逮捕', '起诉', '判决', '勒索', '诈骗', '辟谣', '通报', '处罚', '高考', '中考', '考研', '房产', '楼市'];
const MOBILE_TREND_RULES = [
  { label: '手游行业/榜单', re: /手游.{0,12}(排行榜|榜单|盘点|合集|速览|趋势|报告|市场|行业|数据|收入|流水|买量|出海|厂商|用户|付费|商业化)/ },
  { label: '手游行业/榜单', re: /(排行榜|榜单|盘点|合集|速览).{0,20}手游/ },
  { label: '新游趋势/盘点', re: /新游.{0,10}(排行榜|榜单|盘点|合集|趋势|报告)/ },
  { label: '游戏版号', re: /游戏版号/ },
  { label: '手游玩家共性话题', re: /(抽卡|卡池|氪金|零氪|月卡党|放置养成).{0,12}(机制|趋势|讨论|玩家|体验|争议|分析|规划)/ },
  { label: '手游玩家共性话题', re: /(玩家|机制|趋势|讨论|体验|争议).{0,12}(抽卡|卡池|氪金|零氪|月卡党|放置养成)/ }
];
const OTHER_GAME_SIGNALS = ['原神', '崩坏', '星穹铁道', '绝区零', '鸣潮', '王者荣耀', '和平精英', '明日方舟', '第五人格', '火影忍者', '英雄联盟', '金铲铲', '逆水寒', '梦幻西游', '蛋仔派对', '恋与深空', '燕云十六声', '阴阳师', '光遇', '永劫无间', '剑网3', '剑网三', '云顶之弈', '鸡械火了', '蓝色星原', '无限暖暖', '叠纸', 'lol', 'dnf', 'cf手游', '穿越火线', '地下城与勇士', '复古传奇', '传奇手游', '腾讯游戏', '网易游戏'];
const ZHANGJIAN_BRAND_SIGNALS = ['杖剑传说', '杖剑'];
const ZHANGJIAN_THEME_SIGNALS = ['星陨秘境', '剑与魔法', '放置冒险', '奇幻冒险', '秘境攻略', '平民抽卡', '职业养成'];
const NON_MOBILE_SIGNALS = ['steam', '主机', 'ps5', 'ps4', 'xbox', 'switch', '单机', '端游', 'pc版', 'pc游戏', '独立游戏', '3a大作'];
const SPECIFIC_GAME_CONTENT_SIGNALS = ['角色pv', '版本pv', '实机演示', '角色展示', '关卡攻略', '满星攻略', '阵容推荐', '新皮肤', '通关演示', '出装', '符文', '对线', '上分技巧', '强度榜', '全人物解锁', '流程实况'];
const RISKY_GAME_CONTENT_SIGNALS = ['内置gm', '无限内购', '无限资源', '破解', '破解版', '外挂', '私服', '无偿分享', '兑换码来袭'];
const GENERIC_MEME_SEARCH_TERMS = new Set(['网络热梗', '全网挑战']);
const VIRAL_PROOF_RE = /(网络热梗|全网热梗|玩梗|爆火|火遍全网|全网爆火|刷屏|出圈|破亿|全民参与|全网都在)/;
const MEME_META_CONTENT_RE = /(盘点|合集|三大|最新热梗|近期.{0,8}热梗|锐评|梗知识|学会了吗|烂梗|教育)/;
const SPECIFIC_MEME_TITLE_RE = /热梗(?:《|“|「|之|：|:)/;
const GENERIC_CAMPAIGN_WORDS = new Set(['暑期', '活动', '版本', '新版本', '角色', '新角色', '职业', '新职业', '攻略', '抽卡', '测评', '预热', '资料片']);

function hitWords(text, words) { return words.filter(word => text.includes(word)); }

function campaignTerms(campaign) {
  if (!campaign) return [];
  return [...new Set(String(campaign.keywords || '').split(/[,，、;；\s]+/).map(x => x.trim().toLowerCase())
    .filter(x => x.length >= 3 && !GENERIC_CAMPAIGN_WORDS.has(x)))];
}

function buildSearchKeywords(campaign) {
  const game = String(campaign?.game_name || '杖剑传说').replace(/[《》]/g, '').trim() || '杖剑传说';
  return [game, '手游行业', '网络热梗', '全网挑战', ...campaignTerms(campaign).slice(0, 1).map(term => `${game} ${term}`)];
}

function classifyHotspot(h, campaign = null) {
  const title = String(h?.title || '').toLowerCase();
  if (!title) return null;
  if (h?.targeted && h?.publishedAt) {
    const ageDays = (Date.now() - new Date(h.publishedAt).getTime()) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > 45) return null;
  }
  const hardHits = hitWords(title, HARD_EXCLUDE);
  if (hardHits.length) return null;
  if (hitWords(title, RISKY_GAME_CONTENT_SIGNALS).length) return null;
  const brandHits = hitWords(title, ZHANGJIAN_BRAND_SIGNALS);
  const otherGameHits = hitWords(title, OTHER_GAME_SIGNALS);
  if (otherGameHits.length && !brandHits.length) return null;
  const taskHits = hitWords(title, campaignTerms(campaign));
  const themeHits = hitWords(title, ZHANGJIAN_THEME_SIGNALS);
  if (brandHits.length || taskHits.length || (themeHits.length && !h?.gameVertical)) {
    const matched = [...brandHits, ...taskHits, ...themeHits];
    return { category: '杖剑相关', score: 36 + matched.length * 8, matched, reason: `命中杖剑/当前任务词：${matched.join('、')}` };
  }
  if (hitWords(title, SPECIFIC_GAME_CONTENT_SIGNALS).length) return null;
  const mobileHits = [...new Set(MOBILE_TREND_RULES.filter(rule => rule.re.test(title)).map(rule => rule.label))];
  const nonMobileHits = hitWords(title, NON_MOBILE_SIGNALS);
  if (mobileHits.length && !nonMobileHits.length) {
    return { category: '手游热点', score: 24 + mobileHits.length * 5, matched: mobileHits, reason: `手游行业/玩法共性词：${mobileHits.join('、')}` };
  }
  // 主动搜索“网络热梗/全网挑战”会混入大量普通视频，必须有明确传播证据才算热点。
  if (h?.targeted && GENERIC_MEME_SEARCH_TERMS.has(String(h.searchKeyword || ''))) {
    if (!VIRAL_PROOF_RE.test(title)) return null;
    // “热梗盘点/合集”只是二手汇总，不提供可直接借用的具体梗；带《梗名》或“热梗之…”的除外。
    if (MEME_META_CONTENT_RE.test(title) && !SPECIFIC_MEME_TITLE_RE.test(title)) return null;
  }
  const isGameVertical = !!h?.gameVertical || /游戏|电竞/.test(String(h?.category || '').toLowerCase());
  if (isGameVertical || nonMobileHits.length) return null;
  if (hitWords(title, ENTERTAINMENT_NEWS_EXCLUDE).length) return null;
  const memeHits = hitWords(title, MEME_SIGNALS);
  const formatHits = MEME_FORMAT_RULES.filter(rule => rule.re.test(title)).map(rule => rule.label);
  const matched = [...new Set([...memeHits, ...formatHits])];
  if (matched.length) {
    return { category: '泛娱乐可借势', score: 18 + matched.length * 5, matched, reason: `可套用的网络热梗/内容形式：${matched.join('、')}` };
  }
  return null;
}

function mobileGameScore(title) {
  const result = classifyHotspot({ title });
  return result && ['杖剑相关', '手游热点'].includes(result.category) ? result.score : 0;
}

function relevanceScore(title) {
  const text = String(title || '').toLowerCase();
  if (hitWords(text, HARD_EXCLUDE).length) return -1;
  if (hitWords(text, ENTERTAINMENT_NEWS_EXCLUDE).length) return -1;
  return hitWords(text, MEME_SIGNALS).length + MEME_FORMAT_RULES.filter(rule => rule.re.test(text)).length;
}

function classifyIndustry(title) {
  const text = String(title || '').toLowerCase();
  if (/mmo|mmorpg|大型多人|多人在线|公会|团战|逆水寒|天龙八部|梦幻西游|诛仙|剑网|龙之谷/.test(text)) return 'MMO';
  if (/休闲|益智|消除|放置|模拟经营|小游戏|轻量|解压|合成|蛋仔派对|元梦之星|开心消消乐|羊了个羊|保卫萝卜|植物大战僵尸|pvz/.test(text)) return '休闲向';
  if (/rpg|角色扮演|动作角色|回合制|回合|卡牌|养成|冒险|原神|崩坏|星穹铁道|绝区零|鸣潮|明日方舟|杖剑传说|阴阳师|恋与深空/.test(text)) return 'RPG';
  if (/派对|音游|音乐|舞蹈|社交|搞笑|娱乐|互动|联动|演唱|综艺/.test(text)) return '娱乐向';
  return '手游';
}

function filterRelevant(list, db = null, campaign = null) {
  const scored = [];
  const caseTexts = db ? db.prepare(`SELECT title,copy,summary,content_type,play_method,topic_tags,play_count,result
      FROM cases WHERE play_count>0 AND source='项目执行结果'`).all()
    .map(row => ({
      text: `${row.title || ''} ${row.copy || ''} ${row.summary || ''} ${row.content_type || ''} ${row.play_method || ''} ${row.topic_tags || ''}`.toLowerCase(),
      weight: ['爆款', '良好', '高表现'].includes(row.result) ? 2 : 1,
      play: Number(row.play_count) || 0
    })) : [];
  for (const h of (list || [])) {
    const classification = h.industryNews
      ? { category: '行业动态', score: 30, matched: [h.source || '游戏资讯'], reason: `来自${h.source || '游戏资讯'}的行业资讯` }
      : classifyHotspot(h, campaign);
    if (classification) {
      const words = [...new Set(classification.matched)];
      const matches = caseTexts.filter(item => words.some(word => word.length >= 2 && item.text.includes(word)));
      const caseHits = matches.length;
      const successfulCaseCount = matches.filter(item => item.weight > 1).length;
      const caseScore = matches.reduce((sum, item) => sum + item.weight + Math.min(2, Math.log10(Math.max(1, item.play)) / 3), 0);
      const heatScore = Math.max(0, 8 - Math.log2(Math.max(1, Number(h.rank) || 100)));
      const totalScore = classification.score + Math.min(24, caseScore * 2) + heatScore;
      const channel = classification.category === '泛娱乐可借势' ? '今日焦点' : '行业动态';
      scored.push({ h: { ...h, channel, hotspotCategory: classification.category, industryCategory: channel === '行业动态' ? classifyIndustry(h.title) : '', matchReason: classification.reason, matchedSignals: classification.matched, relevanceScore: classification.score, similarCaseCount: caseHits, successfulCaseCount, candidateScore: Math.round(totalScore * 10) / 10 }, s: totalScore });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  const caps = { '杖剑相关': 30, '手游热点': 30, '泛娱乐可借势': 40, '行业动态': 40 };
  const counts = {};
  const capped = scored.filter(item => {
    const category = item.h.hotspotCategory;
    counts[category] = (counts[category] || 0) + 1;
    return counts[category] <= (caps[category] || 20);
  });
  const buckets = Object.fromEntries(Object.keys(caps).map(category => [category, capped.filter(item => item.h.hotspotCategory === category)]));
  const balanced = [];
  const order = ['杖剑相关', '泛娱乐可借势', '手游热点', '泛娱乐可借势', '行业动态'];
  while (order.some(category => buckets[category]?.length)) {
    for (const category of order) {
      if (buckets[category]?.length) balanced.push(buckets[category].shift());
    }
  }
  return balanced.map(x => x.h);
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
  return `《${camp.game_name || '杖剑传说'}》是一款奇幻题材手游。当前任务：${camp.name}；版本/活动：${camp.version_event || '—'}；目标：${camp.goal || '—'}；重点内容：${camp.focus_content || '—'}；期望方向：${camp.content_directions || '—'}。游戏卖点：剑与魔法的奇幻冒险、职业/坐骑/副本/剧情、二创与整活空间大、适合测评/攻略/情怀向内容。`;
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
      searchKeywords: buildSearchKeywords(camp),
      douyin: {
        clientKey: getSetting(db, 'douyin_client_key') || process.env.DOUYIN_CLIENT_KEY || '',
        clientSecret: getSetting(db, 'douyin_client_secret') || process.env.DOUYIN_CLIENT_SECRET || '',
        deviceId: getSetting(db, 'douyin_device_id') || process.env.DOUYIN_DEVICE_ID || '',
        keywords: buildDouyinKeywords(camp)
      }
    }),
    gameNews.getSnapshot(db, { force: Boolean(force) })
  ]);
  const list = filterRelevant([...(hs.list || []), ...normalizeIndustryNews(industryNews.items)], db, camp);
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
  return { snap_date: targetDate, hotspots_json: '[]', recommendations_json: '[]', source_status_json: '{}', fetched_at: null, analyzed_at: null };
}

let inFlight = null;
let refreshState = { status: 'idle', targetDate: null, startedAt: null, finishedAt: null, error: '' };

function beginRefresh(db, { force = false } = {}) {
  const today = dateOnly(new Date());
  if (inFlight) return inFlight;
  const current = getSnapshotByDate(db, today);
  if (!force && current) return Promise.resolve(current);
  refreshState = { status: 'running', targetDate: today, startedAt: new Date().toISOString(), finishedAt: null, error: '' };
  inFlight = (async () => {
    try {
      const snap = await generate(db, { force });
      refreshState = { ...refreshState, status: 'completed', finishedAt: new Date().toISOString(), error: '' };
      return snap;
    } catch (e) {
      refreshState = { ...refreshState, status: 'failed', finishedAt: new Date().toISOString(), error: e.message || '今日热点更新失败' };
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
  if (refreshState.targetDate === today && refreshState.status === 'failed') return false;
  beginRefresh(db, { force: false }).catch(e => console.error('[dailyHotspot] 后台更新失败:', e.message));
  return true;
}

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

function getSnapshot(db, { force } = {}) { return ensure(db, { force }); }

module.exports = {
  getSnapshot, getLatestSnapshot, readSnapshot, getRefreshStatus, startBackgroundRefresh,
  generate, ensure, dateOnly, filterRelevant, relevanceScore, mobileGameScore,
  classifyHotspot, buildSearchKeywords, campaignTerms
};
