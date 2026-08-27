import { reactive } from 'vue'

const AVAILABLE_PAGES = ['today', 'opportunities', 'campaigns', 'guide']
const storedPage = localStorage.getItem('zj_page') || 'today'

// 全局应用状态
export const appState = reactive({
  user: localStorage.getItem('zj_user') || '',
  currentPage: AVAILABLE_PAGES.includes(storedPage) ? storedPage : 'today',
  apiOnline: null,
  apiMessage: '',
  activeCampId: null,
  toastMsg: '',
  toastErr: false,
  toastVisible: false,
  modalHtml: '',
  modalWide: false,
  modalVisible: false,
  modalKey: 0,          // 递增强制刷新弹窗内容
  pendingOpportunityId: null,
})

let toastTimer = null
export function showToast(msg, isErr = false) {
  clearTimeout(toastTimer)
  appState.toastMsg = msg
  appState.toastErr = isErr
  appState.toastVisible = true
  toastTimer = setTimeout(() => { appState.toastVisible = false }, 2600)
}

export function setUser(name) {
  localStorage.setItem('zj_user', name)
  appState.user = name
}

export function getUser() {
  return appState.user
}

export function goPage(page) {
  const target = AVAILABLE_PAGES.includes(page) ? page : 'today'
  localStorage.setItem('zj_page', target)
  appState.currentPage = target
}
