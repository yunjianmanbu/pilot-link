<template>
  <view class="evolution-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="evo-topbar">
      <view class="evo-back" @click="back"><view class="back-arrow"></view></view>
      <text class="evo-title">{{ t('进化') }}</text>
      <text class="evo-refresh" :class="{ disabled: store.evolutionLoading }" @click="refreshNow">
        {{ store.evolutionLoading ? t('刷新中…') : t('刷新') }}
      </text>
    </view>

    <!-- 自进化相关的能力不再各开一页：内视 / 模块自检 / 反思 / 探索学习都在这一页靠页签切换。 -->
    <view class="evo-tabs">
      <view
        v-for="tab in tabs"
        :key="tab.id"
        class="evo-tab"
        :class="{ active: activeTab === tab.id }"
        @click="selectTab(tab.id)"
      >
        <text class="evo-tab-label">{{ tab.label }}</text>
      </view>
    </view>

    <scroll-view
      class="evo-scroll"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      :refresher-background="refresherBackground"
      @refresherrefresh="onPullRefresh"
    >
      <view v-if="activeTab === 'evolution'" class="evo-content">
        <view v-if="!connected" class="evo-empty">
          <text class="evo-empty-title">{{ t('还没有连接电脑') }}</text>
          <text class="evo-empty-hint">{{ t('连接电脑后才能查看和控制自进化。') }}</text>
        </view>

        <view v-else-if="store.evolutionSupported === false" class="evo-empty">
          <text class="evo-empty-title">{{ t('这台电脑的版本不支持手机控制自进化') }}</text>
          <text class="evo-empty-hint">{{ t('请先在电脑上安装新版 Pilot，之后就能在手机上查看和控制自进化。') }}</text>
        </view>

        <view v-else-if="!state && !personal" class="evo-empty">
          <text class="evo-empty-title">
            {{ store.evolutionLoading || store.evolutionPersonalLoading ? t('正在读取自进化状态…') : t('还没有打开的工作区') }}
          </text>
          <text v-if="store.evolutionError" class="evo-empty-hint">{{ store.evolutionError }}</text>
          <text v-else-if="store.evolutionPersonalError" class="evo-empty-hint">{{ store.evolutionPersonalError }}</text>
          <text v-else class="evo-empty-hint">{{ t('先在电脑端打开一个工作区，或在会话页选择一个项目。') }}</text>
        </view>

        <template v-else>
          <template v-if="state">
          <view v-if="workspaceOptions.length > 0" class="evo-project">
            <text class="evo-project-label">{{ t('项目') }}</text>
            <view
              class="evo-project-trigger"
              :class="{ open: workspacePickerVisible }"
              @click="openWorkspacePicker"
            >
              <view class="evo-project-main">
                <text class="evo-project-name">{{ currentWorkspaceName }}</text>
                <text
                  v-if="currentWorkspacePath && currentWorkspacePath !== currentWorkspaceName"
                  class="evo-project-path"
                >{{ currentWorkspacePath }}</text>
              </view>
              <text class="evo-project-caret">▾</text>
            </view>
          </view>

          <view class="evo-summary">
            <view class="evo-summary-item">
              <text class="evo-summary-value">{{ state.completedRuns }}</text>
              <text class="evo-summary-label">{{ t('次运行') }}</text>
            </view>
            <view class="evo-summary-item">
              <text class="evo-summary-value">{{ state.failures }}</text>
              <text class="evo-summary-label">{{ t('次异常') }}</text>
            </view>
            <view class="evo-summary-item">
              <text class="evo-summary-value">{{ state.avgSteps }}</text>
              <text class="evo-summary-label">{{ t('平均步数') }}</text>
            </view>
            <view class="evo-summary-item">
              <text class="evo-summary-value">{{ state.activeProfile ? `v${state.activeProfile.version}` : '—' }}</text>
              <text class="evo-summary-label">{{ t('当前版本') }}</text>
            </view>
          </view>

          <view class="evo-card">
            <view class="evo-card-head">
              <text class="evo-card-title">{{ t('系统级自动进化') }}</text>
              <view class="evo-toggle-wrap" @click="toggleAuto">
                <view class="evo-toggle" :class="{ on: state.autoEvolve, disabled: busy }">
                  <view class="evo-toggle-knob"></view>
                </view>
                <text class="evo-toggle-label">{{ state.autoEvolve ? t('自动运行已开启') : t('自动运行已关闭') }}</text>
              </view>
            </view>
            <text class="evo-hint">{{ t('自动收集近期任务、提出改进并交给独立模型评审；失败率上升时自动回滚。') }}</text>
            <view class="evo-actions">
              <button
                class="btn primary evo-btn"
                :disabled="!state.canRunCycle || busy"
                @click="runCycle"
              >{{ state.busy === 'cycle' ? t('进化中…') : t('立即进化') }}</button>
              <button
                class="btn ghost evo-btn"
                :disabled="busy"
                @click="improvePolicy"
              >{{ state.busy === 'policy' ? t('调整中…') : t('改进进化机制') }}</button>
              <button
                v-if="state.canRollbackPolicy"
                class="btn ghost evo-btn"
                :disabled="busy"
                @click="rollbackPolicy"
              >{{ t('回滚进化机制') }}</button>
            </view>
            <text v-if="!state.hasKey" class="evo-hint warn">{{ t('需要先在电脑上配置 API Key。') }}</text>
            <text v-else-if="state.completedRuns < state.minRuns && !state.busy" class="evo-hint">
              {{ t('至少需要 {v1} 次运行记录才能开始进化。', { v1: state.minRuns }) }}
            </text>
            <view class="evo-policy">
              <text class="evo-policy-chip">{{ t('每 {v1} 次运行', { v1: state.policy.cooldownRuns }) }}</text>
              <text class="evo-policy-chip">{{ t('评审 ≥ {v1} 分', { v1: state.policy.reviewScore }) }}</text>
              <text class="evo-policy-chip">{{ t('观察 {v1} 次', { v1: state.policy.watchRuns }) }}</text>
              <text class="evo-policy-chip">{{ state.policy.autoApply ? t('通过后自动启用') : t('通过后手动启用') }}</text>
            </view>
            <text v-if="state.policy.focus" class="evo-focus">{{ t('当前重点：{v1}', { v1: state.policy.focus }) }}</text>

            <view v-if="lastCycle" class="evo-cycle">
              <view class="evo-cycle-head">
                <text class="evo-cycle-status" :class="cycleTone(lastCycle.status)">{{ cycleLabel(lastCycle.status) }}</text>
                <text class="evo-time">{{ formatWhen(lastCycle.startedAt) }}</text>
              </view>
              <text class="evo-cycle-summary">{{ lastCycle.summary }}</text>
              <view v-for="stage in lastCycle.stages" :key="`${stage.key}-${stage.at}`" class="evo-stage">
                <view class="evo-stage-dot" :class="stage.status"></view>
                <text class="evo-stage-name">{{ stageLabel(stage.key) }}</text>
                <text class="evo-stage-detail">{{ stage.detail }}</text>
              </view>
            </view>
            <text v-else class="evo-hint">{{ t('还没有运行过系统进化。') }}</text>
          </view>

          <view class="evo-card">
            <view class="evo-card-head">
              <text class="evo-card-title">{{ t('行为进化版本') }}</text>
              <text
                class="evo-card-action"
                :class="{ disabled: !canPropose || busy }"
                @click="propose"
              >{{ store.evolutionAction === 'propose' ? t('提出中…') : t('提出新版本') }}</text>
            </view>
            <text class="evo-hint">{{ t('每个版本都必须通过独立评审才能启用；旧版本保留，可随时回滚。') }}</text>
            <text v-if="!workspaceProfiles.length" class="evo-inline-empty">{{ t('还没有行为进化版本。') }}</text>
            <view
              v-for="profile in workspaceProfiles"
              :key="profile.id"
              class="evo-profile"
              :class="{ open: isProfileOpen('workspace', profile) }"
            >
              <view class="evo-profile-head" @click="toggleProfile('workspace', profile)">
                <text class="evo-profile-version">v{{ profile.version }}</text>
                <text class="evo-badge" :class="profile.status">{{ profileStatus(profile) }}</text>
                <text class="evo-time">{{ formatWhen(profile.createdAt) }}</text>
                <view class="evo-score-block">
                  <text
                    v-if="profile.review"
                    class="evo-score-value"
                    :class="scoreTone(profile.review.score)"
                  >{{ profile.review.score }}</text>
                  <text v-else class="evo-score-value empty">—</text>
                  <text class="evo-score-label">{{ profile.review ? t('分') : t('未评审') }}</text>
                </view>
                <text class="evo-profile-toggle">{{ isProfileOpen('workspace', profile) ? t('收起') : t('展开') }}</text>
                <text class="evo-profile-caret" :class="{ open: isProfileOpen('workspace', profile) }">▾</text>
              </view>
              <view v-if="isProfileOpen('workspace', profile)" class="evo-profile-body">
                <text class="evo-profile-note">{{ profile.rationale }}</text>
                <text v-if="profile.review && profile.review.notes" class="evo-profile-review">{{ profile.review.notes }}</text>
                <view class="evo-actions">
                  <button
                    v-if="profile.status !== 'active' && !profile.review"
                    class="btn primary evo-btn"
                    :disabled="busy"
                    @click="reviewProfile(profile)"
                  >{{ t('独立评审') }}</button>
                  <button
                    v-if="profile.status !== 'active' && profile.review && profile.review.pass"
                    class="btn primary evo-btn"
                    :disabled="busy"
                    @click="activateProfile(profile)"
                  >{{ profile.status === 'retired' ? t('重新启用') : t('启用此版本') }}</button>
                  <button
                    v-if="profile.status !== 'active' && profile.review && !profile.review.pass"
                    class="btn ghost evo-btn"
                    :disabled="busy"
                    @click="reviewProfile(profile)"
                  >{{ t('重新评审') }}</button>
                  <button
                    v-if="profile.status === 'draft'"
                    class="btn ghost evo-btn danger"
                    :disabled="busy"
                    @click="deleteProfile(profile)"
                  >{{ t('删除草稿') }}</button>
                  <button
                    v-if="profile.status === 'draft'"
                    class="btn ghost evo-btn"
                    :disabled="busy"
                    @click="promoteProfile(profile)"
                  >{{ t('提升为全局候选') }}</button>
                </view>
              </view>
            </view>
            <view v-if="state.activeProfile" class="evo-actions evo-actions-end">
              <button class="btn ghost evo-btn" :disabled="busy" @click="rollbackProfile">{{ t('回滚当前版本') }}</button>
            </view>
          </view>

          <view class="evo-card">
            <view class="evo-card-head">
              <text class="evo-card-title">{{ t('全局画像') }}</text>
              <text
                v-if="state.activeGlobalProfile"
                class="evo-card-action"
                :class="{ disabled: busy }"
                @click="rollbackGlobal"
              >{{ t('回滚全局版本') }}</text>
            </view>
            <text class="evo-hint">{{ t('跨所有工作区生效；评审通过后仍需你手动启用。') }}</text>
            <text v-if="!globalProfiles.length" class="evo-inline-empty">{{ t('还没有全局进化版本。') }}</text>
            <view
              v-for="profile in globalProfiles"
              :key="profile.id"
              class="evo-profile"
              :class="{ open: isProfileOpen('global', profile) }"
            >
              <view class="evo-profile-head" @click="toggleProfile('global', profile)">
                <text class="evo-profile-version">v{{ profile.version }}</text>
                <text class="evo-badge" :class="profile.status">{{ profileStatus(profile) }}</text>
                <text class="evo-time">{{ formatWhen(profile.createdAt) }}</text>
                <view class="evo-score-block">
                  <text
                    v-if="profile.review"
                    class="evo-score-value"
                    :class="scoreTone(profile.review.score)"
                  >{{ profile.review.score }}</text>
                  <text v-else class="evo-score-value empty">—</text>
                  <text class="evo-score-label">{{ profile.review ? t('分') : t('未评审') }}</text>
                </view>
                <text class="evo-profile-toggle">{{ isProfileOpen('global', profile) ? t('收起') : t('展开') }}</text>
                <text class="evo-profile-caret" :class="{ open: isProfileOpen('global', profile) }">▾</text>
              </view>
              <view v-if="isProfileOpen('global', profile)" class="evo-profile-body">
                <text class="evo-profile-note">{{ profile.rationale }}</text>
                <text v-if="profile.review && profile.review.notes" class="evo-profile-review">{{ profile.review.notes }}</text>
                <view class="evo-actions">
                  <button
                    v-if="profile.status !== 'active' && !profile.review"
                    class="btn primary evo-btn"
                    :disabled="busy"
                    @click="reviewGlobalProfile(profile)"
                  >{{ t('独立评审') }}</button>
                  <button
                    v-if="profile.status !== 'active' && profile.review && profile.review.pass"
                    class="btn primary evo-btn"
                    :disabled="busy"
                    @click="activateGlobalProfile(profile)"
                  >{{ profile.status === 'retired' ? t('重新启用') : t('启用此全局版本') }}</button>
                  <button
                    v-if="profile.status !== 'active' && profile.review && !profile.review.pass"
                    class="btn ghost evo-btn"
                    :disabled="busy"
                    @click="reviewGlobalProfile(profile)"
                  >{{ t('重新评审') }}</button>
                  <button
                    v-if="profile.status === 'draft'"
                    class="btn ghost evo-btn danger"
                    :disabled="busy"
                    @click="deleteGlobalProfile(profile)"
                  >{{ t('删除草稿') }}</button>
                </view>
              </view>
            </view>
          </view>
          </template>

          <view class="evo-card">
            <view class="evo-card-head">
              <text class="evo-card-title">{{ t('个人版本与源码进化') }}</text>
              <text
                class="evo-card-action"
                :class="{ disabled: store.evolutionPersonalLoading }"
                @click="refreshPersonal"
              >{{ store.evolutionPersonalLoading ? t('读取中…') : t('刷新') }}</text>
            </view>
            <text class="evo-hint">{{ t('直接和 Pilot 聊你想怎么改造，它会读内置源码、修改、跑测试并构建个人版；版本可保存、恢复和提交官方。') }}</text>

            <text v-if="store.evolutionPersonalError" class="evo-hint error">{{ store.evolutionPersonalError }}</text>
            <view v-else-if="!personal" class="evo-actions">
              <button class="btn primary evo-btn" :disabled="store.evolutionPersonalLoading" @click="refreshPersonal">
                {{ t('读取个人版本') }}
              </button>
            </view>

            <template v-else>
              <view class="evo-personal-meta">
                <text>{{ t('官方基线 v{v1}', { v1: personal.baseVersion }) }}</text>
                <text class="muted">{{ personal.available ? t('个人源码已就绪') : t('还没有个人源码') }}</text>
              </view>
              <view class="evo-actions">
                <button
                  v-if="!personal.available"
                  class="btn ghost evo-btn"
                  :disabled="busy"
                  @click="openSource"
                >{{ t('准备个人源码') }}</button>
                <button
                  class="btn primary evo-btn"
                  :disabled="!hasKey || busy"
                  @click="chatSource"
                >{{ store.evolutionAction === 'personalOpenSource' ? t('正在准备…') : t('和 Pilot 聊源码改造') }}</button>
                <button
                  v-if="personal.available"
                  class="btn ghost evo-btn"
                  :disabled="!hasKey || busy"
                  @click="buildPersonal"
                >{{ store.evolutionAction === 'personalBuild' ? t('正在开始…') : t('让 Pilot 构建') }}</button>
                <button
                  class="btn ghost evo-btn"
                  :disabled="!personal.available || busy"
                  @click="openSaveDialog"
                >{{ t('保存当前版本') }}</button>
              </view>

              <view v-if="personal.upgrade.available" class="evo-upgrade">
                <text class="evo-upgrade-title">{{ t('官方已升级到 v{v1}', { v1: personal.upgrade.toVersion }) }}</text>
                <text class="evo-hint">
                  {{ personal.upgrade.requiresManual
                    ? t('需要让 Pilot 手动迁移官方更新，个人改动会保留。')
                    : t('可以自动合并官方更新，冲突会交给 Pilot 处理。') }}
                </text>
                <button
                  class="btn primary evo-btn"
                  :disabled="busy"
                  @click="mergeUpgrade"
                >{{ personalBusy === 'upgrade' ? t('合并中…') : t('合并官方更新') }}</button>
              </view>

              <view
                v-if="personal.lastUpgrade && personal.lastUpgrade.validation !== 'passed'"
                class="evo-upgrade warn"
              >
                <text class="evo-upgrade-title">{{ upgradeStatusText(personal.lastUpgrade) }}</text>
                <text class="evo-hint">
                  {{ personal.lastUpgrade.message || t('文本合并无法发现跨文件逻辑冲突，请运行检查或让 Pilot 审阅。') }}
                </text>
                <view class="evo-actions">
                  <button class="btn primary evo-btn" :disabled="busy" @click="validateUpgrade">
                    {{ personalBusy === 'validate' ? t('检查中…') : t('运行检查') }}
                  </button>
                  <button class="btn ghost evo-btn" :disabled="!hasKey || busy" @click="fixUpgrade">{{ t('让 Pilot 修复') }}</button>
                  <button class="btn ghost evo-btn danger" :disabled="busy" @click="rollbackMerge">{{ t('撤销合并') }}</button>
                </view>
              </view>

              <text v-if="!personal.versions.length" class="evo-inline-empty">{{ t('还没有保存过个人版本。') }}</text>
              <view
                v-for="version in personal.versions.slice(0, 8)"
                :key="version.id"
                class="evo-profile"
                :class="{ open: isProfileOpen('personal', version) }"
              >
                <view class="evo-profile-head" @click="toggleProfile('personal', version)">
                  <text class="evo-profile-version">{{ version.name }}</text>
                  <text class="evo-badge" :class="version.buildPath ? 'active' : 'draft'">
                    {{ version.buildPath ? t('已构建') : t('待构建') }}
                  </text>
                  <text class="evo-time">{{ formatWhen(version.createdAt) }}</text>
                  <text class="evo-profile-toggle">{{ isProfileOpen('personal', version) ? t('收起') : t('展开') }}</text>
                  <text class="evo-profile-caret" :class="{ open: isProfileOpen('personal', version) }">▾</text>
                </view>
                <view v-if="isProfileOpen('personal', version)" class="evo-profile-body">
                  <text class="evo-profile-note">{{ changeSummary(version) }}</text>
                  <view class="evo-actions">
                    <button class="btn ghost evo-btn" :disabled="busy" @click="restoreVersion(version)">
                      {{ t('恢复此版本') }}
                    </button>
                    <button class="btn ghost evo-btn" :disabled="busy" @click="openSubmitDialog(version)">
                      {{ t('提交官方') }}
                    </button>
                  </view>
                </view>
              </view>

              <view v-if="personal.contributions.length" class="evo-contributions">
                <text class="evo-section-subtitle">{{ t('贡献包') }}</text>
                <view v-for="item in personal.contributions.slice(0, 5)" :key="item.id" class="evo-contribution">
                  <text class="evo-contribution-status" :class="item.status">{{ contributionLabel(item.status) }}</text>
                  <text class="evo-contribution-note">{{ item.note }}</text>
                  <text class="evo-time">{{ formatWhen(item.createdAt) }}</text>
                </view>
              </view>
            </template>
          </view>

          <text v-if="!hasKey" class="evo-hint warn evo-bottom-hint">
            {{ t('进化与构建需要电脑端已配置 API Key。') }}
          </text>
          <view class="evo-bottom-gap"></view>
        </template>
      </view>

      <!-- 四个页签的面板本体：每个面板自己拉数据，切回来会重建一次。 -->
      <view v-else class="evo-panel">
        <self-check-panel v-if="activeTab === 'introspect'" />
        <module-check-panel v-else-if="activeTab === 'module-check'" />
        <reflect-panel
          v-else-if="activeTab === 'reflect'"
          :desktop-online="connected"
          :model-options="sessionModelOptions"
          :models-loading="modelsLoading"
        />
        <learning-panel v-else-if="activeTab === 'learning'" />
      </view>
    </scroll-view>

    <app-sheet
      :visible="workspacePickerVisible"
      :title="t('选择项目空间')"
      :subtitle="t('共 {v1} 个项目', { v1: workspaceOptions.length })"
      @close="closeWorkspacePicker"
    >
      <view class="evo-picker-search">
        <text class="evo-picker-search-icon">⌕</text>
        <input
          v-model="workspaceQuery"
          class="evo-picker-search-input"
          type="text"
          :placeholder="t('搜索项目名称或路径')"
          placeholder-class="evo-picker-search-placeholder"
          confirm-type="search"
        />
        <text v-if="workspaceQuery" class="evo-picker-search-clear" @click="workspaceQuery = ''">×</text>
      </view>
      <scroll-view
        scroll-y
        class="evo-picker-list"
        :style="{ height: workspaceListHeight }"
        :show-scrollbar="false"
      >
        <view v-if="filteredWorkspaceOptions.length === 0" class="evo-picker-empty">
          <text class="evo-picker-empty-title">{{ t('没有匹配的项目空间') }}</text>
          <text class="evo-picker-empty-hint">{{ t('换个关键词，或清空搜索查看全部目录。') }}</text>
        </view>
        <view
          v-for="item in filteredWorkspaceOptions"
          :key="item.path"
          class="evo-picker-item"
          :class="{ active: item.path === state?.workspacePath }"
          @click="chooseWorkspaceFromPicker(item.path)"
        >
          <view class="evo-picker-main">
            <text class="evo-picker-name">{{ item.name }}</text>
            <text class="evo-picker-path">{{ item.path }}</text>
          </view>
          <text class="evo-picker-check">{{ item.path === state?.workspacePath ? '✓' : '' }}</text>
        </view>
      </scroll-view>
    </app-sheet>

    <app-dialog
      :visible="textDialog.visible"
      :title="textDialog.title"
      :confirm-text="textDialog.confirmText"
      :busy="textDialog.busy"
      :busy-text="t('处理中…')"
      @confirm="confirmTextDialog"
      @cancel="closeTextDialog"
      @close="closeTextDialog"
    >
      <view class="evo-dialog-fields">
        <input
          v-if="textDialog.mode === 'save'"
          v-model="textDialog.name"
          class="evo-dialog-input"
          :placeholder="t('给这个个人版本起个名字')"
          maxlength="120"
        />
        <textarea
          v-model="textDialog.note"
          class="evo-dialog-textarea"
          :placeholder="textDialog.mode === 'save' ? t('说明你希望这个版本改进什么（可留空）') : t('说明这个改动的价值')"
          maxlength="1000"
        />
      </view>
    </app-dialog>
    <app-dialog-host />
  </view>
</template>

<script>
import AppDialog from '../../components/app-dialog/app-dialog.vue'
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import AppSheet from '../../components/app-sheet/app-sheet.vue'
import LearningPanel from '../../components/learning-panel/learning-panel.vue'
import ModuleCheckPanel from '../../components/module-check-panel/module-check-panel.vue'
import ReflectPanel from '../../components/reflect-panel/reflect-panel.vue'
import SelfCheckPanel from '../../components/self-check-panel/self-check-panel.vue'
import { relativeTime } from '../../lib/format.js'
import { fuzzyFieldsScore } from '../../lib/fuzzy.js'
import { modelOptionLabel } from '../../lib/model-label.js'
import { openAppDialog } from '../../lib/dialog.js'
import { t } from '../../lib/i18n.js'
import {
  applySystemBars,
  evolutionAction,
  init,
  loadEvolutionPersonal,
  onAppShow,
  refreshEvolution,
  refreshSessions,
  request,
  selectSession,
  setEvolutionWorkspace,
  startNewChat,
  store
} from '../../store/index.js'

const EMPTY_DIALOG = {
  visible: false,
  mode: 'save',
  title: '',
  confirmText: '',
  name: '',
  note: '',
  versionId: '',
  busy: false
}

export default {
  components: {
    AppDialog,
    AppDialogHost,
    AppSheet,
    LearningPanel,
    ModuleCheckPanel,
    ReflectPanel,
    SelfCheckPanel
  },
  data() {
    return {
      refreshing: false,
      pollTimer: null,
      workspacePickerVisible: false,
      workspaceQuery: '',
      textDialog: { ...EMPTY_DIALOG },
      // 页签把自进化的四个子能力收进同一页；默认仍是进化本身。
      activeTab: 'evolution',
      // 反思面板的模型下拉复用设置页的取数方式。
      modelSettings: null,
      modelsLoading: false,
      // 列表默认只看版本、状态和分数；详情按条目展开，刷新后仍保留展开状态。
      profileOpen: {}
    }
  },
  computed: {
    store() {
      return store
    },
    state() {
      return store.evolution
    },
    personal() {
      return store.evolutionPersonal
    },
    personalBusy() {
      return store.evolutionPersonalBusy
    },
    connected() {
      return store.agentOnline
    },
    tabs() {
      return [
        { id: 'evolution', label: t('自我进化') },
        { id: 'introspect', label: t('内视') },
        { id: 'module-check', label: t('模块自检') },
        { id: 'reflect', label: t('反思') },
        { id: 'learning', label: t('探索学习') }
      ]
    },
    modelResources() {
      const resources = this.modelSettings && this.modelSettings.resources
      return Array.isArray(resources) ? resources : []
    },
    sessionModelOptions() {
      // 停用的资源也列出来：反思面板选的是「用哪个模型审阅」，与启用状态无关。
      return this.modelResources.map((resource) => ({
        id: resource.id,
        title: `${modelOptionLabel(resource.label || resource.model || t('未命名模型'), resource.tag)} · ${resource.model || t('未配置')}`,
        hint: resource.enabled === false ? t('已停用') : ''
      }))
    },
    refreshingBackground() {
      return store.theme === 'light' ? '#ffffff' : '#000000'
    },
    refresherBackground() {
      return this.refreshingBackground
    },
    busy() {
      return Boolean(store.evolution?.busy) || Boolean(store.evolutionAction) || Boolean(this.personalBusy)
    },
    /** 没有打开工作区时，个人源码接口也会告诉手机电脑端是否配置了 Key。 */
    hasKey() {
      return this.state ? this.state.hasKey === true : store.evolutionPersonalHasKey === true
    },
    lastCycle() {
      return this.state?.cycles?.[0] || null
    },
    canPropose() {
      return Boolean(this.state?.hasKey) && (this.state?.completedRuns || 0) >= 3
    },
    workspaceProfiles() {
      return this.state?.profiles || []
    },
    globalProfiles() {
      return this.state?.globalProfiles || []
    },
    workspaceOptions() {
      const seen = new Map()
      for (const session of store.sessions) {
        if (!session?.workspacePath) continue
        const path = session.workspacePath
        if (!seen.has(path)) {
          seen.set(path, session.workspaceName || path)
        }
      }
      for (const path of store.roots) {
        if (path && !seen.has(path)) seen.set(path, path)
      }
      if (this.state?.workspacePath && !seen.has(this.state.workspacePath)) {
        seen.set(this.state.workspacePath, this.state.workspaceName || this.state.workspacePath)
      }
      return [...seen].map(([path, name]) => ({ path, name }))
    },
    currentWorkspaceName() {
      return this.state?.workspaceName || this.state?.workspacePath || ''
    },
    currentWorkspacePath() {
      return this.state?.workspacePath || ''
    },
    filteredWorkspaceOptions() {
      const query = this.workspaceQuery.trim()
      if (!query) return this.workspaceOptions
      return this.workspaceOptions
        .map((item) => ({
          ...item,
          score: fuzzyFieldsScore([item.name, item.path], query)
        }))
        .filter((item) => item.score >= 0)
        .sort((left, right) => right.score - left.score)
    },
    workspaceListHeight() {
      // 最多显示 8 行，其余在弹层里上下滑动。
      const rows = Math.min(Math.max(this.filteredWorkspaceOptions.length, 1), 8)
      return `${rows * 116}rpx`
    }
  },
  watch: {
    connected(next) {
      // 重连或电脑端上线后重新读取，避免停在旧的离线提示上。
      if (next) void this.refreshNow()
    },
    'state.busy'(next, previous) {
      if (previous && !next) void this.refreshNow()
    },
    personalBusy(next, previous) {
      if (previous && !next) void this.refreshPersonal()
    },
    'state.workspacePath'() {
      // 切换项目后回到「只看分数」的默认状态。
      this.profileOpen = {}
    }
  },
  onLoad() {
    init()
  },
  onShow() {
    init()
    applySystemBars()
    if (!store.pairing) {
      uni.reLaunch({ url: '/pages/pair/index' })
      return
    }
    onAppShow()
    if (!store.evolutionWorkspace) {
      const path =
        store.currentSession?.workspacePath ||
        store.sessions[0]?.workspacePath ||
        store.roots[0] ||
        ''
      if (path) store.evolutionWorkspace = path
    }
    if (this.activeTab === 'evolution') {
      void this.refreshNow()
      this.startPolling()
    } else if (this.activeTab === 'reflect') {
      void this.loadModels()
    }
  },
  onHide() {
    this.stopPolling()
  },
  onUnload() {
    this.stopPolling()
  },
  onBackPress() {
    if (this.textDialog.visible) {
      this.closeTextDialog()
      return true
    }
    return false
  },
  methods: {
    t,
    /** 页签切换：只有进化本体需要轮询，其余面板进页签时自己拉一次。 */
    selectTab(id) {
      if (this.activeTab === id) return
      this.activeTab = id
      if (id === 'evolution') {
        void this.refreshNow()
        this.startPolling()
        return
      }
      this.stopPolling()
      if (id === 'reflect') void this.loadModels()
    },
    async loadModels() {
      if (!store.agentOnline || this.modelsLoading) return
      this.modelsLoading = true
      try {
        const data = await request('models.get', {}, 20_000)
        if (data && Array.isArray(data.resources)) this.modelSettings = data
      } catch {
        // 旧版电脑端没有 models.get：模型下拉留空，其它反思配置照常可用。
        this.modelSettings = null
      } finally {
        this.modelsLoading = false
      }
    },
    /** 电脑端的进化记录用 ISO 时间；列表里的会话用毫秒时间戳。 */
    formatWhen(value) {
      const time = typeof value === 'number' ? value : Date.parse(String(value || ''))
      return Number.isFinite(time) ? relativeTime(time) : ''
    },
    back() {
      uni.navigateBack({ delta: 1 })
    },
    async refreshNow() {
      await Promise.all([
        refreshEvolution(true),
        loadEvolutionPersonal(Boolean(store.evolutionPersonal))
      ])
    },
    async refreshPersonal() {
      await loadEvolutionPersonal(true)
    },
    async onPullRefresh() {
      if (this.refreshing) return
      if (this.activeTab !== 'evolution') {
        // 其它页签的下拉只刷该面板自己的数据，不碰进化记录。
        if (this.activeTab === 'reflect') void this.loadModels()
        return
      }
      this.refreshing = true
      try {
        await this.refreshNow()
      } finally {
        this.refreshing = false
      }
    },
    startPolling() {
      this.stopPolling()
      this.pollTimer = setInterval(() => {
        if (store.evolution?.busy) void refreshEvolution(true)
        if (store.evolutionPersonalBusy) void loadEvolutionPersonal(true)
      }, 4000)
    },
    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
    },
    toast(message) {
      uni.showToast({ title: String(message || '').slice(0, 120), icon: 'none', duration: 2600 })
    },
    errorText(error) {
      return error instanceof Error ? error.message : String(error || '')
    },
    async chooseWorkspace(path) {
      if (!path || path === this.state?.workspacePath) return
      await setEvolutionWorkspace(path)
    },
    profileKey(scope, item) {
      const id = item?.id
      return id ? `${scope}:${id}` : ''
    },
    isProfileOpen(scope, item) {
      const key = this.profileKey(scope, item)
      return key ? this.profileOpen[key] === true : false
    },
    toggleProfile(scope, item) {
      const key = this.profileKey(scope, item)
      if (!key) return
      this.profileOpen = { ...this.profileOpen, [key]: !this.profileOpen[key] }
    },
    openWorkspacePicker() {
      this.workspaceQuery = ''
      this.workspacePickerVisible = true
    },
    closeWorkspacePicker() {
      this.workspacePickerVisible = false
      this.workspaceQuery = ''
    },
    async chooseWorkspaceFromPicker(path) {
      this.closeWorkspacePicker()
      await this.chooseWorkspace(path)
    },
    async perform(action, params = {}, options = {}) {
      try {
        const data = await evolutionAction(action, params)
        if (options.refresh !== false) {
          await Promise.all([
            refreshEvolution(true),
            loadEvolutionPersonal(Boolean(store.evolutionPersonal))
          ])
        }
        return data
      } catch (error) {
        this.toast(this.errorText(error))
        return null
      }
    },
    async confirm(options) {
      return openAppDialog({
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: t('取消'),
        danger: Boolean(options.danger)
      })
    },
    cycleTone(status) {
      if (status === 'completed') return 'pass'
      if (status === 'rejected') return 'warn'
      return 'fail'
    },
    cycleLabel(status) {
      if (status === 'completed') return t('本轮完成')
      if (status === 'rejected') return t('本轮未采用')
      return t('本轮失败')
    },
    stageLabel(key) {
      if (key === 'evidence') return t('收集证据')
      if (key === 'propose') return t('提出改进')
      if (key === 'review') return t('独立评审')
      if (key === 'apply') return t('应用或保留')
      return t('回归观察')
    },
    scoreTone(score) {
      if (score >= 85) return 'excellent'
      if (score >= 75) return 'pass'
      if (score >= 60) return 'warn'
      return 'fail'
    },
    profileStatus(profile) {
      if (profile.status === 'active') return t('已启用')
      if (profile.status === 'retired') return t('已退役')
      if (profile.review?.pass) return t('待启用')
      return t('草稿')
    },
    changeSummary(version) {
      return t('{v1} 个文件', { v1: version.files?.length || 0 })
    },
    upgradeStatusText(report) {
      if (report.validation === 'failed') return t('合并结果未通过检查')
      if (report.validation === 'skipped') return t('合并结果尚未验证（缺少依赖）')
      return t('合并结果尚未验证')
    },
    contributionLabel(status) {
      if (status === 'uploaded') return t('已提交')
      if (status === 'failed') return t('上传失败')
      return t('待发送')
    },
    async toggleAuto() {
      if (this.busy) return
      const next = !this.state?.autoEvolve
      const data = await this.perform('auto', { value: next }, { refresh: false })
      if (data && store.evolution) {
        store.evolution.autoEvolve = data.autoEvolve === true
      }
    },
    async runCycle() {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('立即运行一轮系统进化？'),
        message: t('Pilot 会收集近期运行、提出改进并交给独立模型评审。过程可能需要几分钟，期间可以离开这个页面。'),
        confirmText: t('开始进化')
      })
      if (!ok) return
      await this.perform('cycle', { workspacePath: this.state.workspacePath })
    },
    async improvePolicy() {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('改进进化机制？'),
        message: t('Pilot 会根据历史轮次调整自己的节奏与阈值，交给独立模型评审，通过后自动启用。所有数值都有硬上限，随时可以回滚。'),
        confirmText: t('开始调整')
      })
      if (!ok) return
      await this.perform('improvePolicy', { workspacePath: this.state.workspacePath })
    },
    async rollbackPolicy() {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('回滚进化机制？'),
        message: t('当前版本的节奏和阈值会退役，但不会被删除。'),
        confirmText: t('回滚'),
        danger: true
      })
      if (!ok) return
      await this.perform('rollbackPolicy')
    },
    async propose() {
      if (!this.canPropose || this.busy) return
      const ok = await this.confirm({
        title: t('提出新的行为版本？'),
        message: t('Pilot 会基于当前工作区的真实运行记录提出提示词和策略调整，生成草稿后仍需独立评审。'),
        confirmText: t('提出改进')
      })
      if (!ok) return
      await this.perform('propose', { workspacePath: this.state.workspacePath })
    },
    async reviewProfile(profile) {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('对 v{v1} 做独立评审？', { v1: profile.version }),
        message: t('会调用你配置的评审模型，按 100 分制审查。通过后才能启用。'),
        confirmText: t('开始评审')
      })
      if (!ok) return
      const result = await this.perform('review', {
        workspacePath: this.state.workspacePath,
        profileId: profile.id
      })
      if (result?.profile?.review) {
        this.toast(
          result.profile.review.pass
            ? t('评审通过（{v1} 分）。', { v1: result.profile.review.score })
            : t('评审未通过（{v1} 分）。', { v1: result.profile.review.score })
        )
      }
    },
    async activateProfile(profile) {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('启用 v{v1}？', { v1: profile.version }),
        message: t('启用后，本工作区的新任务会使用这个版本的提示词与策略；随时可以回滚。'),
        confirmText: t('启用')
      })
      if (!ok) return
      await this.perform('activate', {
        workspacePath: this.state.workspacePath,
        profileId: profile.id
      })
    },
    async deleteProfile(profile) {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('删除草稿 v{v1}？', { v1: profile.version }),
        message: t('删除后无法恢复。'),
        confirmText: t('删除'),
        danger: true
      })
      if (!ok) return
      await this.perform('delete', {
        workspacePath: this.state.workspacePath,
        profileId: profile.id
      })
    },
    async promoteProfile(profile) {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('提升 v{v1} 为全局候选？', { v1: profile.version }),
        message: t('Pilot 会把项目专属规则泛化成跨项目规则；它仍需独立评审和你的手动启用。'),
        confirmText: t('生成全局候选')
      })
      if (!ok) return
      await this.perform('promote', {
        workspacePath: this.state.workspacePath,
        profileId: profile.id
      })
    },
    async rollbackProfile() {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('回滚到上一个版本？'),
        message: t('当前版本会退役，但不会被删除。'),
        confirmText: t('回滚'),
        danger: true
      })
      if (!ok) return
      await this.perform('rollback', { workspacePath: this.state.workspacePath })
    },
    async reviewGlobalProfile(profile) {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('对全局 v{v1} 做独立评审？', { v1: profile.version }),
        message: t('全局规则影响所有工作区，评审通过后仍需要你手动启用。'),
        confirmText: t('开始评审')
      })
      if (!ok) return
      const result = await this.perform('globalReview', { profileId: profile.id })
      if (result?.profile?.review) {
        this.toast(
          result.profile.review.pass
            ? t('评审通过（{v1} 分）。', { v1: result.profile.review.score })
            : t('评审未通过（{v1} 分）。', { v1: result.profile.review.score })
        )
      }
    },
    async activateGlobalProfile(profile) {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('启用全局 v{v1}？', { v1: profile.version }),
        message: t('它会影响所有工作区；启用前请确认评审意见。'),
        confirmText: t('启用')
      })
      if (!ok) return
      await this.perform('globalActivate', { profileId: profile.id })
    },
    async deleteGlobalProfile(profile) {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('删除全局草稿 v{v1}？', { v1: profile.version }),
        message: t('删除后无法恢复。'),
        confirmText: t('删除'),
        danger: true
      })
      if (!ok) return
      await this.perform('globalDelete', { profileId: profile.id })
    },
    async rollbackGlobal() {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('回滚全局版本？'),
        message: t('当前全局版本会退役，但不会被删除；所有工作区都会受到影响。'),
        confirmText: t('回滚'),
        danger: true
      })
      if (!ok) return
      await this.perform('globalRollback')
    },
    async openSource() {
      if (this.busy) return
      const result = await this.perform('personalOpenSource')
      if (result?.path) {
        this.toast(t('个人源码已准备好。'))
        await refreshSessions(true)
        await setEvolutionWorkspace(result.path)
      }
    },
    /**
     * 内置源码本身就是一个普通工作区：准备好之后直接开一个新对话，
     * 用户用自然语言说想改什么，Pilot 读源码、修改、跑门禁并构建个人版。
     */
    async chatSource() {
      if (this.busy || !this.hasKey) return
      const result = await this.perform('personalOpenSource')
      if (!result?.path) return
      await refreshSessions(true)
      await setEvolutionWorkspace(result.path)
      startNewChat(
        result.path,
        t('我想改造自己的 Pilot。请先读 SELF.md，了解源码结构和构建方式，然后用简短的话说明可以定制哪些地方，并问我最想改什么。先不要改代码，等我确认。')
      )
      uni.navigateTo({ url: '/pages/chat/index?new=1' })
    },
    async buildPersonal() {
      if (this.busy || !this.hasKey) return
      const result = await this.perform('personalBuild', {}, { refresh: false })
      if (result?.sessionId) {
        await refreshSessions(true)
        selectSession(result.sessionId)
        uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(result.sessionId)}` })
      }
    },
    openSaveDialog() {
      this.textDialog = {
        ...EMPTY_DIALOG,
        visible: true,
        mode: 'save',
        title: t('保存当前个人版本'),
        confirmText: t('保存')
      }
    },
    openSubmitDialog(version) {
      this.textDialog = {
        ...EMPTY_DIALOG,
        visible: true,
        mode: 'submit',
        title: t('提交个人版本 {v1}', { v1: version.name }),
        confirmText: t('提交'),
        note: version.note || version.name,
        versionId: version.id
      }
    },
    closeTextDialog() {
      if (this.textDialog.busy) return
      this.textDialog = { ...EMPTY_DIALOG }
    },
    async confirmTextDialog() {
      const dialog = this.textDialog
      if (dialog.busy) return
      if (dialog.mode === 'save' && !dialog.name.trim()) {
        this.toast(t('请填写版本名称。'))
        return
      }
      if (dialog.mode === 'submit' && !dialog.note.trim()) {
        this.toast(t('请填写改动说明。'))
        return
      }
      this.textDialog.busy = true
      try {
        if (dialog.mode === 'save') {
          const version = await evolutionAction('personalSave', {
            name: dialog.name.trim(),
            note: dialog.note.trim()
          })
          this.toast(t('已保存版本“{v1}”。', { v1: version?.name || dialog.name.trim() }))
        } else {
          const record = await evolutionAction('personalSubmit', {
            versionId: dialog.versionId,
            note: dialog.note.trim()
          })
          this.toast(
            record?.status === 'uploaded'
              ? t('已提交官方。')
              : record?.status === 'failed'
                ? t('上传失败，贡献包已保存在电脑上。')
                : t('贡献包已生成。')
          )
        }
        this.textDialog = { ...EMPTY_DIALOG }
        await loadEvolutionPersonal(true)
      } catch (error) {
        this.toast(this.errorText(error))
        this.textDialog.busy = false
      }
    },
    async mergeUpgrade() {
      if (this.busy) return
      let plan
      try {
        plan = await evolutionAction('personalUpgradePlan', {})
      } catch (error) {
        this.toast(this.errorText(error))
        return
      }
      if (!plan?.available) {
        this.toast(t('已经是最新的官方源码。'))
        await loadEvolutionPersonal(true)
        return
      }
      if (plan.requiresManual) {
        const ok = await this.confirm({
          title: t('需要手动迁移官方更新'),
          message: t('找不到升级前的官方基线。Pilot 会对照新版官方源码逐文件迁移，并保留你的改动。现在开始？'),
          confirmText: t('让 Pilot 迁移')
        })
        if (!ok) return
        const result = await this.perform(
          'personalResolve',
          {
            toVersion: plan.toVersion,
            officialCopyPath: plan.officialCopyPath || '.pilot-upgrade/official'
          },
          { refresh: false }
        )
        if (result?.sessionId) {
          await refreshSessions(true)
          selectSession(result.sessionId)
          uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(result.sessionId)}` })
        }
        return
      }
      const ok = await this.confirm({
        title: t('合并官方 v{v1}？', { v1: plan.toVersion }),
        message: t('官方更新 {v1} 个文件，保留你的改动 {v2} 个，自动合并 {v3} 个，冲突 {v4} 个。合并前会自动备份。', {
          v1: plan.counts.upstream,
          v2: plan.counts.kept,
          v3: plan.counts.merged,
          v4: plan.counts.conflicts
        }),
        confirmText: t('开始合并')
      })
      if (!ok) return
      let result
      try {
        result = await evolutionAction('personalUpgradeApply', {})
      } catch (error) {
        this.toast(this.errorText(error))
        return
      }
      await loadEvolutionPersonal(true)
      if (result?.conflicts?.length) {
        const resolve = await this.confirm({
          title: t('有 {v1} 个文件仍有冲突', { v1: result.conflicts.length }),
          message: t('让 Pilot 逐个解决冲突，并检查跨文件调用是否同步？'),
          confirmText: t('让 Pilot 处理')
        })
        if (!resolve) return
        const assistant = await this.perform(
          'personalResolve',
          {
            toVersion: result.toVersion,
            conflicts: result.conflicts.map((item) => item.path)
          },
          { refresh: false }
        )
        if (assistant?.sessionId) {
          await refreshSessions(true)
          selectSession(assistant.sessionId)
          uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(assistant.sessionId)}` })
        }
        return
      }
      this.toast(t('官方更新已合并，正在运行检查…'))
      await this.validateUpgrade()
    },
    async validateUpgrade() {
      if (this.busy) return
      try {
        const report = await evolutionAction('personalUpgradeValidate', {})
        await loadEvolutionPersonal(true)
        this.toast(
          report?.validation === 'passed'
            ? t('检查通过：typecheck 和测试都通过了。')
            : t('检查未完成：{v1}', { v1: report?.message || '' })
        )
      } catch (error) {
        this.toast(this.errorText(error))
      }
    },
    async fixUpgrade() {
      if (this.busy || !this.hasKey || !this.personal?.lastUpgrade) return
      const report = this.personal.lastUpgrade
      const ok = await this.confirm({
        title: t('让 Pilot 修复合并结果？'),
        message: t('它会在聊天里读取检查输出，处理跨文件调用不一致，然后重新构建个人版。'),
        confirmText: t('让 Pilot 修复')
      })
      if (!ok) return
      const details = [report.message, report.output ? report.output.slice(-1500) : '']
        .filter(Boolean)
        .join('\n\n')
      const result = await this.perform(
        'personalFix',
        { toVersion: report.toVersion, details },
        { refresh: false }
      )
      if (result?.sessionId) {
        await refreshSessions(true)
        selectSession(result.sessionId)
        uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(result.sessionId)}` })
      }
    },
    async rollbackMerge() {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('撤销上次合并？'),
        message: t('会恢复合并前自动备份的文件；合并后你对这些文件的修改会丢失。'),
        confirmText: t('撤销合并'),
        danger: true
      })
      if (!ok) return
      await this.perform('personalUpgradeRollback')
    },
    async restoreVersion(version) {
      if (this.busy) return
      const ok = await this.confirm({
        title: t('恢复“{v1}”？', { v1: version.name }),
        message: t('只回写该版本记录的 {v1} 个文件；之后新增的其他改动会保留。', {
          v1: version.files?.length || 0
        }),
        confirmText: t('恢复'),
        danger: true
      })
      if (!ok) return
      await this.perform('personalRestore', { versionId: version.id })
    }
  }
}
</script>

<style>
.evolution-page {
  min-height: 100vh;
  padding: calc(var(--status-bar-height) + 16rpx) 24rpx 0;
  box-sizing: border-box;
  background: var(--page);
  color: var(--text);
}
.evo-topbar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 6rpx 4rpx 20rpx;
}
.evo-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  margin-right: 2rpx;
  color: var(--accent-soft);
  flex-shrink: 0;
}
.evo-title {
  flex: 1;
  color: var(--text-strong);
  font-size: calc(36rpx * var(--font-scale));
  font-weight: 650;
}
.evo-refresh {
  color: var(--accent-soft);
  font-size: calc(25rpx * var(--font-scale));
  padding: 10rpx 4rpx;
}
.evo-refresh.disabled {
  color: var(--dim);
}
.evo-scroll {
  /* 标题栏 + 页签行各占一截，剩下都给滚动区。 */
  height: calc(100vh - var(--status-bar-height) - 170rpx);
  /* 滚动容器会裁掉横向阴影，向左右借 24rpx 页面留白；宽度同步加宽，
     否则只向左偏移，右侧会空出一条。内容再用内边距放回原位。 */
  width: calc(100% + 48rpx);
  margin: 0 -24rpx;
}
.evo-content {
  /* 顶部留白让第一张卡片的上方光晕有地方画。 */
  padding: 12rpx 24rpx 40rpx;
}
/* 页签：一行横排，靠 accent 底色区分当前页，避免再加一行副标题。 */
.evo-tabs {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 0 4rpx 16rpx;
  overflow: hidden;
}
.evo-tab {
  flex: none;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.evo-tab.active {
  background: var(--accent-wash);
}
.evo-tab-label {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.4;
}
.evo-tab.active .evo-tab-label {
  color: var(--accent-soft);
  font-weight: 600;
}
.evo-panel {
  padding: 12rpx 24rpx 40rpx;
}
.evo-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  padding: 140rpx 40rpx;
  text-align: center;
}
.evo-empty-title {
  color: var(--text);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 600;
}
.evo-empty-hint {
  color: var(--muted);
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.65;
}
.evo-project {
  margin-bottom: 18rpx;
}
.evo-project-label {
  display: block;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  margin-bottom: 8rpx;
}
.evo-project-trigger {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  background: var(--surface);
}
.evo-project-trigger.open {
  background: var(--accent-wash-soft);
}
.evo-project-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.evo-project-name {
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.evo-project-path {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.evo-project-caret {
  flex: none;
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
}
.evo-picker-search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 0 30rpx 14rpx;
  padding: 0 20rpx;
  height: 72rpx;
  border-radius: 16rpx;
  background: var(--input-bg);
  box-sizing: border-box;
}
.evo-picker-search-icon {
  flex: none;
  color: var(--muted);
  font-size: calc(30rpx * var(--font-scale));
}
.evo-picker-search-input {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
}
.evo-picker-search-placeholder {
  color: var(--dim);
}
.evo-picker-search-clear {
  flex: none;
  color: var(--muted);
  font-size: calc(30rpx * var(--font-scale));
  padding: 0 4rpx;
}
.evo-picker-list {
  padding: 0 30rpx;
  box-sizing: border-box;
}
.evo-picker-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 20rpx;
  margin-bottom: 10rpx;
  border-radius: 14rpx;
  background: var(--surface);
}
.evo-picker-item.active {
  background: var(--accent-wash-soft);
}
.evo-picker-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.evo-picker-name {
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.evo-picker-path {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.evo-picker-check {
  flex: none;
  color: var(--accent-soft);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 700;
}
.evo-picker-empty {
  padding: 40rpx 20rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  align-items: center;
  text-align: center;
}
.evo-picker-empty-title {
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 600;
}
.evo-picker-empty-hint {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.6;
}
.evo-summary {
  display: flex;
  gap: 12rpx;
  margin-bottom: 20rpx;
}
.evo-summary-item {
  flex: 1;
  min-width: 0;
  padding: 20rpx 10rpx;
  border-radius: 18rpx;
  background: var(--surface);
  text-align: center;
}
.evo-summary-value {
  display: block;
  color: var(--text-strong);
  font-size: calc(34rpx * var(--font-scale));
  font-weight: 650;
}
.evo-summary-label {
  display: block;
  margin-top: 4rpx;
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
}
.evo-card {
  background: var(--surface);
  border-radius: 22rpx;
  padding: 26rpx;
  margin-bottom: 22rpx;
}
.evo-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 14rpx;
}
.evo-card-title {
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 600;
}
.evo-card-action {
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  padding: 8rpx 2rpx;
  flex-shrink: 0;
}
.evo-card-action.disabled {
  color: var(--dim);
}
.evo-hint {
  display: block;
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.65;
  margin-top: 8rpx;
}
.evo-hint.warn {
  color: #c9ab7c;
}
.evo-hint.error {
  color: var(--danger);
}
.evo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 18rpx;
}
.evo-actions-end {
  justify-content: flex-end;
}
.evo-btn {
  box-sizing: border-box;
  margin: 0;
  padding: 0 var(--btn-pad-sm);
  height: var(--btn-h-sm);
  font-size: var(--btn-font-sm);
  border-radius: var(--btn-radius-sm);
  line-height: 1.2;
}
.evo-btn.danger {
  color: var(--btn-danger-fg, var(--danger));
}
.evo-toggle-wrap {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.evo-toggle {
  width: 78rpx;
  height: 44rpx;
  border-radius: 999rpx;
  background: var(--surface-3);
  position: relative;
  transition: background 0.2s ease;
}
.evo-toggle.on {
  background: var(--accent-wash-strong);
}
.evo-toggle.disabled {
  opacity: 0.5;
}
.evo-toggle-knob {
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  width: 34rpx;
  height: 34rpx;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.2s ease;
}
.evo-toggle.on .evo-toggle-knob {
  transform: translateX(34rpx);
}
.evo-toggle-label {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
}
.evo-toggle.on + .evo-toggle-label {
  color: var(--accent-soft);
}
.evo-policy {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 16rpx;
}
.evo-policy-chip {
  padding: 7rpx 14rpx;
  border-radius: 999rpx;
  background: var(--bg-soft);
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
}
.evo-focus {
  display: block;
  margin-top: 12rpx;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.6;
}
.evo-cycle {
  margin-top: 18rpx;
  padding: 18rpx;
  border-radius: 16rpx;
  background: var(--bg-soft);
}
.evo-cycle-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.evo-cycle-status {
  font-size: calc(23rpx * var(--font-scale));
  font-weight: 600;
}
.evo-cycle-status.pass {
  color: var(--ok);
}
.evo-cycle-status.warn {
  color: var(--warn);
}
.evo-cycle-status.fail {
  color: var(--danger);
}
.evo-time {
  margin-left: auto;
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  flex-shrink: 0;
}
.evo-cycle-summary {
  display: block;
  margin-top: 8rpx;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.6;
}
.evo-stage {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
  margin-top: 12rpx;
}
.evo-stage-dot {
  width: 12rpx;
  height: 12rpx;
  margin-top: 10rpx;
  border-radius: 50%;
  background: var(--dim);
  flex-shrink: 0;
}
.evo-stage-dot.done {
  background: var(--ok);
}
.evo-stage-dot.failed {
  background: var(--danger);
}
.evo-stage-dot.skipped {
  background: var(--warn);
}
.evo-stage-name {
  color: var(--text);
  font-size: calc(22rpx * var(--font-scale));
  flex-shrink: 0;
}
.evo-stage-detail {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
  flex: 1;
  min-width: 0;
}
.evo-inline-empty {
  display: block;
  margin-top: 14rpx;
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
}
.evo-profile {
  margin-top: 18rpx;
  padding-top: 18rpx;
}
.evo-profile:first-of-type {
  padding-top: 8rpx;
}
.evo-profile-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  /* 整行都是展开/收起的点击区域，给一点上下内边距方便点按。 */
  padding: 4rpx 0;
}
.evo-profile-head .evo-time {
  margin-left: auto;
}
.evo-profile-version {
  color: var(--text-strong);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
}
.evo-badge {
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  font-size: calc(19rpx * var(--font-scale));
  color: var(--muted);
  background: var(--bg-soft);
}
.evo-badge.active {
  color: var(--ok-soft);
  background: rgba(152, 183, 158, 0.12);
}
.evo-badge.retired {
  color: var(--dim);
}
/* 分数是列表第一眼要看的指标，单独放大，详情默认折叠。 */
.evo-score-block {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
  min-width: 76rpx;
}
.evo-score-value {
  font-size: calc(32rpx * var(--font-scale));
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.evo-score-value.empty {
  color: var(--dim);
}
.evo-score-value.excellent {
  color: var(--ok);
}
.evo-score-value.pass {
  color: var(--accent-soft);
}
.evo-score-value.warn {
  color: var(--warn);
}
.evo-score-value.fail {
  color: var(--danger);
}
.evo-score-label {
  color: var(--dim);
  font-size: calc(18rpx * var(--font-scale));
}
.evo-profile-toggle {
  flex-shrink: 0;
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
}
.evo-profile-caret {
  flex-shrink: 0;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1;
  transition: transform 0.15s ease;
}
.evo-profile-caret.open {
  transform: rotate(180deg);
}
.evo-profile-body {
  padding-top: 2rpx;
}
.evo-profile-note {
  display: block;
  margin-top: 8rpx;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.6;
}
.evo-profile-review {
  display: block;
  margin-top: 8rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  background: var(--bg-soft);
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.evo-personal-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 14rpx;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
}
.evo-personal-meta .muted {
  color: var(--dim);
}
.evo-upgrade {
  margin-top: 16rpx;
  padding: 16rpx;
  border-radius: 16rpx;
  background: var(--accent-wash-soft);
}
.evo-upgrade.warn {
  background: rgba(201, 171, 124, 0.08);
}
.evo-upgrade-title {
  display: block;
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  font-weight: 600;
}
.evo-contributions {
  margin-top: 20rpx;
}
.evo-section-subtitle {
  display: block;
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 600;
  margin-bottom: 8rpx;
}
.evo-contribution {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 0;
}
.evo-contribution-status {
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  font-size: calc(19rpx * var(--font-scale));
  color: var(--muted);
  background: var(--bg-soft);
  flex-shrink: 0;
}
.evo-contribution-status.uploaded {
  color: var(--ok-soft);
  background: rgba(152, 183, 158, 0.12);
}
.evo-contribution-status.failed {
  color: var(--danger);
  background: rgba(201, 146, 141, 0.1);
}
.evo-contribution-note {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(22rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.evo-bottom-hint {
  margin: 4rpx 6rpx 0;
}
.evo-bottom-gap {
  height: 30rpx;
}
.evo-dialog-fields {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.evo-dialog-input,
.evo-dialog-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 18rpx 20rpx;
  border-radius: 14rpx;
  background: var(--input-bg);
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
}
.evo-dialog-textarea {
  min-height: 160rpx;
  line-height: 1.55;
}
</style>
