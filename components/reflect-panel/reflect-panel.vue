<template>
  <view class="reflect-panel">
    <!-- 面板级标题：与「内视」「模块自检」「自主探索学习」同一套头部结构，
         副标题直接说明当前状态，刷新按钮有自己的热区与禁用态。 -->
    <view class="reflect-head">
      <view class="reflect-head-main">
        <text class="reflect-head-title">{{ t('反思') }}</text>
        <text class="reflect-head-sub">{{ headSubtitle }}</text>
      </view>
      <text
        class="reflect-head-action"
        :class="{ disabled: loading || !desktopOnline }"
        @click="reload"
      >{{ loading ? t('读取中…') : t('刷新') }}</text>
    </view>

    <!-- 未连接、读取中、版本过旧、出错：都收进居中空态块，
         不再用一行灰字贴在顶部，页面不会看起来像「没内容」。 -->
    <view v-if="!desktopOnline" class="reflect-empty">
      <text class="reflect-empty-title">{{ t('未连接') }}</text>
      <text class="reflect-empty-hint">{{ t('连接电脑后，可以在这里配置反思并查看报告。') }}</text>
    </view>
    <view v-else-if="loading && !settings" class="reflect-empty">
      <text class="reflect-empty-title">{{ t('读取中…') }}</text>
    </view>
    <view v-else-if="supported === false" class="reflect-empty">
      <text class="reflect-empty-title">{{ t('反思') }}</text>
      <text class="reflect-empty-hint">
        {{ t('这台电脑的 Pilot 版本较旧，不支持在手机上配置反思。请先在电脑上安装新版 Pilot。') }}
      </text>
    </view>
    <view v-else-if="error" class="reflect-error">{{ error }}</view>

    <template v-else-if="settings">
      <!-- 总开关：热区只给标题行，避免点到卡片空白处误切开关 -->
      <view class="reflect-card">
        <view class="reflect-card-head" @click="toggleEnabled">
          <view class="reflect-card-heading">
            <text class="reflect-card-title">{{ t('启用反思') }}</text>
            <text class="reflect-card-hint">
              {{ t('Pilot 定期或出错时对自己的执行过程提问：压缩漂移、存储、页面、结构、代码、效率、输出与交互。') }}
            </text>
          </view>
          <view class="reflect-toggle" :class="{ on: settings.enabled }">
            <view class="reflect-toggle-knob"></view>
          </view>
        </view>
      </view>

      <template v-if="settings.enabled">
        <!-- 触发方式：两项是独立开关（可以都开），所以用带勾选框的行而不是单选分段控件。 -->
        <view class="reflect-card">
          <text class="reflect-card-title">{{ t('触发方式') }}</text>
          <view
            class="reflect-choice"
            :class="{ active: settings.triggers.onError }"
            @click="toggleTrigger('onError')"
          >
            <text class="reflect-choice-label">{{ t('运行失败时') }}</text>
            <view class="reflect-check" :class="{ on: settings.triggers.onError }">
              <text v-if="settings.triggers.onError" class="reflect-check-mark">✓</text>
            </view>
          </view>
          <view
            class="reflect-choice"
            :class="{ active: settings.triggers.onSchedule }"
            @click="toggleTrigger('onSchedule')"
          >
            <text class="reflect-choice-label">{{ t('定时触发') }}</text>
            <view class="reflect-check" :class="{ on: settings.triggers.onSchedule }">
              <text v-if="settings.triggers.onSchedule" class="reflect-check-mark">✓</text>
            </view>
          </view>
          <text class="reflect-hint">
            {{ t('运行失败后最多每 10 分钟反思一次，连续的报错不会反复调用模型。') }}
          </text>

          <template v-if="settings.triggers.onSchedule">
            <text class="reflect-field-label sub">{{ t('定时方式') }}</text>
            <view class="reflect-segment">
              <view
                class="reflect-segment-item"
                :class="{ active: settings.scheduleMode === 'version' }"
                @click="chooseScheduleMode('version')"
              >
                <text class="reflect-segment-text">{{ t('按版本') }}</text>
              </view>
              <view
                class="reflect-segment-item"
                :class="{ active: settings.scheduleMode === 'interval' }"
                @click="chooseScheduleMode('interval')"
              >
                <text class="reflect-segment-text">{{ t('按间隔') }}</text>
              </view>
              <view
                class="reflect-segment-item"
                :class="{ active: settings.scheduleMode === 'daily' }"
                @click="chooseScheduleMode('daily')"
              >
                <text class="reflect-segment-text">{{ t('每天固定时间') }}</text>
              </view>
            </view>
            <view
              v-if="settings.scheduleMode === 'version'"
              class="reflect-row"
            >
              <text class="reflect-row-title">{{ scheduleLabel }}</text>
              <text class="reflect-row-value">{{ scheduleValue }}</text>
            </view>
            <view v-else class="reflect-row" @click="openSchedulePicker">
              <text class="reflect-row-title">{{ scheduleLabel }}</text>
              <text class="reflect-row-value">{{ scheduleValue }}</text>
              <text class="reflect-row-caret">›</text>
            </view>
            <text v-if="settings.scheduleMode === 'version'" class="reflect-hint">
              {{ t('升级到新版本后自动反思一次；版本长期不变时每 7 天兜底一次。') }}
            </text>
          </template>
        </view>

        <!-- 反思模型 -->
        <view class="reflect-card">
          <view class="reflect-row" @click="modelPickerVisible = true">
            <view class="reflect-row-main">
              <text class="reflect-row-title">{{ t('反思模型') }}</text>
              <text class="reflect-row-desc">{{ t('留空则跟随当前会话模型。') }}</text>
            </view>
            <text class="reflect-row-value">{{ modelTitle }}</text>
            <text class="reflect-row-caret">›</text>
          </view>
        </view>

        <!-- 问题域：标题行直接给出已选项数，不用自己数 -->
        <view class="reflect-card">
          <view class="reflect-card-head">
            <text class="reflect-card-title">{{ t('自问的问题域') }}</text>
            <text class="reflect-card-count">{{ t('已选 {v1} 项', { v1: activeTopicCount }) }}</text>
          </view>
          <view class="reflect-topics">
            <view
              v-for="topic in topics"
              :key="topic.id"
              class="reflect-topic"
              :class="{ active: isTopicActive(topic.id) }"
              @click="toggleTopic(topic.id)"
            >
              <text class="reflect-topic-text">{{ topic.label() }}</text>
            </view>
          </view>
          <text class="reflect-hint">{{ t('至少要保留一个问题域，否则反思没有可问的方向。') }}</text>
        </view>

        <!--
          邮件分两张卡：「邮箱配置」只答「用哪个邮箱发」——收件人、SMTP 登录名与
          发件人都是这一个地址（自己发给自己）；「通知配置」只答「哪些事发信」。
        -->
        <view class="reflect-card">
          <view class="reflect-card-head">
            <view class="reflect-card-heading">
              <text class="reflect-card-title">{{ t('邮箱配置') }}</text>
              <text class="reflect-card-hint">
                {{ t('收件人、SMTP 登录名和发件人都是这一个地址，也就是自己发给自己。') }}
              </text>
            </view>
          </view>

          <view class="reflect-field">
            <text class="reflect-field-label">{{ t('邮箱地址') }}</text>
            <input
              v-model="mail.emailTo"
              class="reflect-input"
              :placeholder="t('多个地址用逗号分隔')"
              :maxlength="320"
              @blur="guessMailPreset"
            />
            <text class="reflect-hint">
              {{ t('邮件发到这个地址，也用它登录 SMTP 和充当发件人；多个地址时只有第一个参与发信。') }}
            </text>
          </view>
          <view class="reflect-field">
            <text class="reflect-field-label">{{ t('邮箱服务商') }}</text>
            <view class="reflect-select" @click="mailPresetPickerVisible = true">
              <text class="reflect-select-text">{{ mailPresetLabel }}</text>
              <text class="reflect-select-chevron">›</text>
            </view>
            <text class="reflect-hint">
              {{ t('选常用邮箱会自动填好服务器、端口和加密方式，地址仍然自己填写；用自己的服务器就选「自定义」。') }}
            </text>
          </view>
          <view class="reflect-field">
            <text class="reflect-field-label">{{ t('SMTP 服务器') }}</text>
            <input v-model="mail.smtpHost" class="reflect-input" placeholder="smtp.163.com" :maxlength="253" />
          </view>
          <view class="reflect-field">
            <text class="reflect-field-label">{{ t('端口') }}</text>
            <input v-model="mail.smtpPort" class="reflect-input" type="number" placeholder="465" :maxlength="5" />
          </view>
          <view class="reflect-field">
            <text class="reflect-field-label">{{ t('加密方式') }}</text>
            <view class="reflect-segment compact">
              <view
                v-for="option in securityOptions"
                :key="option.value"
                class="reflect-segment-item"
                :class="{ active: mail.smtpSecurity === option.value }"
                @click="mail.smtpSecurity = option.value"
              >
                <text class="reflect-segment-text">{{ option.label }}</text>
              </view>
            </view>
          </view>
          <view class="reflect-field">
            <text class="reflect-field-label">{{ t('授权码') }}</text>
            <view class="reflect-secret">
              <input
                v-model="mail.smtpPassword"
                class="reflect-input"
                :password="!secretVisible"
                :placeholder="settings.hasPassword ? t('已保存，留空表示不修改') : t('邮箱设置里生成的授权码')"
                :maxlength="400"
              />
              <text class="reflect-secret-toggle" @click="secretVisible = !secretVisible">
                {{ secretVisible ? t('隐藏') : t('显示') }}
              </text>
            </view>
            <text class="reflect-hint">
              {{ t('授权码不是登录密码。163、QQ 等邮箱要在网页端单独开启 SMTP 并生成授权码。') }}
            </text>
          </view>

          <view class="reflect-actions">
            <button class="btn ghost small-btn" :disabled="busy" @click="saveMail">
              {{ saving ? t('保存中…') : t('保存邮箱配置') }}
            </button>
            <button class="btn ghost small-btn" :disabled="busy" @click="sendTestMail">
              {{ t('发送测试邮件') }}
            </button>
          </view>
          <text v-if="mailHint.text" class="reflect-hint" :class="mailHint.kind">{{ mailHint.text }}</text>
        </view>

        <!-- 通知配置：所有邮件通知集中在这里，开启就发、关闭就不发，顺序即推荐优先级。 -->
        <view class="reflect-card">
          <view class="reflect-card-head" @click="toggleNotifyEnabled">
            <view class="reflect-card-heading">
              <text class="reflect-card-title">{{ t('通知配置') }}</text>
              <text class="reflect-card-hint">
                {{ t('开启就通知，关闭就不通知；列表按推荐优先级排序。') }}
              </text>
            </view>
            <view class="reflect-toggle" :class="{ on: settings.notifyEmailEnabled }">
              <view class="reflect-toggle-knob"></view>
            </view>
          </view>

          <template v-if="notifyCatalog.length">
            <view
              v-for="(entry, index) in notifyCatalog"
              :key="entry.id"
              class="reflect-choice"
              :class="{ active: isNotifyOn(entry.id), disabled: !settings.notifyEmailEnabled }"
              @click="toggleNotifyEvent(entry.id)"
            >
              <view class="reflect-choice-main">
                <text class="reflect-choice-label">{{ index + 1 }}. {{ notifyLabel(entry) }}</text>
                <text class="reflect-choice-desc">{{ notifyHint(entry) }}</text>
              </view>
              <view class="reflect-check" :class="{ on: isNotifyOn(entry.id) }">
                <text v-if="isNotifyOn(entry.id)" class="reflect-check-mark">✓</text>
              </view>
            </view>
            <text class="reflect-hint">
              {{ t('共 {v1} 类通知，已选 {v2} 类。未勾选的事件不会发信。', { v1: String(notifyCatalog.length), v2: String(settings.notifyEmailEvents.length) }) }}
            </text>
          </template>
          <text v-else class="reflect-hint">
            {{ t('这台电脑的 Pilot 版本较旧，请在电脑端的「邮箱配置 → 通知配置」里设置。') }}
          </text>
        </view>

        <!-- 报告 -->
        <view class="reflect-card">
          <view class="reflect-card-head">
            <view class="reflect-card-heading">
              <text class="reflect-card-title">{{ t('反思报告') }}</text>
              <text class="reflect-card-hint">
                {{ settings.lastRunAt ? t('上次反思：{v1}', { v1: timeText(settings.lastRunAt) }) : t('还没有跑过反思。') }}
              </text>
            </view>
          </view>
          <view class="reflect-actions">
            <button class="btn ghost small-btn" :disabled="busy || running" @click="runNow">
              {{ running ? t('反思进行中…') : t('立即反思') }}
            </button>
            <button
              class="btn ghost small-btn"
              :disabled="busy || running || reports.length === 0"
              @click="clearReports"
            >
              {{ t('清除报告') }}
            </button>
          </view>

          <view v-if="reports.length === 0" class="reflect-empty-inline">
            <text class="reflect-hint">
              {{ t('手动触发一次，或在电脑上等它到点自动跑。') }}
            </text>
          </view>
          <view
            v-for="report in reports"
            :key="report.id"
            class="reflect-report"
            @click="openReport(report.id)"
          >
            <view class="reflect-report-head">
              <text class="reflect-report-trigger">{{ triggerLabel(report.trigger) }}</text>
              <text class="reflect-report-time">{{ timeText(report.createdAt) }}</text>
              <text class="reflect-row-caret">›</text>
            </view>
            <text class="reflect-report-summary">{{ report.summary || t('（无摘要）') }}</text>
            <view class="reflect-report-meta">
              <text class="reflect-report-count">{{ t('{v1} 条发现', { v1: report.findings }) }}</text>
              <text v-if="report.severity.high" class="reflect-sev high">
                {{ t('高 {v1}', { v1: report.severity.high }) }}
              </text>
              <text v-if="report.severity.medium" class="reflect-sev medium">
                {{ t('中 {v1}', { v1: report.severity.medium }) }}
              </text>
              <text v-if="report.severity.low" class="reflect-sev low">
                {{ t('低 {v1}', { v1: report.severity.low }) }}
              </text>
              <text v-if="report.email" class="reflect-report-mail">
                {{ report.email.sent ? t('已发送邮件') : t('邮件未发出') }}
              </text>
            </view>
          </view>
          <text v-if="reportTotal > reports.length" class="reflect-hint">
            {{ t('只显示最近 {v1} 份，电脑端能看到全部 {v2} 份。', { v1: reports.length, v2: reportTotal }) }}
          </text>
        </view>
      </template>
    </template>

    <app-picker
      :visible="modelPickerVisible"
      :title="t('反思模型')"
      :subtitle="t('留空则跟随当前会话模型')"
      :options="modelPickerOptions"
      :value="modelPickerIndex"
      :empty-text="modelsLoading ? t('读取中…') : t('还没有可用的模型资源')"
      @select="onModelPick"
      @close="modelPickerVisible = false"
    />

    <app-picker
      :visible="mailPresetPickerVisible"
      :title="t('邮箱服务商')"
      :subtitle="t('选好后可以继续改服务器和端口；地址照常自己填。')"
      :options="mailPresetOptions"
      :value="mailPresetIndex"
      @select="onMailPresetPick"
      @close="mailPresetPickerVisible = false"
    />

    <app-picker
      :visible="intervalPickerVisible"
      :title="t('反思间隔')"
      :subtitle="t('最短 30 分钟，最长 7 天')"
      :options="intervalOptions"
      :value="intervalIndex"
      @select="onIntervalPick"
      @close="intervalPickerVisible = false"
    />

    <app-time-sheet
      :visible="timeSheetVisible"
      :title="t('每天反思时间')"
      :subtitle="t('只在电脑开着的时候触发')"
      :value="dailyTime"
      @confirm="onTimePick"
      @close="timeSheetVisible = false"
    />

    <app-sheet :visible="!!detailReport" :title="t('反思详情')" tall @close="closeDetail">
      <!-- 报告长度不可控：必须给 sheet body 一个能滚的容器，否则超出 82vh 的部分会被裁掉。 -->
      <scroll-view v-if="detailReport" scroll-y class="reflect-detail-scroll" :show-scrollbar="false">
        <view class="reflect-report-head">
          <text class="reflect-report-trigger">{{ triggerLabel(detailReport.trigger) }}</text>
          <text class="reflect-report-time">{{ timeText(detailReport.createdAt) }}</text>
        </view>
        <text class="reflect-detail-summary">{{ detailReport.summary || t('（无摘要）') }}</text>
        <!-- 证据不足而没问的域：不写出来，用户只会看到「只问了 2 个域」而不知道为何。 -->
        <text v-if="skippedText" class="reflect-detail-skipped">{{ skippedText }}</text>
        <text class="reflect-detail-meta">
          {{ t('模型：{v1} · 用时 {v2} 秒', { v1: detailReport.model || t('未记录'), v2: secondsText(detailReport.durationMs) }) }}
        </text>
        <view v-for="(finding, index) in detailReport.findings" :key="finding.id || index" class="reflect-finding">
          <view class="reflect-finding-head">
            <text class="reflect-sev" :class="finding.severity">{{ severityLabel(finding.severity) }}</text>
            <text class="reflect-finding-topic">{{ topicLabel(finding.topic) }}</text>
            <text v-if="findingStatusLabel(finding)" class="reflect-finding-status" :class="finding.status || 'open'">
              {{ findingStatusLabel(finding) }}
            </text>
          </view>
          <text class="reflect-finding-observation">{{ finding.observation }}</text>
          <text class="reflect-finding-suggestion">
            {{ t('建议：{v1}', { v1: finding.suggestion }) }}
          </text>
          <!-- 代码位置：结论指向哪个文件哪一行，手机上也要能核对。 -->
          <text
            v-for="(ref, refIndex) in finding.refs || []"
            :key="`${finding.id || index}-ref-${refIndex}`"
            class="reflect-finding-ref"
          >
            {{ refLabel(ref) }}
          </text>
          <view class="reflect-finding-actions">
            <text
              v-for="option in FINDING_STATUS_OPTIONS"
              :key="option.id"
              class="reflect-status-btn"
              :class="{ active: (finding.status || 'open') === option.id }"
              @click="markFinding(finding, option.id)"
            >
              {{ option.label() }}
            </text>
          </view>
        </view>
        <text v-if="detailReport.evidence" class="reflect-evidence">{{ detailReport.evidence }}</text>
        <view class="reflect-detail-tail"></view>
      </scroll-view>
    </app-sheet>

    <app-dialog-host />
  </view>
</template>

<script>
import AppDialogHost from '../app-dialog-host/app-dialog-host.vue'
import AppPicker from '../app-picker/app-picker.vue'
import AppSheet from '../app-sheet/app-sheet.vue'
import AppTimeSheet from '../app-time-sheet/app-time-sheet.vue'
import { getLocale, t } from '../../lib/i18n.js'
import {
  clearReflectReports,
  closeReflectReport,
  loadReflect,
  loadReflectReport,
  runReflectNow,
  saveReflectSettings,
  sendReflectTestMail,
  setReflectFindingStatus,
  store
} from '../../store/index.js'

/**
 * 问题域目录与电脑端 `src/shared/reflect.ts` 的 REFLECTION_TOPICS 同序同名。
 * 手机端不打包桌面源码，这份表是唯一副本，改一处就要同时改另一处（有测试守着）。
 */
export const REFLECT_TOPICS = [
  { id: 'compaction-drift', label: () => t('会话压缩漂移') },
  { id: 'storage-performance', label: () => t('存储性能') },
  { id: 'page-design', label: () => t('页面设计合理性') },
  { id: 'project-structure', label: () => t('项目结构合理性') },
  { id: 'code-quality', label: () => t('代码优化') },
  { id: 'execution-efficiency', label: () => t('执行效率') },
  { id: 'output-quality', label: () => t('输出质量') },
  { id: 'interaction-experience', label: () => t('交互体验') }
]

/**
 * 标签全部写成 `() => t('…')` 而不是字符串：i18n 测试用字面量扫描
 * `t('…')` 来保证英文词典不漏不多，而且切换语言后要能当场重算。
 */
const TRIGGER_LABELS = {
  manual: () => t('手动触发'),
  error: () => t('运行失败触发'),
  schedule: () => t('定时触发')
}

const SEVERITY_LABELS = { high: () => t('高'), medium: () => t('中'), low: () => t('低') }

/**
 * 类别与电脑端 REFLECTION_EVIDENCE_LABELS 同序同名：
 * 报告里「跳过某个域」要说明缺的是哪类证据。
 */
export const REFLECT_EVIDENCE_LABELS = [
  { id: 'runs', label: () => t('运行记录（步数 / token / 失败）') },
  { id: 'timing', label: () => t('阶段耗时与审批等待') },
  { id: 'outcomes', label: () => t('用户评分或校验结果') },
  { id: 'compaction', label: () => t('上下文压缩痕迹') },
  { id: 'storage', label: () => t('本地存储体积') },
  { id: 'code', label: () => t('自检代码事实') },
  { id: 'ui', label: () => t('界面事实（组件规模 / 界面反馈）') }
]

/** 结论三态，与电脑端 `ReflectionFindingStatus` 一致；open 是默认值。 */
export const FINDING_STATUS_OPTIONS = [
  { id: 'open', label: () => t('待处理') },
  { id: 'done', label: () => t('已处理') },
  { id: 'dismissed', label: () => t('不打算做') }
]

/** 与电脑端 REFLECTION_INTERVAL_MIN/MAX 对齐：30 分钟到 7 天。 */
export const REFLECT_INTERVALS = [
  { minutes: 30, label: () => t('30 分钟') },
  { minutes: 60, label: () => t('1 小时') },
  { minutes: 120, label: () => t('2 小时') },
  { minutes: 240, label: () => t('4 小时') },
  { minutes: 360, label: () => t('6 小时') },
  { minutes: 720, label: () => t('12 小时') },
  { minutes: 1440, label: () => t('1 天') },
  { minutes: 2880, label: () => t('2 天') },
  { minutes: 4320, label: () => t('3 天') },
  { minutes: 7200, label: () => t('5 天') },
  { minutes: 10080, label: () => t('7 天') }
]

/** 电脑端默认间隔是 12 小时，这里作为「找不到匹配项」时的落点。 */
const DEFAULT_INTERVAL_INDEX = 5

/** 服务器预设按当前语言取名：品牌名不翻成中文以外的东西，只有中文名需要翻译。 */
const localized = (zh, en) => (getLocale() === 'en' ? en : zh)

/**
 * 常用邮箱服务商，与电脑端 `src/shared/mail-presets.ts` 的 MAIL_PRESETS 同序同 host。
 * 域名只用来按地址自动识别服务商；地址本身始终由用户自己填。
 */
export const MAIL_PRESETS = [
  {
    id: '163',
    label: () => localized('网易 163 邮箱', 'NetEase 163 Mail'),
    domains: ['163.com'],
    host: 'smtp.163.com',
    port: 465,
    security: 'tls'
  },
  {
    id: '126',
    label: () => localized('网易 126 邮箱', 'NetEase 126 Mail'),
    domains: ['126.com'],
    host: 'smtp.126.com',
    port: 465,
    security: 'tls'
  },
  {
    id: 'yeah',
    label: () => localized('网易 yeah.net', 'NetEase yeah.net'),
    domains: ['yeah.net'],
    host: 'smtp.yeah.net',
    port: 465,
    security: 'tls'
  },
  {
    id: 'qq',
    label: () => localized('QQ 邮箱 / Foxmail', 'QQ Mail / Foxmail'),
    domains: ['qq.com', 'foxmail.com'],
    host: 'smtp.qq.com',
    port: 465,
    security: 'tls'
  },
  {
    id: 'exmail',
    label: () => localized('腾讯企业邮', 'Tencent Exmail'),
    domains: [],
    host: 'smtp.exmail.qq.com',
    port: 465,
    security: 'tls'
  },
  {
    id: 'sina',
    label: () => localized('新浪邮箱', 'Sina Mail'),
    domains: ['sina.com', 'sina.cn'],
    host: 'smtp.sina.com',
    port: 465,
    security: 'tls'
  },
  {
    id: '139',
    label: () => localized('中国移动 139 邮箱', 'China Mobile 139 Mail'),
    domains: ['139.com'],
    host: 'smtp.139.com',
    port: 465,
    security: 'tls'
  },
  {
    id: '189',
    label: () => localized('中国电信 189 邮箱', 'China Telecom 189 Mail'),
    domains: ['189.cn'],
    host: 'smtp.189.cn',
    port: 465,
    security: 'tls'
  },
  {
    id: 'gmail',
    label: () => 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    host: 'smtp.gmail.com',
    port: 465,
    security: 'tls'
  },
  {
    id: 'outlook',
    label: () => 'Outlook / Hotmail',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    host: 'smtp-mail.outlook.com',
    port: 587,
    security: 'starttls'
  },
  {
    id: 'icloud',
    label: () => localized('iCloud 邮箱', 'iCloud Mail'),
    domains: ['icloud.com', 'me.com', 'mac.com'],
    host: 'smtp.mail.me.com',
    port: 587,
    security: 'starttls'
  },
  {
    id: 'yahoo',
    label: () => localized('Yahoo 邮箱', 'Yahoo Mail'),
    domains: ['yahoo.com', 'ymail.com'],
    host: 'smtp.mail.yahoo.com',
    port: 465,
    security: 'tls'
  },
  {
    id: 'zoho',
    label: () => localized('Zoho 邮箱', 'Zoho Mail'),
    domains: ['zoho.com', 'zohomail.com'],
    host: 'smtp.zoho.com',
    port: 465,
    security: 'tls'
  },
  {
    id: 'yandex',
    label: () => localized('Yandex 邮箱', 'Yandex Mail'),
    domains: ['yandex.com', 'yandex.ru'],
    host: 'smtp.yandex.com',
    port: 465,
    security: 'tls'
  },
  {
    id: 'gmx',
    label: () => localized('GMX 邮箱', 'GMX Mail'),
    domains: ['gmx.com', 'gmx.net'],
    host: 'smtp.gmx.com',
    port: 465,
    security: 'tls'
  }
]

/** 第一个地址的域名（小写、去首尾点）：多收件人时只看它以识别服务商。 */
const mailDomainOf = (address) => {
  const first = String(address || '').split(/[,;]/)[0].trim()
  const at = first.lastIndexOf('@')
  return at < 0 ? '' : first.slice(at + 1).trim().toLowerCase().replace(/^\.+|\.+$/g, '')
}

const matchPresetByEmail = (address) => {
  const domain = mailDomainOf(address)
  if (!domain) return null
  return (
    MAIL_PRESETS.find((preset) =>
      preset.domains.some((entry) => domain === entry || domain.endsWith(`.${entry}`))
    ) || null
  )
}

const matchPresetByHost = (host) => {
  const normalized = String(host || '').trim().toLowerCase()
  if (!normalized) return null
  return MAIL_PRESETS.find((preset) => preset.host === normalized) || null
}

const EMPTY_MAIL = {
  emailTo: '',
  smtpHost: '',
  smtpPort: '465',
  smtpSecurity: 'tls',
  smtpPassword: ''
}

export default {
  name: 'ReflectPanel',
  components: { AppDialogHost, AppPicker, AppSheet, AppTimeSheet },
  props: {
    desktopOnline: { type: Boolean, default: false },
    /** 模型资源由设置页的模型分区统一提供，这里不再单独请求 models.state。 */
    modelOptions: { type: Array, default: () => [] },
    modelsLoading: { type: Boolean, default: false }
  },
  data() {
    return {
      topics: REFLECT_TOPICS,
      mail: { ...EMPTY_MAIL },
      secretVisible: false,
      mailHint: { text: '', kind: '' },
      modelPickerVisible: false,
      intervalPickerVisible: false,
      mailPresetPickerVisible: false,
      timeSheetVisible: false,
      detailReport: null,
      // 三态标记正在提交：避免连点把同一个请求排队。
      statusSaving: false
    }
  },
  computed: {
    settings() {
      return store.reflect?.settings || null
    },
    loading() {
      return store.reflectLoading
    },
    supported() {
      return store.reflectSupported
    },
    error() {
      return store.reflectError
    },
    busy() {
      return !!store.reflectAction
    },
    saving() {
      return store.reflectAction === 'saving'
    },
    running() {
      return store.reflect?.running === true
    },
    /** 通知项目录由电脑端下发（含中英文与提示），旧版电脑端没有时为空数组。 */
    notifyCatalog() {
      const list = this.settings?.notifyCatalog
      return Array.isArray(list) ? list : []
    },
    activeNotifyEvents() {
      const list = this.settings?.notifyEmailEvents
      return Array.isArray(list) ? list : []
    },
    reports() {
      return Array.isArray(store.reflect?.reports) ? store.reflect.reports : []
    },
    reportTotal() {
      return Number(store.reflect?.reportTotal) || 0
    },
    /** 面板副标题：连接、开关与上次运行状态一眼可见，不用再往下滑去找。 */
    headSubtitle() {
      if (!this.desktopOnline) return t('未连接')
      if (!this.settings) return ''
      if (!this.settings.enabled) return t('未启用')
      return this.settings.lastRunAt
        ? t('上次反思：{v1}', { v1: this.timeText(this.settings.lastRunAt) })
        : t('还没有跑过反思。')
    },
    activeTopicCount() {
      return this.topics.filter((topic) => this.isTopicActive(topic.id)).length
    },
    securityOptions() {
      return [
        { value: 'tls', label: t('SSL/TLS') },
        { value: 'starttls', label: 'STARTTLS' },
        { value: 'none', label: t('不加密') }
      ]
    },
    /** 「跟随会话模型」永远占第 0 项，值用空串表示。 */
    modelPickerOptions() {
      const options = [{ label: t('跟随会话模型'), hint: '' }]
      for (const option of this.modelOptions || []) {
        options.push({
          label: String(option.title || option.label || option.id || ''),
          hint: option.hint ? String(option.hint) : ''
        })
      }
      return options
    },
    modelPickerIndex() {
      const id = this.settings?.modelId || ''
      if (!id) return 0
      const index = (this.modelOptions || []).findIndex((option) => option.id === id)
      return index < 0 ? 0 : index + 1
    },
    modelTitle() {
      const id = this.settings?.modelId || ''
      if (!id) return t('跟随会话模型')
      const hit = (this.modelOptions || []).find((option) => option.id === id)
      return hit ? String(hit.title || hit.label || hit.id) : t('跟随会话模型')
    },
    intervalOptions() {
      return REFLECT_INTERVALS.map((choice) => ({ label: choice.label(), hint: '' }))
    },
    /** 「自定义」永远排在最后一项：用户自己填服务器时下拉停在这里。 */
    mailPresetOptions() {
      return [
        ...MAIL_PRESETS.map((preset) => ({
          label: preset.label(),
          hint: `${preset.host}:${preset.port}`
        })),
        { label: t('自定义'), hint: t('自己填服务器地址') }
      ]
    },
    mailPresetIndex() {
      const host = String(this.mail.smtpHost || '').trim().toLowerCase()
      const index = MAIL_PRESETS.findIndex((preset) => preset.host === host)
      return index < 0 ? MAIL_PRESETS.length : index
    },
    mailPresetLabel() {
      return this.mailPresetOptions[this.mailPresetIndex]?.label || t('自定义')
    },
    intervalIndex() {
      const minutes = Number(this.settings?.intervalMinutes) || 720
      const index = REFLECT_INTERVALS.findIndex((choice) => choice.minutes === minutes)
      return index < 0 ? DEFAULT_INTERVAL_INDEX : index
    },
    dailyTime() {
      return this.settings?.dailyTime || '09:00'
    },
    scheduleLabel() {
      if (this.settings?.scheduleMode === 'version') return t('版本基线')
      return this.settings?.scheduleMode === 'daily' ? t('每天时间') : t('间隔')
    },
    scheduleValue() {
      if (!this.settings) return ''
      if (this.settings.scheduleMode === 'version') {
        return this.settings.lastVersion
          ? t('上次反思 v{v1}', { v1: this.settings.lastVersion })
          : t('还没有基线')
      }
      if (this.settings.scheduleMode === 'daily') return this.dailyTime
      const minutes = Number(this.settings.intervalMinutes) || 720
      const hit = REFLECT_INTERVALS.find((choice) => choice.minutes === minutes)
      return hit ? hit.label() : t('{v1} 分钟', { v1: minutes })
    }
  },
  mounted() {
    this.syncMailDraft()
    if (this.desktopOnline) void loadReflect().then(() => this.syncMailDraft())
  },
  methods: {
    applyMailPreset(preset) {
      this.mail = {
        ...this.mail,
        smtpHost: preset.host,
        smtpPort: String(preset.port),
        smtpSecurity: preset.security
      }
    },
    onMailPresetPick(index) {
      this.mailPresetPickerVisible = false
      const preset = MAIL_PRESETS[Number(index)]
      if (preset) {
        this.applyMailPreset(preset)
        return
      }
      // 「自定义」：清空服务器地址，否则下拉会立刻又跳回刚选的预设，看起来像没生效。
      this.mail = { ...this.mail, smtpHost: '', smtpPort: '465', smtpSecurity: 'tls' }
    },
    /**
     * 填完地址顺手把服务器带出来。只在服务器还空着、或当前值本来就等于另一个预设时
     * 才跟随：用户手写的自有服务器不能被一次失焦覆盖。
     */
    guessMailPreset() {
      const preset = matchPresetByEmail(this.mail.emailTo)
      if (!preset) return
      if (this.mail.smtpHost.trim() && !matchPresetByHost(this.mail.smtpHost)) return
      this.applyMailPreset(preset)
    },
    reload() {
      if (!this.desktopOnline || this.loading) return
      void loadReflect().then(() => this.syncMailDraft())
    },
    /**
     * 把电脑端的邮件配置灌进本地草稿。授权码只写不读——输入框永远是空值，
     * 留空即「不修改」，真的输入了才提交，避免把已保存的凭据静默清掉。
     */
    syncMailDraft() {
      const settings = this.settings
      if (!settings) return
      this.mail = {
        emailTo: settings.emailTo || '',
        smtpHost: settings.smtpHost || '',
        smtpPort: String(settings.smtpPort || 465),
        smtpSecurity: settings.smtpSecurity || 'tls',
        smtpPassword: ''
      }
      this.mailHint = { text: '', kind: '' }
    },
    toast(title) {
      try {
        uni.showToast({ title, icon: 'none' })
      } catch {
        // 测试环境没有 uni：不需要提示。
      }
    },
    /** 保存一个补丁并同步回草稿；失败时回到电脑端的真实值，别停在没生效的状态。 */
    async patch(patch) {
      try {
        await saveReflectSettings(patch)
        this.syncMailDraft()
        return true
      } catch (error) {
        this.toast(error?.message || t('保存失败'))
        await loadReflect()
        this.syncMailDraft()
        return false
      }
    },
    toggleEnabled() {
      if (this.busy || !this.settings) return
      void this.patch({ enabled: !this.settings.enabled })
    },
    toggleTrigger(key) {
      if (this.busy || !this.settings) return
      const triggers = { ...this.settings.triggers }
      triggers[key] = !triggers[key]
      void this.patch({ triggers })
    },
    /** 总开关：关掉则一条通知都不发（邮箱配置保留不变）。 */
    toggleNotifyEnabled() {
      if (this.busy || !this.settings) return
      void this.patch({ notifyEmailEnabled: !this.settings.notifyEmailEnabled })
    },
    isNotifyOn(id) {
      return this.activeNotifyEvents.includes(id)
    },
    notifyLabel(entry) {
      return getLocale() === 'en' ? String(entry.en || entry.zh || '') : String(entry.zh || '')
    },
    notifyHint(entry) {
      return getLocale() === 'en' ? String(entry.enHint || '') : String(entry.zhHint || '')
    },
    /** 单个事件开关：整张表一起提交，电脑端会按推荐优先级重新排序归一。 */
    toggleNotifyEvent(id) {
      if (this.busy || !this.settings) return
      if (!this.settings.notifyEmailEnabled) {
        this.toast(t('请先打开邮件通知总开关'))
        return
      }
      const next = this.activeNotifyEvents.includes(id)
        ? this.activeNotifyEvents.filter((entry) => entry !== id)
        : [...this.activeNotifyEvents, id]
      void this.patch({ notifyEmailEvents: next })
    },
    chooseScheduleMode(mode) {
      if (this.busy || !this.settings) return
      if (this.settings.scheduleMode === mode) return
      void this.patch({ scheduleMode: mode })
    },
    isTopicActive(id) {
      return Array.isArray(this.settings?.topics) && this.settings.topics.includes(id)
    },
    toggleTopic(id) {
      if (this.busy || !this.settings) return
      const current = Array.isArray(this.settings.topics) ? this.settings.topics : []
      const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
      // 电脑端把「没有选中项」当作全选默认值，删到 0 个会静默变回全选，这里先拦住。
      if (next.length === 0) {
        this.toast(t('至少要保留一个问题域'))
        return
      }
      void this.patch({ topics: next })
    },
    openSchedulePicker() {
      if (this.settings?.scheduleMode === 'version') return
      if (this.settings?.scheduleMode === 'daily') {
        this.timeSheetVisible = true
        return
      }
      this.intervalPickerVisible = true
    },
    onIntervalPick(index) {
      const choice = REFLECT_INTERVALS[Number(index)] || REFLECT_INTERVALS[DEFAULT_INTERVAL_INDEX]
      this.intervalPickerVisible = false
      void this.patch({ intervalMinutes: choice.minutes })
    },
    onTimePick(value) {
      this.timeSheetVisible = false
      void this.patch({ dailyTime: value })
    },
    onModelPick(index) {
      const pick = Number(index) || 0
      this.modelPickerVisible = false
      const modelId = pick === 0 ? '' : this.modelOptions[pick - 1]?.id || ''
      void this.patch({ modelId })
    },
    async saveMail() {
      if (this.busy || !this.settings) return
      const port = Number(this.mail.smtpPort) || 0
      if (port < 1 || port > 65535) {
        this.mailHint = { text: t('端口需要是 1-65535 之间的数字。'), kind: 'error' }
        return
      }
      const emailTo = String(this.mail.emailTo || '').trim()
      if (this.settings.notifyEmailEnabled && !emailTo.includes('@')) {
        this.mailHint = { text: t('开启邮件通知时，邮箱地址必须包含 @。'), kind: 'error' }
        return
      }
      const patch = {
        // 空输入框 = 用户要清掉这一项：发 null。空串在主进程里是「保持原值」，
        // 传过去会让这次清空静默失效。
        emailTo: emailTo || null,
        smtpHost: String(this.mail.smtpHost || '').trim() || null,
        smtpPort: port,
        smtpSecurity: this.mail.smtpSecurity
      }
      // 授权码留空 = 不修改；只有真的输入了才提交。
      const password = String(this.mail.smtpPassword || '').trim()
      if (password) patch.smtpPassword = password
      const ok = await this.patch(patch)
      this.mailHint = {
        text: ok ? t('邮箱配置已保存。') : t('保存失败，请检查后再试。'),
        kind: ok ? '' : 'error'
      }
    },
    async sendTestMail() {
      if (this.busy) return
      this.mailHint = { text: t('正在发送测试邮件…'), kind: '' }
      try {
        const result = await sendReflectTestMail(String(this.mail.emailTo || '').trim())
        this.mailHint = result.ok
          ? { text: t('测试邮件已发出，请查看收件箱（也可能在垃圾箱）。'), kind: '' }
          : { text: result.error || t('测试邮件没有发出去。'), kind: 'error' }
      } catch (error) {
        this.mailHint = { text: error?.message || t('测试邮件没有发出去。'), kind: 'error' }
      }
    },
    async runNow() {
      if (this.busy || this.running) return
      try {
        await runReflectNow()
        this.toast(t('已开始反思，完成后会出现在列表里'))
      } catch (error) {
        this.toast(error?.message || t('触发失败'))
      }
    },
    async clearReports() {
      try {
        await clearReflectReports()
        this.closeDetail()
        this.toast(t('已清除'))
      } catch (error) {
        this.toast(error?.message || t('清除失败'))
      }
    },
    async openReport(id) {
      try {
        this.detailReport = await loadReflectReport(id)
      } catch (error) {
        this.toast(error?.message || t('读取报告失败'))
      }
    },
    closeDetail() {
      this.detailReport = null
      closeReflectReport()
    },
    triggerLabel(trigger) {
      const label = TRIGGER_LABELS[trigger] || TRIGGER_LABELS.manual
      return label()
    },
    severityLabel(severity) {
      const label = SEVERITY_LABELS[severity] || SEVERITY_LABELS.medium
      return label()
    },
    topicLabel(id) {
      const hit = REFLECT_TOPICS.find((topic) => topic.id === id)
      return hit ? hit.label() : id
    },
    /** 本轮因证据不足没问的域，一条说明拼好；没跳过时返回空串。 */
    skippedText() {
      const skipped = this.detailReport?.skipped
      if (!Array.isArray(skipped) || skipped.length === 0) return ''
      const parts = skipped.map((entry) => {
        const missing = (entry.missing || [])
          .map((kind) => {
            const hit = REFLECT_EVIDENCE_LABELS.find((item) => item.id === kind)
            return hit ? hit.label() : kind
          })
          .join('、')
        return missing
          ? t('{v1}（缺{v2}）', { v1: this.topicLabel(entry.topic), v2: missing })
          : this.topicLabel(entry.topic)
      })
      return t('本轮未提问：{v1}', { v1: parts.join('；') })
    },
    /**「路径:行」：电脑端下发的是结构化 ref（path / line），手机上拼成一行更好认。 */
    refLabel(ref) {
      if (!ref) return ''
      const path = String(ref.path || '').trim()
      const line = Number(ref.line)
      if (!path) return ''
      return Number.isFinite(line) && line > 0 ? `${path}:${line}` : path
    },
    findingStatusLabel(finding) {
      const status = finding?.status || 'open'
      // 默认的「待处理」不占位：只有真的标过才显示状态，避免每条结论都多一行。
      if (status === 'open') return ''
      const hit = FINDING_STATUS_OPTIONS.find((option) => option.id === status)
      return hit ? hit.label() : ''
    },
    async markFinding(finding, status) {
      if (!finding?.id) return
      const current = finding.status || 'open'
      if (current === status) return
      if (this.statusSaving) return
      this.statusSaving = true
      try {
        const report = await setReflectFindingStatus(this.detailReport.id, finding.id, status)
        if (report) this.detailReport = report
      } catch (error) {
        this.toast(error?.message || t('保存失败'))
      } finally {
        this.statusSaving = false
      }
    },
    secondsText(durationMs) {
      const ms = Number(durationMs) || 0
      return String(Math.max(1, Math.round(ms / 1000)))
    },
    timeText(value) {
      if (!value) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      const pad = (number) => String(number).padStart(2, '0')
      return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
  }
}
</script>

<style>
/* 反思分区：与「内视」「模块自检」「自主探索学习」共用一套卡片语言——
   面板级头部 + 一张卡片一件事，卡片内用分隔线分行，不再有散落的 section-label。 */
.reflect-panel {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

/* ---------- 面板头部 ---------- */
.reflect-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
  padding: 4rpx 4rpx 0;
}
.reflect-head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.reflect-head-title {
  color: var(--text-strong);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.3;
}
.reflect-head-sub {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.5;
}
/* 刷新按钮给足热区（22rpx 字号 + 14rpx 横向内边距），禁用态而不是直接消失。 */
.reflect-head-action {
  flex: none;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.4;
}
.reflect-head-action.disabled {
  opacity: 0.45;
}

/* ---------- 空态与错误 ---------- */
.reflect-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  padding: 120rpx 40rpx;
  border-radius: 18rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.reflect-empty-title {
  color: var(--text-strong);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
}
.reflect-empty-hint {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
  text-align: center;
}
.reflect-error {
  padding: 20rpx 22rpx;
  border-radius: 16rpx;
  background: var(--accent-wash-soft);
  color: var(--danger);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}

/* ---------- 卡片 ---------- */
.reflect-card {
  padding: 20rpx 22rpx;
  border-radius: 18rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.reflect-card > .reflect-card-title {
  display: block;
  margin-bottom: 4rpx;
}
.reflect-card-head {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
}
.reflect-card-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.reflect-card-title {
  color: var(--text-strong);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.35;
}
.reflect-card-hint {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.55;
}
.reflect-card-count {
  flex: none;
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.55;
}

/* ---------- 开关：78×44rpx，knob 34rpx，与学习面板同尺度 ---------- */
.reflect-toggle {
  flex: none;
  position: relative;
  width: 78rpx;
  height: 44rpx;
  border-radius: 999rpx;
  background: var(--surface-3);
  transition: background 0.2s ease;
}
.reflect-toggle.on {
  background: var(--accent);
}
/* knob 不能用白色：深色主题下 --accent 本身就是白色，两者相叠就看不出开关状态了。 */
.reflect-toggle-knob {
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  width: 34rpx;
  height: 34rpx;
  border-radius: 50%;
  background: var(--accent-ink, #000000);
  transition: transform 0.2s ease;
}
.reflect-toggle.on .reflect-toggle-knob {
  transform: translateX(34rpx);
}

/* ---------- 分段控件：等宽两/三栏，比胶囊更容易点中 ---------- */
.reflect-segment {
  display: flex;
  gap: 8rpx;
  margin-top: 12rpx;
  padding: 4rpx;
  border-radius: 14rpx;
  background: var(--input-bg);
}
.reflect-segment.compact {
  margin-top: 8rpx;
}
.reflect-segment-item {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12rpx 8rpx;
  border-radius: 11rpx;
  transition: background 0.18s ease;
}
.reflect-segment-item.active {
  background: var(--surface-3);
}
.reflect-segment-text {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.4;
  text-align: center;
}
.reflect-segment-item.active .reflect-segment-text {
  color: var(--accent-soft);
  font-weight: 600;
}

/* ---------- 多项勾选（触发方式）---------- */
.reflect-choice {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 0;
  border-top: 1rpx solid var(--line);
}
.reflect-choice-label {
  flex: 1;
  min-width: 0;
  color: var(--dim);
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.4;
}
.reflect-choice.active .reflect-choice-label {
  color: var(--text-strong);
  font-weight: 600;
}
/* 带说明的两行项：标题 + 一句提示，勾选框贴右侧居中。 */
.reflect-choice-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.reflect-choice-main .reflect-choice-label {
  flex: none;
  font-size: calc(26rpx * var(--font-scale));
}
.reflect-choice-desc {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.45;
  opacity: 0.85;
}
.reflect-choice.disabled {
  opacity: 0.45;
}
.reflect-check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  border-radius: 11rpx;
  border: 1rpx solid var(--line);
  background: var(--input-bg);
  box-sizing: border-box;
}
.reflect-check.on {
  border-color: var(--accent);
  background: var(--accent);
}
.reflect-check-mark {
  color: var(--accent-ink, #000000);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 700;
  line-height: 1;
}

/* ---------- 行 ---------- */
.reflect-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 0;
  border-top: 1rpx solid var(--line);
}
/* 卡片里唯一的一行不需要上分隔线，否则卡片顶部会多出一条横线。 */
.reflect-card > .reflect-row:first-child {
  padding-top: 0;
  border-top: none;
}
.reflect-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.reflect-row-title {
  color: var(--text-strong);
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.4;
}
.reflect-row-desc {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.5;
}
.reflect-row-value {
  flex: none;
  max-width: 46%;
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  text-align: right;
}
.reflect-row-caret {
  flex: none;
  color: var(--muted);
  font-size: calc(26rpx * var(--font-scale));
  line-height: 1;
}

/* ---------- 问题域 ---------- */
.reflect-topics {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 14rpx;
}
.reflect-topic {
  padding: 14rpx 22rpx;
  border-radius: 14rpx;
  border: 1rpx solid var(--line);
  background: var(--input-bg);
}
.reflect-topic.active {
  border-color: var(--accent);
  background: var(--accent-wash);
}
.reflect-topic-text {
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.4;
}
.reflect-topic.active .reflect-topic-text {
  color: var(--accent-soft);
  font-weight: 600;
}

/* ---------- 表单 ---------- */
.reflect-field {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 18rpx 0 0;
  margin-top: 18rpx;
  border-top: 1rpx solid var(--line);
}
.reflect-field-label {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.45;
}
/* 用作卡片内的二级小标题（如「定时方式」）。 */
.reflect-field-label.sub {
  display: block;
  margin-top: 20rpx;
  color: var(--text-strong);
  font-size: calc(23rpx * var(--font-scale));
  font-weight: 600;
}

/* ---------- 提示 ---------- */
.reflect-hint {
  display: block;
  margin-top: 12rpx;
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.55;
}
.reflect-hint.error {
  color: var(--danger);
}
.reflect-hint.warn {
  color: var(--warn);
}
.reflect-empty-inline {
  padding: 18rpx 0 4rpx;
}

/* ---------- 操作按钮 ---------- */
.reflect-actions {
  display: flex;
  gap: 12rpx;
  margin-top: 18rpx;
}
.reflect-actions .btn {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
}
.reflect-input {
  height: calc(72rpx * var(--font-scale));
  padding: 0 20rpx;
  border-radius: 14rpx;
  background: var(--input-bg);
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  box-sizing: border-box;
}
.reflect-secret {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.reflect-secret .reflect-input {
  flex: 1;
  min-width: 0;
}
.reflect-secret-toggle {
  flex: none;
  padding: 10rpx 18rpx;
  border-radius: 12rpx;
  background: var(--input-bg);
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.4;
}
/* 服务商下拉：整行可点，样式与输入框同高。 */
.reflect-select {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  height: calc(72rpx * var(--font-scale));
  padding: 0 20rpx;
  border-radius: 14rpx;
  background: var(--input-bg);
  box-sizing: border-box;
}
.reflect-select-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
}
.reflect-select-chevron {
  flex: none;
  color: var(--dim);
  font-size: calc(26rpx * var(--font-scale));
  line-height: 1;
}
.reflect-report {
  margin-top: 14rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  border: 1rpx solid var(--line);
  background: var(--input-bg);
}
.reflect-report:active {
  background: var(--accent-wash-soft);
}
.reflect-report-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.reflect-report-trigger {
  flex: none;
  color: var(--text-strong);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 600;
  line-height: 1.4;
}
.reflect-report-time {
  margin-left: auto;
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.4;
}
.reflect-report-summary {
  display: block;
  margin-top: 10rpx;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.55;
}
.reflect-report-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
  margin-top: 10rpx;
}
.reflect-report-count,
.reflect-report-mail {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
}
.reflect-sev {
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  font-size: calc(20rpx * var(--font-scale));
  border: 1rpx solid currentColor;
}
.reflect-sev.high {
  color: var(--danger);
}
.reflect-sev.medium {
  color: var(--warn);
}
.reflect-sev.low {
  color: var(--dim);
}
.reflect-detail-scroll {
  /* sheet body 是 flex:1 的容器，scroll-view 在这里必须自己拿到高度才滚得动。 */
  flex: 1;
  min-height: 0;
  height: 62vh;
  padding: 0 30rpx;
  box-sizing: border-box;
}
.reflect-detail-tail {
  height: 24rpx;
}
.reflect-detail-summary {
  display: block;
  margin-top: 16rpx;
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.6;
}
.reflect-detail-meta {
  display: block;
  margin-top: 8rpx;
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
}
/* 未提问的域：解释为什么某个问题域没结果，不占醒目层级。 */
.reflect-detail-skipped {
  display: block;
  margin-top: 10rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  background: var(--input-bg);
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.5;
}
.reflect-finding {
  margin-top: 18rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  border: 1rpx solid var(--line);
}
.reflect-finding-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
/* 只标过的结论才显状态；待处理不占位。 */
.reflect-finding-status {
  margin-left: auto;
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  font-size: calc(19rpx * var(--font-scale));
  border: 1rpx solid var(--line);
  color: var(--muted);
}
.reflect-finding-status.done {
  color: var(--ok);
  border-color: var(--ok);
}
.reflect-finding-status.dismissed {
  color: var(--dim);
}
/* 代码位置：等宽字体并允许换行，长路径不被截断。 */
.reflect-finding-ref {
  display: block;
  margin-top: 6rpx;
  color: var(--muted);
  font-family: monospace;
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.45;
  word-break: break-all;
}
.reflect-finding-actions {
  display: flex;
  gap: 10rpx;
  margin-top: 12rpx;
}
.reflect-status-btn {
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.reflect-status-btn.active {
  color: var(--accent);
  border-color: var(--accent);
}
.reflect-finding-topic {
  color: var(--text-strong);
  font-size: calc(23rpx * var(--font-scale));
}
.reflect-finding-observation {
  display: block;
  margin-top: 10rpx;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.55;
}
.reflect-finding-suggestion {
  display: block;
  margin-top: 8rpx;
  color: var(--accent);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.reflect-evidence {
  display: block;
  margin-top: 18rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  background: var(--input-bg);
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.55;
}
</style>
