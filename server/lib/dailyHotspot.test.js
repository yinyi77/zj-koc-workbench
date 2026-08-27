const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyHotspot, filterRelevant, buildSearchKeywords } = require('./dailyHotspot');

const campaign = {
  game_name: '《杖剑传说》',
  keywords: '星陨秘境,新资料片,暑期,新职业,秘境攻略,抽卡,月卡'
};

test('杖剑品牌词和当前任务专属词归入杖剑相关', () => {
  assert.equal(classifyHotspot({ title: '杖剑传说星陨秘境平民攻略' }, campaign).category, '杖剑相关');
  assert.equal(classifyHotspot({ title: '星陨秘境速通思路' }, campaign).category, '杖剑相关');
});

test('手游共性话题保留，具体其他手游内容排除', () => {
  assert.equal(classifyHotspot({ title: '2026手游新游榜和抽卡趋势' }, campaign).category, '手游热点');
  assert.equal(classifyHotspot({ title: '26年8月新手游速览，好游不多' }, campaign).category, '手游热点');
  assert.equal(classifyHotspot({ title: '盘点2026年最适合长期玩的六款手游' }, campaign).category, '手游热点');
  assert.equal(classifyHotspot({ title: '零氪玩家为什么喜欢放置养成' }, campaign).category, '手游热点');
  assert.equal(classifyHotspot({ title: '《鸣潮》新角色版本PV' }, campaign), null);
  assert.equal(classifyHotspot({ title: '《原神》至冬版本抽卡攻略' }, campaign), null);
  assert.equal(classifyHotspot({ title: 'DNF手游鉴宝之战，你是哪种玩家？' }, campaign), null);
  assert.equal(classifyHotspot({ title: '【LOL手游榜单大神】国服剑魔出装符文搭配推荐' }, campaign), null);
  assert.equal(classifyHotspot({ title: '复古传奇的氪金玩家讨论' }, campaign), null);
  assert.equal(classifyHotspot({ title: '不知名端游的关卡攻略', gameVertical: true }, campaign), null);
  assert.equal(classifyHotspot({ title: '抢先体验某某手游，这品质值得玩家等13年吗？', targeted: true, searchKeyword: '手游行业' }, campaign), null);
});

test('只保留可参与的网络热梗，娱乐行业资讯和硬新闻排除', () => {
  assert.equal(classifyHotspot({ title: '这个变装挑战成了全网热梗', source: '抖音', rank: 5 }, campaign).category, '泛娱乐可借势');
  assert.equal(classifyHotspot({ title: '万万没想到手机倒过来秒当首富', source: '抖音', rank: 8 }, campaign).category, '泛娱乐可借势');
  assert.equal(classifyHotspot({ title: '周五下班后的精神状态', source: '抖音', rank: 9 }, campaign).category, '泛娱乐可借势');
  assert.equal(classifyHotspot({ title: '电影宣传玩起变装挑战', source: '抖音', rank: 3 }, campaign), null);
  assert.equal(classifyHotspot({ title: 'TF四代青岛演唱会', source: '抖音', rank: 4 }, campaign), null);
  assert.equal(classifyHotspot({ title: '某明星新歌官宣', source: '抖音', rank: 5 }, campaign), null);
  assert.equal(classifyHotspot({ title: '某歌手刷屏全网的翻唱现场', source: 'B站', rank: 5 }, campaign), null);
  assert.equal(classifyHotspot({ title: 'HM品牌视觉PPT模板直接套用', targeted: true, searchKeyword: '网络热梗' }, campaign), null);
  assert.equal(classifyHotspot({ title: '挑战全网最快满突某角色', targeted: true, searchKeyword: '全网挑战' }, campaign), null);
  assert.equal(classifyHotspot({ title: '变装挑战火遍全网，播放破亿', targeted: true, searchKeyword: '全网挑战' }, campaign).category, '泛娱乐可借势');
  assert.equal(classifyHotspot({ title: '八月近期全网爆火热梗盘点', targeted: true, searchKeyword: '网络热梗' }, campaign), null);
  assert.equal(classifyHotspot({ title: '网络热梗《活人感》', targeted: true, searchKeyword: '网络热梗' }, campaign).category, '泛娱乐可借势');
  assert.equal(classifyHotspot({ title: '今天大家都在讨论的话题', source: '抖音', rank: 8, sentenceTag: 10000 }, campaign), null);
  assert.equal(classifyHotspot({ title: '某财经公告', source: '抖音', rank: 2, sentenceTag: 7000 }, campaign), null);
  assert.equal(classifyHotspot({ title: '地震情况通报', source: '抖音', rank: 1 }, campaign), null);
});

test('B站游戏分区不再因其他游戏名自动入池', () => {
  const list = filterRelevant([
    { id: 'zj', title: '杖剑传说星陨秘境攻略', source: 'B站', rank: 4 },
    { id: 'mobile', title: '手游月卡党的养成趋势', source: '抖音', rank: 10 },
    { id: 'ent', title: '变装挑战热梗', source: '抖音', rank: 3 },
    { id: 'other', title: '《绝区零》角色展示', source: 'B站', rank: 1, gameVertical: true }
  ], null, campaign);
  assert.deepEqual(list.map(x => x.id).sort(), ['ent', 'mobile', 'zj']);
  assert.deepEqual(new Set(list.map(x => x.hotspotCategory)), new Set(['杖剑相关', '手游热点', '泛娱乐可借势']));
  assert.deepEqual(list.map(x => x.hotspotCategory), ['杖剑相关', '泛娱乐可借势', '手游热点']);
});

test('定向搜索中超过 45 天的旧内容不再当作热点', () => {
  const old = new Date(Date.now() - 46 * 86400000).toISOString();
  assert.equal(classifyHotspot({ title: '杖剑传说旧攻略', targeted: true, publishedAt: old }, campaign), null);
});

test('外挂破解和虚假资源内容不进入杖剑热点', () => {
  assert.equal(classifyHotspot({ title: '杖剑传说内置GM无限内购无偿分享' }, campaign), null);
});

test('定向搜索词包含游戏名、任务专属词和手游行业词', () => {
  const terms = buildSearchKeywords(campaign);
  assert.ok(terms.includes('杖剑传说'));
  assert.ok(terms.includes('杖剑传说 星陨秘境'));
  assert.ok(terms.includes('手游行业'));
  assert.ok(terms.includes('网络热梗'));
  assert.ok(terms.includes('全网挑战'));
});
