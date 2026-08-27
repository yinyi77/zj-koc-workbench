<template>
  <div>
    <div class="page-head">
      <div>
        <h2>机会中心</h2>
        <div class="sub">热点研判 → 值得跟进 → 方案整理 → 输出归档</div>
      </div>
      <div class="head-actions">
        <n-button secondary :loading="loading" @click="loadData">{{ loading ? '刷新中...' : '刷新' }}</n-button>
        <n-button type="primary" @click="openOppForm">＋ 手动创建机会</n-button>
      </div>
    </div>

    <div v-if="loading" class="loading-card"><span>正在加载机会数据...</span><span class="spinner"></span></div>
    <div v-else-if="error" class="error-card">
      <span>{{ error }}</span>
      <n-button size="small" secondary @click="loadData">重试</n-button>
    </div>
    <div v-if="!loading && dataHealthItems.length" class="data-health-banner">
      <b>数据待完善</b>
      <span v-for="item in dataHealthItems" :key="item">{{ item }}</span>
    </div>

    <!-- 子导航 -->
    <n-tabs v-model:value="tab" type="segment" animated class="page-tabs">
      <n-tab-pane name="current" :tab="`当前机会 ${counts.current}`" />
      <n-tab-pane name="history" :tab="`历史机会 ${counts.history}`" />
      <n-tab-pane name="generate" tab="机会生成" />
      <n-tab-pane name="templates" tab="机会模板库" />
    </n-tabs>

    <!-- 筛选条（current/history tab）-->
    <div v-if="tab === 'current' || tab === 'history'" class="filter-bar wrap">
      <n-select v-model:value="filters.status" :options="statusFilterOptions" />
      <n-select v-model:value="filters.platform" :options="platformFilterOptions" placeholder="平台-全部" clearable />
      <n-select v-model:value="filters.risk" :options="riskOptions" placeholder="风险-全部" clearable />
      <n-select v-model:value="filters.due" :options="dueOptions" placeholder="时效-全部" clearable />
      <n-input class="q" v-model:value="filters.q" placeholder="搜索：热点/玩法/标题" clearable />
      <n-button size="small" secondary @click="filters = { status: '全部', platform: '', risk: '', due: '', q: '' }">重置</n-button>
    </div>

    <!-- 当前机会看板 -->
    <div v-if="!error && tab === 'current'" class="kanban-board">
      <div v-for="col in kanbanColumns" :key="col.status" class="kanban-col">
        <div class="kanban-head">
          <b>{{ col.status }}</b>
          <span>{{ col.items.length }}</span>
        </div>
        <div v-if="col.items.length" class="kanban-list">
          <div v-for="o in col.items" :key="o.id" class="opp-card" role="button" tabindex="0" @click="openDrawer(o.id)" @keyup.enter="openDrawer(o.id)">
            <span class="opp-title">{{ o.title }}</span>
            <span class="opp-meta">{{ o.campaign_name || '未关联策略' }}</span>
            <span class="opp-tags">
              <StatusTag :text="o.platform || '平台待定'" />
              <span v-if="o.deadline" class="tag orange">截止 {{ o.deadline }}</span>
              <span v-if="o.ai_score != null" class="tag purple">AI {{ o.ai_score }}</span>
              <span v-else-if="o.rule_score != null" class="tag gray">规则 {{ o.rule_score }}</span>
            </span>
            <span v-if="o.direction || o.play_method" class="opp-desc">{{ o.play_method || o.direction }}</span>
            <span class="opp-card-actions">
              <n-button size="tiny" type="error" secondary @click.stop="deleteOpp(o.id)">删除</n-button>
            </span>
          </div>
        </div>
        <EmptyState v-else icon="check">暂无{{ col.status }}机会</EmptyState>
      </div>
    </div>

    <!-- 历史机会表格 -->
    <n-data-table v-if="!error && tab === 'history'" class="data-table-card" :columns="historyColumns" :data="filteredList" :bordered="false" :single-line="false" />

    <!-- 机会生成 tab -->
    <div class="card" v-if="tab === 'generate'">
      <div class="sec-title">从候选热点生成机会</div>
      <div class="hint">选择今日候选热点，系统会创建机会并自动生成完整方案。</div>
      <div v-if="dailyMeta.fetchedAt" class="hotspot-freshness opportunity-source-meta">
        <span>每日快照 {{ formatDateTime(dailyMeta.fetchedAt) }}</span>
        <span>B站 {{ dailyMeta.biliCount }} 条</span>
        <span>抖音 {{ dailyMeta.douyinCount }} 条</span>
      </div>
      <div v-if="candHotspots.length" class="tmpl-list">
        <div v-for="h in candHotspots" :key="h.list_key || h.id" class="tmpl-card">
          <div class="t">{{ h.title }}</div>
          <div class="meta">
            <StatusTag :text="h.platform || '平台待定'" />
            <StatusTag :text="h.trend || '—'" />
            <span class="tag gray">热度 {{ h.heat || '—' }}</span>
          </div>
          <div class="acts"><n-button size="small" type="primary" @click="toOpportunity(h)">生成机会</n-button></div>
        </div>
      </div>
      <EmptyState v-else>当前没有可生成的候选热点</EmptyState>

      <div class="sec-title" style="margin-top:16px">根据当前热点策略主动生成机会</div>
      <div class="hint">系统综合机会模板、当前关注目标和候选热点，生成可研判的机会方向。</div>
      <n-button type="primary" :loading="genLoading" @click="generateCandidates">
        {{ genLoading ? '生成中…' : '🤖 生成候选机会' }}
      </n-button>
      <div v-if="genCands.length" style="margin-top:12px">
        <div v-for="(c, i) in genCands" :key="i" class="tmpl-card">
          <div class="t">{{ c.title }}</div>
          <div class="meta">
            <StatusTag :text="c.platform" />
            <StatusTag :text="c.node || '—'" />
            <StatusTag :text="'风险' + (riskLevel(c))" />
          </div>
          <div class="line"><b>玩法：</b>{{ c.play_method }}</div>
          <div class="line"><b>方向：</b>{{ c.direction }}</div>
          <div class="line"><b>依据：</b>{{ c.basis?.version_fit || c.basis?.reason || '—' }}</div>
          <div class="acts"><n-button size="small" type="primary" @click="adoptCandidate(i)">采纳为机会</n-button></div>
        </div>
      </div>
    </div>

    <!-- 机会模板 tab -->
    <div v-if="tab === 'templates'">
      <div class="page-head" style="border-bottom:none;margin-bottom:0;padding-bottom:0">
        <div></div>
        <div class="head-actions"><n-button type="primary" @click="openTemplateForm()">＋ 新建模板</n-button></div>
      </div>
      <div class="card">
        <div v-if="templates.length" class="tmpl-list">
          <div v-for="t in templates" :key="t.id" class="tmpl-card">
            <div class="t">{{ t.name }} <span class="tag gray">使用 {{ t.usage_count || 0 }} 次</span></div>
            <div class="meta">
              <StatusTag :text="t.applicable_hotspot || '—'" />
              <StatusTag :text="t.applicable_node || '通用节点'" />
            </div>
            <div class="line"><b>核心逻辑：</b>{{ t.core_logic || '—' }}</div>
            <div class="line"><b>适用场景：</b>{{ t.validation || '—' }}</div>
            <div class="acts">
              <n-button size="small" secondary @click="openTemplateForm(t)">编辑</n-button>
              <n-button size="small" type="error" secondary @click="deleteTemplate(t.id)">删除</n-button>
            </div>
          </div>
        </div>
        <EmptyState v-else>还没有机会模板，可先新建一条常用研判框架。</EmptyState>
      </div>
    </div>

    <!-- 机会详情抽屉 -->
    <template v-if="drawerVisible">
      <div class="drawer-mask" @click="closeDrawer"></div>
      <div class="drawer">
        <div class="drawer-head">
          <div>
            <div style="font-size:16px;font-weight:700">{{ drawer?.title }}</div>
            <div style="margin-top:6px">
              <StatusTag :text="drawer?.status" />
              <span v-if="drawer?.assignee" class="tag gray">跟进:{{ drawer.assignee }}</span>
              <span v-if="drawer?.deadline" class="tag orange">截止 {{ drawer.deadline }}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <n-button size="small" type="error" secondary @click="deleteCurrentOpp">删除机会</n-button>
            <button type="button" class="x" aria-label="关闭机会详情" @click="closeDrawer">&times;</button>
          </div>
        </div>
        <div class="drawer-body">
          <!-- 流程步骤 -->
          <div v-if="!isTerminal" class="flow">
            <template v-for="(s, i) in OPP_FLOW" :key="s">
              <div :class="['step', i < flowIdx ? 'done' : i === flowIdx ? 'cur' : '']">
                <span class="dot">{{ i < flowIdx ? '✓' : i + 1 }}</span>{{ s }}
              </div>
              <span v-if="i < OPP_FLOW.length - 1" class="arrow">&rarr;</span>
            </template>
          </div>

          <!-- ① 机会研判 -->
          <div class="sec-title">① 机会研判
            <span><n-button size="small" type="primary" :loading="evalLoading" @click="evalOpp">{{ evalLoading ? '分析并更新中…' : 'AI 评估并更新' }}</n-button></span>
          </div>
          <div v-if="drawer?.ai_analysis" class="ai-block">
            <div class="hd">AI 评估 · {{ drawer.ai_score }}分</div>{{ drawer.ai_analysis }}
          </div>
          <div v-if="drawer?.rule_score != null" class="rule-block"><b>规则评分 {{ drawer.rule_score }} 分</b></div>
          <div v-if="!drawer?.ai_analysis && drawer?.rule_score == null" class="hint">尚未评估</div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <n-button v-if="drawer?.status === '待研判'" size="small" type="success" secondary @click="setStatus('值得跟进')">✓ 值得跟进</n-button>
            <n-button v-if="drawer?.status === '待研判'" size="small" type="error" secondary @click="setStatus('不采用')">✕ 不采用</n-button>
          </div>

          <div class="sec-title">② 机会方案
            <span class="plan-actions">
              <n-button v-if="hasPlan" size="small" secondary @click="copyPlan">复制方案</n-button>
              <n-button v-if="hasPlan" size="small" secondary @click="downloadPlan">下载 Brief</n-button>
              <n-button size="small" secondary @click="generateOpportunityPlan()">生成/刷新方案</n-button>
            </span>
          </div>
          <div v-if="planConflict" class="decision-conflict">当前评分低于 45 分，以下内容仅作为探索稿，不代表建议执行。请先确认关联性再推进。</div>
          <div v-if="drawer?.direction || drawer?.play_method || drawer?.game_combo" class="opportunity-plan-grid">
            <div><label>来源热点</label><p>{{ drawer.hotspot_title || '手动创建' }}</p></div>
            <div><label>建议平台 / 时间</label><p>{{ drawer.platform || '待定' }} · {{ drawer.suggested_time || drawer.deadline || '待定' }}</p></div>
            <div class="full"><label>机会方向</label><p>{{ drawer.direction || '—' }}</p></div>
            <div><label>推荐玩法</label><p>{{ drawer.play_method || '—' }}</p></div>
            <div><label>游戏结合方式</label><p>{{ drawer.game_combo || '—' }}</p></div>
            <div class="full"><label>风险提示</label><p>{{ drawer.risk_note || '未发现明显风险' }}</p></div>
          </div>
          <div v-else class="hint">尚未生成方案。系统会根据当前项目适配、热梗可复用性、趋势、新鲜度和风险整理建议。</div>
          <div v-if="planVersions.length" class="plan-version-list">
            <div class="plan-version-title">方案版本记录</div>
            <div v-for="version in planVersions.slice(0, 5)" :key="version.id" class="plan-version-item">
              <span><b>V{{ version.version_no }}</b> · {{ version.mode === 'ai' ? 'AI 生成' : '规则生成' }} · {{ (version.created_at || '').slice(5, 16) }}</span>
              <n-button size="tiny" text @click="copyPlanVersion(version)">复制该版</n-button>
            </div>
          </div>

          <div class="sec-title">③ 状态与时效</div>
          <div class="form-grid">
            <div class="form-row">
              <label>状态</label>
              <n-select v-model:value="drawer.status" :options="allStatusOptions" @update:value="saveState" />
            </div>
            <div class="form-row">
              <label>截止日期</label>
              <n-date-picker v-model:value="drawerDeadlineValue" type="date" clearable @update:value="updateDeadline" />
            </div>
            <div class="form-row full">
              <label>跟进人</label>
              <n-input v-model:value="drawer.assignee" placeholder="填写负责人" @change="saveState" />
            </div>
          </div>

          <!-- 操作日志 -->
          <div class="sec-title">操作日志
            <span><n-button size="small" secondary @click="addNote">＋ 备注</n-button></span>
          </div>
          <div v-if="logs.length">
            <div v-for="l in logs" :key="l.id || l.created_at" class="log-item">
              <b>{{ l.user || '系统' }}</b> · {{ l.action }} · {{ l.note }}
              <span style="float:right">{{ (l.created_at || '').slice(5, 16) }}</span>
            </div>
          </div>
          <div v-else class="hint">无日志</div>
        </div>
      </div>
    </template>

    <!-- 新建/编辑机会模板弹窗 -->
    <Modal :show="showTemplateForm" @close="showTemplateForm = false" wide>
      <template #head><h3>{{ templateEditing ? '编辑' : '新建' }}机会模板</h3></template>
      <div class="form-grid">
        <div class="form-row full"><label>模板名称 *</label><n-input v-model:value="templateForm.name" /></div>
        <div class="form-row full"><label>核心逻辑</label><n-input v-model:value="templateForm.core_logic" type="textarea" /></div>
        <div class="form-row"><label>适用热点</label><n-input v-model:value="templateForm.applicable_hotspot" /></div>
        <div class="form-row"><label>适用策略节点</label><n-input v-model:value="templateForm.applicable_node" /></div>
        <div class="form-row full"><label>适用场景</label><n-input v-model:value="templateForm.validation" /></div>
        <div class="form-row full"><label>风险与限制</label><n-input v-model:value="templateForm.risks" /></div>
      </div>
      <template #foot><n-button type="primary" @click="saveTemplate">保存</n-button></template>
    </Modal>

    <!-- 手动创建机会弹窗 -->
    <Modal :show="showOppForm" @close="showOppForm = false">
      <template #head><h3>手动创建机会</h3></template>
      <div class="form-row"><label>机会标题 *</label><n-input v-model:value="oppFormTitle" /></div>
      <div class="form-row"><label>关联热点策略</label>
        <n-select v-model:value="oppFormCampId" :options="campaignOptions" placeholder="不关联" clearable />
      </div>
      <template #foot><n-button type="primary" @click="createOpp">创建</n-button></template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, h, onMounted, watch } from 'vue'
import { NButton } from 'naive-ui'
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api.js'
import { showToast, getUser, appState } from '../stores/app.js'
import { OPP_FLOW, OPP_CURRENT, OPP_HISTORY, OPP_ALL, OPP_TERMINAL } from '../utils/constants.js'
import Modal from '../components/Modal.vue'
import StatusTag from '../components/StatusTag.vue'
import EmptyState from '../components/EmptyState.vue'

const tab = ref('current')
const filters = ref({ status: '全部', platform: '', risk: '', due: '', q: '' })
const opportunities = ref([])
const templates = ref([])
const campaigns = ref([])
const genCands = ref([])
const hotspotCandidates = ref([])
const dailyMeta = ref({ fetchedAt: '', analyzedAt: '', biliCount: 0, douyinCount: 0 })
const genLoading = ref(false)
const loading = ref(false)
const error = ref('')

// Drawer state
const drawerVisible = ref(false)
const drawer = ref(null)
const logs = ref([])
const planVersions = ref([])
const drawerDeadlineValue = ref(null)

// Template form
const showTemplateForm = ref(false)
const templateEditing = ref(null)
const templateForm = ref({})

// New opp form
const showOppForm = ref(false)
const oppFormTitle = ref('')
const oppFormCampId = ref('')

// Eval loading
const evalLoading = ref(false)

const counts = computed(() => ({
  current: opportunities.value.filter(o => OPP_CURRENT.includes(o.status)).length,
  history: opportunities.value.filter(o => OPP_HISTORY.includes(o.status)).length
}))

const dataHealthItems = computed(() => {
  const items = []
  const missingPlatform = opportunities.value.filter(o => !o.platform).length
  const missingDirection = opportunities.value.filter(o => !o.direction && !o.play_method).length
  const legacy = opportunities.value.filter(o => o._legacyStatus || o._legacyPlatform).length
  const duplicates = opportunities.value.length - new Set(opportunities.value.map(o => String(o.title || '').trim().toLowerCase())).size
  if (missingPlatform) items.push(`${missingPlatform} 条缺少平台`)
  if (missingDirection) items.push(`${missingDirection} 条缺少方案方向`)
  if (legacy) items.push(`${legacy} 条历史字段已自动兼容，建议补全`)
  if (duplicates) items.push(`${duplicates} 条标题可能重复`)
  return items
})

const statusOptions = computed(() => tab.value === 'current' ? OPP_CURRENT : OPP_HISTORY)
const statusFilterOptions = computed(() => [
  { label: '全部', value: '全部' },
  ...statusOptions.value.map(v => ({ label: v, value: v }))
])
const allStatusOptions = OPP_ALL.map(v => ({ label: v, value: v }))
const riskOptions = ['高', '中', '低'].map(v => ({ label: v, value: v }))
const dueOptions = [
  { label: '本周截止', value: 'week' },
  { label: '本月截止', value: 'month' },
  { label: '已逾期', value: 'overdue' },
  { label: '无截止', value: 'none' }
]
const campaignOptions = computed(() => campaigns.value.map(c => ({ label: c.name, value: c.id })))

const platforms = computed(() => [...new Set(opportunities.value.map(o => o.platform).filter(Boolean))])
const platformFilterOptions = computed(() => platforms.value.map(v => ({ label: v, value: v })))

const filteredList = computed(() => {
  let list = opportunities.value
  if (tab.value === 'current') list = list.filter(o => OPP_CURRENT.includes(o.status))
  if (tab.value === 'history') list = list.filter(o => OPP_HISTORY.includes(o.status))
  const f = filters.value
  if (f.status !== '全部') list = list.filter(o => o.status === f.status)
  if (f.platform) list = list.filter(o => o.platform === f.platform)
  if (f.risk) list = list.filter(o => (o.risk_level || '中') === f.risk)
  if (f.due) {
    const today = new Date().toISOString().slice(0, 10)
    const now = new Date(today).getTime()
    const inDays = (days) => new Date(now + days * 86400000).toISOString().slice(0, 10)
    if (f.due === 'week') list = list.filter(o => o.deadline && o.deadline >= today && o.deadline <= inDays(7))
    if (f.due === 'month') list = list.filter(o => o.deadline && o.deadline >= today && o.deadline <= inDays(30))
    if (f.due === 'overdue') list = list.filter(o => o.deadline && o.deadline < today)
    if (f.due === 'none') list = list.filter(o => !o.deadline)
  }
  if (f.q) {
    const q = f.q.toLowerCase()
    list = list.filter(o => [o.title, o.hotspot_title, o.play_method, o.direction].filter(Boolean).join(' ').toLowerCase().includes(q))
  }
  return list
})
const historyColumns = computed(() => [
  {
    title: '机会',
    key: 'title',
    minWidth: 220,
    render: row => h('span', { class: 'title-link', onClick: () => openDrawer(row.id) }, row.title)
  },
  {
    title: '来源热点/节点',
    key: 'hotspot_title',
    minWidth: 160,
    render: row => h('span', { class: 'muted-cell' }, `${row.hotspot_title || '—'}${row.node ? ' / ' + row.node : ''}`)
  },
  { title: '关联策略', key: 'campaign_name', minWidth: 140, render: row => row.campaign_name || '—' },
  { title: '平台', key: 'platform', width: 90, render: row => row.platform || '—' },
  {
    title: '评分',
    key: 'score',
    width: 120,
    render: row => {
      const parts = []
      if (row.ai_score != null) parts.push(h('span', { style: { color: 'var(--purple)', fontWeight: 700 } }, `AI ${row.ai_score}`))
      if (row.rule_score != null) parts.push(h('span', { style: { color: 'var(--ink2)', fontSize: '12px', marginLeft: '4px' } }, `规则 ${row.rule_score}`))
      return parts.length ? h('span', parts) : '—'
    }
  },
  { title: '状态', key: 'status', width: 100, render: row => h(StatusTag, { text: row.status }) },
  { title: '更新', key: 'updated_at', width: 100, render: row => (row.updated_at || '').slice(5, 16) },
  {
    title: '操作',
    key: 'actions',
    width: 86,
    render: row => h(NButton, { size: 'small', type: 'error', secondary: true, onClick: () => deleteOpp(row.id) }, () => '删除')
  }
])
const kanbanColumns = computed(() => {
  return OPP_CURRENT.map(status => ({
    status,
    items: filteredList.value.filter(o => o.status === status)
  }))
})

const candHotspots = computed(() => hotspotCandidates.value.filter(h =>
  (h.status || '候选') === '候选' && h.screen_result !== '不符合'
))

const isTerminal = computed(() => drawer.value && OPP_TERMINAL.includes(drawer.value.status))
const flowIdx = computed(() => drawer.value ? OPP_FLOW.indexOf(drawer.value.status) : 0)
const hasPlan = computed(() => !!(drawer.value && (drawer.value.direction || drawer.value.play_method || drawer.value.game_combo)))
const planConflict = computed(() => {
  if (!hasPlan.value) return false
  const score = drawer.value?.ai_score ?? drawer.value?.rule_score
  return score != null && Number(score) < 45
})

function riskLevel(c) {
  if (c.risk_json?.opinion?.level) return c.risk_json.opinion.level
  if (c.risk_level) return c.risk_level
  return '中'
}

const LEGACY_STATUS_MAP = {
  '待判断': '待研判',
  '已采纳': '值得跟进',
  '待匹配创作者': '值得跟进',
  '创作中': '方案整理中',
  '待发布': '方案整理中',
  '已发布': '已输出',
  '已验证': '已输出'
}

function normalizeOpportunity(row) {
  const status = LEGACY_STATUS_MAP[row.status] || row.status
  const platform = normalizePlatform(row.platform || row.hotspot_source)
  return {
    ...row,
    status: OPP_ALL.includes(status) ? status : '待研判',
    platform,
    _legacyStatus: !OPP_ALL.includes(row.status) && !LEGACY_STATUS_MAP[row.status],
    _legacyPlatform: !!row.platform && platform !== row.platform
  }
}

function normalizePlatform(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^(b站|bilibili|b\?)$/i.test(text)) return 'B站'
  if (/^(抖音|douyin|dy)$/i.test(text)) return '抖音'
  return text
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16)
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

function dateStringToValue(value) {
  if (!value) return null
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day).getTime()
}

function dateValueToString(value) {
  if (!value) return ''
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function syncDrawerDateValue() {
  drawerDeadlineValue.value = dateStringToValue(drawer.value?.deadline)
}

function updateDeadline(value) {
  if (!drawer.value) return
  drawer.value.deadline = dateValueToString(value)
  saveState()
}

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    opportunities.value = (await apiGet('/opportunities')).map(normalizeOpportunity)
    try { templates.value = await apiGet('/creative_templates') } catch (e) { /* ignore */ }
    try { campaigns.value = await apiGet('/campaigns') } catch (e) { /* ignore */ }
    try {
      const [stored, daily] = await Promise.all([
        apiGet('/hotspots'),
        apiGet('/today/hotspots?limit=100')
      ])
      dailyMeta.value = {
        fetchedAt: daily.fetchedAt || '',
        analyzedAt: daily.analyzedAt || '',
        biliCount: Number(daily.biliCount) || 0,
        douyinCount: Number(daily.douyinCount) || 0
      }
      const byUrl = new Map(stored.filter(item => item.url).map(item => [item.url, item]))
      const byTitle = new Map(stored.map(item => [`${item.title}::${normalizePlatform(item.platform)}`, item]))
      const dailyRows = (daily.list || []).map((item, index) => {
        const platform = normalizePlatform(item.platform || item.source || item.source_label)
        const saved = byUrl.get(item.url) || byTitle.get(`${item.title}::${platform}`)
        return {
          ...item,
          platform,
          stored_id: saved?.id || null,
          status: saved?.status || '候选',
          screen_result: saved?.screen_result || '待定',
          list_key: `daily-${item.id || index}`
        }
      })
      const dailyKeys = new Set(dailyRows.map(item => item.url || `${item.title}::${item.platform}`))
      const storedOnly = stored
        .filter(item => !dailyKeys.has(item.url || `${item.title}::${normalizePlatform(item.platform)}`))
        .map(item => ({ ...item, platform: normalizePlatform(item.platform), stored_id: item.id, list_key: `stored-${item.id}` }))
      hotspotCandidates.value = [...dailyRows, ...storedOnly]
    } catch (e) {
      hotspotCandidates.value = []
    }
  } catch (e) {
    error.value = e.message
    showToast(e.message, true)
  } finally {
    loading.value = false
  }
}

async function openDrawer(id) {
  try {
    const [o, l, versions] = await Promise.all([
      apiGet(`/opportunities/${id}`),
      apiGet(`/opportunities/${id}/logs`),
      apiGet(`/opportunities/${id}/plan-versions`)
    ])
    drawer.value = normalizeOpportunity(o)
    syncDrawerDateValue()
    logs.value = l || []
    planVersions.value = versions || []
    drawerVisible.value = true
  } catch (e) { showToast(e.message, true) }
}

function closeDrawer() {
  drawerVisible.value = false
  planVersions.value = []
  loadData()
}

async function deleteOpp(id) {
  if (!confirm('确认删除？')) return
  try {
    await apiDelete(`/opportunities/${id}`)
    showToast('已删除')
    if (drawer.value?.id === id) {
      drawerVisible.value = false
      drawer.value = null
      logs.value = []
      planVersions.value = []
    }
    await loadData()
  } catch (e) { showToast(e.message, true) }
}

async function deleteCurrentOpp() {
  if (!drawer.value) return
  await deleteOpp(drawer.value.id)
}

async function evalOpp() {
  if (!drawer.value) return
  evalLoading.value = true
  const id = drawer.value.id
  try {
    const evalResult = await apiPost(`/opportunities/${id}/evaluate`, { user: getUser() }, { timeout: 180000 })
    const score = Number(evalResult.ai?.score ?? evalResult.rule?.score)
    let planResult = null
    if (!Number.isFinite(score) || score >= 45) {
      planResult = await generateOpportunityPlan({ silent: true, refresh: false })
    }
    const usedRule = evalResult.mode === 'rule' || planResult?.mode === 'rule'
    const message = Number.isFinite(score) && score < 45
      ? `评估完成（${score}分），低于 45 分，未自动生成正式方案`
      : (planResult?.message || evalResult.message || '评估与方案已更新')
    showToast(message, usedRule || (Number.isFinite(score) && score < 45))
    await openDrawer(id)
    await loadData()
  } catch (e) { showToast(e.message, true) }
  finally { evalLoading.value = false }
}

async function generateOpportunityPlan({ silent = false, refresh = true } = {}) {
  if (!drawer.value) return null
  const id = drawer.value.id
  try {
    const r = await apiPost(`/opportunities/${id}/generate-plan`, { user: getUser() }, { timeout: 180000 })
    if (refresh) {
      await openDrawer(id)
      await loadData()
    }
    if (!silent) showToast(r.message || '机会字段已由 AI 更新', r.mode === 'rule')
    return r
  } catch (e) {
    if (!silent) showToast(e.message, true)
    throw e
  }
}

async function setStatus(status) {
  if (!drawer.value) return
  const reason = prompt(status === '值得跟进' ? '判断结论（为什么值得跟进）：' : '状态说明：') || ''
  await apiPut(`/opportunities/${drawer.value.id}`, { status, decision: reason, decision_by: getUser() })
  await apiPost(`/opportunities/${drawer.value.id}/logs`, { action: '状态变更', note: `${status}：${reason}`, user: getUser() })
  showToast('已更新')
  openDrawer(drawer.value.id)
}

async function saveState() {
  if (!drawer.value) return
  try {
    await apiPut(`/opportunities/${drawer.value.id}`, { status: drawer.value.status, deadline: drawer.value.deadline, assignee: drawer.value.assignee || '' })
    showToast('已保存')
  } catch (e) { showToast(e.message, true) }
}

async function addNote() {
  if (!drawer.value) return
  const note = prompt('备注内容：')
  if (!note) return
  try {
    await apiPost(`/opportunities/${drawer.value.id}/logs`, { action: '备注', note, user: getUser() })
    openDrawer(drawer.value.id)
  } catch (e) { showToast(e.message, true) }
}

async function toOpportunity(h) {
  try {
    let hid = typeof h === 'number' ? h : (h.stored_id || (typeof h.id === 'number' ? h.id : null))
    if (!hid) {
      const saved = await apiPost('/today/hotspots/materialize', {
        id: h.id,
        url: h.url,
        title: h.title,
        user: getUser()
      })
      hid = saved.hotspot.id
    }
    const r = await apiPost(`/hotspots/${hid}/adopt`, { campaign_id: appState.activeCampId, user: getUser() })
    showToast('已生成并进入机会中心')
    openDrawer(r.id)
    tab.value = 'current'
  } catch (e) { showToast(e.message, true) }
}

function planTextFrom(value) {
  const o = value || {}
  return [
    `# ${o.title || '机会方案'}`,
    '',
    `- 状态：${o.status || '—'}`,
    `- 来源热点：${o.hotspot_title || '手动创建'}`,
    `- 建议平台：${o.platform || '待定'}`,
    `- 建议时间：${o.suggested_time || o.deadline || '待定'}`,
    `- 跟进人：${o.assignee || '待定'}`,
    '',
    '## 机会方向',
    o.direction || '—',
    '',
    '## 推荐玩法',
    o.play_method || '—',
    '',
    '## 游戏结合方式',
    o.game_combo || '—',
    '',
    '## 风险提示',
    o.risk_note || '未发现明显风险'
  ].join('\n')
}

function planText() {
  return drawer.value ? planTextFrom({ ...drawer.value, title: drawer.value.title }) : ''
}

async function copyPlan() {
  try {
    await navigator.clipboard.writeText(planText())
    showToast('方案已复制')
  } catch (e) {
    showToast('复制失败，请使用下载 Brief', true)
  }
}

async function copyPlanVersion(version) {
  try {
    await navigator.clipboard.writeText(planTextFrom({ ...version.plan, title: drawer.value?.title, status: drawer.value?.status, hotspot_title: drawer.value?.hotspot_title, assignee: drawer.value?.assignee }))
    showToast(`已复制 V${version.version_no} 方案`)
  } catch (e) {
    showToast('复制失败', true)
  }
}

function downloadPlan() {
  const content = planText()
  if (!content) return
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${String(drawer.value?.title || '机会方案').replace(/[\\/:*?"<>|]/g, '_')}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  showToast('Brief 已下载')
}

async function generateCandidates() {
  genLoading.value = true
  try {
    const r = await apiPost('/opportunities/generate-candidates', {})
    genCands.value = r.candidates || []
  } catch (e) { showToast(e.message, true) }
  finally { genLoading.value = false }
}

async function adoptCandidate(idx) {
  const c = genCands.value[idx]
  if (!c) return showToast('未找到候选机会', true)
  try {
    const r = await apiPost('/opportunities', {
      title: c.title,
      campaign_id: appState.activeCampId || null,
      status: '待研判',
      direction: c.direction || '',
      play_method: c.play_method || '',
      game_combo: c.game_combo || '',
      platform: c.platform || '',
      node: c.node || '',
      basis: JSON.stringify(c.basis || {}),
      risk_json: JSON.stringify(c.risk_json || {}),
      suggested_time: c.suggested_time || '',
      risk_level: riskLevel(c),
      created_by: getUser()
    })
    showToast('已生成并进入机会中心')
    tab.value = 'current'
    await loadData()
    openDrawer(r.id)
  } catch (e) { showToast(e.message, true) }
}

function openTemplateForm(t = null) {
  templateEditing.value = t
  templateForm.value = t ? { ...t } : { name: '', core_logic: '', applicable_hotspot: '', applicable_node: '', validation: '', risks: '' }
  showTemplateForm.value = true
}

async function saveTemplate() {
  if (!templateForm.value.name.trim()) return showToast('请输入名称', true)
  try {
    if (templateEditing.value) {
      await apiPut(`/creative_templates/${templateEditing.value.id}`, templateForm.value)
    } else {
      await apiPost('/creative_templates', { ...templateForm.value, created_by: getUser() })
    }
    showTemplateForm.value = false
    showToast('已保存')
    tab.value = 'templates'
    loadData()
  } catch (e) { showToast(e.message, true) }
}

async function deleteTemplate(id) {
  if (!confirm('确认删除？')) return
  try {
    await apiDelete(`/creative_templates/${id}`)
    showToast('已删除')
    loadData()
  } catch (e) { showToast(e.message, true) }
}

function openOppForm() {
  oppFormTitle.value = ''
  oppFormCampId.value = ''
  showOppForm.value = true
}

async function createOpp() {
  const title = oppFormTitle.value.trim()
  if (!title) return showToast('请输入标题', true)
  try {
    const r = await apiPost('/opportunities', { title, campaign_id: oppFormCampId.value || null, status: '待研判', created_by: getUser() })
    showOppForm.value = false
    showToast('已创建')
    openDrawer(r.id)
    tab.value = 'current'
    loadData()
  } catch (e) { showToast(e.message, true) }
}

// Watch for drawer open trigger from TodayPage
watch(() => appState.pendingOpportunityId, (val) => {
  if (val) {
    openDrawer(val)
    appState.pendingOpportunityId = null
  }
}, { immediate: true })

onMounted(loadData)
</script>
