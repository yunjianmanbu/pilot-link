<template>
  <view class="page settings-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="topbar">
      <view class="back" @click="back"><view class="back-arrow"></view></view>
      <text class="title">{{ t('设置') }}</text>
    </view>

    <!-- 设置目录：固定在标题栏下方，圆角卡片等宽排列，一点直达。 -->
    <view id="settings-nav" class="settings-nav">
      <view class="settings-nav-grid">
        <view
          v-for="item in settingsNavItems"
          :key="item.id"
          class="settings-nav-card"
          :class="{ active: activeSection === item.id }"
          @click="selectSettingsSection(item)"
        >
          <text class="settings-nav-label">{{ item.label }}</text>
        </view>
      </view>
    </view>

    <view v-if="activeSection === 'settings-connection'" id="settings-devices" class="card">
      <view class="card-head">
        <text class="card-title">{{ t('已配对电脑') }}</text>
        <text class="card-head-action" @click="addDevice">{{ t('＋ 添加电脑') }}</text>
      </view>
      <view
        v-for="item in store.pairings"
        :key="item.deviceId"
        class="device-row"
        :class="{ active: isActiveDevice(item.deviceId) }"
      >
        <view class="device-main">
          <view class="device-name-row">
            <text class="device-name">{{ item.deviceName || t('未命名电脑') }}</text>
            <text v-if="isActiveDevice(item.deviceId)" class="device-current">{{ t('当前') }}</text>
          </view>
          <text class="device-host">{{ relayHostOf(item.relayUrl) }}</text>
        </view>
        <view class="device-row-actions">
          <text
            v-if="!isActiveDevice(item.deviceId)"
            class="chip device-row-action"
            @click="switchDevice(item.deviceId)"
          >
            {{ t('切换') }}
          </text>
          <text class="chip device-row-action danger" @click="removeDeviceConfirm(item)">{{ t('移除') }}</text>
        </view>
      </view>
      <text v-if="store.pairings.length === 0" class="hint">{{ t('还没有配对电脑，点右上角添加。') }}</text>
      <text v-else class="hint">
        {{ t('同一时刻连接一台电脑；切换后会自动加载那台电脑的会话列表。') }}
      </text>
      <view class="card-actions single">
        <button class="btn ghost small-btn" @click="openConnectPhone">{{ t('显示连接二维码') }}</button>
      </view>
      <text class="hint">
        {{ t('不在电脑前时，用另一台手机扫描二维码连接同一台电脑。') }}
      </text>
    </view>

    <view v-if="activeSection === 'settings-models'" id="settings-models" class="card model-card">
      <view class="card-head">
        <text class="card-title">{{ t('模型') }}</text>
        <text class="card-head-action" @click="loadModels">
          {{ modelsLoading ? t('读取中…') : t('刷新') }}
        </text>
      </view>

      <text v-if="!desktopOnline" class="hint">
        {{ t('连接电脑后，可以选择会话模型和评估模型。') }}
      </text>
      <text v-else-if="modelsSupported === false" class="hint warn">
        {{ t('这台电脑的 Pilot 版本较旧，不支持在手机上选择模型。请先在电脑上安装新版 Pilot。') }}
      </text>
      <text v-else-if="modelsError" class="hint error">{{ modelsError }}</text>
      <template v-else-if="modelSettings">
        <text class="hint">
          {{ t('模型资源在电脑端「设置 → 模型资源」统一配置；这里选择会话和评估使用哪些资源。') }}
        </text>

        <view class="model-resource-list">
          <view
            v-for="resource in modelResources"
            :key="resource.id"
            class="model-resource-row"
            :class="{ disabled: !resource.enabled }"
          >
            <view class="model-resource-main">
              <text class="model-resource-name">
                {{ modelOptionLabel(resource.label || resource.model || t('未命名模型'), resource.tag) }}
              </text>
              <text class="model-resource-model">{{ resource.model || t('未配置') }}</text>
            </view>
            <text class="model-resource-tag" :class="{ warn: !resource.hasKey || !resource.enabled }">
              {{ !resource.enabled ? t('已停用') : resource.hasKey ? t('已配置密钥') : t('缺少密钥') }}
            </text>
          </view>
        </view>
        <text v-if="modelResources.length === 0" class="hint warn">
          {{ t('电脑端还没有模型资源。请先在电脑端「设置 → 模型资源」添加，再回到这里选择。') }}
        </text>

        <view class="model-field">
          <text class="model-field-label">{{ t('会话模型') }}</text>
          <view class="model-picker" @click="openSessionModelPicker">
            <view class="model-select">
              <text class="model-select-text">{{ sessionModelTitle }}</text>
              <text class="model-select-caret">▾</text>
            </view>
          </view>
        </view>

        <view class="model-eval-head">
          <text class="model-field-label">{{ t('评估模型') }}</text>
          <text class="model-eval-note">{{ t('推荐两个独立模型') }}</text>
        </view>
        <text class="hint">
          {{ t('默认第一评估和第二评估；可增加更多，也可减少到一个。未选择时由会话模型自评，不算独立评审。') }}
        </text>
        <view
          v-for="(id, index) in modelEvaluationIds"
          :key="`model-eval-${index}`"
          class="model-eval-row"
        >
          <text class="model-eval-label">{{ evaluationLabel(index) }}</text>
          <view class="model-picker" @click="openEvaluationPicker(index)">
            <view class="model-select eval">
              <text class="model-select-text">{{ evaluationTitle(index) }}</text>
              <text class="model-select-caret">▾</text>
            </view>
          </view>
          <text
            class="model-eval-remove"
            :class="{ disabled: modelEvaluationIds.length <= 1 }"
            @click="removeEvaluation(index)"
          >{{ t('移除') }}</text>
        </view>
        <text
          class="card-head-action add-eval"
          :class="{ disabled: modelEvaluationIds.length >= maxEvaluationModels }"
          @click="addEvaluation"
        >{{ t('＋ 添加评估模型') }}</text>

        <view class="card-actions single">
          <button class="btn primary small-btn" :disabled="modelsSaving" @click="saveModelSelection">
            {{ modelsSaving ? t('保存中…') : t('保存模型选择') }}
          </button>
        </view>
      </template>
    </view>

    <view v-if="activeSection === 'settings-models'" class="card billing-card">
      <view class="card-head">
        <text class="card-title">{{ t('余额与费用') }}</text>
        <text class="card-head-action" @click="loadBilling(true)">
          {{ billingLoading ? t('读取中…') : t('刷新') }}
        </text>
      </view>

      <view v-if="!billingOnline" class="billing-row">
        <text class="hint">{{ t('连接电脑后才能读取余额与费用。') }}</text>
      </view>
      <view v-else-if="billingError" class="billing-row">
        <text class="billing-warn">{{ billingError }}</text>
        <text class="hint">{{ t('需要电脑端为 0.1.30 或更新版本。') }}</text>
      </view>
      <template v-else>
        <view class="billing-summary">
          <view class="billing-block">
            <text class="billing-label">{{ t('可用余额') }}</text>
            <text class="billing-value">{{ balanceText }}</text>
            <text v-if="balanceDetail" class="billing-note">{{ balanceDetail }}</text>
          </view>
          <view class="billing-block">
            <text class="billing-label">{{ t('本机估算费用') }}</text>
            <text class="billing-value">{{ costText }}</text>
            <text v-if="usageDetail" class="billing-note">{{ usageDetail }}</text>
          </view>
        </view>

        <view v-if="billingBalance && !billingBalance.ok" class="billing-row">
          <text class="billing-warn">{{ balanceErrorText }}</text>
        </view>
        <view
          v-else-if="billingBalance && billingBalance.available === false"
          class="billing-row"
        >
          <text class="billing-warn">{{ t('余额不足，新的请求会被拒绝。') }}</text>
        </view>

        <view v-if="billingAccounts.length > 1" class="billing-accounts">
          <text class="billing-section-title">{{ t('所有模型余额') }}</text>
          <view
            v-for="account in billingAccounts"
            :key="account.id"
            class="billing-account-row"
            :class="{ disabled: !account.enabled }"
          >
            <view class="billing-account-main">
              <view class="billing-account-name-row">
                <text class="billing-account-role">
                  {{ account.role === 'judge' ? t('其他模型') : t('主模型') }}
                </text>
                <text v-if="!account.enabled" class="billing-account-tag">{{ t('已停用') }}</text>
              </view>
              <text class="billing-account-model">{{ account.model || account.label || t('未配置') }}</text>
              <text v-if="accountHost(account)" class="billing-account-host">{{ accountHost(account) }}</text>
            </view>
            <text class="billing-account-value" :class="{ warn: accountBalanceWarn(account) }">
              {{ accountBalanceText(account) }}
            </text>
          </view>
        </view>

        <view v-if="billingRows.length" class="billing-models">
          <view v-for="row in billingRows" :key="row.model || 'unknown'" class="billing-model-row">
            <text class="billing-model-name">{{ row.model || t('未记录模型') }}</text>
            <text class="billing-model-tokens">
              {{ formatTokens(row.promptTokens + row.completionTokens) }}
            </text>
            <text class="billing-model-cost">{{ formatCost(row.estimatedCostUsd, costLocale) }}</text>
          </view>
        </view>

        <text class="hint">
          {{ t('各模型余额分别来自对应账户；费用按电脑记录的 token 用量估算，仅供参考。') }}
        </text>
        <text v-if="costCurrency === 'CNY'" class="hint">
          {{ costRateHint }}
        </text>
        <text v-if="billingUpdatedText" class="note">{{ billingUpdatedText }}</text>
      </template>
    </view>

    <view v-if="activeSection === 'settings-update'" id="settings-update" class="card desktop-update-card">
      <view class="card-head">
        <text class="card-title">{{ t('电脑端更新') }}</text>
        <text
          v-if="!desktopUpdateUnsupported"
          class="card-head-action"
          :class="{ disabled: !desktopOnline || desktopChecking }"
          @click="checkDesktopUpdate"
        >{{ desktopChecking ? t('检查中…') : t('检查更新') }}</text>
      </view>
      <view class="row">
        <text class="label">{{ t('电脑端版本') }}</text>
        <text class="value small">{{ store.agentVersion || '—' }}</text>
      </view>
      <view class="row">
        <text class="label">{{ t('状态') }}</text>
        <text class="value small" :class="desktopStatusClass">{{ desktopStatusText }}</text>
      </view>
      <text v-if="desktopUpdateUnsupported" class="hint warn">
        {{ t('这台电脑的 Pilot 版本较旧，不支持在手机上检查更新。请先在电脑上安装新版 Pilot，之后就能在手机上检查和安装。') }}
      </text>
      <view
        v-if="desktopUpdate && desktopUpdate.release && desktopUpdate.status === 'available'"
        class="desktop-release"
      >
        <text class="desktop-release-version">v{{ desktopUpdate.release.version }}</text>
        <text v-if="desktopUpdate.release.notes" class="desktop-release-notes">{{ desktopUpdate.release.notes }}</text>
      </view>
      <view v-if="desktopProgressVisible" class="update-bar">
        <view class="update-bar-fill" :style="{ width: desktopProgressWidth }"></view>
      </view>
      <text
        v-if="desktopUpdate && desktopUpdate.status === 'error' && desktopUpdate.message"
        class="hint error"
      >{{ desktopUpdate.message }}</text>
      <text
        v-if="desktopUpdate && desktopUpdate.relocatingToUserDir && (desktopCanInstall || desktopUpdate.status === 'installing')"
        class="hint warn"
      >{{ t('这次安装会把电脑端迁移到当前用户目录，不再需要 Windows 授权；配对、会话和设置都会保留。') }}</text>
      <text
        v-else-if="desktopUpdate && desktopUpdate.elevationRequired && (desktopCanInstall || desktopUpdate.status === 'installing')"
        class="hint warn"
      >{{ t('电脑端安装在需要管理员权限的目录，安装时 Windows 会弹出授权框，请在电脑上点「是」。想以后免确认，可把 Pilot 重装到当前用户目录。') }}</text>
      <view v-if="desktopCanDownload || desktopCanInstall" class="desktop-actions">
        <button
          v-if="desktopCanDownload"
          class="btn primary small-btn"
          :disabled="!desktopOnline"
          @click="downloadDesktopUpdateAction"
        >{{ t('下载更新') }}</button>
        <button
          v-if="desktopCanInstall"
          class="btn primary small-btn"
          :disabled="!desktopOnline"
          @click="installDesktopUpdateAction"
        >{{ t('安装并重启电脑端') }}</button>
      </view>
      <text class="hint">
        {{
          !desktopOnline
            ? t('连接电脑后才能检查电脑端更新。')
            : desktopUpdateUnsupported
              ? t('电脑端升级到新版后，手机就能检查和安装电脑端更新。')
              : t('检查和下载由电脑执行；安装后电脑会重启，手机稍后自动重连。任务执行中不能安装。')
        }}
      </text>
    </view>

    <view v-if="activeSection === 'settings-appearance'" id="settings-appearance" class="card">
      <text class="card-title">{{ t('外观') }}</text>
      <view class="theme-options">
        <view
          v-for="option in themeOptions"
          :key="option.value"
          class="theme-option"
          :class="{ active: store.themeMode === option.value }"
          @click="chooseTheme(option.value)"
        >
          <text class="theme-name">{{ option.label }}</text>
          <text class="theme-check">{{ store.themeMode === option.value ? '✓' : '' }}</text>
        </view>
      </view>
      <text class="hint">{{ t('「跟随系统」会随手机的深色/浅色模式自动切换。') }}</text>
      <text class="section-label">{{ t('对比度') }}</text>
      <view class="theme-options">
        <view
          v-for="option in contrastOptions"
          :key="option.value"
          class="theme-option"
          :class="{ active: store.contrast === option.value }"
          @click="chooseContrast(option.value)"
        >
          <text class="theme-name">{{ option.label }}</text>
          <text class="theme-check">{{ store.contrast === option.value ? '✓' : '' }}</text>
        </view>
      </view>
      <text class="hint">{{ t('调整文字与页面底色的分离程度；低档更柔和，高档更鲜明，主题色保持不变。') }}</text>
      <text class="section-label">{{ t('饱和度') }}</text>
      <view class="theme-options">
        <view
          v-for="option in saturationOptions"
          :key="option.value"
          class="theme-option"
          :class="{ active: store.saturation === option.value }"
          @click="chooseSaturation(option.value)"
        >
          <text class="theme-name">{{ option.label }}</text>
          <text class="theme-check">{{ store.saturation === option.value ? '✓' : '' }}</text>
        </view>
      </view>
      <text class="hint">{{ t('调整主题色与功能色的鲜艳程度；黑白主题只有灰阶，看不出饱和度差异。') }}</text>
      <text class="section-label">{{ t('字号') }}</text>
      <view class="theme-options">
        <view
          v-for="option in fontSizeOptions"
          :key="option.value"
          class="theme-option"
          :class="{ active: store.fontSize === option.value }"
          @click="chooseFontSize(option.value)"
        >
          <text class="theme-name">{{ option.label }}</text>
          <text class="theme-check">{{ store.fontSize === option.value ? '✓' : '' }}</text>
        </view>
      </view>
      <text class="hint">{{ t('只放大文字，按钮和间距保持不变；标准就是原来的字号。') }}</text>
      <text class="section-label">{{ t('主题配色') }}</text>
      <view class="choice-grid">
        <view
          v-for="option in accentOptions"
          :key="option.value"
          class="choice-card"
          :class="{ active: store.accent === option.value }"
          @click="chooseAccent(option.value)"
        >
          <view class="choice-preview">
            <view class="accent-dot" :style="{ background: option.swatch }" />
            <view class="choice-skeleton">
              <view class="choice-bar bar-strong" />
              <view class="choice-bar bar-soft" />
            </view>
          </view>
          <view class="choice-meta">
            <text class="choice-name">{{ option.label }}</text>
            <text class="choice-check">{{ store.accent === option.value ? '✓' : '' }}</text>
          </view>
        </view>
      </view>
      <text class="hint">{{ t('每套配色都会切换底色与主题色，深色和浅色各自适配。') }}</text>
      <text class="section-label">{{ t('按钮方案') }}</text>
      <view class="choice-grid scheme-grid">
        <view
          v-for="option in buttonSchemeOptions"
          :key="option.value"
          class="choice-card"
          :class="[{ active: store.buttonScheme === option.value }, 'btn-scheme-' + option.value]"
          @click="chooseButtonScheme(option.value)"
        >
          <view class="choice-preview">
            <view class="scheme-pill scheme-pill-primary" />
            <view class="scheme-pill scheme-pill-soft" />
          </view>
          <view class="choice-meta">
            <text class="choice-name">{{ option.label }}</text>
            <text class="choice-check">{{ store.buttonScheme === option.value ? '✓' : '' }}</text>
          </view>
        </view>
      </view>
      <text class="hint">{{ t('按钮方案只调整主按钮、次按钮和危险按钮，不改变知识、文件、暂停等状态色。') }}</text>
    </view>

    <view v-if="activeSection === 'settings-appearance'" class="card">
      <text class="card-title">{{ t('语言') }}</text>
      <view class="theme-options">
        <view
          v-for="option in languageOptions"
          :key="option.value"
          class="theme-option"
          :class="{ active: localeSetting === option.value }"
          @click="chooseLocale(option.value)"
        >
          <text class="theme-name">{{ option.label }}</text>
          <text class="theme-check">{{ localeSetting === option.value ? '✓' : '' }}</text>
        </view>
      </view>
      <text class="hint">{{ t('界面语言。默认跟随系统；智能体始终使用你提问的语言回复。') }}</text>
    </view>

    <view v-if="activeSection === 'settings-connection'" id="settings-pairing" class="card">
      <text class="card-title">{{ t('配对信息') }}</text>
      <view class="row">
        <text class="label">{{ t('电脑') }}</text>
        <text class="value">{{ store.deviceName || store.pairing?.deviceName || '—' }}</text>
      </view>
      <view class="row">
        <text class="label">{{ t('中继') }}</text>
        <text class="value small">{{ relayHost || '—' }}</text>
      </view>
      <view class="row">
        <text class="label">{{ t('状态') }}</text>
        <text class="value" :class="statusClass">{{ statusText }}</text>
      </view>
      <view class="row">
        <text class="label">{{ t('配对时间') }}</text>
        <text class="value small">{{ pairedAt }}</text>
      </view>
      <view class="row">
        <text class="label">{{ t('最近活动') }}</text>
        <text class="value small">{{ lastActiveAt }}</text>
      </view>
      <view class="row">
        <text class="label">{{ t('手机名称') }}</text>
        <input v-model="phoneName" class="name-input" :maxlength="40" :placeholder="t('我的手机')" />
      </view>
      <view class="card-actions single">
        <button class="btn ghost small-btn" @click="saveName">{{ t('保存手机名称') }}</button>
      </view>
    </view>

    <view v-if="activeSection === 'settings-connection'" class="card">
      <text class="card-title">{{ t('连接') }}</text>
      <view class="row">
        <text class="label">{{ t('后台保持') }}</text>
        <text class="value small" :class="{ warn: keepAliveStateTone === 'warn' }">
          {{ keepAliveStateText }}
        </text>
      </view>
      <view class="row">
        <text class="label">{{ t('系统后台限制') }}</text>
        <text class="value small">{{ batteryStateText }}</text>
      </view>
      <text v-if="backgroundReportText" class="hint">{{ backgroundReportText }}</text>
      <text v-if="backgroundTraceText" class="hint">{{ backgroundTraceText }}</text>
      <view class="card-actions single">
        <button class="btn ghost small-btn" @click="openBatterySettingsPage">
          {{ t('允许后台运行') }}
        </button>
      </view>
      <text class="hint">
        {{ t('国产系统还需要在“应用启动管理”里把 Pilot 设为手动管理，并允许自启动和后台活动。') }}
      </text>
      <view class="card-actions">
        <button class="btn primary small-btn" @click="reconnect">{{ t('立即重新连接') }}</button>
        <button class="btn danger small-btn" @click="unpair">{{ t('解除当前电脑') }}</button>
      </view>
      <text class="hint">
        {{ t('只解除当前这台电脑；如果还有其它已配对电脑，会自动切换过去。') }}
      </text>
    </view>

    <!-- 安全与能力：手机只读展示沙箱和工具清单，启停仍在电脑端。 -->
    <view v-if="activeSection === 'settings-security'" id="settings-security" class="card">
      <view class="card-head">
        <text class="card-title">{{ t('安全与能力') }}</text>
        <text class="card-head-action" @click="loadSecurity">{{ t('刷新') }}</text>
      </view>
      <view class="row">
        <text class="label">{{ t('沙箱') }}</text>
        <text class="value small" :class="{ warn: sandboxWarn }">{{ sandboxText }}</text>
      </view>
      <text v-if="sandboxStatus?.detail" class="hint">{{ sandboxStatus.detail }}</text>
      <view class="row">
        <text class="label">{{ t('动态工具') }}</text>
        <text class="value small">{{ toolsSummary }}</text>
      </view>
      <text v-if="toolsError" class="hint error-hint">{{ toolsError }}</text>
      <view class="card-actions">
        <button class="btn ghost small-btn" @click="openTools">{{ t('查看工具清单') }}</button>
        <button class="btn ghost small-btn" @click="openQuick">{{ t('编辑快捷指令') }}</button>
        <button class="btn ghost small-btn" @click="openSelfCheck">{{ t('内视') }}</button>
        <button class="btn ghost small-btn" @click="openModuleCheck">{{ t('模块自检') }}</button>
        <button class="btn ghost small-btn" @click="openLearning">{{ t('自主探索学习') }}</button>
      </view>
      <text class="hint">
        {{ t('只读展示；沙箱、权限和工具启停仍在电脑端设置。') }}
      </text>
      <text class="hint">
        {{ t('内视、模块自检与自主探索学习可以在手机上操作。') }}
      </text>
    </view>

    <!-- 运行环境：只读展示电脑端的系统、CPU、内存与磁盘占用。 -->
    <view v-if="activeSection === 'settings-security'" class="card">
      <view class="card-head">
        <text class="card-title">{{ t('运行环境') }}</text>
        <text class="card-head-action" @click="loadEnvInfo">{{ t('刷新') }}</text>
      </view>
      <view v-if="envLoading" class="row">
        <text class="label">{{ t('状态') }}</text>
        <text class="value small">{{ t('读取中…') }}</text>
      </view>
      <template v-else-if="envInfo">
        <view v-for="row in envRows" :key="row.label" class="row">
          <text class="label">{{ row.label }}</text>
          <text class="value small" :class="{ warn: row.warn }">{{ row.value }}</text>
        </view>
        <text v-if="envInfo.disk && envInfo.disk.low" class="hint warn">
          {{ t('工作区所在卷剩余空间不足 {v1}，安装依赖或构建可能因 ENOSPC 失败。', { v1: lowDiskText }) }}
        </text>
      </template>
      <text v-else class="hint">{{ envError || t('无法读取运行环境') }}</text>
      <text class="hint">
        {{ t('只读展示；系统、内存和磁盘信息来自当前电脑。') }}
      </text>
    </view>

    <!-- 文件缓存：手机上打开过的文件留多久，只影响本机，不碰电脑上的文件。 -->
    <view v-if="activeSection === 'settings-security'" id="settings-file-cache" class="card">
      <text class="card-title">{{ t('文件缓存') }}</text>
      <view class="theme-options theme-options-grid">
        <view
          v-for="option in fileCacheDayOptions"
          :key="option.value"
          class="theme-option"
          :class="{ active: fileCacheDays === option.value }"
          @click="chooseFileCacheDays(option.value)"
        >
          <text class="theme-name">{{ option.label }}</text>
          <text class="theme-check">{{ fileCacheDays === option.value ? '✓' : '' }}</text>
        </view>
      </view>
      <text class="hint">
        {{ t('在手机上打开过的文件会缓存到本机，超过保存天数没再打开就自动清理；再看一次从这次查看重新计时。') }}
      </text>
      <text class="hint">
        {{ t('只影响这台手机上的缓存，不会改动电脑上的文件。') }}
      </text>
    </view>

    <view v-if="activeSection === 'settings-update'" id="settings-about" class="card">
      <text class="card-title">{{ t('关于') }}</text>
      <view class="row">
        <text class="label">{{ t('版本') }}</text>
        <text class="value small">{{ versionText }}</text>
      </view>

      <view v-if="updateVisible" class="update-box" :class="updateState.status">
        <view class="update-head">
          <text class="update-title">{{ updateTitle }}</text>
          <text v-if="updatePercentText" class="update-percent">{{ updatePercentText }}</text>
        </view>
        <view v-if="updateBarVisible" class="update-bar">
          <view class="update-bar-fill" :style="{ width: updateProgressWidth }"></view>
        </view>
        <text class="update-meta">{{ updateMeta }}</text>
        <view v-if="updateActionsVisible" class="update-actions">
          <button
            v-if="updateState.status === 'ready'"
            class="btn primary small-btn"
            @click="installUpdate"
          >
            {{ updateState.installerOpened ? t('再次安装') : t('立即安装') }}
          </button>
          <button
            v-else-if="updateState.status === 'error'"
            class="btn primary small-btn"
            @click="retryUpdate"
          >
            {{ t('重试下载') }}
          </button>
          <button
            v-if="updateState.status === 'downloading' || updateState.status === 'verifying'"
            class="btn ghost small-btn"
            @click="cancelUpdate"
          >
            {{ t('取消下载') }}
          </button>
          <button
            v-if="updateState.status === 'error'"
            class="btn ghost small-btn"
            @click="openDownloadPage"
          >
            {{ t('下载页') }}
          </button>
        </view>
      </view>

      <view class="card-actions single">
        <button class="btn primary small-btn" @click="checkUpdate">{{ t('检查更新') }}</button>
      </view>
      <view class="card-actions single">
        <button class="btn ghost small-btn" @click="shareApp">{{ t('分享给朋友') }}</button>
      </view>
      <view class="card-actions grid">
        <button v-if="updateActive" class="btn ghost small-btn" @click="goUpdatePage">
          {{ t('打开更新页面') }}
        </button>
        <button class="btn ghost small-btn" @click="openChangelogRecord">{{ t('版本更新记录') }}</button>
        <button class="btn ghost small-btn" @click="openDownloadPage">{{ t('用浏览器下载') }}</button>
      </view>
      <text class="note">
        {{ t('消息在手机与电脑之间端到端加密（ECDH P-256 + HKDF-SHA256 + AES-256-GCM），中继服务器只转发密文。') }}
      </text>
      <text class="note">
        {{ t('配对长期有效：App 重启、切换网络都会自动重连，不需要重新扫码；只有连续 7 天完全没有使用，才需要重新扫码配对。') }}
      </text>
    </view>

    <view v-if="activeSection === 'settings-help'" class="card">
      <text class="card-title">{{ t('帮助与反馈') }}</text>
      <text class="note">
        {{ t('用着不顺手、发现 bug，或者想要新功能，都可以告诉我们。') }}
      </text>
      <view class="card-actions single">
        <button class="btn primary small-btn" @click="openFeedback">
          {{ t('问题反馈 / 提需求 / 提建议') }}
        </button>
      </view>
    </view>

    <view v-if="activeSection === 'settings-help'" class="card">
      <text class="card-title">{{ t('使用手册') }}</text>
      <text class="note">
        {{ t('从首次配对、发送任务、审批与排队，到更新和常见问题，电脑端与手机端的完整说明都在这里。') }}
      </text>
      <view class="card-actions single">
        <button class="btn ghost small-btn" @click="openManual">
          {{ t('打开使用手册') }}
        </button>
      </view>
    </view>

    <app-dialog
      :visible="!!deviceToRemove"
      :title="t('移除电脑')"
      :message="
        deviceToRemove
          ? `移除「${deviceToRemove.deviceName || t('这台电脑')}」后，需要重新扫码才能连接。`
          : ''
      "
      :cancel-text="t('保留')"
      :confirm-text="t('移除')"
      icon="×"
      danger
      @confirm="confirmRemoveDevice"
      @cancel="deviceToRemove = null"
      @close="deviceToRemove = null"
    />
    <app-dialog
      :visible="unpairVisible"
      :title="t('解除当前电脑')"
      :message="t('只解除当前这台电脑；如果还有其它已配对电脑，会自动切换过去。')"
      :cancel-text="t('取消')"
      :confirm-text="t('解除')"
      icon="!"
      danger
      @confirm="confirmUnpair"
      @cancel="unpairVisible = false"
      @close="unpairVisible = false"
    />
    <app-dialog
      :visible="desktopInstallVisible"
      :title="t('安装电脑端更新')"
      :message="desktopInstallMessage"
      :cancel-text="t('取消')"
      :confirm-text="t('安装并重启')"
      icon="!"
      @confirm="confirmInstallDesktopUpdate"
      @cancel="desktopInstallVisible = false"
      @close="desktopInstallVisible = false"
    />
    <app-picker
      :visible="modelPickerVisible"
      :title="modelPickerTitle"
      :subtitle="modelPickerSubtitle"
      :options="modelPickerOptions"
      :value="modelPickerIndex"
      :empty-text="modelPickerEmptyText"
      @select="onModelPicked"
      @close="closeModelPicker"
    />

    <!-- 动态工具清单：只读，启停和签名仍由电脑端负责。 -->
    <app-sheet
      :visible="toolsOpen"
      :title="t('动态工具')"
      :subtitle="t('只读清单；启停、签名和审批仍在电脑端。')"
      tall
      @close="closeTools"
    >
      <scroll-view scroll-y class="tool-sheet-scroll">
        <view v-if="toolsLoading" class="tool-sheet-state">{{ t('读取中…') }}</view>
        <view v-else-if="toolsError" class="tool-sheet-state error">{{ toolsError }}</view>
        <view v-else-if="!toolsList.length" class="tool-sheet-state">
          {{ t('这个工作区还没有动态工具。') }}
        </view>
        <view v-for="tool in toolsList" :key="tool.name" class="tool-item">
          <view class="tool-item-head">
            <text class="tool-item-name">{{ tool.name }}</text>
            <text class="tool-item-tag" :class="{ exec: tool.risk === 'exec' }">{{ toolRiskLabel(tool) }}</text>
            <text class="tool-item-version">v{{ tool.version }}</text>
          </view>
          <text v-if="tool.description" class="tool-item-desc">{{ tool.description }}</text>
          <text class="tool-item-meta">{{ toolStateLabel(tool) }}</text>
        </view>
      </scroll-view>
    </app-sheet>

    <!-- 快捷指令：保存后替换电脑端内置预设（最多 8 条）。 -->
    <app-sheet
      :visible="quickOpen"
      :title="t('快捷指令')"
      :subtitle="t('新建任务时显示的预设，最多 8 条。')"
      tall
      @close="closeQuick"
    >
      <scroll-view scroll-y class="tool-sheet-scroll">
        <view v-if="quickLoading" class="tool-sheet-state">{{ t('读取中…') }}</view>
        <view v-else-if="quickError" class="tool-sheet-state error">{{ quickError }}</view>
        <template v-else>
          <view v-for="(item, index) in quickList" :key="index" class="quick-row">
            <textarea
              v-model="item.content"
              class="quick-input"
              auto-height
              maxlength="500"
              :placeholder="t('快捷指令内容')"
              :disabled="quickBusy"
            />
            <text class="quick-remove" @click="removeQuick(index)">×</text>
          </view>
          <text v-if="quickNote" class="tool-sheet-state">{{ quickNote }}</text>
          <text v-if="!quickList.length && !quickNote" class="tool-sheet-state">
            {{ t('还没有快捷指令。') }}
          </text>
          <text v-if="quickList.length < 8" class="quick-add" @click="addQuick">
            ＋ {{ t('添加一条') }}
          </text>
        </template>
      </scroll-view>
      <template #footer>
        <view class="card-actions">
          <button class="btn ghost small-btn" @click="closeQuick">{{ t('取消') }}</button>
          <button class="btn primary small-btn" :disabled="quickBusy" @click="saveQuick">
            {{ quickBusy ? t('保存中…') : t('保存') }}
          </button>
        </view>
      </template>
    </app-sheet>

    <app-dialog-host />
  </view>
</template>

<script>
import AppDialog from '../../components/app-dialog/app-dialog.vue'
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import AppPicker from '../../components/app-picker/app-picker.vue'
import AppSheet from '../../components/app-sheet/app-sheet.vue'
import {
  USD_CNY_RATE,
  costCurrencyFor,
  formatClock,
  formatCost,
  formatMoney,
  formatTokens,
  primaryBalance
} from '../../lib/billing.js'
import { DISK_LOW_BYTES, formatBytes, fullTime, hostOf } from '../../lib/format.js'
import { copyText } from '../../lib/clipboard.js'
import { modelOptionLabel } from '../../lib/model-label.js'
import { formatShareText, shareText } from '../../lib/share.js'
import {
  cancelUpdateDownload,
  checkAndPromptUpdate,
  currentAppInfo,
  formatUpdateBytes,
  getUpdateDownloadState,
  installDownloadedUpdate,
  openChangelogPage as openChangelogRecordExternal,
  openUpdateDownloadPage,
  openUpdatePage,
  retryUpdateDownload,
  SHARE_APP_URL,
  subscribeUpdateDownload
} from '../../lib/update.js'
import {
  applySystemBars,
  checkDesktopUpdate,
  downloadDesktopUpdate,
  init,
  installDesktopUpdate,
  loadQuickCommands,
  loadSandboxStatus,
  loadSystemInfo,
  loadTools,
  reconnect as reconnectClient,
  removeDevice,
  request,
  saveQuickCommands,
  setAccent,
  setButtonScheme,
  setContrast,
  setFontSize,
  setSaturation,
  setThemeMode,
  store,
  switchToDevice,
  unpair as unpairClient,
  updatePhoneName
} from '../../store/index.js'
import {
  getLocale,
  getLocaleSetting,
  setLocaleSetting,
  systemLocales,
  t
} from '../../lib/i18n.js'
import { backgroundDurationParts } from '../../lib/background-report.js'
import { openBatterySettings } from '../../lib/background-settings.js'
import {
  FILE_CACHE_DAY_OPTIONS,
  FILE_CACHE_DEFAULT_DAYS,
  loadFileCacheDays,
  saveFileCacheDays,
  sweepFileCache
} from '../../lib/file-cache.js'

export default {
  components: { AppDialog, AppDialogHost, AppPicker, AppSheet },
  data() {
    return {
      phoneName: store.phoneName || '',
      deviceToRemove: null,
      unpairVisible: false,
      desktopInstallVisible: false,
      // 按使用场景分组：设备和连接、更新、能力、模型、外观、帮助各成一区，
      // 关系近的卡片放进同一区，避免「电脑」和「连接」各拆一半。
      settingsNavItems: [
        { id: 'settings-connection', label: t("连接") },
        { id: 'settings-update', label: t("更新") },
        { id: 'settings-security', label: t("功能") },
        { id: 'settings-models', label: t("模型") },
        { id: 'settings-appearance', label: t("外观") },
        { id: 'settings-help', label: t("帮助") }
      ],
      // 目录是分区切换，不是滚动锚点：一次只展示当前分区的卡片。
      activeSection: 'settings-connection',
      // 文件缓存只影响这台手机：默认 7 天，可以在这里换。
      fileCacheDays: loadFileCacheDays(),
      fileCacheDayOptions: FILE_CACHE_DAY_OPTIONS.map((value) => ({
        value,
        label:
          value === FILE_CACHE_DEFAULT_DAYS
            ? t('{v1} 天（默认）', { v1: value })
            : t('{v1} 天', { v1: value })
      })),
      themeOptions: [
        { value: 'system', label: t("跟随系统") },
        { value: 'light', label: t("浅色") },
        { value: 'dark', label: t("深色") }
      ],
      fontSizeOptions: [
        { value: 'standard', label: t("标准") },
        { value: 'large', label: t("大") },
        { value: 'xlarge', label: t("特大") }
      ],
      contrastOptions: [
        { value: 'low', label: t("低") },
        { value: 'standard', label: t("标准") },
        { value: 'high', label: t("高") }
      ],
      saturationOptions: [
        { value: 'low', label: t("低") },
        { value: 'standard', label: t("标准") },
        { value: 'high', label: t("高") }
      ],
      accentOptions: [
        {
          value: 'graphite',
          label: t("黑白"),
          swatch: 'linear-gradient(135deg, #000000 0 50%, #ffffff 50% 100%)'
        },
        { value: 'pine', label: t("松柏"), swatch: '#317754' },
        { value: 'indigo', label: t("靛蓝"), swatch: '#344d93' },
        { value: 'clay', label: t("陶土"), swatch: '#8f5932' },
        { value: 'ocean', label: t("海蓝"), swatch: '#206788' },
        { value: 'moss', label: t("苔绿"), swatch: '#597529' },
        { value: 'plum', label: t("梅紫"), swatch: '#76469b' },
        { value: 'rose', label: t("玫瑰"), swatch: '#9f3c53' },
        { value: 'sand', label: t("沙岩"), swatch: '#816122' },
        { value: 'orange', label: t("橘子海"), swatch: '#b2570f' },
        { value: 'celadon', label: t("青瓷"), swatch: '#2c7671' },
        {
          value: 'claude',
          label: t("暖白"),
          swatch: 'linear-gradient(135deg, #d97757 0 50%, #faf9f5 50% 100%)'
        }
      ],
      buttonSchemeOptions: [
        {
          value: 'accent',
          label: t("跟随主题"),
          swatch: 'linear-gradient(135deg, var(--accent, #888) 0 50%, var(--surface-3, #333) 50% 100%)'
        },
        { value: 'mono', label: t("极简黑白"), swatch: 'linear-gradient(135deg, #111111 0 50%, #f5f5f5 50% 100%)' },
        {
          value: 'soft',
          label: t("柔和填充"),
          swatch: 'linear-gradient(135deg, rgba(128,128,128,0.5), rgba(128,128,128,0.14))'
        },
        {
          value: 'outline',
          label: t("分层填充"),
          swatch: 'linear-gradient(135deg, var(--surface-3, #333) 0 50%, var(--surface-2, #222) 50% 100%)'
        }
      ],
      localeSetting: getLocaleSetting(),
      languageOptions: [
        { value: 'auto', label: `${t("跟随系统")} · ${systemLocales()[0] || 'Auto'}` },
        { value: 'zh-CN', label: t("简体中文") },
        { value: 'en', label: 'English' }
      ],
      updateState: getUpdateDownloadState(),
      updateUnsubscribe: null,
      billing: null,
      billingLoading: false,
      billingError: '',
      modelSettings: null,
      modelsLoading: false,
      modelsSaving: false,
      modelsError: '',
      modelsRetryPending: false,
      // null 表示还没读取过；false 表示电脑端不认识 models.*（旧版）。
      modelsSupported: null,
      modelSessionId: '',
      modelEvaluationIds: ['', ''],
      maxEvaluationModels: 6,
      modelPickerVisible: false,
      modelPickerKind: 'session',
      modelPickerEvalIndex: -1,
      // 沙箱与动态工具：只读展示。
      sandboxStatus: null,
      sandboxLoading: false,
      sandboxError: '',
      // 运行环境：只读展示，进入设置页或点刷新时读取。
      envInfo: null,
      envLoading: false,
      envError: '',
      toolsList: [],
      toolsLoading: false,
      toolsError: '',
      toolsLoaded: false,
      toolsOpen: false,
      // 快捷指令编辑器。
      quickOpen: false,
      quickList: [],
      quickLoading: false,
      quickError: '',
      quickNote: '',
      quickBusy: false
    }
  },
  computed: {
    store() {
      return store
    },
    workspacePath() {
      return String(
        store.currentSession?.workspacePath ||
          store.currentSession?.cwd ||
          store.roots?.[0] ||
          ''
      )
    },
    sandboxText() {
      if (this.sandboxLoading) return t("检测中…")
      if (this.sandboxError) return t("读取失败")
      const status = this.sandboxStatus
      if (!status) return t("未读取")
      if (status.mode === 'off') return t("已关闭")
      if (!status.available) return t("不可用")
      return t("可用（{v1}）", { v1: status.backend })
    },
    sandboxWarn() {
      if (this.sandboxLoading || this.sandboxError) return false
      const status = this.sandboxStatus
      return Boolean(status && (status.mode === 'off' || !status.available))
    },
    toolsSummary() {
      if (this.toolsLoading) return t("读取中…")
      if (this.toolsError) return t("读取失败")
      if (!this.toolsLoaded) return t("未读取")
      const enabled = this.toolsList.filter((tool) => tool?.enabled).length
      return t("{v1} 个已启用", { v1: enabled })
    },
    versionText() {
      const info = currentAppInfo()
      return info?.version ? `Pilot App ${info.version}` : t("Pilot（网页版）")
    },
    envRows() {
      const info = this.envInfo
      if (!info) return []
      const unknown = t("未知")
      const disk = info.disk
      const available = (free, total) =>
        t("{v1} 可用 / {v2}", { v1: formatBytes(free), v2: formatBytes(total) })
      return [
        {
          label: t("系统"),
          value: `${info.platform || unknown} ${info.osRelease || ''} (${info.arch || unknown})`
        },
        {
          label: t("CPU"),
          value: `${info.cpuModel || unknown} · ${t("{v1} 核", { v1: info.cpuCount || 0 })}`
        },
        {
          label: t("内存"),
          value: available(info.memoryFreeBytes, info.memoryTotalBytes)
        },
        {
          label: t("磁盘"),
          value:
            disk && disk.freeBytes !== null && disk.freeBytes !== undefined
              ? available(disk.freeBytes, disk.totalBytes)
              : unknown,
          warn: Boolean(disk && disk.low)
        },
        {
          label: t("运行时"),
          value: `Electron ${info.electron || unknown} · Node ${info.node || unknown}`
        }
      ]
    },
    lowDiskText() {
      return formatBytes(DISK_LOW_BYTES)
    },
    relayHost() {
      const pairing = store.pairing
      if (!pairing) return ''
      // 直连成功后主地址会变成局域网 IP；这里仍显示真正的中继地址。
      const relay = pairing.relayWrapped
        ? pairing.relayUrl
        : pairing.fallbackWrapped
          ? pairing.fallbackUrl
          : ''
      return hostOf(relay || '')
    },
    statusText() {
      if (store.connectionState === 'connected') {
        if (!store.agentOnline) return t("电脑离线")
        return store.connectionTransport === 'lan' ? t("局域网直连") : t("已连接")
      }
      if (store.connectionState === 'connecting') return t("连接中…")
      if (store.connectionState === 'reconnecting') return t("正在重连…")
      if (store.connectionState === 'replaced') return t("已在另一处打开")
      return t("未连接")
    },
    statusClass() {
      if (store.connectionState === 'connected') {
        return store.agentOnline ? 'ok' : 'warn'
      }
      return 'err'
    },
    pairedAt() {
      return fullTime(store.pairing?.pairedAt)
    },
    lastActiveAt() {
      return fullTime(store.pairing?.lastActiveAt || store.pairing?.pairedAt)
    },
    keepAliveStateText() {
      if (!store.pairing) return t('未启用')
      if (store.keepAliveState === 'service') return t('前台服务已启用')
      if (store.keepAliveError) {
        return `${t('未启用')}（${store.keepAliveError}）`
      }
      return t('未启用（退回唤醒锁）')
    },
    keepAliveStateTone() {
      return store.keepAliveState === 'service' ? 'ok' : 'warn'
    },
    batteryStateText() {
      if (store.batteryUnrestricted === true) return t('已允许后台运行')
      if (store.batteryUnrestricted === false) return t('受系统限制')
      return t('无法读取')
    },
    backgroundReportText() {
      const report = store.backgroundReport
      if (!report?.kind) return ''
      const duration = this.formatBackgroundDuration(report.ms)
      if (report.kind === 'kept') {
        return t('上次后台 {v1}：连接保持', { v1: duration })
      }
      if (report.kind === 'dropped') {
        return report.error
          ? t('上次后台 {v1}：连接被断开（{v2}）', { v1: duration, v2: report.error })
          : t('上次后台 {v1}：连接被断开', { v1: duration })
      }
      if (report.kind === 'process-gone') {
        return t('上次后台 {v1}：App 被系统回收', { v1: duration })
      }
      return ''
    },
    /** 后台明细：回帧数、是否在后台断开、回前台探活结果。 */
    backgroundTraceText() {
      const report = store.backgroundReport
      if (!report?.kind || report.kind === 'first') return ''
      const parts = [t('后台回帧 {v1} 次', { v1: String(report.frames || 0) })]
      if (report.closedInBackground) {
        parts.push(report.closeReason ? t('后台断开：{v1}', { v1: report.closeReason }) : t('后台断开'))
      }
      if (report.probe) {
        parts.push(report.probe.ok ? t('回前台探活成功') : t('回前台探活失败'))
      }
      return parts.join(' · ')
    },
    desktopOnline() {
      return store.connectionState === 'connected' && store.agentOnline === true
    },
    desktopUpdate() {
      return store.desktopUpdate
    },
    desktopChecking() {
      return this.desktopUpdate?.status === 'checking'
    },
    desktopUpdateUnsupported() {
      return store.desktopUpdateSupported === false
    },
    desktopCanDownload() {
      return this.desktopUpdate?.status === 'available'
    },
    desktopCanInstall() {
      return this.desktopUpdate?.status === 'ready'
    },
    desktopProgressVisible() {
      const status = this.desktopUpdate?.status
      return status === 'downloading' || status === 'ready'
    },
    desktopProgressWidth() {
      const progress = this.desktopUpdate?.progress
      return `${Math.max(0, Math.min(100, Number(progress) || 0))}%`
    },
    desktopStatusText() {
      const state = this.desktopUpdate
      if (!this.desktopOnline) return t("未连接")
      if (this.desktopUpdateUnsupported) return t("当前版本不支持手机更新")
      if (!state) return t("尚未检查")
      switch (state.status) {
        case 'checking':
          return t("正在检查…")
        case 'up-to-date':
          return t("已是最新版本")
        case 'available':
          return t("发现新版本")
        case 'downloading':
          return state.progress ? `${t("下载中")} ${state.progress}%` : t("下载中…")
        case 'ready':
          return t("已下载，可以安装")
        case 'installing':
          return t("正在安装…")
        case 'error':
          return t("更新失败")
        case 'disabled':
          return t("当前版本不支持手机更新")
        default:
          return t("尚未检查")
      }
    },
    desktopInstallMessage() {
      if (this.desktopUpdate?.relocatingToUserDir) {
        return t('电脑会退出并重启完成更新，正在执行的任务会中断。这次安装会把 Pilot 迁移到当前用户目录，不再需要 Windows 授权。确定现在安装？')
      }
      if (this.desktopUpdate?.elevationRequired) {
        return t('电脑会退出并重启完成更新，正在执行的任务会中断。电脑端安装在需要管理员权限的目录，安装时 Windows 会弹出授权框，请在电脑上点「是」。确定现在安装？')
      }
      return t('电脑会退出并重启完成更新，正在执行的任务会中断。确定现在安装？')
    },
    desktopStatusClass() {
      const status = this.desktopUpdate?.status
      if (!this.desktopOnline) return 'err'
      if (this.desktopUpdateUnsupported) return 'warn'
      if (status === 'error') return 'err'
      if (status === 'available' || status === 'ready') return 'warn'
      return ''
    },
    updateVisible() {
      const status = this.updateState.status
      return status !== 'idle' && status !== 'done'
    },
    updateActive() {
      return this.updateVisible
    },
    updateBarVisible() {
      return this.updateState.status === 'downloading' || this.updateState.status === 'verifying'
    },
    updateProgressWidth() {
      const progress = this.updateState.status === 'verifying' ? 100 : this.updateState.progress
      return `${Math.max(0, Math.min(100, Number(progress) || 0))}%`
    },
    updatePercentText() {
      const state = this.updateState
      if (state.status !== 'downloading' || !state.total) return ''
      return `${state.progress}%`
    },
    updateTitle() {
      const state = this.updateState
      if (state.status === 'downloading') return t("正在下载更新 v{v1}", { v1: state.version })
      if (state.status === 'verifying') return t("正在校验安装包…")
      if (state.status === 'ready') return t("更新 v{v1} 已下载", { v1: state.version })
      if (state.status === 'installing') return t("正在打开安装程序…")
      if (state.status === 'error') return t("更新下载失败")
      return ''
    },
    updateMeta() {
      const state = this.updateState
      if (state.status === 'downloading') {
        const received = formatUpdateBytes(state.received)
        const total = formatUpdateBytes(state.total)
        if (received && total) {
          return t("{v1} / {v2} · 可退出此页，下载会在后台继续", { v1: received, v2: total })
        }
        if (received) return t("{v1} · 可退出此页，下载会在后台继续", { v1: received })
        return t("正在准备下载 · 可退出此页，下载会在后台继续")
      }
      if (state.status === 'verifying') return t("正在校验安装包完整性，请稍候…")
      if (state.status === 'ready') {
        return state.installerOpened
          ? t("已打开系统安装程序，如未完成可再次安装。")
          : t("覆盖安装会保留配对信息和设置。")
      }
      if (state.status === 'installing') return t("正在打开系统安装程序，请稍候…")
      if (state.status === 'error') {
        return t("{v1}。可重试，或打开下载页手动安装。", { v1: state.error || t('下载失败') })
      }
      return ''
    },
    updateActionsVisible() {
      return (
        this.updateState.status === 'ready' ||
        this.updateState.status === 'error' ||
        this.updateState.status === 'downloading' ||
        this.updateState.status === 'verifying'
      )
    },
    modelResources() {
      const resources = this.modelSettings?.resources
      return Array.isArray(resources) ? resources : []
    },
    sessionModelOptions() {
      // 停用的资源也要出现在选择器里：上面的资源列表本来就全部罗列，
      // 这里再过滤会让用户看到“有资源但下拉是空的”。旧版电脑端不带
      // enabled 字段，只有显式 false 才算停用。
      return this.modelResources.map((resource) => ({
        id: resource.id,
        title: `${modelOptionLabel(resource.label || resource.model || t('未命名模型'), resource.tag)} · ${resource.model || t('未配置')}`,
        hint: resource.enabled === false ? t('已停用') : ''
      }))
    },
    sessionModelIndex() {
      const index = this.sessionModelOptions.findIndex(
        (option) => option.id === this.modelSessionId
      )
      return index < 0 ? 0 : index
    },
    sessionModelTitle() {
      return this.sessionModelOptions[this.sessionModelIndex]?.title || t('未选择')
    },
    // 弹框的标题、选项和空态文案都是派生值，必须是 computed：
    // 模板按属性方式绑定，写成 method 会把函数本身传进弹框，
    // 页面上就会显示 function () { [native code] }。
    modelPickerTitle() {
      if (this.modelPickerKind === 'session') return t('会话模型')
      if (this.modelPickerEvalIndex < 0) return t('评估模型')
      return this.evaluationLabel(this.modelPickerEvalIndex)
    },
    modelPickerSubtitle() {
      if (this.modelPickerKind === 'session') return t('选择这个会话使用的模型资源')
      return t('选择参与独立评审的模型资源')
    },
    modelPickerOptions() {
      const list =
        this.modelPickerKind === 'session'
          ? this.sessionModelOptions
          : this.modelPickerEvalIndex >= 0
            ? this.evaluationOptions(this.modelPickerEvalIndex)
            : []
      return list.map((option) => ({ label: option.title, hint: option.hint || '' }))
    },
    modelPickerIndex() {
      if (this.modelPickerKind === 'session') return this.sessionModelIndex
      return this.evaluationIndex(this.modelPickerEvalIndex)
    },
    // 下拉为空时说明原因，而不是一律显示“暂无可选项”，否则用户无法判断是没连电脑、
    // 电脑端没配置，还是刚刚读取失败。
    modelPickerEmptyText() {
      if (!this.desktopOnline) {
        return t('还没有连接电脑。连上电脑后这里会列出可选的模型资源。')
      }
      if (this.modelsLoading) return t('正在读取电脑端的模型资源…')
      if (this.modelsError) return this.modelsError
      if (this.modelResources.length === 0) {
        return t('电脑端还没有模型资源。请先在电脑端「设置 → 模型资源」添加，再回到这里选择。')
      }
      return t('暂无可选项')
    },
    billingOnline() {
      return Boolean(store.agentOnline)
    },
    costLocale() {
      return getLocale()
    },
    costCurrency() {
      return costCurrencyFor(getLocale())
    },
    billingBalance() {
      return this.billing?.balance || null
    },
    balanceText() {
      const entry = primaryBalance(this.billingBalance)
      return entry ? formatMoney(entry.totalBalance, entry.currency) : '—'
    },
    balanceDetail() {
      const entry = primaryBalance(this.billingBalance)
      if (!entry) return ''
      return t("赠送 {v1} · 充值 {v2}", {
        v1: formatMoney(entry.grantedBalance, entry.currency),
        v2: formatMoney(entry.toppedUpBalance, entry.currency)
      })
    },
    balanceErrorText() {
      const balance = this.billingBalance
      if (!balance || balance.ok) return ''
      const known = {
        'missing-key': t("电脑端还没有配置 API Key。"),
        unauthorized: t("密钥被拒绝（401），余额无法读取。"),
        unsupported: t("该端点不支持余额查询。"),
        network: t("网络错误，稍后重试。"),
        'invalid-response': t("余额返回的格式无法识别。"),
        error: t("余额查询失败，稍后重试。")
      }
      return known[balance.error] || known.error
    },
    costText() {
      return formatCost(this.billing?.usage?.estimatedCostUsd, getLocale())
    },
    costRateHint() {
      return t('费用按 1 美元 ≈ {v1} 元折算成人民币显示。', { v1: USD_CNY_RATE })
    },
    usageDetail() {
      const usage = this.billing?.usage
      if (!usage || !usage.runs) return t("本机还没有运行记录。")
      return t("{v1} 次运行 · 输入 {v2} · 输出 {v3} tokens", {
        v1: usage.runs,
        v2: formatTokens(usage.promptTokens),
        v3: formatTokens(usage.completionTokens)
      })
    },
    billingRows() {
      const rows = this.billing?.usage?.rows
      if (!Array.isArray(rows) || rows.length <= 1) return []
      return rows
    },
    billingAccounts() {
      // 电脑端 0.1.30 之前的报告没有 accounts 字段，此时不显示多模型余额。
      const accounts = this.billing?.accounts
      if (!Array.isArray(accounts)) return []
      return accounts.filter((account) => account && account.balance)
    },
    billingUpdatedText() {
      const balance = this.billingBalance
      if (!balance || !balance.ok) return ''
      return t("余额更新于 {v1}", { v1: formatClock(balance.fetchedAt) })
    }
  },
  watch: {
    // 进页面时可能还没连上电脑，连上后再补一次，免得卡片一直停在「连接电脑后…」。
    billingOnline(online) {
      if (online) {
        void this.loadBilling(false)
        void this.loadModels()
      }
    }
  },
  onLoad() {
    init()
    this.phoneName = store.phoneName || ''
    this.updateUnsubscribe = subscribeUpdateDownload((state) => {
      this.updateState = state
    })
    void this.loadBilling(false)
    void this.loadModels()
  },
  onShow() {
    applySystemBars()
    // 费用随运行记录变化，回到本页时重新汇总（余额命中电脑端缓存，不会重复请求）。
    void this.loadBilling(false)
    // 电脑端可能刚改过模型选择，回到本页时对齐。
    void this.loadModels()
    // 沙箱与工具清单变化不频繁，回到本页时重新读一次即可。
    void this.loadSecurity()
    // 磁盘剩余空间会随任务变化，每次回到设置页刷新一次运行环境。
    void this.loadEnvInfo()
  },
  onUnload() {
    if (typeof this.updateUnsubscribe === 'function') this.updateUnsubscribe()
    this.updateUnsubscribe = null
  },
  methods: {
    /** 目录是分区切换：直接换成对应分区的卡片，不滚动定位。 */
    selectSettingsSection(item) {
      this.activeSection = item.id
      // 上一分区的滚动位置不应带到新分区，切换后回到顶部。
      uni.pageScrollTo({ scrollTop: 0, duration: 0 })
    },
    formatCost,
    formatTokens,
    // Options API 的模板只能访问组件实例属性，模块级 import 要显式挂到
    // methods，否则模板里的该函数会报未定义并整页白屏。
    modelOptionLabel,
    async loadEnvInfo() {
      if (store.connectionState !== 'connected') {
        this.envInfo = null
        this.envError = t("电脑连接已断开")
        return
      }
      if (this.envLoading) return
      this.envLoading = true
      this.envError = ''
      try {
        this.envInfo = await loadSystemInfo()
      } catch (error) {
        this.envInfo = null
        const message = String(error?.message || '')
        // 旧版电脑端没有 system.info，协议会回「手机端不支持该操作」。
        // 这里换成明确的升级提示，避免看起来像手机端故障。
        this.envError = message.includes('不支持')
          ? t("当前电脑端版本不支持手机查看运行环境，请先在电脑上更新 Pilot。")
          : message || t("读取运行环境失败")
      } finally {
        this.envLoading = false
      }
    },
    async loadSecurity() {
      if (store.connectionState !== 'connected') {
        this.sandboxError = t("电脑连接已断开")
        this.toolsError = t("电脑连接已断开")
        this.toolsLoaded = false
        return
      }
      this.sandboxLoading = true
      this.sandboxError = ''
      try {
        this.sandboxStatus = await loadSandboxStatus()
      } catch (error) {
        this.sandboxStatus = null
        this.sandboxError = String(error?.message || t("读取沙箱状态失败"))
      } finally {
        this.sandboxLoading = false
      }
      const path = this.workspacePath
      this.toolsLoading = true
      this.toolsError = ''
      this.toolsLoaded = false
      try {
        if (!path) {
          this.toolsList = []
          this.toolsError = t("当前没有工作区")
          return
        }
        this.toolsList = await loadTools(path)
        this.toolsLoaded = true
      } catch (error) {
        this.toolsList = []
        this.toolsError = String(error?.message || t("读取工具清单失败"))
      } finally {
        this.toolsLoading = false
      }
    },
    openTools() {
      this.toolsOpen = true
      if (!this.toolsList.length && !this.toolsLoading) void this.loadSecurity()
    },
    closeTools() {
      this.toolsOpen = false
    },
    toolRiskLabel(tool) {
      return tool?.risk === 'exec' ? t("可执行") : t("只读")
    },
    toolStateLabel(tool) {
      const enabled = tool?.enabled ? t("已启用") : t("已停用")
      const approved = tool?.approved ? t("已批准") : t("未批准")
      return `${enabled} · ${approved}`
    },
    openSelfCheck() {
      uni.navigateTo({ url: '/pages/self-check/index' })
    },
    openModuleCheck() {
      uni.navigateTo({ url: '/pages/module-check/index' })
    },
    openLearning() {
      uni.navigateTo({ url: '/pages/learning/index' })
    },
    openConnectPhone() {
      uni.navigateTo({ url: '/pages/connect-phone/index' })
    },
    openQuick() {
      this.quickOpen = true
      this.quickError = ''
      this.quickNote = ''
      void this.loadQuickList()
    },
    closeQuick() {
      if (this.quickBusy) return
      this.quickOpen = false
    },
    async loadQuickList() {
      this.quickLoading = true
      this.quickError = ''
      try {
        const list = await loadQuickCommands()
        if (list === null) {
          this.quickList = []
          this.quickNote = t("尚未自定义，电脑端正在使用内置预设。保存后会替换为这里的条目。")
        } else {
          this.quickList = list.map((item) => ({
            id: item?.id || '',
            content: String(item?.content || '')
          }))
          this.quickNote = ''
        }
      } catch (error) {
        this.quickList = []
        this.quickError = String(error?.message || t("读取快捷指令失败"))
      } finally {
        this.quickLoading = false
      }
    },
    addQuick() {
      if (this.quickList.length >= 8) return
      this.quickList.push({ id: '', content: '' })
    },
    removeQuick(index) {
      this.quickList.splice(index, 1)
    },
    async saveQuick() {
      if (this.quickBusy) return
      const rows = this.quickList
        .map((item) => ({
          ...(item.id ? { id: item.id } : {}),
          content: String(item.content || '').trim()
        }))
        .filter((item) => item.content)
      if (!rows.length) {
        uni.showToast({ title: t("至少保留一条快捷指令"), icon: 'none' })
        return
      }
      this.quickBusy = true
      this.quickError = ''
      try {
        const saved = await saveQuickCommands(rows)
        this.quickList = saved.map((item) => ({
          id: item?.id || '',
          content: String(item?.content || '')
        }))
        this.quickOpen = false
        uni.showToast({ title: t("快捷指令已保存"), icon: 'none' })
      } catch (error) {
        this.quickError = String(error?.message || t("保存快捷指令失败"))
      } finally {
        this.quickBusy = false
      }
    },
    accountHost(account) {
      return hostOf(account?.baseUrl || '')
    },
    accountBalanceWarn(account) {
      const balance = account?.balance
      // ok=false 或余额为 0 时用醒目的颜色提醒。
      return Boolean(balance && (!balance.ok || balance.available === false))
    },
    accountBalanceText(account) {
      const balance = account?.balance
      if (!balance) return '—'
      if (balance.ok) {
        const entry = primaryBalance(balance)
        return entry ? formatMoney(entry.totalBalance, entry.currency) : '—'
      }
      const known = {
        'missing-key': t("未配置密钥"),
        unauthorized: t("密钥被拒绝"),
        unsupported: t("不支持查询"),
        network: t("网络错误"),
        'invalid-response': t("返回格式无法识别"),
        error: t("查询失败")
      }
      return known[balance.error] || known.error
    },
    evaluationLabel(index) {
      const labels = [
        t('第一评估'),
        t('第二评估'),
        t('第三评估'),
        t('第四评估'),
        t('第五评估'),
        t('第六评估')
      ]
      return labels[index] || t('评估模型')
    },
    evaluationOptions(index) {
      const used = this.modelEvaluationIds.filter(
        (id, at) => at !== index && Boolean(id)
      )
      return [
        { id: '', title: t('选择模型资源') },
        ...this.modelResources
          .filter((resource) => !used.includes(resource.id))
          .map((resource) => ({
            id: resource.id,
            title: `${modelOptionLabel(resource.label || resource.model || t('未命名模型'), resource.tag)} · ${resource.model || t('未配置')}`,
            hint: resource.enabled === false ? t('已停用') : ''
          }))
      ]
    },
    evaluationIndex(index) {
      const id = this.modelEvaluationIds[index]
      const found = this.evaluationOptions(index).findIndex((option) => option.id === id)
      return found < 0 ? 0 : found
    },
    evaluationTitle(index) {
      const id = this.modelEvaluationIds[index]
      if (!id) return t('选择模型资源')
      const option = this.evaluationOptions(index).find((item) => item.id === id)
      return option?.title || t('选择模型资源')
    },
    openSessionModelPicker() {
      this.modelPickerKind = 'session'
      this.modelPickerEvalIndex = -1
      this.modelPickerVisible = true
      this.ensureModelResources()
    },
    openEvaluationPicker(index) {
      this.modelPickerKind = 'evaluation'
      this.modelPickerEvalIndex = index
      this.modelPickerVisible = true
      this.ensureModelResources()
    },
    // 弹层打开时若手上还没有资源，补一次强制读取：首次进页面可能还没连上电脑，
    // 或电脑端刚加完资源，立刻刷出来，避免看到一个空白下拉。
    ensureModelResources() {
      if (this.modelResources.length > 0) return
      void this.loadModels(true)
    },
    closeModelPicker() {
      this.modelPickerVisible = false
    },
    onModelPicked(index) {
      if (this.modelPickerKind === 'session') {
        this.onPickSessionModel(index)
        return
      }
      this.onPickEvaluation(this.modelPickerEvalIndex, index)
    },
    onPickSessionModel(index) {
      const option = this.sessionModelOptions[Number(index) || 0]
      if (option) this.modelSessionId = option.id
    },
    onPickEvaluation(index, selectedIndex) {
      if (index < 0) return
      const option = this.evaluationOptions(index)[Number(selectedIndex) || 0]
      if (!option) return
      this.modelEvaluationIds = this.modelEvaluationIds.map((id, at) =>
        at === index ? option.id : id
      )
    },
    addEvaluation() {
      if (this.modelEvaluationIds.length >= this.maxEvaluationModels) return
      this.modelEvaluationIds = [...this.modelEvaluationIds, '']
    },
    removeEvaluation(index) {
      if (this.modelEvaluationIds.length <= 1) return
      this.modelEvaluationIds = this.modelEvaluationIds.filter((_, at) => at !== index)
    },
    syncModelSelection() {
      const validIds = new Set(
        this.modelResources.filter((resource) => resource.enabled).map((resource) => resource.id)
      )
      const session = this.modelSettings?.sessionModelId
      this.modelSessionId = validIds.has(session) ? session : this.sessionModelOptions[0]?.id || ''
      const selected = Array.isArray(this.modelSettings?.evaluationModelIds)
        ? [
            ...new Set(
              this.modelSettings.evaluationModelIds.filter((id) => validIds.has(id))
            )
          ]
        : []
      while (selected.length < 2) selected.push('')
      this.modelEvaluationIds = selected.slice(0, this.maxEvaluationModels)
    },
    async loadModels(force) {
      if (!store.agentOnline) return
      if (this.modelsLoading) {
        // 已经有一次读取在飞，记下来结束后再补一次（用户刚打开下拉时常见）。
        if (force) this.modelsRetryPending = true
        return
      }
      this.modelsLoading = true
      this.modelsError = ''
      try {
        const data = await request('models.get', {}, 20_000)
        if (data && Array.isArray(data.resources)) {
          this.modelSettings = data
          this.modelsSupported = true
          this.syncModelSelection()
        } else {
          this.modelsError = t('电脑端返回的数据不完整。')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '')
        if (message.includes('不支持')) {
          this.modelsSupported = false
        } else {
          this.modelsError = message || t('读取失败，稍后重试。')
        }
      } finally {
        this.modelsLoading = false
        if (this.modelsRetryPending) {
          this.modelsRetryPending = false
          void this.loadModels(true)
        }
      }
    },
    async saveModelSelection() {
      if (!store.agentOnline || this.modelsSaving) return
      const ids = this.modelEvaluationIds.map((id) => String(id || '').trim()).filter(Boolean)
      if (new Set(ids).size !== ids.length) {
        uni.showToast({ title: t('同一个模型资源不能重复作为评估模型。'), icon: 'none' })
        return
      }
      if (!this.modelSessionId) {
        uni.showToast({ title: t('请先选择会话模型。'), icon: 'none' })
        return
      }
      this.modelsSaving = true
      try {
        const data = await request(
          'models.update',
          { sessionModelId: this.modelSessionId, evaluationModelIds: ids },
          20_000
        )
        if (data && Array.isArray(data.resources)) {
          this.modelSettings = data
          this.modelsSupported = true
          this.syncModelSelection()
        }
        uni.showToast({ title: t('已保存模型选择'), icon: 'none' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '')
        if (message.includes('不支持')) this.modelsSupported = false
        uni.showToast({ title: message || t('保存失败，稍后重试。'), icon: 'none', duration: 3000 })
      } finally {
        this.modelsSaving = false
      }
    },
    async loadBilling(refresh) {
      if (!store.agentOnline) return
      if (this.billingLoading) return
      this.billingLoading = true
      this.billingError = ''
      try {
        const data = await request('billing.get', { refresh: refresh === true }, 20_000)
        if (data && data.balance && data.usage) {
          this.billing = data
        } else {
          this.billingError = t("电脑端返回的数据不完整。")
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '')
        // 旧版电脑端不认识这个操作，直接把它的提示展示出来。
        this.billingError = message || t("读取失败，稍后重试。")
      } finally {
        this.billingLoading = false
      }
    },
    checkUpdate() {
      void checkAndPromptUpdate({ manual: true })
    },
    async checkDesktopUpdate() {
      if (!this.desktopOnline || this.desktopChecking) return
      try {
        await checkDesktopUpdate()
        const state = store.desktopUpdate
        if (state?.status === 'up-to-date') {
          uni.showToast({ title: t("电脑端已是最新版本"), icon: 'none' })
        } else if (state?.status === 'available') {
          uni.showToast({ title: t("发现电脑端新版本"), icon: 'none' })
        }
      } catch (error) {
        uni.showToast({ title: this.desktopErrorText(error), icon: 'none' })
      }
    },
    async downloadDesktopUpdateAction() {
      if (!this.desktopOnline) return
      try {
        await downloadDesktopUpdate()
      } catch (error) {
        uni.showToast({ title: this.desktopErrorText(error), icon: 'none' })
      }
    },
    installDesktopUpdateAction() {
      if (!this.desktopOnline || !this.desktopCanInstall) return
      this.desktopInstallVisible = true
    },
    async confirmInstallDesktopUpdate() {
      this.desktopInstallVisible = false
      try {
        await installDesktopUpdate()
        uni.showToast({
          title: this.desktopUpdate?.relocatingToUserDir
            ? t("正在迁移到当前用户目录；电脑端会自动重启")
            : this.desktopUpdate?.elevationRequired
              ? t("已请求安装；请在电脑上点「是」完成 Windows 授权")
              : t("电脑端正在安装更新，稍后会自动重连"),
          icon: 'none',
          duration: 4000
        })
      } catch (error) {
        uni.showToast({ title: this.desktopErrorText(error), icon: 'none', duration: 3000 })
      }
    },
    desktopErrorText(error) {
      const message = error instanceof Error ? error.message : String(error || '')
      // 旧版电脑端会回「手机端不支持该操作：update.check」，直接说清楚怎么解决。
      if (message.includes('不支持该操作') || message.includes('不支持手机控制更新')) {
        store.desktopUpdateSupported = false
        return t('这台电脑的 Pilot 版本较旧，不支持在手机上检查更新。请先在电脑上安装新版 Pilot。')
      }
      return message || t("操作失败，稍后重试。")
    },
    goUpdatePage() {
      openUpdatePage()
    },
    openFeedback() {
      uni.navigateTo({ url: '/pages/feedback/index' })
    },
    openManual() {
      uni.navigateTo({ url: '/pages/manual/index' })
    },
    installUpdate() {
      installDownloadedUpdate()
    },
    retryUpdate() {
      if (!retryUpdateDownload()) void checkAndPromptUpdate({ manual: true })
    },
    cancelUpdate() {
      cancelUpdateDownload()
    },
    openDownloadPage() {
      openUpdateDownloadPage()
    },
    // 分享应用本身：一段介绍 + 官网/下载页链接，对方点开就能装。
    async shareApp() {
      const result = await shareText(
        formatShareText({
          heading: t('Pilot：本地优先的编程智能体'),
          entries: [
            {
              text: t(
                '电脑端跑任务、手机端随时查看进度。消息端到端加密，不经过第三方云服务。'
              )
            }
          ],
          footer: t('下载地址：{v1}', { v1: SHARE_APP_URL })
        }).text,
        { copy: copyText, url: SHARE_APP_URL }
      )
      if (result.reason === 'cancelled') return
      if (result.ok) {
        uni.showToast({ title: t('已打开分享'), icon: 'none' })
        return
      }
      if (result.copied) {
        uni.showToast({ title: t('下载链接已复制，可粘贴给朋友'), icon: 'none' })
        return
      }
      uni.showToast({ title: t('分享失败，请稍后再试'), icon: 'none' })
    },
    openChangelogRecord() {
      openChangelogRecordExternal()
    },
    saveName() {
      updatePhoneName(this.phoneName)
      uni.showToast({ title: t("已保存"), icon: 'none' })
    },
    chooseTheme(mode) {
      setThemeMode(mode)
    },
    chooseFontSize(size) {
      setFontSize(size)
    },
    chooseContrast(contrast) {
      setContrast(contrast)
    },
    chooseSaturation(saturation) {
      setSaturation(saturation)
    },
    chooseFileCacheDays(value) {
      this.fileCacheDays = saveFileCacheDays(value)
      // 天数改小会让已有缓存立刻超期，顺手清一遍，不用等下次打开文件。
      void sweepFileCache().catch(() => {})
      uni.showToast({ title: t('已改为 {v1} 天', { v1: this.fileCacheDays }), icon: 'none' })
    },
    chooseButtonScheme(value) {
      setButtonScheme(value)
    },
    chooseAccent(value) {
      setAccent(value)
    },
    chooseLocale(value) {
      const changed = setLocaleSetting(value)
      this.localeSetting = value
      if (!changed) {
        this.$forceUpdate?.()
        return
      }
      // 页面里的文案在渲染时调用 t()，重新进入当前页即可整体刷新。
      uni.reLaunch({ url: '/pages/settings/index' })
    },
    relayHostOf(url) {
      return hostOf(url || '')
    },
    isActiveDevice(deviceId) {
      return store.pairing?.deviceId === deviceId
    },
    switchDevice(deviceId) {
      switchToDevice(deviceId)
    },
    addDevice() {
      uni.navigateTo({ url: '/pages/pair/index?add=1' })
    },
    removeDeviceConfirm(item) {
      this.deviceToRemove = item
    },
    confirmRemoveDevice() {
      const item = this.deviceToRemove
      this.deviceToRemove = null
      if (item?.deviceId) removeDevice(item.deviceId)
    },
    formatBackgroundDuration(ms) {
      const parts = backgroundDurationParts(ms)
      if (parts.unit === 'short') return t('不到 1 分钟')
      if (parts.unit === 'minutes') return t('{v1} 分钟', { v1: parts.minutes })
      return parts.minutes
        ? t('{v1} 小时 {v2} 分钟', { v1: parts.hours, v2: parts.minutes })
        : t('{v1} 小时', { v1: parts.hours })
    },
    openBatterySettingsPage() {
      if (openBatterySettings()) return
      uni.showToast({
        title: t('无法打开系统设置，请在系统设置中手动允许 Pilot 后台运行'),
        icon: 'none'
      })
    },
    reconnect() {
      reconnectClient()
      uni.showToast({ title: t("正在重新连接…"), icon: 'none' })
    },
    unpair() {
      this.unpairVisible = true
    },
    confirmUnpair() {
      this.unpairVisible = false
      unpairClient()
    },
    back() {
      try {
        const pages = getCurrentPages()
        if (pages.length > 1) {
          uni.navigateBack()
          return
        }
      } catch {
        // ignore
      }
      uni.reLaunch({ url: '/pages/sessions/index' })
    }
  }
}
</script>

<style>
.settings-page {
  /* 固定标题栏 + 设置目录，内容从两者下方开始。 */
  --settings-topbar-h: 92rpx;
  padding: calc(var(--status-bar-height) + var(--settings-topbar-h) + 12rpx) 28rpx 80rpx;
  box-sizing: border-box;
}
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: calc(var(--status-bar-height) + var(--settings-topbar-h));
  padding: var(--status-bar-height) 28rpx 0;
  box-sizing: border-box;
  background: var(--page);
}
.back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  margin-right: 2rpx;
  color: var(--accent-soft);
  flex-shrink: 0;
}
.title {
  color: var(--text-strong);
  font-size: calc(36rpx * var(--font-scale));
  font-weight: 650;
}
/* 设置目录吸顶在固定标题栏下方；六个分区按三列两行等宽排列。 */
.settings-nav {
  position: sticky;
  top: calc(var(--status-bar-height) + var(--settings-topbar-h));
  z-index: 30;
  margin: 0 -28rpx 18rpx;
  padding: 12rpx 28rpx 14rpx;
  background: var(--page);
  border-bottom: 1rpx solid var(--line);
}
.settings-nav-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12rpx;
}
.settings-nav-card {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 72rpx;
  padding: 0 8rpx;
  border: 1rpx solid var(--border);
  border-radius: 16rpx;
  background: var(--surface);
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  box-sizing: border-box;
  overflow: hidden;
}
.settings-nav-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-nav-card.active {
  border-color: transparent;
  background: var(--accent-wash);
  color: var(--accent-soft);
}
.card {
  background: var(--surface);
  border-radius: 22rpx;
  padding: 26rpx;
  margin-bottom: 22rpx;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 16rpx;
}
.card-title {
  display: block;
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 600;
  margin-bottom: 16rpx;
}
.card-head .card-title {
  margin-bottom: 0;
}
.card-head-action {
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  padding: 8rpx 4rpx;
  flex-shrink: 0;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 12rpx 0;
}
.label {
  color: var(--muted);
  font-size: calc(25rpx * var(--font-scale));
  flex-shrink: 0;
}
.value {
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  text-align: right;
  word-break: break-all;
}
.value.small {
  font-size: calc(23rpx * var(--font-scale));
  color: var(--muted);
}
.value.ok {
  color: var(--ok);
}
.value.warn {
  color: var(--warn);
}
.value.err {
  color: var(--danger);
}
.name-input {
  flex: 1;
  text-align: right;
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  background: transparent;
}
.btn.small-btn {
  height: var(--btn-h-md);
  padding: 0 var(--btn-pad-md);
  font-size: var(--btn-font-md);
  margin: 0;
}
/* 卡片内操作区：统一用间距分组，避免每个按钮各自 margin 叠成一坨。 */
.card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: var(--btn-gap);
  margin-top: 20rpx;
}
.card-actions .btn {
  margin: 0;
  flex: 1 1 240rpx;
  min-width: 0;
}
.card-actions.single .btn,
.card-actions .btn.block {
  flex-basis: 100%;
}
/* 次要操作两列排布；奇数个时最后一个自然占满整行。 */
.card-actions.grid .btn {
  flex: 1 1 calc(50% - 8rpx);
}
.card-actions + .hint,
.card-actions + .note {
  margin-top: 16rpx;
}
.hint {
  display: block;
  margin-top: 14rpx;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.hint.error {
  color: #c9928d;
}
.hint.warn {
  color: #c9ab7c;
}
.desktop-release {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  margin-top: 16rpx;
  padding: 16rpx 18rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.03);
}
.desktop-release-version {
  color: var(--text-strong);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 650;
}
.desktop-release-notes {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
  white-space: pre-wrap;
}
.desktop-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 18rpx;
}
.desktop-actions .btn {
  flex: 1;
}
.note {
  display: block;
  margin-top: 14rpx;
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.6;
}
.model-resource-list {
  margin-top: 16rpx;
  border-radius: 16rpx;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
}
.model-resource-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 14rpx 18rpx;
}
.model-resource-row.disabled {
  opacity: 0.55;
}
.model-project-row {
  border-bottom: 1rpx solid var(--line);
}
.model-project-row:last-child {
  border-bottom: none;
}
.model-resource-row-press {
  background: var(--surface-3);
}
.model-resource-main {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}
.model-resource-name {
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  font-weight: 600;
}
.model-resource-model {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  word-break: break-all;
}
.model-resource-tag {
  flex-shrink: 0;
  color: var(--accent-soft);
  font-size: calc(21rpx * var(--font-scale));
}
.model-resource-tag.warn {
  color: #c9ab7c;
}
.model-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 22rpx;
}
.model-picker {
  flex: 1;
  min-width: 0;
}
.model-field-label {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  flex-shrink: 0;
}
.model-select {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  height: 64rpx;
  min-height: 64rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  border-radius: 14rpx;
  background: var(--bg-soft);
}
.model-select-text {
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.model-select-caret {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
}
.model-eval-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 24rpx;
}
.model-eval-note {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
}
.model-eval-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 14rpx;
}
.model-eval-label {
  width: 110rpx;
  flex-shrink: 0;
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
}
.model-eval-remove {
  flex-shrink: 0;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  padding: 10rpx 4rpx;
}
.model-eval-remove.disabled {
  opacity: 0.35;
}
.add-eval {
  display: inline-block;
  margin-top: 16rpx;
}
.add-eval.disabled {
  opacity: 0.4;
}
.billing-summary {
  display: flex;
  gap: 16rpx;
  margin-top: 8rpx;
}
.billing-block {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding: 16rpx 18rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.03);
}
.billing-label {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
}
.billing-value {
  color: var(--text);
  font-size: calc(34rpx * var(--font-scale));
  font-weight: 650;
}
.billing-note {
  display: block;
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.5;
}
.billing-warn {
  display: block;
  margin-top: 12rpx;
  color: #c9ab7c;
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.billing-row {
  margin-top: 12rpx;
}
.billing-accounts {
  margin-top: 18rpx;
  border-radius: 16rpx;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
}
.billing-section-title {
  display: block;
  padding: 12rpx 18rpx;
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  background: rgba(255, 255, 255, 0.03);
}
.billing-account-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 14rpx 18rpx;
}
.billing-account-row.disabled {
  opacity: 0.55;
}
.billing-account-main {
  flex: 1;
  min-width: 0;
}
.billing-account-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.billing-account-role {
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  background: rgba(143, 168, 192, 0.14);
}
.billing-account-tag {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.billing-account-model {
  display: block;
  margin-top: 6rpx;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.billing-account-host {
  display: block;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.billing-account-value {
  flex-shrink: 0;
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
  text-align: right;
}
.billing-account-value.warn {
  color: #c9ab7c;
  font-weight: 500;
}
.billing-models {
  margin-top: 16rpx;
  border-radius: 16rpx;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
}
.billing-model-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 18rpx;
  font-size: calc(22rpx * var(--font-scale));
}
.billing-model-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.billing-model-tokens {
  color: var(--dim);
}
.billing-model-cost {
  min-width: 110rpx;
  text-align: right;
  color: var(--text);
}
.device-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 18rpx 0;
}
.device-row.active {
  background: rgba(143, 168, 192, 0.08);
  border-radius: 14rpx;
  padding-left: 14rpx;
  padding-right: 14rpx;
}
.device-main {
  flex: 1;
  min-width: 0;
}
.device-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.device-name {
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.device-current {
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  background: rgba(143, 168, 192, 0.14);
  flex-shrink: 0;
}
.device-host {
  display: block;
  margin-top: 4rpx;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.device-row-actions {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-shrink: 0;
}
.device-row-action {
  color: var(--btn-soft-fg, var(--accent-soft));
  background: var(--btn-soft-bg, var(--bg-soft));
  border: var(--btn-soft-border, 1rpx solid transparent);
}
.device-row-action.danger {
  color: var(--btn-danger-fg, var(--danger));
  background: var(--btn-danger-bg, var(--stop-soft));
  border: var(--btn-danger-border, 1rpx solid transparent);
}
.theme-options {
  display: flex;
  gap: 14rpx;
}
.theme-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 22rpx 10rpx;
  border-radius: 16rpx;
  background: var(--bg-soft);
}
.theme-option.active {
  background: var(--accent-wash);
}
.theme-name {
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
}
.theme-option.active .theme-name {
  color: var(--accent-soft);
  font-weight: 600;
}
.theme-check {
  width: 24rpx;
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
  text-align: center;
}
/* 档位多的时候（文件缓存 6 档）一行塞不下，换成三列网格：
   6 档正好排成 3×2，每格整块可点、标签居中。
   卡片可用宽度约 642rpx（页面 28rpx + 卡片 26rpx 内边距），
   三列每格约 205rpx，放得下「90 天」；中文「7 天（默认）」和英文
   "7 days (default)" 在特大字号下会折成两行，靠 grid-auto-rows: 1fr
   让同一行等高，不会被挤成窄条。 */
.theme-options-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: 1fr;
}
.theme-options-grid .theme-option {
  position: relative;
  min-width: 0;
  padding: 24rpx 8rpx;
}
.theme-options-grid .theme-name {
  padding: 0 6rpx;
  line-height: 1.25;
  text-align: center;
}
/* 勾选钉在格子右上角，不占标签宽度（否则三列时标签只剩一半宽）：
   空着也留 24rpx 的位置会把「7 天（默认）」提前挤断。 */
.theme-options-grid .theme-check {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  width: auto;
  line-height: 1;
}
.section-label {
  display: block;
  margin: 26rpx 0 12rpx;
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
}
/* 主题配色与按钮方案用卡片展示：每张卡带一块预览区，
   配色卡预览强调色，按钮方案卡直接用方案 token 画主/次按钮。 */
.choice-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}
.choice-card {
  flex: 0 0 calc((100% - 28rpx) / 3);
  box-sizing: border-box;
  padding: 12rpx;
  border-radius: 18rpx;
  background: var(--surface-2);
}
.choice-card:active {
  transform: scale(0.985);
}
.choice-card.active {
  background: var(--accent-wash);
}
.choice-preview {
  height: 78rpx;
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 0 16rpx;
  border-radius: 14rpx;
  /* 预览区用 --surface（卡片下一级），这样「分层填充」方案的主按钮
     （--surface-3）在预览里仍然看得出来；两层都用 surface-3 会融在一起。 */
  background: var(--surface);
  box-sizing: border-box;
}
.accent-dot {
  width: 36rpx;
  height: 36rpx;
  flex: none;
  border-radius: 50%;
  box-shadow:
    inset 0 0 0 1rpx rgba(128, 128, 128, 0.35),
    0 0 0 3rpx rgba(128, 128, 128, 0.12);
}
.choice-skeleton {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.choice-bar {
  height: 10rpx;
  border-radius: 6rpx;
  background: rgba(128, 128, 128, 0.28);
}
.choice-bar.bar-strong {
  width: 82%;
  background: rgba(128, 128, 128, 0.5);
}
.choice-bar.bar-soft {
  width: 54%;
}
.choice-meta {
  margin-top: 10rpx;
  padding: 0 4rpx 2rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
}
.choice-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.3;
}
.choice-card.active .choice-name {
  color: var(--accent-soft);
  font-weight: 600;
}
.choice-check {
  width: 22rpx;
  flex: none;
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
  text-align: center;
}
.scheme-grid .choice-card {
  flex: 0 0 calc(50% - 7rpx);
}
.scheme-pill {
  height: 32rpx;
  border-radius: 16rpx;
}
.scheme-pill-primary {
  flex: 1.15;
  background: var(--btn-primary-bg);
  border: var(--btn-primary-border);
}
.scheme-pill-soft {
  flex: 0.85;
  background: var(--btn-soft-bg);
  border: var(--btn-soft-border);
}
.update-box {
  margin-top: 18rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  background: var(--bg-soft);
}
.update-box.ready {
  background: rgba(152, 183, 158, 0.08);
}
.update-box.error {
  background: rgba(201, 146, 141, 0.08);
}
.update-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.update-title {
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
}
.update-box.ready .update-title {
  color: var(--ok-soft);
}
.update-box.error .update-title {
  color: var(--danger);
}
.update-percent {
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  flex-shrink: 0;
}
.update-bar {
  height: 10rpx;
  margin-top: 16rpx;
  border-radius: 6rpx;
  background: var(--surface-3);
  overflow: hidden;
}
.update-bar-fill {
  height: 100%;
  border-radius: 6rpx;
  background: var(--accent-gradient);
  transition: width 0.2s ease;
}
.update-meta {
  display: block;
  margin-top: 12rpx;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.update-actions {
  display: flex;
  gap: 14rpx;
  margin-top: 16rpx;
}
.update-actions .btn.small-btn {
  flex: 1;
  margin-top: 0;
}
.error-hint {
  color: var(--danger);
}
.tool-sheet-scroll {
  flex: 1;
  min-height: 0;
  height: 58vh;
  padding: 0 30rpx;
  box-sizing: border-box;
}
.tool-sheet-state {
  display: block;
  padding: 40rpx 10rpx;
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.7;
  text-align: center;
}
.tool-sheet-state.error {
  color: var(--danger);
}
.tool-item {
  padding: 18rpx 0;
  border-bottom: 1rpx solid var(--line);
}
.tool-item-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.tool-item-name {
  flex: 1;
  min-width: 0;
  color: var(--text-strong);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-item-tag {
  flex: none;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  background: var(--resume-soft);
  color: var(--resume);
  font-size: calc(19rpx * var(--font-scale));
}
.tool-item-tag.exec {
  background: var(--stop-soft);
  color: var(--stop);
}
.tool-item-version {
  flex: none;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.tool-item-desc {
  display: block;
  margin-top: 8rpx;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.tool-item-meta {
  display: block;
  margin-top: 6rpx;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.quick-row {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  padding: 12rpx 0;
}
.quick-input {
  flex: 1;
  min-width: 0;
  min-height: 80rpx;
  max-height: 240rpx;
  padding: 14rpx 16rpx;
  border-radius: 14rpx;
  background: var(--input-bg);
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.55;
  box-sizing: border-box;
}
.quick-remove {
  flex: none;
  width: 48rpx;
  height: 48rpx;
  margin-top: 12rpx;
  color: var(--muted);
  font-size: calc(32rpx * var(--font-scale));
  line-height: calc(48rpx * var(--font-scale));
  text-align: center;
}
.quick-add {
  display: block;
  margin: 10rpx 0 20rpx;
  padding: 16rpx;
  border-radius: 14rpx;
  background: var(--surface-3);
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  text-align: center;
}
</style>
