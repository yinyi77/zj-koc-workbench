<template>
  <div>
    <div class="page-head">
      <div class="page-head-left">
        <h2>热点雷达</h2>
        <div class="sub">{{ today }} · 先发现全网热梗与网感热点，再结合当前策略完成研判和方案输出</div>
      </div>
      <div class="page-head-actions">
        <n-button size="small" secondary :loading="refreshing" @click="refreshToday">{{ refreshing ? '抓取中...' : '重新抓取今日热点' }}</n-button>
        <n-button size="small" secondary @click="openHotspotForm">+ 录入热点</n-button>
        <n-button size="small" secondary @click="openTodoForm">+ 添加待办</n-button>
      </div>
    </div>

    <div v-if="loading" class="loading-card"><span>正在同步今日工作数据...</span><span class="spinner"></span></div>
    <div v-else-if="error" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="load">重试</n-button>
    </div>

    <div v-if="snapshotUpdating" class="snapshot-update-banner" role="status" aria-live="polite">
      <span class="spinner"></span>
      <div>
        <b>今日热点正在更新</b>
        <p>{{ snapshotUpdateMessage }}</p>
      </div>
    </div>
    <div v-else-if="snapshotUpdateError" class="snapshot-update-banner failed" role="alert">
      <div>
        <b>今日热点更新未完成</b>
        <p>当前仍展示最近一次快照。{{ snapshotUpdateError }}</p>
      </div>
      <n-button size="small" secondary @click="refreshToday">重新更新</n-button>
    </div>

    <div class="workbench-hero">
      <div class="workbench-primary">
        <div class="hero-label">今日网感决策</div>
        <h3>{{ priorityHeadline }}</h3>
        <p>{{ prioritySubline }}</p>
        <div class="hero-actions">
          <n-button type="primary" @click="goPage('opportunities')">进入机会中心</n-button>
          <n-button secondary @click="scrollTo('hotspots')">浏览候选热点</n-button>
        </div>
      </div>
      <div class="workbench-queue">
        <n-button text class="queue-item" @click="scrollTo('must')">
          <b>{{ expiring.length }}</b>
          <span>临期机会</span>
        </n-button>
        <n-button text class="queue-item" @click="scrollTo('recommend')">
          <b>{{ recos.length }}</b>
          <span>推荐机会</span>
        </n-button>
        <n-button text class="queue-item" @click="scrollTo('todos')">
          <b>{{ todoCount }}</b>
          <span>跟进事项</span>
        </n-button>
      </div>
    </div>

    <!-- 策略配置摘要 -->
    <div v-if="summary" class="card card-highlight" style="padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 24px;background:var(--brand);color:var(--brand-text)">
        <div>
          <div style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px">
            {{ summary.game_name }}
            <span class="tag" style="color:var(--brand-text);background:rgba(255,255,255,.12)">{{ summary.priority }}优先级</span>
          </div>
          <div style="font-size:20px;font-weight:700;margin:8px 0 4px">{{ summary.name }}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.55)">当前版本/活动：{{ summary.version_event || '—' }}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <n-button size="small" quaternary style="color:#fff" @click="goPage('campaigns')">查看策略</n-button>
          <n-button size="small" secondary style="color:#fff" @click="openAdjustFocus">调整重点</n-button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border)">
        <div style="background:#fff;padding:16px 20px"><div class="tag gray" style="margin-bottom:6px">本期传播目标</div><div style="font-size:14px;font-weight:500">{{ summary.goal || '—' }}</div></div>
        <div style="background:#fff;padding:16px 20px"><div class="tag gray" style="margin-bottom:6px">当前重点角色/内容</div><div style="font-size:14px;font-weight:500">{{ summary.focus_content || '—' }}</div></div>
        <div style="background:#fff;padding:16px 20px"><div class="tag gray" style="margin-bottom:6px">营销周期</div><div style="font-size:14px;font-weight:500">{{ summary.cycle_start || '—' }} ~ {{ summary.cycle_end || '—' }}</div></div>
        <div style="background:#fff;padding:16px 20px"><div class="tag gray" style="margin-bottom:6px">剩余策略周期</div><div :style="{fontSize:'14px',fontWeight:700,color: summary.remain_days < 7 ? 'var(--red)' : 'inherit'}">{{ summary.remain_days != null ? summary.remain_days + ' 天' : '—' }}</div></div>
      </div>
    </div>

    <!-- Section: AI 推荐机会 -->
    <div id="recommend" class="section-anchor" style="display:flex;justify-content:space-between;align-items:center;margin:var(--sp-8) 0 var(--sp-4)">
      <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:var(--sp-2)">
        <span style="width:3px;height:16px;background:var(--purple);border-radius:2px"></span>
        当前项目推荐机会
      </h3>
    </div>
    <div v-if="recos.length">
      <div v-for="(r, i) in recos" :key="i" class="card" style="padding:var(--sp-5)">
        <div style="display:flex;align-items:flex-start;gap:14px">
          <div :style="{width:'52px',height:'52px',borderRadius:'50%',background:scoreColor(r.score),display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:'16px',flexShrink:0}">
            {{ r.score }}<span style="font-size:9px;font-weight:400">{{ r.verdict }}</span>
          </div>
          <div style="flex:1;min-width:0">
            <button type="button" class="hotspot-title-link reco-title" @click="openRealLink(r.url)">{{ r.title }}</button>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
              <StatusTag :text="r.source" />
              <span v-if="r.heat" style="font-size:12px;color:var(--ink-faint)">&#x1F525; {{ fmt(r.heat) }}</span>
            </div>
            <div style="font-size:13px;color:var(--ink-dim);line-height:1.6"><b style="color:var(--ink)">结合角度：</b>{{ r.angle || '—' }}</div>
            <div style="font-size:13px;color:var(--ink-dim);line-height:1.6;margin-bottom:8px"><b style="color:var(--ink)">推荐理由：</b>{{ r.reason || '—' }}</div>
            <div style="display:flex;gap:8px">
              <n-button size="small" type="primary" @click="genCreative(i)">生成机会方案</n-button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <EmptyState v-else icon="sparkles">通用热点池已有内容，但暂未找到适合当前项目的推荐机会</EmptyState>

    <!-- Section: 双热点池 -->
    <div id="hotspots" class="section-anchor" style="display:flex;justify-content:space-between;align-items:center;margin:var(--sp-8) 0 var(--sp-4)">
      <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:var(--sp-2)">
        <span style="width:3px;height:16px;background:var(--orange);border-radius:2px"></span>
        热点情报池
      </h3>
    </div>
    <div class="pool-tabs" role="tablist" aria-label="热点栏目">
      <button type="button" :class="{ active: activePool === '今日焦点' }" @click="activePool = '今日焦点'">今日焦点 <span>{{ focusCount }}</span></button>
      <button type="button" :class="{ active: activePool === '行业动态' }" @click="activePool = '行业动态'">行业动态 <span>{{ industryCount }}</span></button>
    </div>
    <div v-if="activePool === '行业动态'" class="industry-filters">
      <button v-for="item in industryCategoryOptions" :key="item" type="button" :class="{ active: industryFilter === item }" @click="industryFilter = item">{{ item }}</button>
    </div>
    <div class="hotspot-pool-note">
      {{ activePool === '今日焦点'
        ? '聚合泛娱乐网络大热梗，优先展示可模仿、可二创、正在快速传播的挑战、名场面、BGM 和情绪梗。'
        : `追踪手游垂类内容，并按休闲向、娱乐向、MMO、RPG 分类。资讯来源：${industrySourceSummary || 'B站游戏内容'}。` }}
    </div>
    <div v-if="douyinNotice" class="card" style="padding:12px 16px;margin-bottom:var(--sp-4);border-color:#f2cf8d;background:#fffaf0;color:#7a5311;font-size:13px;line-height:1.6">
      <b>抖音来源提示：</b>{{ douyinNotice }}
    </div>
    <div class="hotspot-freshness">
      <span>本次抓取 {{ formatDateTime(fetchedAt) }}</span>
      <span>分析完成 {{ formatDateTime(analyzedAt) }}</span>
      <span>B站 {{ sourceCounts.bili }} 条</span>
      <span>抖音 {{ sourceCounts.douyin }} 条</span>
      <span>行业资讯 {{ sourceCounts.industry }} 条</span>
    </div>
    <div v-if="displayHotspots.length" class="card-grid card-grid-2">
      <div v-for="h in displayHotspots" :key="h.id" class="card" style="padding:var(--sp-4) var(--sp-5)">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <StatusTag :text="h.source_label || h.source || h.platform || 'B站'" />
          <StatusTag v-if="h.category" :text="activePool === '行业动态' ? (h.industryCategory || '手游') : h.category" />
          <StatusTag v-if="h.screen_result" :text="h.screen_result" />
          <span v-if="h.discoveryScore != null" class="tag gray">发现分 {{ h.discoveryScore }}</span>
          <span v-if="h.rank" style="font-size:12px;color:var(--ink-faint)">#{{ h.rank }}</span>
          <span v-if="h.heat" style="font-size:12px;color:var(--ink-faint)">&#x1F525; {{ fmt(h.heat) }}</span>
        </div>
        <button type="button" class="hotspot-title-link" @click="openRealLink(h.url)">{{ h.title }}</button>
        <div style="font-size:12px;color:var(--ink-faint);margin-bottom:8px">
          {{ h.publishedAt ? '发布于 ' + formatDateTime(h.publishedAt) + ' · ' : '' }}{{ h.valid_until ? '有效期至 ' + h.valid_until : (h.up ? 'UP ' + h.up : '发布时间未知') }}
        </div>
        <div v-if="h.screen_reason || h.risk_note" style="font-size:12px;color:var(--ink-dim);line-height:1.6;margin-bottom:8px">
          {{ h.screen_reason || h.risk_note }}
        </div>
        <img v-if="h.pic" :src="h.pic" style="width:100%;max-height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;background:var(--gray-100)" @error="e => e.target.style.display='none'" />
        <n-button size="small" secondary :disabled="h.screen_result === '不符合'" @click="toOpportunity(h)">生成机会</n-button>
      </div>
    </div>
    <EmptyState v-else icon="trending">该栏目暂时没有达到入选标准的真实热点</EmptyState>

    <!-- Section: 即将过期 -->
    <div id="must" class="section-anchor" style="display:flex;justify-content:space-between;align-items:center;margin:var(--sp-8) 0 var(--sp-4)">
      <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:var(--sp-2)">
        <span style="width:3px;height:16px;background:var(--red);border-radius:2px"></span>
        即将过期 / 需处理
      </h3>
    </div>
    <div v-if="expiring.length" class="card" style="padding:0;overflow:hidden">
      <div v-for="e in expiring" :key="e.kind + '-' + e.id" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--gray-100);transition:background .15s" @mouseenter="h => h.currentTarget.style.background='var(--gray-50)'" @mouseleave="h => h.currentTarget.style.background=''">
        <span :class="['urgency-badge', e.urgency]">{{ urgencyLabel(e.urgency) }}</span>
        <button type="button" class="hotspot-title-link expiring-title" @click="openExpiring(e)">{{ e.title }}</button>
        <span style="font-size:12px;color:var(--ink-faint)">{{ e.deadline }} · {{ e.note }}</span>
      </div>
    </div>
    <EmptyState v-else icon="check">没有即将过期的机会</EmptyState>

    <!-- Section: 机会跟进 -->
    <div id="todos" class="section-anchor" style="display:flex;justify-content:space-between;align-items:center;margin:var(--sp-8) 0 var(--sp-4)">
      <h3 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:var(--sp-2)">
        <span style="width:3px;height:16px;background:var(--ink);border-radius:2px"></span>
        机会跟进
      </h3>
      <span style="font-size:13px;color:var(--ink-faint)">{{ todoCount }} 项</span>
    </div>
    <div v-if="todoCount" class="card-grid card-grid-2">
      <div v-for="(arr, k) in todos" :key="k">
        <div v-if="arr.length" class="card" style="padding:var(--sp-4)">
          <div style="font-weight:600;font-size:13px;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            {{ k }} <span class="tag gray">{{ arr.length }}</span>
          </div>
          <div v-for="t in arr.slice(0, 6)" :key="t.id" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--gray-100);font-size:13px;cursor:pointer" @click="handleTodoClick(t)">
            <span style="flex:1;font-weight:500">{{ t.title }}</span>
            <StatusTag :text="t.sub" v-if="t.sub" />
            <span v-if="t.due" style="font-size:11px;color:var(--ink-faint)">截止 {{ t.due }}</span>
          </div>
        </div>
      </div>
    </div>
    <EmptyState v-else icon="clipboard">暂无待办</EmptyState>

    <Modal :show="showCreative" @close="showCreative = false" wide>
      <template #head><h3>机会方案草稿</h3></template>
      <div v-if="creativeR" style="margin-bottom:12px">
        <div style="font-weight:600;margin-bottom:4px">{{ creativeR.title }}</div>
        <div style="font-size:12px;color:var(--ink-faint)">{{ creativeR.angle || creativeR.reason || '—' }}</div>
      </div>
      <n-input v-model:value="creativeText" type="textarea" :autosize="{ minRows: 10 }" />
      <template #foot>
        <n-button secondary :disabled="!canCopyCreative" @click="copyCreative">复制方案</n-button>
        <n-button secondary :loading="creativeLoading" :disabled="!creativeR" @click="regenCreative">{{ creativeLoading ? '生成中...' : '重新生成' }}</n-button>
        <n-button secondary @click="showCreative = false">关闭</n-button>
        <n-button type="primary" :loading="savingCreative" @click="createOpportunityFromCreative">{{ savingCreative ? '创建中...' : '进入机会中心' }}</n-button>
      </template>
    </Modal>

    <Modal :show="showFocus" @close="showFocus = false" wide>
      <template #head><h3>调整当前热点策略</h3></template>
      <div class="form-row"><label>当前版本/活动</label><n-input v-model:value="focusVer" /></div>
      <div class="form-row"><label>重点角色/内容</label><n-input v-model:value="focusContent" type="textarea" /></div>
      <template #foot><n-button type="primary" :loading="savingFocus" @click="saveFocus">{{ savingFocus ? '保存中...' : '保存' }}</n-button></template>
    </Modal>

    <Modal :show="showHotspotForm" @close="showHotspotForm = false" wide>
      <template #head><h3>录入候选热点</h3></template>
      <div class="form-grid">
        <div class="form-row full"><label>热点标题 *</label><n-input v-model:value="hsTitle" placeholder="填写真实热点或视频标题" /></div>
        <div class="form-row"><label>发布平台 *</label><select v-model="hsPlatform" class="form-select-input"><option v-for="option in platformOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>
        <div class="form-row"><label>信息来源 *</label><select v-model="hsSource" class="form-select-input"><option v-for="option in sourceOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>
        <div class="form-row"><label>热点类型 *</label><select v-model="hsCategory" class="form-select-input"><option v-for="option in categoryOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>
        <div class="form-row"><label>当前趋势</label><select v-model="hsTrend" class="form-select-input"><option v-for="option in trendOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>
        <div class="form-row"><label>热度评分（0–100）</label><n-input-number v-model:value="hsHeat" :min="0" :max="100" :show-button="false" style="width:100%" /></div>
        <div class="form-row"><label>预计有效期 *</label><input v-model="hsValid" class="form-date-input" type="date" /></div>
        <div class="form-row full"><label>原内容链接 *</label><n-input v-model:value="hsUrl" placeholder="填写可直接打开的视频或热点链接" /></div>
        <div class="form-row full"><label>内容描述 *</label><n-input v-model:value="hsDesc" type="textarea" placeholder="说明热点内容、爆点，以及为什么值得关注" /></div>
        <div class="form-row full"><label>热点标签 / 可复用表达</label><n-input v-model:value="hsTags" placeholder="例如：反转、情绪共鸣、热门BGM、挑战模板；多个标签用逗号分隔" /></div>
        <div class="form-row full"><label>风险提示</label><n-input v-model:value="hsRisk" placeholder="没有风险可留空；如版权、争议、时效风险" /></div>
      </div>
      <template #foot><n-button type="primary" :loading="savingHotspot" @click="saveHotspot">{{ savingHotspot ? '保存中...' : '保存热点' }}</n-button></template>
    </Modal>

    <Modal :show="showTodoForm" @close="showTodoForm = false">
      <template #head><h3>添加待办</h3></template>
      <div class="form-row"><label>待办内容 *</label><n-input v-model:value="tdTitle" /></div>
      <div class="form-row"><label>负责人</label><n-input v-model:value="tdAss" /></div>
      <div class="form-row"><label>截止日期</label><input v-model="tdDue" class="form-date-input" type="date" /></div>
      <template #foot><n-button type="primary" :loading="savingTodo" @click="saveTodo">{{ savingTodo ? '添加中...' : '添加' }}</n-button></template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { apiGet, apiPost, apiPut } from '../utils/api.js'
import { appState, showToast, goPage } from '../stores/app.js'
import { fmt, scoreColor, getToday } from '../utils/helpers.js'
import Modal from '../components/Modal.vue'
import StatusTag from '../components/StatusTag.vue'
import EmptyState from '../components/EmptyState.vue'

const today = getToday()
const user = computed(() => appState.user)
const summary = ref(null)
const hotspots = ref([])
const activePool = ref('今日焦点')
const industryFilter = ref('全部')
const sourceStatus = ref({})
const fetchedAt = ref('')
const analyzedAt = ref('')
const sourceCounts = ref({ bili: 0, douyin: 0, industry: 0 })
const industrySources = ref({})
const recos = ref([])
const expiring = ref([])
const todos = ref({})
const loading = ref(false)
const refreshing = ref(false)
const error = ref('')
const snapshotUpdating = ref(false)
const snapshotStale = ref(false)
const snapshotHasCache = ref(false)
const displayedSnapDate = ref('')
const targetSnapDate = ref('')
const snapshotUpdateError = ref('')
let snapshotPollTimer = null
const savingCreative = ref(false)
const creativeLoading = ref(false)
const savingFocus = ref(false)
const savingHotspot = ref(false)
const savingTodo = ref(false)
const todoCount = computed(() => Object.values(todos.value).flat().length)
const industryCategoryOptions = ['全部', '手游', '休闲向', '娱乐向', 'MMO', 'RPG']
const focusCount = computed(() => hotspots.value.filter(h => h.channel === '今日焦点').length)
const industryCount = computed(() => hotspots.value.filter(h => h.channel === '行业动态').length)
const industrySourceSummary = computed(() => Object.entries(industrySources.value)
  .map(([name, count]) => `${name} ${count}`).join('、'))
const snapshotUpdateMessage = computed(() => {
  if (!snapshotHasCache.value) return '正在生成今天的首份热点快照，完成后页面会自动刷新。'
  if (snapshotStale.value) return `当前先展示 ${displayedSnapDate.value} 的最近快照，更新完成后会自动替换为 ${targetSnapDate.value || today} 的数据。`
  return '当前继续展示已缓存的今日内容，更新完成后会自动替换为最新结果。'
})
const displayHotspots = computed(() => hotspots.value.filter(h => {
  if (h.channel !== activePool.value) return false
  if (activePool.value !== '行业动态' || industryFilter.value === '全部') return true
  return (h.industryCategory || '手游') === industryFilter.value
}).slice(0, 40))
const douyinNotice = computed(() => {
  const status = sourceStatus.value?.douyin
  if (!status || status === 'ok') return ''
  if (status === 'needs_config') return '请在左下角“系统设置”中配置抖音开放平台的视频搜索能力；配置前不会展示平台总榜或搜索页假链接。'
  if (status === 'empty') return '当前通用热点与项目关键词未搜索到近 7 天可用视频，可调整当前策略关键词后重新抓取。'
  return sourceStatus.value?.douyinMessage || '视频搜索暂时不可用，本次仅展示其他平台的真实内容。'
})
const priorityHeadline = computed(() => {
  if (expiring.value.length) return `先处理 ${expiring.value.length} 个临期机会`
  if (recos.value.length) return `从 ${recos.value.length} 个推荐机会里挑选`
  if (todoCount.value) return `处理 ${todoCount.value} 个机会跟进`
  return '今天没有紧急事项'
})
const prioritySubline = computed(() => {
  if (summary.value?.name) return `当前策略：${summary.value.name}`
  return '先配置当前关注主题，再让热点筛选和机会研判围绕同一个目标运转。'
})

const showCreative = ref(false)
const creativeR = ref(null), creativeText = ref('生成中…')
const __gc = ref({ r: null, creative: '' })
const canCopyCreative = computed(() => creativeText.value && !creativeText.value.startsWith('生成中'))
const showFocus = ref(false), focusVer = ref(''), focusContent = ref('')
const showHotspotForm = ref(false), showTodoForm = ref(false)

const hsTitle = ref(''), hsSource = ref('平台热榜'), hsPlatform = ref('B站')
const hsCategory = ref('热梗模板'), hsHeat = ref(60), hsTrend = ref('上升')
const hsValid = ref(''), hsUrl = ref(''), hsTags = ref(''), hsDesc = ref(''), hsRisk = ref('')

const tdTitle = ref(''), tdAss = ref(user.value), tdDue = ref('')
const platformOptions = ['B站', '抖音', '微博', '小红书', '其他'].map(v => ({ label: v, value: v }))
const sourceOptions = ['平台热榜', '游戏分区榜', '具体视频', '站内搜索', '人工发现', '其他'].map(v => ({ label: v, value: v }))
const categoryOptions = ['热梗模板', '情绪话题', '视觉/形式趋势', '生活方式热点', '游戏热点', '品牌/行业热点', '网感热点'].map(v => ({ label: v, value: v }))
const trendOptions = ['上升', '平稳', '下降'].map(v => ({ label: v, value: v }))

function urgencyLabel(u) {
  return { missed: '已错过', today: '今天确认', '24h': '24h内' }[u] || ''
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16)
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

function handleTodoClick() { goPage('opportunities') }
function openRealLink(url) {
  if (!url) return showToast('该热点暂无有效来源链接', true)
  window.open(url, '_blank', 'noopener,noreferrer')
}
function isDirectContentLink(item) {
  const url = String(item?.url || '')
  if (/bilibili\.com\/video\//i.test(url) || /douyin\.com\/(video|note)\//i.test(url)) return true
  return item?.channel === '行业动态' && item?.industryNews === true && /^https?:\/\//i.test(url)
}
function openExpiring(item) {
  if (item.url) return openRealLink(item.url)
  if (item.kind === 'opportunity') return openOppDrawer(item.id)
  showToast('该热点暂无有效来源链接', true)
}
function scrollTo(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

function applySnapshotState(response) {
  snapshotHasCache.value = Boolean(response.hasSnapshot)
  snapshotUpdating.value = Boolean(response.updating)
  snapshotStale.value = Boolean(response.stale)
  displayedSnapDate.value = response.displayedSnapDate || response.snapDate || ''
  targetSnapDate.value = response.targetSnapDate || today
  snapshotUpdateError.value = response.updateError || ''
}

function scheduleSnapshotPolling() {
  if (snapshotPollTimer) clearTimeout(snapshotPollTimer)
  snapshotPollTimer = null
  if (!snapshotUpdating.value) return
  snapshotPollTimer = setTimeout(pollSnapshotStatus, 3000)
}

async function loadSnapshotData() {
  const [response, recommendationResponse] = await Promise.all([
    apiGet('/today/hotspots?limit=120'),
    apiGet('/today/recommendations?limit=8')
  ])
  const live = response.list || []
  sourceStatus.value = response.sourceStatus || {}
  fetchedAt.value = response.fetchedAt || ''
  analyzedAt.value = response.analyzedAt || ''
  sourceCounts.value = {
    bili: Number(response.biliCount) || 0,
    douyin: Number(response.douyinCount) || 0,
    industry: Number(response.industryArticleCount) || 0
  }
  industrySources.value = response.industrySourceCounts || {}
  // 热词搜索页不冒充发布内容，只展示能直达具体视频/作品的热点。
  hotspots.value = live.filter(isDirectContentLink)
  recos.value = recommendationResponse.list || []
  applySnapshotState(response)
  scheduleSnapshotPolling()
}

async function pollSnapshotStatus() {
  snapshotPollTimer = null
  try {
    const status = await apiGet('/today/hotspots/status')
    snapshotHasCache.value = Boolean(status.hasSnapshot)
    snapshotUpdating.value = Boolean(status.updating)
    snapshotStale.value = Boolean(status.stale)
    displayedSnapDate.value = status.displayedSnapDate || displayedSnapDate.value
    targetSnapDate.value = status.targetSnapDate || targetSnapDate.value
    snapshotUpdateError.value = status.error || ''
    if (status.updating) return scheduleSnapshotPolling()
    if (status.status === 'completed' && !status.stale) {
      await loadSnapshotData()
      showToast('今日热点已更新，页面数据已自动刷新')
    }
  } catch (e) {
    // 短暂网络波动不覆盖旧快照，稍后继续检查后台任务。
    if (snapshotUpdating.value) scheduleSnapshotPolling()
  }
}

async function load() {
  loading.value = true
  error.value = ''
  const errors = []
  try {
    const d = await apiGet('/today')
    summary.value = d.campaignSummary || null
    appState.activeCampId = summary.value?.id || null
    expiring.value = d.expiring || []
    todos.value = d.execTodos || {}
  } catch (e) { errors.push(`今日概览：${e.message}`) }
  try { await loadSnapshotData() } catch (e) { errors.push(`今日热点：${e.message}`) }
  if (errors.length) {
    error.value = errors.join('；')
    showToast(error.value, true)
  }
  loading.value = false
}

async function refreshToday() {
  refreshing.value = true
  snapshotUpdating.value = true
  snapshotUpdateError.value = ''
  try {
    await apiPost('/today/refresh', {}, { timeout: 180000 })
    await loadSnapshotData()
    showToast('已按通用热点逻辑重新抓取并完成当前项目分析')
  } catch (e) { showToast(e.message, true) }
  finally { refreshing.value = false }
}

async function genCreative(idx) {
  const r = recos.value[idx]; if (!r) return showToast('未找到推荐机会', true)
  creativeR.value = r; creativeText.value = '生成中…'; showCreative.value = true
  await requestCreative(r)
}

async function regenCreative() {
  if (!creativeR.value) return showToast('缺少推荐机会内容', true)
  creativeText.value = '生成中…'
  await requestCreative(creativeR.value)
}

async function requestCreative(r) {
  creativeLoading.value = true
  try {
    const resp = await apiPost('/today/recommendations/creative', {
      title: r.title,
      angle: r.angle,
      reason: r.reason,
      user: user.value
    }, { timeout: 180000 })
    creativeText.value = resp.text || ''; __gc.value = { r, creative: creativeText.value }
    showToast(resp.ok === false ? 'AI 不稳定，已生成规则兜底版本' : '机会方案已生成', resp.ok === false)
  } catch (e) {
    creativeText.value = `生成失败：${e.message}\n\n你可以点击“重新生成”，或先进入机会中心后再补充结论。`
  } finally {
    creativeLoading.value = false
  }
}

async function copyCreative() {
  if (!canCopyCreative.value) return
  try {
    await navigator.clipboard.writeText(creativeText.value)
    showToast('已复制机会方案')
  } catch (e) {
    showToast('复制失败，请手动选中文本复制', true)
  }
}

async function openAdjustFocus() {
  const c = await apiGet(`/campaigns/${summary.value.id}`)
  focusVer.value = c.version_event || ''; focusContent.value = c.focus_content || ''; showFocus.value = true
}
async function saveFocus() {
  savingFocus.value = true
  try {
  await apiPut(`/campaigns/${summary.value.id}`, { version_event: focusVer.value, focus_content: focusContent.value })
  showFocus.value = false; showToast('重点已更新'); load()
  } catch (e) { showToast(e.message, true) }
  finally { savingFocus.value = false }
}
async function toOpportunity(h) {
  try {
    let hid = typeof h.id === 'number' ? h.id : h.stored_id
    if (!hid) {
      const saved = await apiPost('/today/hotspots/materialize', { id: h.id, url: h.url, title: h.title, user: user.value })
      hid = saved.hotspot.id
    }
    const r = await apiPost(`/hotspots/${hid}/adopt`, { campaign_id: appState.activeCampId, user: user.value })
    appState.pendingOpportunityId = r.id
    goPage('opportunities')
    showToast('已采纳为正式机会')
  } catch (e) { showToast(e.message, true) }
}

async function createOpportunityFromCreative() {
  const payload = __gc.value || {}
  const r = payload.r
  if (!r) return showToast('缺少推荐机会内容', true)
  savingCreative.value = true
  try {
    const resp = await apiPost('/opportunities', {
      title: r.title,
      campaign_id: appState.activeCampId,
      status: '待研判',
      platform: r.platform || r.source || r.source_label || '',
      direction: r.angle || '',
      basis: JSON.stringify({ reason: r.reason || '', source: r.source || '', creative: payload.creative || creativeText.value }),
      created_by: user.value
    })
    showCreative.value = false
    appState.pendingOpportunityId = resp.id
    goPage('opportunities')
    showToast('已创建机会')
  } catch (e) { showToast(e.message, true) }
  finally { savingCreative.value = false }
}

function openOppDrawer(id) { appState.pendingOpportunityId = id; goPage('opportunities') }
function openHotspotForm() { showHotspotForm.value = true }
function openTodoForm() { showTodoForm.value = true }

async function saveHotspot() {
  const title = hsTitle.value.trim()
  if (!title) return showToast('请输入热点标题', true)
  if (!hsPlatform.value) return showToast('请选择发布平台', true)
  if (!hsSource.value) return showToast('请选择信息来源', true)
  if (!hsCategory.value) return showToast('请选择热点类型', true)
  if (!hsValid.value) return showToast('请选择预计有效期', true)
  if (!/^https?:\/\//i.test(String(hsUrl.value || '').trim())) return showToast('请填写以 http:// 或 https:// 开头的原内容链接', true)
  if (!String(hsDesc.value || '').trim()) return showToast('请填写内容描述', true)
  savingHotspot.value = true
  try {
  await apiPost('/hotspots', {
    title, source_label: hsSource.value, platform: hsPlatform.value, category: hsCategory.value,
    heat: +hsHeat.value || 0, trend: hsTrend.value, valid_until: hsValid.value,
    url: hsUrl.value.trim(), tags: hsTags.value.trim(), description: hsDesc.value.trim(), risk_note: hsRisk.value.trim(),
    source: '手动录入', created_by: user.value
  })
  hsTitle.value = ''; hsUrl.value = ''; hsTags.value = ''; hsDesc.value = ''; hsRisk.value = ''; hsValid.value = ''
  showHotspotForm.value = false; showToast('已录入'); load()
  } catch (e) { showToast(e.message, true) }
  finally { savingHotspot.value = false }
}
async function saveTodo() {
  const title = tdTitle.value.trim(); if (!title) return showToast('请输入内容', true)
  savingTodo.value = true
  try {
  await apiPost('/todos', { title, assignee: tdAss.value, due_date: tdDue.value, created_by: user.value })
  tdTitle.value = ''; tdDue.value = ''
  showTodoForm.value = false; showToast('已添加'); load()
  } catch (e) { showToast(e.message, true) }
  finally { savingTodo.value = false }
}

onMounted(load)
onBeforeUnmount(() => {
  if (snapshotPollTimer) clearTimeout(snapshotPollTimer)
})
</script>

<style scoped>
.snapshot-update-banner {
  display:flex;
  align-items:center;
  gap:12px;
  margin:0 0 var(--sp-5);
  padding:12px 16px;
  border:1px solid #d9e6db;
  border-radius:10px;
  background:#f4f9f5;
  color:var(--ink);
}
.snapshot-update-banner > div { flex:1;min-width:0; }
.snapshot-update-banner b { font-size:13px; }
.snapshot-update-banner p { margin:2px 0 0;color:var(--ink-dim);font-size:12px;line-height:1.5; }
.snapshot-update-banner.failed { border-color:#efd6ad;background:#fff9ef; }
.pool-tabs {
  display:flex;
  gap:6px;
  margin-bottom:10px;
  padding:4px;
  width:max-content;
  border:1px solid var(--border);
  border-radius:10px;
  background:#fff;
}
.pool-tabs button,
.industry-filters button {
  border:0;
  background:transparent;
  color:var(--ink-dim);
  cursor:pointer;
  font:inherit;
}
.pool-tabs button {
  padding:8px 14px;
  border-radius:7px;
  font-size:13px;
  font-weight:650;
}
.pool-tabs button span { margin-left:4px;color:var(--ink-faint);font-size:11px; }
.pool-tabs button.active { background:var(--ink);color:#fff; }
.pool-tabs button.active span { color:rgba(255,255,255,.65); }
.industry-filters {
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin:0 0 12px;
}
.industry-filters button {
  padding:5px 11px;
  border:1px solid var(--border);
  border-radius:999px;
  background:#fff;
  font-size:12px;
}
.industry-filters button.active { border-color:var(--ink);background:var(--ink);color:#fff; }
.hotspot-pool-note {
  margin: -6px 0 12px;
  padding: 10px 14px;
  border-left: 3px solid var(--ink);
  background: var(--gray-50);
  color: var(--ink-dim);
  font-size: 12px;
  line-height: 1.6;
}
.hotspot-title-link {
  display:block;
  width:100%;
  padding:0;
  border:0;
  background:transparent;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink);
  cursor: pointer;
  font-family:inherit;
  text-align:left;
  text-decoration: none;
}
.hotspot-title-link.reco-title { margin-bottom:4px;font-size:15px; }
.hotspot-title-link.expiring-title { flex:1;width:auto; }
.hotspot-title-link:hover {
  color: var(--brand);
  text-decoration: underline;
}
</style>
