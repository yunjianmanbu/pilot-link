<template>
  <view class="page module-check-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="mc-header">
      <view class="mc-topbar">
        <view class="mc-back" @click="back"><view class="back-arrow"></view></view>
        <view class="mc-titles">
          <text class="mc-title">{{ t('模块自检') }}</text>
          <text class="mc-subtitle">{{ workspaceLabel }}</text>
        </view>
        <text
          class="mc-refresh"
          :class="{ disabled: loading || busy }"
          @click="load"
        >{{ loading ? t('读取中…') : t('刷新') }}</text>
      </view>

      <!-- 自检只读：不确定的结论都带文件与行号，修改必须由用户确认。 -->
      <view class="mc-intro">
        <text class="mc-badge">{{ t('工程健康') }}</text>
        <text class="mc-intro-text">
          {{ t('自检只读扫描 Pilot 内置源码里你勾选的模块，用固定规则列出风险点和优化建议。勾选确认后才会创建一个普通会话去修，写入仍受沙箱与审批约束。') }}
        </text>
      </view>

      <view class="mc-stats">
        <view class="mc-stat">
          <text class="mc-stat-value">{{ report ? report.score : '—' }}</text>
          <text class="mc-stat-label">{{ t('健康分') }}</text>
        </view>
        <view class="mc-stat">
          <text class="mc-stat-value">{{ report ? riskTotal : 0 }}</text>
          <text class="mc-stat-label">{{ t('风险点') }}</text>
        </view>
        <view class="mc-stat">
          <text class="mc-stat-value">{{ report ? report.scannedFiles : 0 }}</text>
          <text class="mc-stat-label">{{ t('已扫描文件') }}</text>
        </view>
      </view>
    </view>

    <scroll-view class="mc-scroll" scroll-y :show-scrollbar="false">
      <view class="mc-content">
        <view v-if="!connected" class="mc-empty">
          <text class="mc-empty-title">{{ t('还没有连接电脑') }}</text>
          <text class="mc-empty-hint">{{ t('连接电脑后才能运行模块自检。') }}</text>
        </view>

        <view v-else-if="loading && !state" class="mc-empty">
          <text class="mc-empty-title">{{ t('正在读取自检状态…') }}</text>
        </view>

        <view v-else-if="error && !state" class="mc-empty">
          <text class="mc-empty-title">{{ t('读取自检状态失败') }}</text>
          <text class="mc-empty-hint">{{ error }}</text>
          <button class="btn ghost small-btn mc-retry" @click="load">{{ t('重试') }}</button>
        </view>

        <template v-else>
          <view v-if="error" class="mc-error" @click="error = ''">
            <text class="mc-error-text">{{ error }}</text>
          </view>

          <!-- 模块选择：默认全选；清空后点立即自检表示扫描全部。 -->
          <view class="mc-card">
            <view class="mc-card-head">
              <view class="mc-card-heading">
                <text class="mc-card-title">{{ t('自检模块') }}</text>
                <text class="mc-card-hint">{{ moduleHint }}</text>
              </view>
              <view class="mc-head-actions">
                <text
                  class="mc-head-action"
                  :class="{ disabled: busy || !modules.length }"
                  @click="toggleAllModules"
                >{{ allSelected ? t('清空') : t('全选') }}</text>
                <text
                  class="mc-head-action"
                  :class="{ disabled: busy }"
                  @click="reloadModules"
                >{{ t('重新扫描') }}</text>
              </view>
            </view>

            <view v-if="!modules.length" class="mc-empty-inline">
              {{ discovering ? t('正在发现模块…') : t('内置源码里没有发现可自检的模块。') }}
            </view>
            <view v-else class="mc-module-list">
              <view
                v-for="module in modules"
                :key="module.id"
                class="mc-module"
                :class="{ active: isSelected(module.id) }"
                @click="toggleModule(module.id)"
              >
                <view class="mc-check" :class="{ on: isSelected(module.id) }">
                  <text v-if="isSelected(module.id)" class="mc-check-mark">✓</text>
                </view>
                <view class="mc-module-main">
                  <text class="mc-module-name">{{ module.path || '/' }}</text>
                  <text class="mc-module-meta">{{ moduleMeta(module) }}</text>
                </view>
              </view>
            </view>

            <view class="mc-run-row">
              <text class="mc-run-note">
                {{ selected.length ? t('已选 {v1} 个模块', { v1: selected.length }) : t('未选择模块时扫描全部') }}
              </text>
              <button
                class="btn primary mc-run-btn"
                :disabled="busy !== '' || !connected || discovering"
                @click="runCheck"
              >{{ busy === 'run' ? t('自检中…') : t('立即自检') }}</button>
            </view>
          </view>

          <!-- 定期自检：只在电脑端后台按同一套规则扫描，不产生模型费用。 -->
          <view class="mc-card">
            <view class="mc-card-head">
              <view class="mc-card-heading">
                <text class="mc-card-title">{{ t('定期自检') }}</text>
                <text class="mc-card-hint">{{ scheduleHint }}</text>
              </view>
            </view>
            <view class="mc-row" @click="openInterval">
              <text class="mc-row-label">{{ t('自检间隔') }}</text>
              <text class="mc-row-value">{{ intervalLabel }} ›</text>
            </view>
            <view class="mc-schedule-actions">
              <button
                class="btn ghost small-btn"
                :disabled="busy !== '' || !connected"
                @click="toggleSchedule"
              >{{ enabled ? t('关闭定期自检') : t('开启定期自检') }}</button>
            </view>
            <text class="mc-meta">{{ metaText }}</text>
            <text v-if="historyCount > 0" class="mc-meta">
              {{ t('历史报告 {v1} 份', { v1: historyCount }) }}
            </text>
          </view>

          <!-- 风险清单：疑似凭据等条目固定人工处理，不能勾选交给会话。 -->
          <view class="mc-card">
            <view class="mc-card-head">
              <view class="mc-card-heading">
                <text class="mc-card-title">{{ t('风险点与建议') }}</text>
                <text class="mc-card-hint">{{ riskHint }}</text>
              </view>
              <text
                v-if="report && pickableRisks.length"
                class="mc-head-action"
                :class="{ disabled: busy !== '' }"
                @click="toggleAllRisks"
              >{{ allRisksPicked ? t('清空') : t('全选可优化项') }}</text>
            </view>

            <view v-if="acceptedSession" class="mc-accepted">
              <text class="mc-accepted-text">
                {{ queued
                  ? t('已创建修复会话，优化清单在会话队列里：配置模型后发送即可。')
                  : t('已创建修复会话，正在切换过去。') }}
              </text>
              <text class="mc-link" @click="openAcceptedSession">{{ t('打开会话') }}</text>
            </view>

            <view v-if="!report" class="mc-empty-inline">
              {{ t('还没有自检报告。点「立即自检」生成第一份。') }}
            </view>
            <view v-else-if="!reportRisks.length" class="mc-empty-inline">
              {{ t('没有发现风险点。') }}
            </view>
            <view v-else class="mc-risk-list">
              <view
                v-for="risk in reportRisks"
                :key="risk.id"
                class="mc-risk"
                :class="{ picked: isRiskPicked(risk.id), manual: risk.manual }"
                @click="toggleRisk(risk)"
              >
                <view class="mc-risk-head">
                  <view class="mc-check" :class="{ on: isRiskPicked(risk.id), disabled: risk.manual }">
                    <text v-if="isRiskPicked(risk.id)" class="mc-check-mark">✓</text>
                  </view>
                  <text class="mc-severity" :class="risk.severity">{{ severityLabel(risk.severity) }}</text>
                  <text class="mc-risk-title">{{ risk.title }}</text>
                </view>
                <text class="mc-risk-meta">{{ ruleLabel(risk.rule) }} · {{ risk.moduleName }}</text>
                <text class="mc-risk-detail">{{ risk.detail }}</text>
                <text class="mc-risk-fix">
                  <text class="mc-risk-fix-label">{{ t('建议') }}</text>{{ risk.recommendation }}
                </text>
                <view v-if="risk.evidence && risk.evidence.length" class="mc-evidence">
                  <text
                    v-for="item in risk.evidence"
                    :key="item"
                    class="mc-evidence-item"
                    user-select
                  >{{ item }}</text>
                </view>
                <text v-if="risk.manual" class="mc-manual">
                  {{ t('该项已标记为人工处理，自检不会自动修改。') }}
                </text>
              </view>
            </view>

            <text v-if="report && riskTotal > reportRisks.length" class="mc-note">
              {{ t('仅显示前 {v1} 项，共 {v2} 项；完整报告请在电脑端查看。', { v1: reportRisks.length, v2: riskTotal }) }}
            </text>
            <text v-if="manualCount > 0" class="mc-note">
              {{ t('显示的条目里有 {v1} 项需要人工处理（例如疑似凭据），自检不会把它们交给会话自动修改。', { v1: manualCount }) }}
            </text>
            <text v-if="lastDecision" class="mc-note">
              {{ lastDecision.sessionId
                ? t('最近一次确认：{v1}（会话 {v2}）', { v1: formatWhen(lastDecision.at), v2: lastDecision.sessionId })
                : t('最近一次确认：{v1}（只生成提案，未建会话）', { v1: formatWhen(lastDecision.at) }) }}
            </text>

            <view v-if="proposalId && !acceptedSession" class="mc-accepted">
              <text class="mc-accepted-text">
                {{ t('已生成改造提案（{v1}），未修改任何文件。', { v1: proposalId }) }}
              </text>
            </view>

            <view v-if="latestProposal" class="mc-proposal">
              <view class="mc-proposal-head" @click="proposalOpen = !proposalOpen">
                <text class="mc-proposal-title">{{ t('改造提案预览') }}</text>
                <text class="mc-proposal-meta">
                  {{ t('{v1} 项建议 · {v2}', { v1: latestProposal.riskIds.length, v2: formatWhen(latestProposal.createdAt) }) }}
                </text>
                <text class="mc-link">{{ proposalOpen ? t('收起') : t('展开') }}</text>
              </view>
              <text class="mc-note">
                {{ t('提案只是文字清单，生成它不会修改任何文件；勾选「自改源码」才会交给编码会话执行。') }}
              </text>
              <text v-if="latestProposal.refreshedAt" class="mc-note">
                {{ t('自改会话结束后已重跑自检，提案按最新报告刷新。') }}
              </text>
              <text v-if="proposalOpen" class="mc-proposal-body" user-select>{{ latestProposal.prompt }}</text>
              <text v-if="proposalOpen && latestProposal.promptTruncated" class="mc-note">
                {{ t('手机上只显示提案开头，完整内容请在电脑端查看。') }}
              </text>
            </view>

            <view v-if="picked.length" class="mc-accept-bar">
              <text class="mc-accept-count">{{ t('已选 {v1} 项', { v1: picked.length }) }}</text>
              <button
                class="btn primary small-btn"
                :disabled="busy !== '' || !report"
                @click="askAccept"
              >{{ busy === 'accept'
                ? t('正在处理…')
                : (selfModify
                  ? t('自改源码（{v1}）', { v1: picked.length })
                  : t('生成提案（{v1}）', { v1: picked.length })) }}</button>
            </view>

            <view
              v-if="picked.length"
              class="mc-selfmodify"
              :class="{ on: selfModify }"
              @click="toggleSelfModify"
            >
              <view class="mc-check" :class="{ on: selfModify }">
                <text v-if="selfModify" class="mc-check-mark">✓</text>
              </view>
              <text class="mc-selfmodify-text">
                {{ selfModify
                  ? t('已允许自改：会创建编码会话，真的修改源码。')
                  : t('自改源码（默认关闭）：不勾选只生成提案，不改任何文件。') }}
              </text>
            </view>
          </view>
        </template>
      </view>
    </scroll-view>

    <app-picker
      :visible="intervalOpen"
      :title="t('自检间隔')"
      :subtitle="t('定期自检使用的间隔；打开或关闭后会立即保存。')"
      :options="intervalOptions"
      :value="intervalIndex"
      @select="onIntervalPicked"
      @close="intervalOpen = false"
    />

    <app-dialog
      :visible="acceptOpen"
      :title="selfModify ? t('创建修复会话？') : t('生成改造提案？')"
      :message="acceptMessage"
      :cancel-text="t('取消')"
      :confirm-text="selfModify ? t('创建会话') : t('生成提案')"
      :busy="busy === 'accept'"
      @confirm="confirmAccept"
      @close="acceptOpen = false"
    />
  </view>
</template>

<script>
import AppDialog from '../../components/app-dialog/app-dialog.vue'
import AppPicker from '../../components/app-picker/app-picker.vue'
import { t } from '../../lib/i18n.js'
import {
  acceptModuleCheck,
  discoverModuleCheckModules,
  init,
  loadModuleCheckState,
  onAppShow,
  runModuleCheck,
  saveModuleCheckSettings,
  selectSession,
  store
} from '../../store/index.js'

const INTERVAL_CHOICES = [6, 12, 24, 72, 168]

export default {
  components: { AppDialog, AppPicker },
  data() {
    return {
      // 初始不能是 true：load() 用 loading 防止重复请求，初值为 true 会让
      // 首次进入页面直接返回，界面一直停在「读取中」。
      loading: false,
      // 模块发现要遍历工作区，和状态读取分开，先显示报告再补模块列表。
      discovering: false,
      busy: '',
      error: '',
      state: null,
      modules: [],
      workspacePath: '',
      selected: [],
      picked: [],
      acceptedSession: '',
      proposalId: '',
      proposalOpen: false,
      selfModify: false,
      queued: false,
      intervalOpen: false,
      acceptOpen: false
    }
  },
  computed: {
    store() {
      return store
    },
    connected() {
      return store.connectionState === 'connected'
    },
    report() {
      const report = this.state?.lastReport
      return report && typeof report === 'object' ? report : null
    },
    reportRisks() {
      return Array.isArray(this.report?.risks) ? this.report.risks : []
    },
    riskTotal() {
      const total = Number(this.report?.riskTotal)
      return Number.isFinite(total) && total >= 0 ? total : this.reportRisks.length
    },
    riskCounts() {
      const counts = this.report?.riskCounts
      if (counts && typeof counts === 'object') {
        return {
          high: Number(counts.high) || 0,
          medium: Number(counts.medium) || 0,
          low: Number(counts.low) || 0
        }
      }
      const fallback = { high: 0, medium: 0, low: 0 }
      for (const risk of this.reportRisks) {
        if (risk.severity === 'high') fallback.high += 1
        else if (risk.severity === 'medium') fallback.medium += 1
        else fallback.low += 1
      }
      return fallback
    },
    pickableRisks() {
      return this.reportRisks.filter((risk) => !risk.manual)
    },
    manualCount() {
      return this.reportRisks.length - this.pickableRisks.length
    },
    allRisksPicked() {
      return Boolean(this.pickableRisks.length) && this.picked.length === this.pickableRisks.length
    },
    enabled() {
      return this.state?.settings?.enabled === true
    },
    intervalHours() {
      const hours = Number(this.state?.settings?.intervalHours)
      // Desktop settings can be written by the protocol with any 1..720 value;
      // show the real interval instead of pretending it is the 24h default.
      return Number.isFinite(hours) && hours > 0 ? hours : 24
    },
    intervalIndex() {
      return INTERVAL_CHOICES.indexOf(this.intervalHours)
    },
    intervalOptions() {
      return INTERVAL_CHOICES.map((hours) => ({ label: this.intervalText(hours) }))
    },
    intervalLabel() {
      return this.intervalText(this.intervalHours)
    },
    historyCount() {
      return Number(this.state?.historyCount) || 0
    },
    allSelected() {
      return Boolean(this.modules.length) && this.selected.length === this.modules.length
    },
    workspaceName() {
      const path = String(
        this.workspacePath ||
          this.report?.workspace ||
          store.currentSession?.workspacePath ||
          store.roots?.[0] ||
          ''
      ).replace(/[\\/]+$/, '')
      const parts = path.split(/[\\/]/).filter(Boolean)
      return parts[parts.length - 1] || ''
    },
    workspaceLabel() {
      // 自检固定扫内置源码：副标题写实际目录��不再看当前工作区。
      return this.workspaceName || t('内置源码')
    },
    moduleHint() {
      if (this.discovering && !this.modules.length) return t('正在发现模块…')
      return `${t('勾选要参与的模块；不勾选时默认自检全部。')} ${t('共 {v1} 个模块，已选 {v2} 个。', { v1: this.modules.length, v2: this.selected.length })}`
    },
    scheduleHint() {
      if (this.enabled) return t('已开启 · 下次 {v1}', { v1: this.formatWhen(this.state?.nextRunAt) })
      return t('关闭时只在手动点击时扫描。开启后按间隔在后台用同一套规则扫描已选模块。')
    },
    metaText() {
      const report = this.report
      const parts = [t('上次自检：{v1}', { v1: this.formatWhen(this.state?.lastRunAt) })]
      if (report) {
        parts.push(t('扫描 {v1} 个文件 / {v2} 行', { v1: report.scannedFiles, v2: report.scannedLines }))
        parts.push(t('触发方式：{v1}', { v1: report.trigger === 'schedule' ? t('定期') : t('手动') }))
      }
      return parts.join(' · ')
    },
    riskHint() {
      if (!this.report) return t('还没有自检报告。点「立即自检」生成第一份。')
      return t('高 {v1} · 中 {v2} · 低 {v3}。勾选条目后默认只生成提案；要真改源码再打开「自改源码」。', {
        v1: this.riskCounts.high,
        v2: this.riskCounts.medium,
        v3: this.riskCounts.low
      })
    },
    lastDecision() {
      const decisions = this.state?.decisions
      return Array.isArray(decisions) && decisions.length ? decisions[0] : null
    },
    latestProposal() {
      const proposals = this.state?.proposals
      return Array.isArray(proposals) && proposals.length ? proposals[0] : null
    },
    acceptMessage() {
      // 默认只产提案；只有显式打开「自改源码」才说明会写文件。
      if (!this.selfModify) {
        return t('选中的 {v1} 项会生成一份可审阅的改造提案，不会修改任何文件。', {
          v1: this.picked.length
        })
      }
      return t('已允许自改：选中的 {v1} 项会变成新会话的首条指令，写入仍受沙箱和审批约束。', {
        v1: this.picked.length
      })
    }
  },
  onLoad() {
    init()
    void this.load()
  },
  onShow() {
    onAppShow()
  },
  onBackPress() {
    if (this.intervalOpen) {
      this.intervalOpen = false
      return true
    }
    if (this.acceptOpen) {
      this.acceptOpen = false
      return true
    }
    return false
  },
  methods: {
    back() {
      uni.navigateBack()
    },
    async load() {
      if (this.loading) return
      if (!this.connected) {
        this.error = t('电脑连接已断开，请回到会话页重连后重试')
        return
      }
      this.loading = true
      this.error = ''
      try {
        // 状态只是本地文件里的一小段数据，先读它并显示报告；模块发现要
        // 遍历整份源码，放到后面单独跑，不挡首屏。
        const state = await loadModuleCheckState()
        this.state = state || this.state
        this.workspacePath =
          state?.lastReport?.workspace || this.workspacePath
        this.applyStateSelections()
      } catch (error) {
        this.error = String(error?.message || t('读取自检状态失败')).slice(0, 160)
      } finally {
        this.loading = false
      }
      if (!this.error) void this.refreshModules()
    },
    async refreshModules() {
      if (this.discovering || !this.connected) return
      this.discovering = true
      try {
        const discovered = await discoverModuleCheckModules()
        this.modules = discovered.modules
        this.workspacePath =
          discovered.workspace || this.workspacePath
        this.applyStateSelections()
      } catch (error) {
        this.error = String(error?.message || t('读取模块列表失败')).slice(0, 160)
      } finally {
        this.discovering = false
      }
    },
    // 定期自检可能在后台替换报告；丢掉已经不存在的选择，再按模块列表
    // 恢复已配置的勾选。状态先到时模块列表还是空的，等模块回来会再算一次。
    applyStateSelections() {
      const state = this.state
      const pickable = new Set(
        (Array.isArray(state?.lastReport?.risks) ? state.lastReport.risks : [])
          .filter((risk) => risk && risk.id && !risk.manual)
          .map((risk) => risk.id)
      )
      this.picked = this.picked.filter((id) => pickable.has(id))
      const configured = Array.isArray(state?.settings?.modules)
        ? state.settings.modules.filter((id) => this.modules.some((module) => module.id === id))
        : []
      this.selected = configured.length
        ? configured
        : this.modules.map((module) => module.id)
    },
    async reloadModules() {
      if (this.busy) return
      await this.refreshModules()
    },
    toggleModule(id) {
      if (!id) return
      this.selected = this.selected.includes(id)
        ? this.selected.filter((item) => item !== id)
        : [...this.selected, id]
    },
    toggleAllModules() {
      this.selected = this.allSelected ? [] : this.modules.map((module) => module.id)
    },
    isSelected(id) {
      return this.selected.includes(id)
    },
    moduleMeta(module) {
      const parts = [
        t('{v1} 个文件 · {v2} 个源文件', {
          v1: module.files,
          v2: module.sourceFiles
        })
      ]
      if (Number(module.testFiles) > 0) {
        parts.push(t('{v1} 个测试', { v1: module.testFiles }))
      }
      return parts.join(' · ')
    },
    async runCheck() {
      if (this.busy || !this.connected) return
      this.busy = 'run'
      this.error = ''
      this.acceptedSession = ''
      // 新报告对应新的提案基准，旧提案提示不能留着。
      this.proposalId = ''
      try {
        const report = await runModuleCheck(this.selected)
        if (report) {
          this.state = {
            ...(this.state || { settings: {}, historyCount: 0, decisions: [] }),
            lastReport: report,
            lastRunAt: report.finishedAt,
            // The host keeps at most 20 reports; mirror the increment locally
            // until the next refresh returns the authoritative count.
            historyCount: Math.min((Number(this.state?.historyCount) || 0) + 1, 20)
          }
          this.picked = []
          if (Array.isArray(report.modules) && report.modules.length) {
            this.selected = report.modules
          }
        }
      } catch (error) {
        this.error = String(error?.message || t('自检失败')).slice(0, 160)
      } finally {
        this.busy = ''
      }
    },
    async changeSchedule(enabled, hours) {
      if (this.busy) return
      this.busy = 'settings'
      this.error = ''
      try {
        const next = await saveModuleCheckSettings({
          enabled,
          ...(hours === undefined ? {} : { intervalHours: hours })
        })
        if (next) this.state = next
      } catch (error) {
        this.error = String(error?.message || t('保存自检设置失败')).slice(0, 160)
      } finally {
        this.busy = ''
      }
    },
    toggleSchedule() {
      void this.changeSchedule(!this.enabled)
    },
    openInterval() {
      if (this.busy) return
      this.intervalOpen = true
    },
    onIntervalPicked(index) {
      const hours = INTERVAL_CHOICES[Number(index)]
      this.intervalOpen = false
      if (!hours || hours === this.intervalHours) return
      void this.changeSchedule(this.enabled, hours)
    },
    intervalText(hours) {
      if (hours % 24 === 0) {
        const days = hours / 24
        return days === 1 ? t('每天') : t('每 {v1} 天', { v1: days })
      }
      return t('每 {v1} 小时', { v1: hours })
    },
    isRiskPicked(id) {
      return this.picked.includes(id)
    },
    toggleRisk(risk) {
      if (!risk?.id || risk.manual) return
      this.picked = this.picked.includes(risk.id)
        ? this.picked.filter((id) => id !== risk.id)
        : [...this.picked, risk.id]
    },
    toggleAllRisks() {
      this.picked = this.allRisksPicked
        ? []
        : this.pickableRisks.map((risk) => risk.id)
    },
    askAccept() {
      if (this.busy || !this.report || !this.picked.length) return
      this.acceptOpen = true
    },
    toggleSelfModify() {
      if (this.busy) return
      this.selfModify = !this.selfModify
    },
    async confirmAccept() {
      if (this.busy === 'accept' || !this.report || !this.picked.length) return
      this.acceptOpen = false
      this.busy = 'accept'
      this.error = ''
      const selfModify = this.selfModify === true
      try {
        const result = await acceptModuleCheck(this.report.id, this.picked, selfModify)
        this.picked = []
        const next = await loadModuleCheckState()
        if (next) this.state = next
        this.proposalId = result.proposalId
        if (!selfModify) {
          // 只生提案：不建会话、不跳转，提案内容就在当前页预览。
          this.selfModify = false
          return
        }
        this.acceptedSession = result.sessionId
        this.queued = result.queued
        if (!result.sessionId) throw new Error(t('创建修复会话失败'))
        selectSession(result.sessionId)
        uni.navigateTo({
          url: `/pages/chat/index?id=${encodeURIComponent(result.sessionId)}`
        })
      } catch (error) {
        this.error = String(error?.message || t('创建修复会话失败')).slice(0, 160)
      } finally {
        this.busy = ''
      }
    },
    openAcceptedSession() {
      if (!this.acceptedSession) return
      selectSession(this.acceptedSession)
      uni.navigateTo({
        url: `/pages/chat/index?id=${encodeURIComponent(this.acceptedSession)}`
      })
    },
    severityLabel(severity) {
      if (severity === 'high') return t('高')
      if (severity === 'medium') return t('中')
      return t('低')
    },
    ruleLabel(rule) {
      switch (rule) {
        case 'oversized-file':
          return t('超大文件')
        case 'todo-backlog':
          return t('待办积压')
        case 'debug-logging':
          return t('调试输出')
        case 'missing-tests':
          return t('缺少测试')
        case 'hardcoded-path':
          return t('硬编码路径')
        case 'secret-like':
          return t('疑似凭据')
        case 'duplicate-file':
          return t('重复文件')
        case 'missing-verification-script':
          return t('缺少验证脚本')
        default:
          return String(rule || '')
      }
    },
    formatWhen(value) {
      if (!value) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '—'
      const pad = (part) => String(part).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
  }
}
</script>

<style scoped>
.module-check-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  padding: calc(var(--status-bar-height) + 20rpx) 28rpx 0;
  box-sizing: border-box;
}
.mc-header {
  flex: none;
}
.mc-topbar {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 4rpx 2rpx 14rpx;
}
.mc-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  align-self: flex-start;
  margin-top: -3rpx;
  margin-right: 2rpx;
  color: var(--accent-soft);
  flex-shrink: 0;
}
.mc-titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.mc-title {
  color: var(--text-strong);
  font-size: calc(34rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.35;
}
.mc-subtitle {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mc-refresh {
  flex: none;
  padding: 8rpx 14rpx;
  border-radius: 12rpx;
  background: var(--surface);
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
}
.mc-refresh.disabled,
.mc-head-action.disabled {
  color: var(--dim);
  opacity: 0.7;
}
.mc-intro {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 16rpx 20rpx;
  border-radius: 16rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.mc-badge {
  align-self: flex-start;
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  background: var(--accent-wash-soft);
  color: var(--accent-soft);
  font-size: calc(19rpx * var(--font-scale));
  line-height: 1.4;
}
.mc-intro-text {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.mc-stats {
  display: flex;
  gap: 10rpx;
  margin: 14rpx 0 12rpx;
}
.mc-stat {
  flex: 1;
  min-width: 0;
  padding: 12rpx 10rpx;
  border-radius: 14rpx;
  background: var(--surface);
  text-align: center;
}
.mc-stat-value {
  display: block;
  color: var(--text-strong);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.2;
}
.mc-stat-label {
  display: block;
  margin-top: 4rpx;
  color: var(--dim);
  font-size: calc(19rpx * var(--font-scale));
}
.mc-scroll {
  flex: 1;
  min-height: 0;
  width: calc(100% + 56rpx);
  margin: 0 -28rpx;
}
.mc-content {
  padding: 8rpx 28rpx calc(60rpx + env(safe-area-inset-bottom));
}
.mc-card {
  margin-bottom: 16rpx;
  padding: 20rpx 22rpx;
  border-radius: 18rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.mc-card-head {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
}
.mc-card-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.mc-card-title {
  color: var(--text-strong);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.35;
}
.mc-card-hint {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.55;
}
.mc-head-actions {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8rpx;
}
.mc-head-action {
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.4;
  padding: 4rpx 0;
}
.mc-empty,
.mc-empty-inline {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 40rpx 20rpx;
  text-align: center;
}
.mc-empty-title {
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
}
.mc-empty-hint {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.mc-empty-inline {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
  padding: 26rpx 10rpx;
}
.mc-retry {
  margin-top: 12rpx;
}
.mc-error {
  margin-bottom: 12rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: var(--stop-soft);
}
.mc-error-text {
  color: var(--stop);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.mc-module-list {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 14rpx;
}
.mc-module {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 14rpx 16rpx;
  border-radius: 14rpx;
  background: var(--surface-3);
  border: 1rpx solid transparent;
}
.mc-module.active {
  border-color: var(--accent-border, var(--accent-soft));
  background: var(--accent-wash-soft);
}
.mc-check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  border-radius: 10rpx;
  border: 2rpx solid var(--line-strong, var(--dim));
  background: var(--surface);
  box-sizing: border-box;
}
.mc-check.on {
  border-color: var(--accent-soft);
  background: var(--accent-soft);
}
.mc-check.disabled {
  opacity: 0.45;
}
.mc-check-mark {
  color: var(--accent-ink, #000000);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1;
}
.mc-module-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.mc-module-name {
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.4;
  word-break: break-all;
}
.mc-module-meta {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.45;
}
.mc-run-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 16rpx;
}
.mc-run-note {
  flex: 1;
  min-width: 0;
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
}
.mc-run-btn {
  flex: none;
}
.mc-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 14rpx;
  padding: 14rpx 16rpx;
  border-radius: 14rpx;
  background: var(--surface-3);
}
.mc-row-label {
  flex: 1;
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
}
.mc-row-value {
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
}
.mc-schedule-actions {
  display: flex;
  margin-top: 14rpx;
}
.mc-schedule-actions .btn {
  flex: 1;
}
.mc-meta {
  display: block;
  margin-top: 12rpx;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.55;
}
.mc-risk-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 14rpx;
}
.mc-risk {
  padding: 16rpx;
  border-radius: 16rpx;
  background: var(--surface-3);
  border: 1rpx solid transparent;
}
.mc-risk.picked {
  border-color: var(--accent-soft);
  background: var(--accent-wash-soft);
}
.mc-risk.manual {
  opacity: 0.88;
}
.mc-risk-head {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
}
.mc-severity {
  flex: none;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  font-size: calc(19rpx * var(--font-scale));
  line-height: 1.5;
}
.mc-severity.high {
  background: var(--stop-soft);
  color: var(--stop);
}
.mc-severity.medium {
  background: var(--pause-soft);
  color: var(--pause);
}
.mc-severity.low {
  background: var(--resume-soft);
  color: var(--resume);
}
.mc-risk-title {
  flex: 1;
  min-width: 0;
  color: var(--text-strong);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 600;
  line-height: 1.45;
  word-break: break-word;
}
.mc-risk-meta {
  display: block;
  margin-top: 8rpx;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.45;
}
.mc-risk-detail {
  display: block;
  margin-top: 8rpx;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.mc-risk-fix {
  display: block;
  margin-top: 8rpx;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.mc-risk-fix-label {
  margin-right: 8rpx;
  color: var(--accent-soft);
  font-weight: 600;
}
.mc-evidence {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  margin-top: 8rpx;
  padding: 10rpx 12rpx;
  border-radius: 10rpx;
  background: var(--input-bg);
}
.mc-evidence-item {
  color: var(--dim);
  font-family: var(--mono-font, monospace);
  font-size: calc(19rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.mc-manual {
  display: block;
  margin-top: 8rpx;
  color: var(--pause);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.5;
}
.mc-note {
  display: block;
  margin-top: 12rpx;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.55;
}
.mc-proposal {
  margin-top: 14rpx;
  padding: 14rpx;
  border-radius: 14rpx;
  border: 1rpx dashed var(--line-strong, var(--line));
  background: var(--surface);
}
.mc-proposal-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.mc-proposal-title {
  flex: none;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  font-weight: 600;
}
.mc-proposal-meta {
  flex: 1;
  min-width: 0;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.mc-proposal-body {
  display: block;
  margin-top: 10rpx;
  padding: 12rpx;
  border-radius: 10rpx;
  background: var(--surface-2, var(--surface));
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.mc-selfmodify {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  margin-top: 14rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--border);
}
.mc-selfmodify.on {
  border-color: var(--danger, var(--accent-soft));
  background: var(--danger-soft, var(--surface));
}
.mc-selfmodify-text {
  flex: 1;
  min-width: 0;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.55;
}
.mc-selfmodify.on .mc-selfmodify-text {
  color: var(--danger, var(--text));
}
.mc-accepted {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 12rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  background: var(--resume-soft);
}
.mc-accepted-text {
  flex: 1;
  min-width: 0;
  color: var(--resume);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.5;
}
.mc-link {
  flex: none;
  color: var(--accent-soft);
  font-size: calc(21rpx * var(--font-scale));
  text-decoration: underline;
}
.mc-accept-bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 16rpx;
  padding-top: 14rpx;
  border-top: 1rpx solid var(--line);
}
.mc-accept-count {
  flex: 1;
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
}
</style>
