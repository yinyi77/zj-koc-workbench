/**
 * 规则推荐/打分引擎（AI不可用时的兜底，也用于今日工作的机会推荐）
 * 打分维度：
 *  A 当前项目适配           (0-35)
 *  B 热梗/内容可复用性      (0-25)
 *  C 趋势强度               (0-20)
 *  D 新鲜度与可追溯性       (0-20)
 *  E 风险扣分               (-30 ~ 0)
 */
const { getDb } = require('../db/database');

function tokenize(str) {
  return (str || '').split(/[,，、\s/|]+/).map(s => s.trim()).filter(s => s.length >= 2);
}

function textHasAny(text, words) {
  const t = (text || '').toLowerCase();
  return words.filter(w => t.includes(w.toLowerCase()));
}

function parseJson(s, fallback) {
  if (!s) return fallback;
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : fallback; }
  catch (e) { return fallback; }
}

// 限制与风险规则：可自动识别的维度（其余维度为人工核对红线，不自动扣分）
// 注意：detect 必须返回布尔值（textHasAny 返回数组，空数组在 JS 里为真值，需显式判断 .length）
const RISK_DEFS = [
  { key: 'opinion', label: '舆情风险', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['争议', '绯闻', '负面', '吐槽', '差评', '维权']).length > 0 && !/竞品/.test(h.title || '') },
  { key: 'copyright', label: '版权风险', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['搬运', '盗用', '抄袭', '侵权', '未授权']).length > 0 },
  { key: 'ip_unauth', label: '未授权IP使用', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['未授权', '侵权', '盗用IP']).length > 0 },
  { key: 'exaggerate', label: '过度夸大宣传', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['暴涨', '必看', '最强', '逆天', '百分百', '保证', '稳赚', '封神', '神作']).length > 0 },
  { key: 'platform_rule', label: '不符合平台规则', detect: h => (h.category === '泛娱乐' || h.category === '社会热点' || h.trend === '下降') },
  { key: 'real_person', label: '过度依赖真人拍摄', detect: h => textHasAny(`${h.title} ${h.tags || ''} ${h.description || ''}`, ['真人', '实拍', '拍摄', '露脸', '出镜']).length > 0 },
  { key: 'outdated', label: '已经过时的热点', detect: h => (h.trend === '下降' || (h.valid_until && new Date(h.valid_until) < new Date()) || (h.heat || 0) < 50) }
];
const MANUAL_RISK = { char_error: '角色设定错误', high_cost: '制作成本过高', koc_mismatch: '不适合KOC能力的玩法' };

/** 评估热点命中的风险规则；返回 {blocked, hits:[{key,label,level,manual}]} */
function evaluateRisk(hotspot, campaign) {
  const rules = parseJson(campaign && campaign.risk_rules, null);
  const hits = [];
  if (rules) {
    for (const def of RISK_DEFS) {
      const lvl = rules[def.key];
      if (!lvl || lvl === 'off') continue;
      if (def.detect(hotspot)) hits.push({ key: def.key, label: def.label, level: lvl });
    }
    for (const k of Object.keys(MANUAL_RISK)) {
      const lvl = rules[k];
      if (lvl && lvl !== 'off') hits.push({ key: k, label: MANUAL_RISK[k], level: lvl, manual: true });
    }
  }
  const blocked = hits.some(h => h.level === 'forbid' && !h.manual);
  return { blocked, hits };
}

/** 取"作为业务背景"的任务：优先用当前任务(is_current)，否则取所有执行中任务 */
function activeCampaigns(db) {
  const cur = db.prepare("SELECT * FROM campaigns WHERE is_current=1 LIMIT 1").get();
  if (cur) return [cur];
  return db.prepare("SELECT * FROM campaigns WHERE status='执行中' ORDER BY (priority='高') DESC, end_date ASC").all();
}

/** 对热点进行独立研判，不依赖作者库、案例库或投放结果。 */
function scoreHotspot(hotspot, campaign) {
  const detail = [];
  const text = `${hotspot.title || ''} ${hotspot.description || ''} ${hotspot.tags || ''}`.toLowerCase();
  let score = 0;

  const gameName = String(campaign && campaign.game_name || '杖剑传说').replace(/[《》]/g, '');
  const directWords = [gameName, ...(gameName === '杖剑传说' ? ['杖剑', '剑与魔法', '奇幻冒险', '职业养成', '放置养成', '转职', '秘境', '坐骑', '副本'] : [])].filter(Boolean);
  const campaignWords = campaign ? tokenize(`${campaign.keywords || ''} ${campaign.content_directions || ''} ${campaign.focus_content || ''} ${campaign.version_event || ''} ${campaign.goal || ''}`) : [];
  const directHits = textHasAny(text, directWords);
  const campaignHits = textHasAny(text, campaignWords);
  const targetScore = Math.min(35, directHits.length * 7 + campaignHits.length * 6);
  score += targetScore;
  detail.push({ dim: '当前项目适配', score: targetScore, max: 35, note: [...directHits, ...campaignHits].slice(0, 5).join('、') || `未直接命中${gameName}关注词，可继续判断表达形式是否可迁移` });

  const adaptableWords = ['热梗', '攻略', '测评', '挑战', '整活', '二创', '剧情', '反转', '对比', '盘点', '教程', '实测', '玩法', '名场面', '模仿', '跟拍', '变装', '卡点', '共鸣', '破防', '复刻'];
  const adaptableHits = textHasAny(text, adaptableWords);
  const adaptableScore = Math.min(25, 5 + adaptableHits.length * 5 + (hotspot.memeScore ? Math.round(Number(hotspot.memeScore) / 5) : 0));
  score += adaptableScore;
  detail.push({ dim: '热梗可复用', score: adaptableScore, max: 25, note: adaptableHits.join('、') || '需要人工识别可迁移的表达模板' });

  const rawHeat = Math.max(0, Number(hotspot.heat) || 0);
  let heatScore = hotspot.trendScore != null
    ? Math.round(Math.min(20, Number(hotspot.trendScore) * 20 / 35))
    : Math.round(Math.min(20, Math.log10(rawHeat + 1) * 3.5));
  if (hotspot.trend === '上升') heatScore = Math.min(20, heatScore + 2);
  score += heatScore;
  detail.push({ dim: '趋势强度', score: heatScore, max: 20, note: `热度${hotspot.heat || 0}/${hotspot.trend || '未知'}` });

  let freshness = hotspot.freshnessScore != null ? Math.min(15, Number(hotspot.freshnessScore)) : 6;
  if (hotspot.trend === '下降') freshness = Math.min(freshness, 3);
  const traceability = hotspot.url ? 5 : 0;
  const freshnessTotal = Math.round(freshness + traceability);
  score += freshnessTotal;
  detail.push({ dim: '新鲜度与可追溯', score: freshnessTotal, max: 20, note: `${hotspot.publishedAt || hotspot.published_at ? '有发布时间' : '发布时间未知'}，${hotspot.url ? '可直达原内容' : '缺少原内容链接'}` });

  let riskPenalty = 0; const riskNotes = [];
  if (campaign) {
    const risk = evaluateRisk(hotspot, campaign);
    risk.hits.filter(h => h.level === 'caution' && !h.manual).forEach(h => { riskPenalty -= 10; riskNotes.push(`谨慎:${h.label}`); });
    risk.hits.filter(h => h.level === 'forbid' && !h.manual).forEach(h => { riskPenalty -= 30; riskNotes.push(`红线:${h.label}`); });
  }
  riskPenalty = Math.max(-30, riskPenalty);
  score += riskPenalty;
  detail.push({ dim: '风险扣分', score: riskPenalty, max: 0, note: riskNotes.join('；') || '未触发自动风险' });

  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 70 ? '值得跟进' : score >= 45 ? '继续观察' : '不建议跟进';
  return { score, verdict, detail };
}

/** 为机会推荐创作者（规则）*/
function recommendCreators(opportunity, hotspot, campaign, limit = 3) {
  return [];
}

/** 今日推荐：对所有候选热点打分排序 */
function dailyRecommendations() {
  const db = getDb();
  const hotspots = db.prepare("SELECT * FROM hotspots WHERE status='候选' ORDER BY heat DESC").all();
  const campaigns = activeCampaigns(db);
  const results = [];
  for (const h of hotspots) {
    let best = null, bestCamp = null;
    if (campaigns.length === 0) {
      best = scoreHotspot(h, null);
    } else {
      for (const c of campaigns) {
        const r = scoreHotspot(h, c);
        if (!best || r.score > best.score) { best = r; bestCamp = c; }
      }
    }
    results.push({ hotspot: h, campaign: bestCamp ? { id: bestCamp.id, name: bestCamp.name } : null, ...best });
  }
  return results.sort((a, b) => b.score - a.score);
}

/**
 * 实时生成「今日推荐机会」卡片所需字段（不落库）。
 * 结合候选热点 + 热点策略，给出玩法/结合方式/时间/风险等。
 * aiDraft 存在时（用户点过「重新分析」），用 AI 生成内容覆盖规则默认。
 */
function buildRecommendation(hotspot, campaign, creators, aiDraft) {
  const score = scoreHotspot(hotspot, campaign);

  let play_method, game_combo, risk_note, reason;
  if (aiDraft && (aiDraft.play_method || aiDraft.game_combo)) {
    play_method = aiDraft.play_method;
    game_combo = aiDraft.game_combo;
    risk_note = aiDraft.risk_note;
    reason = aiDraft.reason;
  } else {
    const t = (hotspot.title + ' ' + (hotspot.tags || '')).toLowerCase();
    if (hotspot.category === '游戏内') play_method = '版本玩法深度解析 + 实操演示，优先攻略/测评形式';
    else if (hotspot.category === '泛游戏') play_method = '热点梗二次创作 + 游戏自然植入，整活/挑战类更易传播';
    else play_method = '情怀/话题向内容 + 游戏彩蛋植入，弱引导不硬广';
    const focus = campaign ? (campaign.focus_content || campaign.content_directions || '') : '';
    const gameName = String(campaign && campaign.game_name || '杖剑传说').replace(/[《》]/g, '');
    const form = hotspot.platform === '抖音' ? '快节奏短视频' : '攻略/测评内容';
    game_combo = `将《${gameName}》${focus} 与热点「${hotspot.title}」结合，以 ${form} 形式呈现`;
    risk_note = hotspot.risk_note || (score.score < 45 ? '热点关联度偏低，建议谨慎' : '常规风险，注意内容合规与平台规范');
    reason = score.detail.map(x => `${x.dim} ${x.score}分`).join('｜');
  }

  let risk_level = score.score >= 70 ? '低' : score.score >= 45 ? '中' : '高';
  const suggested_time = hotspot.valid_until ? `建议在 ${hotspot.valid_until} 前启动` : '建议尽快确认执行时间';

  // 风险规则注入：被红线命中则强制高风险，并在风险说明中标注
  const riskInfo = campaign ? evaluateRisk(hotspot, campaign) : { blocked: false, hits: [] };
  if (riskInfo.blocked) risk_level = '高';
  const riskTags = riskInfo.hits.filter(h => !h.manual).map(h => `[${h.level === 'forbid' ? '禁止' : '谨慎'}]${h.label}`);
  if (riskTags.length) risk_note = (risk_note ? risk_note + '；' : '') + '风险规则：' + riskTags.join('、');

  return {
    hotspot_id: hotspot.id,
    hotspot_title: hotspot.title,
    hotspot_source: hotspot.source_label || hotspot.platform,
    campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
    score: score.score,
    verdict: score.verdict,
    play_method,
    game_combo,
    reason,
    cost_estimate: null,
    suggested_time,
    risk_level,
    risk_note
  };
}

/**
 * 对单条热点执行宣发适配筛查（自动抓取仅提供候选，此函数负责过滤不合规内容）。
 * 用营销任务关键词 + 可配置黑名单判定 符合/待定/不符合。
 */
function screenHotspotById(db, h) {
  const setRow = db.prepare('UPDATE hotspots SET screen_result=?,screen_reason=?,relevance=? WHERE id=?');
  const blRow = db.prepare("SELECT value FROM settings WHERE key='screen_blacklist'").get();
  const bl = (blRow && blRow.value)
    ? blRow.value.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean)
    : ['争议', '绯闻', '政治', '擦边', '社会负面'];
  const campaign = activeCampaigns(db)[0] || null;
  const text = `${h.title} ${h.description || ''} ${h.tags || ''}`.toLowerCase();
  const scored = scoreHotspot(h, campaign);
  let result = scored.score >= 70 ? '符合' : scored.score >= 45 ? '待定' : '不符合';
  let reason = scored.score >= 70
    ? `当前项目适配分 ${scored.score}，具备较强的热点表达迁移价值`
    : scored.score >= 45
      ? `当前项目适配分 ${scored.score}，建议人工确认结合是否自然`
      : `当前项目适配分 ${scored.score}，本项目暂不采用；原热点仍保留在通用热点池`;
  const bad = bl.filter(b => text.includes(b));
  if (bad.length) { result = '不符合'; reason = `含疑似不适配宣发的内容(${bad.join('/')})，已标记当前项目筛查不通过`; }
  const rel = result === '符合' ? '强' : result === '待定' ? '中' : '弱';
  setRow.run(result, reason, rel, h.id);
  return { screen_result: result, screen_reason: reason, relevance: rel };
}

module.exports = { scoreHotspot, recommendCreators, dailyRecommendations, buildRecommendation, screenHotspotById, evaluateRisk, activeCampaigns, parseJson, tokenize };
