<template>
  <n-config-provider :theme-overrides="naiveTheme">
    <n-message-provider>
      <div id="app-root">
        <header class="app-header">
          <div class="app-header-inner">
            <button type="button" class="header-brand" aria-label="返回热点雷达" @click="goPage('today')">
              <span class="sb-logo"><img src="/logo.png" alt="热点机会台" /></span>
              <span class="sb-brand-text">
                <strong>热点机会台</strong>
                <small>热梗发现与方案生成</small>
              </span>
            </button>

            <nav class="header-nav" aria-label="主导航">
              <button type="button" class="sb-nav-item" v-for="item in mainNav" :key="item.key"
                :class="{ active: currentPage === item.key }"
                @click="goPage(item.key)">
                <n-icon class="nav-icon" :component="item.icon" />
                <span>{{ item.label }}</span>
              </button>
            </nav>

            <div class="header-actions">
              <n-button
                :class="['api-health', apiOnline === false ? 'offline' : apiOnline === true ? 'online' : 'checking']"
                attr-type="button"
                :title="apiMessage"
                @click="checkApi"
              >
                <span class="health-dot"></span>{{ apiLabel }}
              </n-button>
              <n-button quaternary size="small" @click="goPage('guide')">使用指南</n-button>
              <button type="button" class="user-chip" @click="askUsername(true)">
                <span class="user-avatar">{{ user ? user[0] : '?' }}</span>
                <span>{{ user || '未设置' }}</span>
              </button>
              <n-button quaternary size="small" class="settings-trigger" @click="showSettings = true">系统设置</n-button>
            </div>
          </div>
        </header>

        <div class="main-area">
          <main class="main-content">
            <TodayPage      v-if="currentPage === 'today'" />
            <CampaignsPage  v-else-if="currentPage === 'campaigns'" />
            <OpportunitiesPage v-else-if="currentPage === 'opportunities'" />
            <GuidePage      v-else-if="currentPage === 'guide'" />
            <TodayPage      v-else />
          </main>
        </div>

        <!-- Toast -->
        <div :class="['toast', { show: toastVisible, err: toastErr }]">{{ toastMsg }}</div>

        <!-- 用户设置弹窗 -->
        <Modal :show="showUserModal" @close="showUserModal = false">
          <template #head><h3>你是谁？</h3></template>
          <div class="form-row">
            <label>输入你的名字（用于记录操作）</label>
            <n-input v-model:value="userInput" placeholder="如：李媒介" @keyup.enter="saveUser" />
          </div>
          <template #foot>
            <n-button type="primary" @click="saveUser">确定</n-button>
          </template>
        </Modal>

        <!-- 系统设置弹窗 -->
        <Modal :show="showSettings" @close="showSettings = false" wide>
          <template #head><h3>系统设置</h3></template>
          <SettingsPanel />
          <template #foot>
            <n-button secondary @click="showSettings = false">关闭</n-button>
          </template>
        </Modal>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { appState, setUser, getUser, goPage as setPage } from './stores/app.js'
import { showToast } from './stores/app.js'
import { apiGet } from './utils/api.js'
import Modal from './components/Modal.vue'
import SettingsPanel from './pages/SettingsPanel.vue'
import TodayPage from './pages/TodayPage.vue'
import CampaignsPage from './pages/CampaignsPage.vue'
import OpportunitiesPage from './pages/OpportunitiesPage.vue'
import GuidePage from './pages/GuidePage.vue'
import {
  CalendarClearOutline,
  CompassOutline,
  MegaphoneOutline
} from '@vicons/ionicons5'

const currentPage = computed(() => appState.currentPage)
const toastVisible = computed(() => appState.toastVisible)
const toastMsg = computed(() => appState.toastMsg)
const toastErr = computed(() => appState.toastErr)
const user = computed(() => appState.user)
const apiOnline = computed(() => appState.apiOnline)
const apiMessage = computed(() => appState.apiMessage || '正在检查后端服务')
const apiLabel = computed(() => {
  if (appState.apiOnline === true) return '后端正常'
  if (appState.apiOnline === false) return '连接异常'
  return '检查中'
})

const mainNav = [
  { key: 'today', label: '热点雷达', icon: CalendarClearOutline },
  { key: 'opportunities', label: '机会中心', icon: CompassOutline },
  { key: 'campaigns', label: '策略配置', icon: MegaphoneOutline }
]

const naiveTheme = {
  common: {
    primaryColor: '#151515',
    primaryColorHover: '#333333',
    primaryColorPressed: '#000000',
    primaryColorSuppl: '#151515',
    textColorBase: '#171717',
    borderColor: '#dedede',
    borderRadius: '8px',
    fontFamily: 'Inter, "Microsoft YaHei", system-ui, sans-serif'
  },
  Button: {
    borderRadiusMedium: '8px',
    borderRadiusSmall: '7px',
    fontWeight: '700'
  },
  Card: {
    borderRadius: '8px',
    color: '#fff',
    borderColor: 'rgba(216,230,219,.95)'
  },
  Tag: {
    borderRadius: '999px'
  }
}

const showUserModal = ref(false)
const userInput = ref('')
const showSettings = ref(false)
let healthTimer = null

async function checkApi() {
  appState.apiOnline = null
  appState.apiMessage = '正在检查后端服务'
  try {
    await apiGet('/settings')
    appState.apiOnline = true
    appState.apiMessage = '后端服务连接正常'
  } catch (e) {
    appState.apiOnline = false
    appState.apiMessage = e.message
  }
}

function askUsername(force = false) {
  if (!force && getUser()) return
  userInput.value = getUser()
  showUserModal.value = true
}

function saveUser() {
  const v = userInput.value.trim()
  if (!v) return showToast('请输入名字', true)
  setUser(v)
  showUserModal.value = false
}

function goPage(page) {
  if (!page) return
  setPage(page)
}

onMounted(() => {
  checkApi()
  healthTimer = setInterval(checkApi, 30000)
})

onBeforeUnmount(() => {
  if (healthTimer) clearInterval(healthTimer)
})
</script>
