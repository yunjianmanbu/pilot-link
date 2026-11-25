<template>
  <view class="page sessions-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <!-- 顶部导航和项目筛选固定在列表上方，只有下面的会话列表滚动。 -->
    <view class="sessions-header">
      <view class="topbar">
        <view class="topbar-main" @click="openDeviceSheet">
          <view class="dot" :class="dotClass"></view>
          <view class="titles">
            <text class="title">Pilot Link</text>
            <text class="subtitle">{{ deviceName }} · {{ connectionText }}</text>
          </view>
          <text v-if="store.pairings.length > 0" class="device-caret">▾</text>
        </view>
        <view class="topbar-actions">
          <!-- 深浅模式最常用，放到首页顶栏；「跟随系统」三态仍在设置的「外观」里。 -->
          <text class="action" @click="toggleTheme">{{ themeToggleLabel }}</text>
          <text class="action" @click="openSettings">{{ t('设置') }}</text>
        </view>
      </view>

      <view v-if="bannerText" class="banner" :class="{ error: !agentOnline }">
        <text class="banner-text">{{ bannerText }}</text>
        <text v-if="showRetry" class="banner-action" @click="reconnect">{{ t('重新连接') }}</text>
      </view>

      <!-- 更新下载横幅：离开设置页或退到后台后，下载进度仍然可见。 -->
      <view
        v-if="updateBannerVisible"
        class="update-banner"
        :class="updateState.status"
        @click="openUpdate"
      >
        <view class="update-banner-main">
          <text class="update-banner-title">{{ updateBannerTitle }}</text>
          <text class="update-banner-meta">{{ updateBannerMeta }}</text>
          <view v-if="updateBannerBusy" class="update-banner-bar">
            <view class="update-banner-fill" :style="{ width: updateBannerProgressWidth }"></view>
          </view>
        </view>
        <text class="update-banner-action">{{ updateBannerAction }}</text>
      </view>

      <!-- 任务结束但还没点开时，列表上方先给一条可点的汇总：
           列表长、或切了项目筛选时，只靠行内小徽标容易漏看。 -->
      <view v-if="unreadTotal > 0" class="unread-summary" @click="openLatestUnread">
        <view class="unread-summary-dot"></view>
        <text class="unread-summary-text">{{ unreadSummaryText }}</text>
        <text class="unread-summary-action">{{ t('查看') }} ›</text>
      </view>

      <!-- 排队汇总：列表行内只看得到单个会话的队列，这里直接给全屏总数。
           点一下切到「进行中」筛选，跳过去看那几个还排着队的会话。 -->
      <view v-if="totalQueueCount > 0" class="queue-summary" @click="showQueued">
        <view class="unread-summary-dot queue-summary-dot"></view>
        <text class="queue-summary-count">{{ t('{v1} 个任务排队中', { v1: totalQueueCount }) }}</text>
        <text class="queue-summary-action">{{ t('查看') }} ›</text>
      </view>

      <view v-if="store.sessions.length > 0" class="filter-bar">
        <view
          v-if="filters.length > 1"
          class="filter-trigger"
          :class="{ open: filterMenuVisible }"
          @click="toggleFilterMenu"
        >
          <text class="filter-trigger-label">{{ currentFilter.name }}</text>
          <text class="filter-trigger-count">{{ currentFilter.count }}</text>
          <text class="filter-caret">▾</text>
        </view>

        <view
          class="running-toggle"
          :class="{ active: runningOnly }"
          @click="toggleRunningOnly"
        >
          <view class="running-check" :class="{ checked: runningOnly }">
            <text v-if="runningOnly" class="running-check-mark">✓</text>
          </view>
          <text class="running-toggle-label">{{ t('进行中') }}</text>
          <text v-if="runningSessionCount > 0" class="running-toggle-count">
            {{ runningSessionCount }}
          </text>
        </view>

        <!-- 进行中右侧：汇总所有会话的待办，点开弹层逐条查看。 -->
        <view class="todo-entry" @click="openTodoSheet">
          <text class="todo-entry-label">{{ t('全部待办') }}</text>
          <text v-if="totalTodoCount > 0" class="todo-entry-count">{{ totalTodoCount }}</text>
        </view>

        <!-- 定时任务跨会话入口：与「全部待办」同排同款，常驻显示。
             列表行里看不出排了几条定时，这一条不依赖是否已有缓存，点开就现拉。 -->
        <view class="todo-entry sched-entry" @click="openScheduleSheet">
          <text class="todo-entry-label">{{ t('全部任务') }}</text>
          <text v-if="scheduledSummary.tasks > 0" class="todo-entry-count">
            {{ scheduledSummary.tasks }}
          </text>
        </view>

        <view v-if="filterMenuVisible" class="filter-mask" @click="closeFilterMenu"></view>

        <view v-if="filterMenuVisible" class="filter-menu" @click.stop>
          <scroll-view
            scroll-y
            class="filter-menu-list"
            :style="{ height: filterMenuHeight }"
            :show-scrollbar="false"
          >
            <view
              class="filter-option"
              :class="{ active: projectFilter === '' }"
              @click="setProjectFilter('')"
            >
              <text class="filter-option-name">{{ t('全部项目') }}</text>
              <text class="filter-option-count">{{ store.sessions.length }}</text>
              <text class="filter-check">{{ projectFilter === '' ? '✓' : '' }}</text>
            </view>
            <view
              v-for="item in filters"
              :key="item.key"
              class="filter-option"
              :class="{ active: projectFilter === item.key }"
              @click="setProjectFilter(item.key)"
            >
              <text class="filter-option-name">{{ item.name }}</text>
              <text class="filter-option-count">{{ item.count }}</text>
              <text class="filter-check">{{ projectFilter === item.key ? '✓' : '' }}</text>
            </view>
          </scroll-view>
        </view>
      </view>
    </view>

    <scroll-view
      class="session-scroll"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      :refresher-background="refresherBackground"
      @refresherrefresh="onRefresh"
      @scroll="onSessionListScroll"
    >
      <view class="session-content">
        <view v-if="groups.length === 0" class="empty">
          <text class="empty-title">{{ emptyTitle }}</text>
          <text class="empty-hint">{{ emptyHint }}</text>
        </view>

        <view v-for="group in groups" :key="group.key" class="project">
          <view class="project-head">
            <text class="project-name">{{ group.name }}</text>
            <text class="project-count">{{ group.items.length }}</text>
            <!-- 项目名右侧的加号：直接在这个项目的目录里新建任务。 -->
            <view class="project-add" @click.stop="newTaskInGroup(group)">
              <text class="project-add-icon">＋</text>
            </view>
          </view>
          <view
            v-for="session in group.items"
            :key="session.id"
            class="session"
            :class="{
              running: runningFor(session.id),
              unread: Boolean(unreadFor(session.id)),
              'unread-failed': unreadFor(session.id) === 'failed'
            }"
            @click="open(session)"
            @touchstart="startSessionPress(session, $event)"
            @touchmove="moveSessionPress"
            @touchend="endSessionPress"
            @touchcancel="cancelSessionPress"
          >
            <view class="session-main">
              <view class="session-title-row">
                <text class="session-title">{{ session.title }}</text>
                <!-- 状态徽标各自独立：正在执行时排队数量同样要显示，
                     否则「跑着 1 个、还排着 2 个」这种情况在列表上完全看不出来。 -->
                <text v-if="runningFor(session.id)" class="badge running-badge">{{ t('运行中') }}</text>
                <text v-if="pendingFor(session.id) > 0" class="badge queue-badge">{{ t('排队{v1}', { v1: pendingFor(session.id) }) }}</text>
                <text v-if="session.paused" class="badge paused-badge">{{ t('已暂停') }}</text>
                <view
                  v-if="unreadFor(session.id)"
                  class="badge unread-badge"
                  :class="unreadFor(session.id) === 'failed' ? 'failed-badge' : 'done-badge'"
                >
                  <view class="unread-dot"></view>
                  <text>{{ unreadFor(session.id) === 'failed' ? t('失败待查看') : t('已完成待查看') }}</text>
                </view>
                <text v-if="todoCounts[session.id]" class="badge todo-badge">{{ t('待办{v1}', { v1: todoCounts[session.id] }) }}</text>
              </view>
              <view v-if="runInstructions[session.id]" class="session-instruction">
                <text class="session-instruction-tag">{{ t('指令') }}</text>
                <text class="session-instruction-text">{{ runInstructions[session.id] }}</text>
              </view>
              <view v-if="planStats(session)" class="session-plan-row">
                <view class="session-plan-head">
                  <text class="session-plan-tag">{{ t('计划') }}</text>
                  <view class="session-plan-steps">
                    <text
                      v-for="step in planStats(session).visibleSteps"
                      :key="step.n"
                      class="session-plan-dot"
                      :class="step.status"
                    >{{ step.n }}</text>
                    <text v-if="planStats(session).hiddenSteps" class="session-plan-more">
                      +{{ planStats(session).hiddenSteps }}
                    </text>
                  </view>
                  <text class="session-plan-count">{{ planStats(session).done }}/{{ planStats(session).total }}</text>
                </view>
                <text v-if="planStats(session).activeText" class="session-plan-step">
                  {{ planStats(session).activeText }}
                </text>
              </view>
              <text class="session-meta">{{ sessionMeta(session) }}</text>
              <!-- 行内快捷入口：不打开会话，直接进这个任务的文件或知识库。 -->
              <view class="session-links">
                <text
                  class="chip session-link"
                  @click.stop="openSessionFiles(session)"
                >{{ t('文件') }}</text>
                <text
                  class="chip session-link"
                  @click.stop="openSessionKnowledge(session)"
                >{{ t('知识') }}</text>
                <text
                  class="chip session-link"
                  @click.stop="openSessionLinks(session)"
                >{{ t('链接') }}</text>
                <text
                  class="chip session-link"
                  @click.stop="openSessionTools(session)"
                >{{ t('工具') }}</text>
                <text
                  class="chip session-link"
                  @click.stop="openSessionMemory(session)"
                >{{ t('记忆') }}</text>
              </view>
            </view>
            <text class="chevron">›</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <view class="fab" @click="newChat">＋</view>

    <!-- 左下角版本号：点一下手动检查更新，检查结果走应用内弹框/提示。 -->
    <view
      class="version-chip"
      :class="{ busy: checkingUpdate }"
      @click="checkUpdates"
    >
      <text class="version-text">{{ checkingUpdate ? t('检查更新中…') : versionLabel }}</text>
    </view>

    <!-- 项目空间选择：自定义底部弹层，目录多时可搜索、可滚动。 -->
    <app-sheet
      :visible="pickerVisible"
      :title="t('选择项目空间')"
      :subtitle="`共 ${pickerRoots.length} 个可用目录`"
      @close="closePicker"
    >
      <view class="sheet-search">
        <text class="sheet-search-icon">⌕</text>
        <input
          v-model="pickerQuery"
          class="sheet-search-input"
          type="text"
          :placeholder="t('搜索项目名称或路径')"
          placeholder-class="sheet-search-placeholder"
          confirm-type="search"
        />
        <text v-if="pickerQuery" class="sheet-search-clear" @click="pickerQuery = ''">×</text>
      </view>
      <scroll-view
        scroll-y
        class="sheet-list"
        :style="{ height: pickerListHeight }"
        :show-scrollbar="false"
      >
        <!-- 电脑端授权目录后，手机可以在这里新建工作区。 -->
        <view
          v-if="!pickerQuery && store.workspaceRoots.length > 0"
          class="sheet-item sheet-item-create"
          @click="openCreator"
        >
          <view class="sheet-item-main">
            <text class="sheet-item-name">{{ t('＋ 新建工作区') }}</text>
            <text class="sheet-item-path">{{ t('在电脑端授权的目录里新建子文件夹') }}</text>
          </view>
          <text class="sheet-item-go">›</text>
        </view>
        <view v-if="filteredPickerRoots.length === 0" class="sheet-empty">
          <text class="sheet-empty-title">{{ t('没有匹配的项目空间') }}</text>
          <text class="sheet-empty-hint">{{ t('换个关键词，或清空搜索查看全部目录。') }}</text>
        </view>
        <view
          v-for="root in filteredPickerRoots"
          :key="root"
          class="sheet-item"
          @click="chooseRoot(root)"
        >
          <view class="sheet-item-main">
            <text class="sheet-item-name">{{ rootName(root) }}</text>
            <text class="sheet-item-path">{{ root }}</text>
          </view>
          <text class="sheet-item-go">›</text>
        </view>
      </scroll-view>
    </app-sheet>

    <!-- 全部待办：按任务汇总所有会话的待办，点任务行进入该会话继续处理。 -->
    <app-sheet
      :visible="todoSheetVisible"
      :title="t('全部待办')"
      :subtitle="todoSheetSubtitle"
      @close="closeTodoSheet"
    >
      <scroll-view
        scroll-y
        class="todo-sheet-list"
        :style="{ height: todoSheetHeight }"
        :show-scrollbar="false"
      >
        <view v-if="todoSheetLoading" class="todo-sheet-empty">{{ t('正在读取待办…') }}</view>
        <view v-else-if="!todoSheetGroups.length" class="todo-sheet-empty">
          {{ t('还没有待办') }}
        </view>
        <view
          v-for="group in todoSheetGroups"
          :key="group.sessionId"
          class="todo-sheet-group"
        >
          <view class="todo-sheet-head" @click="openTodoSession(group)">
            <text class="todo-sheet-session">{{ group.title }}</text>
            <text class="todo-sheet-project">{{ group.project }}</text>
            <text class="todo-sheet-count">{{ group.items.length }}</text>
            <text class="todo-sheet-go">›</text>
          </view>
          <view
            v-for="item in group.items"
            :key="item.id"
            class="todo-sheet-item"
            @click="openTodoSession(group)"
          >
            <view class="todo-sheet-dot"></view>
            <text class="todo-sheet-text">{{ item.text }}</text>
            <text v-if="item.offline" class="todo-sheet-tag">{{ t('待同步') }}</text>
          </view>
        </view>
      </scroll-view>
    </app-sheet>

    <!-- 全部任务：与「全部待办」同款弹层，跨会话看排了哪些定时，点任务行进入对应会话。 -->
    <app-sheet
      :visible="scheduleSheetVisible"
      :title="t('全部任务')"
      :subtitle="scheduleSheetSubtitle"
      @close="closeScheduleSheet"
    >
      <scroll-view
        scroll-y
        class="todo-sheet-list"
        :style="{ height: scheduleSheetHeight }"
        :show-scrollbar="false"
      >
        <view v-if="scheduleSheetLoading" class="todo-sheet-empty">
          {{ t('正在读取定时任务…') }}
        </view>
        <view v-else-if="scheduleSheetOffline && !scheduleGroups.length" class="todo-sheet-empty">
          <text class="todo-sheet-empty-text">{{ t('电脑端离线，暂时读不到定时任务') }}</text>
          <text class="todo-sheet-retry" @click="retryScheduleSheet">{{ t('重新读取') }}</text>
        </view>
        <view v-else-if="scheduleSheetFailed && !scheduleGroups.length" class="todo-sheet-empty">
          <text class="todo-sheet-empty-text">{{ t('电脑端暂时没返回定时任务，稍后再点一次') }}</text>
          <text class="todo-sheet-retry" @click="retryScheduleSheet">{{ t('重新读取') }}</text>
        </view>
        <view v-else-if="!scheduleGroups.length" class="todo-sheet-empty">
          <text class="todo-sheet-empty-text">{{ t('还没有定时任务') }}</text>
          <text class="todo-sheet-retry" @click="retryScheduleSheet">{{ t('重新读取') }}</text>
        </view>
        <view
          v-for="group in scheduleGroups"
          :key="group.sessionId"
          class="todo-sheet-group"
        >
          <view class="todo-sheet-head" @click="openScheduleSession(group)">
            <text class="todo-sheet-session">{{ group.title }}</text>
            <text class="todo-sheet-project">{{ group.project }}</text>
            <text class="todo-sheet-count">{{ group.tasks.length }}</text>
            <text v-if="!group.missing" class="todo-sheet-go">›</text>
          </view>
          <view
            v-for="task in group.tasks"
            :key="task.id"
            class="todo-sheet-item"
            @click="openScheduleSession(group)"
          >
            <view class="todo-sheet-dot" :class="{ off: task.enabled === false }"></view>
            <view class="todo-sheet-body">
              <text class="todo-sheet-text">{{ task.content }}</text>
              <view class="todo-sheet-meta">
                <text class="todo-sheet-kind">{{ scheduleKindLabel(task) }}</text>
                <text v-if="task.enabled === false" class="todo-sheet-tag">{{ t('已暂停') }}</text>
                <text v-else-if="task.lastStatus === 'failed'" class="todo-sheet-tag error">
                  {{ t('上次执行失败') }}
                </text>
                <text v-else-if="scheduleTimeText(task.nextRunAt)" class="todo-sheet-tag">
                  {{ t('下次 {v1}', { v1: scheduleTimeText(task.nextRunAt) }) }}
                </text>
              </view>
            </view>
          </view>
        </view>
      </scroll-view>
    </app-sheet>

    <!-- 工作区：既可以选授权目录里任意层级的已有文件夹，也可以新建子文件夹。 -->
    <app-sheet
      :visible="creatorVisible"
      :title="t('选择工作区')"
      :subtitle="creatorSubtitle"
      :mask-closable="!creatorBusy"
      @close="closeCreator"
    >
      <view class="create-body">
        <text class="create-label">{{ t('授权目录') }}</text>
        <scroll-view scroll-x class="create-roots" :show-scrollbar="false">
          <view class="create-roots-inner">
            <view
              v-for="root in creatorRoots"
              :key="root"
              class="create-chip"
              :class="{ active: creatorRoot === root }"
              @click="chooseCreatorRoot(root)"
            >
              <text class="create-chip-name">{{ rootName(root) }}</text>
            </view>
          </view>
        </scroll-view>

        <view class="browse-head">
          <view class="browse-crumbs">
            <text class="browse-crumb-root">{{ rootName(creatorRoot) }}</text>
            <text v-if="creatorPath" class="browse-crumb-rest">/ {{ creatorPathLabel }}</text>
          </view>
          <text v-if="creatorPath" class="browse-up" @click="browseUp">{{ t('上一级') }}</text>
        </view>

        <scroll-view scroll-y class="browse-list" :style="{ height: browseListHeight }">
          <view v-if="creatorBrowseBusy" class="browse-empty">{{ t('正在读取文件夹…') }}</view>
          <view v-else-if="creatorBrowseError" class="browse-empty">{{ creatorBrowseError }}</view>
          <view v-else-if="!creatorFolders.length" class="browse-empty">
            {{ t('这里还没有子文件夹，可以在下面新建一个') }}
          </view>
          <view
            v-for="folder in creatorFolders"
            :key="folder.path"
            class="browse-row"
            @click="enterFolder(folder)"
          >
            <text class="browse-name">{{ folder.name }}</text>
            <text class="browse-go">›</text>
          </view>
          <view v-if="browseTruncated" class="browse-empty">{{ t('文件夹太多，只显示前 300 个') }}</view>
        </scroll-view>

        <view class="browse-actions">
          <text
            class="browse-use"
            :class="{ disabled: creatorBusy || creatorBrowseBusy }"
            @click="useCurrentFolder"
          >
            {{ creatorBusy ? t('处理中…') : t('使用此文件夹') }}
          </text>
        </view>

        <text class="create-label">{{ t('或在这里新建文件夹') }}</text>
        <view class="create-input-wrap">
          <input
            v-model="creatorName"
            class="create-input"
            type="text"
            :placeholder="t('例如 my-project')"
            placeholder-class="create-placeholder"
            confirm-type="done"
            :disabled="creatorBusy"
            @confirm="submitWorkspace"
          />
          <text v-if="creatorName" class="create-clear" @click="creatorName = ''">×</text>
        </view>
        <text v-if="creatorNameError" class="create-error">{{ creatorNameError }}</text>
        <text v-else class="create-hint">{{ t('将在{v1}下创建，并直接用它开始新对话。', { v1: creatorPathLabelWithRoot }) }}</text>
      </view>
      <template #footer>
        <view class="device-actions">
          <text class="device-action" @click="closeCreator">{{ t('取消') }}</text>
          <text
            class="device-action primary"
            :class="{ disabled: !canCreateWorkspace || creatorBusy || creatorBrowseBusy }"
            @click="submitWorkspace"
          >
            {{ creatorBusy ? t('创建中…') : t('创建并开始') }}
          </text>
        </view>
      </template>
    </app-sheet>

    <!-- 多台电脑：点顶部设备名切换；同一时刻只连一台，切换后自动加载该电脑的缓存。 -->
    <app-sheet
      :visible="deviceSheetVisible"
      :title="t('切换电脑')"
      :subtitle="`已配对 ${store.pairings.length} 台`"
      @close="closeDeviceSheet"
    >
      <scroll-view
        scroll-y
        class="device-list"
        :style="{ height: deviceListHeight }"
        :show-scrollbar="false"
      >
        <view
          v-for="item in store.pairings"
          :key="item.deviceId"
          class="device-row"
          :class="{ active: isActiveDevice(item.deviceId) }"
          @click="chooseDevice(item.deviceId)"
        >
          <view class="device-main">
            <text class="device-name">{{ item.deviceName || t('未命名电脑') }}</text>
            <text class="device-host">{{ relayHost(item.relayUrl) }}</text>
          </view>
          <text v-if="isActiveDevice(item.deviceId)" class="device-check">{{ t('✓ 当前') }}</text>
          <text v-else class="device-switch">{{ t('切换') }}</text>
        </view>
      </scroll-view>
      <template #footer>
        <view class="device-actions">
          <text class="device-action" @click="openSettings">{{ t('管理已配对电脑') }}</text>
          <text class="device-action primary" @click="addDevice">{{ t('＋ 添加电脑') }}</text>
        </view>
      </template>
    </app-sheet>

    <!-- 长按会话：重命名、复制、删除，和电脑端侧栏菜单对齐。 -->
    <app-sheet
      :visible="menuVisible"
      :title="menuSession?.title || t('任务操作')"
      :subtitle="t('选择要执行的操作')"
      @close="closeSessionMenu"
    >
      <view class="session-actions">
        <view class="session-action" @click="startSessionRename">
          <text class="session-action-icon">✎</text>
          <text class="session-action-label">{{ t('重命名') }}</text>
        </view>
        <view class="session-action" @click="forkCurrentSession">
          <text class="session-action-icon">⧉</text>
          <text class="session-action-label">{{ t('复制任务') }}</text>
        </view>
        <view class="session-action danger" @click="askDeleteSession">
          <text class="session-action-icon">⌫</text>
          <text class="session-action-label">{{ t('删除任务') }}</text>
        </view>
      </view>
    </app-sheet>

    <app-sheet
      :visible="renameVisible"
      :title="t('修改任务名称')"
      :subtitle="t('只改标题，不影响工作区和执行记录')"
      @close="closeSessionRename"
    >
      <view class="session-rename-field">
        <input
          v-model="renameValue"
          class="session-rename-input"
          type="text"
          :maxlength="120"
          :focus="renameFocus"
          :placeholder="t('输入任务名称')"
          placeholder-class="session-rename-placeholder"
          confirm-type="done"
          :disabled="renameBusy"
          @confirm="submitSessionRename"
        />
        <text v-if="renameValue" class="session-rename-clear" @click="renameValue = ''">×</text>
      </view>
      <text v-if="renameError" class="session-rename-error">{{ renameError }}</text>
      <template #footer>
        <view class="session-rename-actions">
          <text class="session-rename-action" @click="closeSessionRename">{{ t('取消') }}</text>
          <text
            class="session-rename-action primary"
            :class="{ disabled: sessionRenameDisabled }"
            @click="submitSessionRename"
          >{{ renameBusy ? t('保存中…') : t('保存') }}</text>
        </view>
      </template>
    </app-sheet>

    <app-dialog
      :visible="deleteVisible"
      danger
      :title="t('删除任务？')"
      :message="t('删除后无法恢复，相关回退点也会一并清理。')"
      :cancel-text="t('取消')"
      :confirm-text="t('删除')"
      icon="⌫"
      @confirm="confirmDeleteSession"
      @close="deleteVisible = false"
    />

    <app-dialog
      :visible="noRootsVisible"
      :title="t('还没有可用目录')"
      message="请先在电脑端 Pilot 的「手机连接」面板打开一个工作区，或在「手机可创建的工作区」里授权一个目录。"
      :cancel-text="''"
      :confirm-text="t('知道了')"
      icon="⌂"
      @confirm="noRootsVisible = false"
      @close="noRootsVisible = false"
    />
    <app-dialog-host />
  </view>
</template>

<script>
import AppDialog from '../../components/app-dialog/app-dialog.vue'
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import AppSheet from '../../components/app-sheet/app-sheet.vue'
import { projectName, relativeTime } from '../../lib/format.js'
import { planProgress } from '../../lib/plan.js'
import {
  buildScheduledGroups,
  mergeScheduledResult,
  scheduleKindLabel,
  scheduleTimeText
} from '../../lib/scheduled-overview.js'
import { createPressGesture } from '../../lib/press.js'
import { validateWorkspaceName } from '../../lib/workspace-name.js'
import {
  checkAndPromptUpdate,
  currentAppInfo,
  getUpdateDownloadState,
  openUpdatePage,
  subscribeUpdateDownload
} from '../../lib/update.js'
import {
  applySystemBars,
  browseWorkspaceFolders,
  createWorkspace,
  deleteSession,
  forkSession,
  init,
  loadAllScheduled,
  loadPendingTodosBySession,
  onAppShow,
  openWorkspaceFolder,
  reconnect as reconnectClient,
  refreshAll,
  refreshRoots,
  refreshSessions,
  renameSession,
  selectSession,
  setThemeMode,
  startNewChat,
  store,
  switchToDevice
} from '../../store/index.js'
import { t } from '../../lib/i18n.js'
import { closeSplash } from '../../lib/splash.js'

export default {
  components: { AppDialog, AppDialogHost, AppSheet },
  data() {
    return {
      refreshing: false,
      noRootsVisible: false,
      pickerVisible: false,
      pickerRoots: [],
      pickerQuery: '',
      creatorVisible: false,
      creatorRoot: '',
      creatorName: '',
      creatorBusy: false,
      creatorPath: '',
      creatorParent: '',
      creatorFolders: [],
      creatorBrowseBusy: false,
      creatorBrowseError: '',
      creatorBrowseSeq: 0,
      browseTruncated: false,
      deviceSheetVisible: false,
      projectFilter: '',
      filterMenuVisible: false,
      runningOnly: false,
      todoSheetVisible: false,
      todoSheetLoading: false,
      todoSheetRows: [],
      todoSheetSeq: 0,
      scheduleSheetVisible: false,
      scheduleSheetLoading: false,
      scheduleSheetRows: [],
      scheduleSheetOffline: false,
      scheduleSheetFailed: false,
      scheduleSheetSeq: 0,
      updateState: getUpdateDownloadState(),
      updateUnsubscribe: null,
      checkingUpdate: false,
      // 长按会话弹出的操作菜单：重命名 / 复制任务 / 删除任务。
      menuVisible: false,
      menuSession: null,
      renameVisible: false,
      renameSessionId: '',
      renameValue: '',
      renameError: '',
      renameBusy: false,
      renameFocus: false,
      deleteVisible: false,
      deleteBusy: false
    }
  },
  created() {
    // 长按 500ms 且手指没有拖动才打开会话菜单。原生 @longpress 在
    // scroll-view 里拖动也会触发，这里改成自己判定，拖动列表不再误触。
    this.sessionPress = createPressGesture({
      onLongPress: (session) => this.openSessionMenu(session)
    })
  },
  computed: {
    store() {
      return store
    },
    deviceName() {
      return store.deviceName || store.pairing?.deviceName || t("我的电脑")
    },
    refresherBackground() {
      return store.theme === 'light' ? '#ffffff' : '#000000'
    },
    themeToggleLabel() {
      // 显示的是「当前」模式：点一下切到另一套。跟随系统时按解析后的配色显示，
      // 避免出现「没选过浅色却写着浅色」的错觉。
      return store.theme === 'light' ? `☀ ${t('浅色')}` : `☾ ${t('深色')}`
    },
    versionLabel() {
      // 热更后 currentAppInfo() 会读到已应用的 wgt 版本；H5 预览没有原生版本号。
      const info = currentAppInfo()
      return info?.version ? `v${info.version}` : t('Pilot（网页版）')
    },
    agentOnline() {
      return store.agentOnline
    },
    connected() {
      return store.connectionState === 'connected'
    },
    connectionText() {
      if (this.connected) {
        if (!this.agentOnline) return t("电脑离线")
        return store.connectionTransport === 'lan' ? t("局域网直连") : t("已连接")
      }
      if (store.connectionState === 'connecting') return t("连接中…")
      if (store.connectionState === 'reconnecting') return t("正在重连…")
      if (store.connectionState === 'replaced') return t("已在另一处打开")
      return t("未连接")
    },
    dotClass() {
      if (this.connected && this.agentOnline) return 'ok'
      if (this.connected) return 'warn'
      return 'err'
    },
    bannerText() {
      if (!this.connected) {
        if (store.connectionState === 'replaced') {
          return t("这个配对正在另一处使用，可以稍后重试。")
        }
        return store.connectionMessage || t("正在连接中继服务器…")
      }
      if (!this.agentOnline) return t("电脑端离线，请确认电脑已打开 Pilot 客户端并开启手机配对。")
      if (store.serverError) return store.serverError
      return ''
    },
    showRetry() {
      return store.connectionState === 'disconnected' || store.connectionState === 'replaced'
    },
    updateBannerVisible() {
      const status = this.updateState.status
      return status !== 'idle' && status !== 'done'
    },
    updateBannerBusy() {
      return this.updateState.status === 'downloading' || this.updateState.status === 'verifying'
    },
    updateBannerProgressWidth() {
      const progress = this.updateState.status === 'verifying' ? 100 : this.updateState.progress
      return `${Math.max(0, Math.min(100, Number(progress) || 0))}%`
    },
    updateBannerTitle() {
      const state = this.updateState
      if (state.status === 'downloading') {
        const percent = state.total > 0 ? ` · ${state.progress}%` : ''
        return t("正在下载更新 v{v1}{v2}", { v1: state.version, v2: percent })
      }
      if (state.status === 'verifying') return t("正在校验更新 v{v1}…", { v1: state.version })
      if (state.status === 'ready') return t("更新 v{v1} 已下载", { v1: state.version })
      if (state.status === 'installing') return t("正在打开安装程序…")
      if (state.status === 'error') return t("更新下载失败")
      return ''
    },
    updateBannerMeta() {
      const state = this.updateState
      if (state.status === 'downloading') return t("可继续使用，下载会在后台进行")
      if (state.status === 'verifying') return t("正在校验安装包完整性")
      if (state.status === 'ready') {
        return state.installerOpened
          ? t("如未完成安装，可再次打开安装程序")
          : t("点右侧查看并安装，配对信息和设置会保留")
      }
      if (state.status === 'installing') return t("请按系统提示完成安装")
      if (state.status === 'error') return state.error || t("可以重试下载")
      return ''
    },
    updateBannerAction() {
      // 点击整条横幅都会打开更新页，这里只提示可查看，避免文案与实际动作不一致。
      return t("查看")
    },
    filteredPickerRoots() {
      const query = this.pickerQuery.trim().toLowerCase()
      if (!query) return this.pickerRoots
      return this.pickerRoots.filter((root) => {
        const value = String(root || '')
        return (
          value.toLowerCase().includes(query) ||
          this.rootName(value).toLowerCase().includes(query)
        )
      })
    },
    createRowVisible() {
      return !this.pickerQuery && store.workspaceRoots.length > 0
    },
    pickerListHeight() {
      // 最多显示 8 行，多出来的目录在弹层里上下滑动选择。
      const total = this.filteredPickerRoots.length + (this.createRowVisible ? 1 : 0)
      const rows = Math.min(Math.max(total, 1), 8)
      return `${rows * 116}rpx`
    },
    creatorRoots() {
      return store.workspaceRoots
    },
    creatorSubtitle() {
      const count = store.workspaceRoots.length
      if (!count) return t("电脑端还没有授权可创建的目录")
      return count > 1
        ? t("{v1} 个授权目录，可选已有文件夹或新建", { v1: count })
        : t("可选任意层级的子文件夹，也可新建")
    },
    creatorPathLabel() {
      return this.creatorPath ? this.creatorPath.split('/').join(' / ') : ''
    },
    creatorPathLabelWithRoot() {
      const root = this.rootName(this.creatorRoot) || t("授权目录")
      return this.creatorPathLabel ? `${root} / ${this.creatorPathLabel}` : root
    },
    browseListHeight() {
      const rows = Math.min(Math.max(this.creatorFolders.length, 2), 6)
      return `${rows * 78}rpx`
    },
    creatorNameCheck() {
      return validateWorkspaceName(this.creatorName)
    },
    creatorNameError() {
      return this.creatorNameCheck.error
    },
    canCreateWorkspace() {
      return Boolean(this.creatorRoot) && this.creatorNameCheck.ok
    },
    deviceListHeight() {
      // 最多显示 6 台，超出的在弹层里上下滑动。
      const rows = Math.min(Math.max(store.pairings.length, 1), 6)
      return `${rows * 116}rpx`
    },
    allGroups() {
      const map = new Map()
      for (const session of store.sessions) {
        const key = session.cwd || session.project || t("未分组")
        if (!map.has(key)) {
          map.set(key, {
            key,
            name: projectName(session),
            cwd: String(session.cwd || ''),
            items: [],
            latest: 0
          })
        }
        const group = map.get(key)
        // 同一个项目可能混有老会话（没有 cwd）：只要有一条带目录就记下来，加号才有地方新建。
        if (!group.cwd && session.cwd) group.cwd = String(session.cwd)
        group.items.push(session)
        group.latest = Math.max(group.latest, Number(session.lastModified) || 0)
      }
      const groups = [...map.values()]
      groups.sort((a, b) => b.latest - a.latest)
      for (const group of groups) {
        group.items.sort(
          (a, b) => (Number(b.lastModified) || 0) - (Number(a.lastModified) || 0)
        )
      }
      return groups
    },
    filters() {
      return this.allGroups.map((group) => ({
        key: group.key,
        name: group.name,
        count: group.items.length
      }))
    },
    runInstructions() {
      const map = {}
      // 会话行自带的运行信息作为兜底：即使 chat.started / runs.list 没到，
      // 刷新会话列表后也能显示当前任务指令。
      for (const session of store.sessions) {
        if (session?.id && session.running && session.runInstruction) {
          map[session.id] = session.runInstruction
        }
      }
      for (const run of Object.values(store.activeRuns)) {
        if (run?.sessionId && run.instruction) map[run.sessionId] = run.instruction
      }
      return map
    },
    todoCounts() {
      return store.todoCounts || {}
    },
    /** 已经结束但还没点开过的会话，最近结束的排在前面。 */
    unreadEntries() {
      const map = store.unreadSessions || {}
      const ids = Object.keys(map).filter((id) =>
        store.sessions.some((session) => session.id === id)
      )
      ids.sort((a, b) => (Number(map[b]?.at) || 0) - (Number(map[a]?.at) || 0))
      return ids.map((id) => ({
        id,
        status: map[id]?.status === 'failed' ? 'failed' : 'done'
      }))
    },
    unreadTotal() {
      return this.unreadEntries.length
    },
    unreadSummaryText() {
      const total = this.unreadTotal
      const failed = this.unreadEntries.filter((item) => item.status === 'failed').length
      if (failed > 0) {
        return t('{v1} 个任务已结束，其中 {v2} 个失败', { v1: total, v2: failed })
      }
      return t('{v1} 个任务已完成，点开查看', { v1: total })
    },
    busySessionIds() {
      // 有正在执行或排队任务的会话都算「进行中」。
      const ids = new Set()
      for (const session of store.sessions) {
        if (session?.id && (session.running || Number(session.queueCount) > 0)) {
          ids.add(session.id)
        }
      }
      for (const run of Object.values(store.activeRuns)) {
        if (run?.sessionId) ids.add(run.sessionId)
      }
      for (const item of store.queue) {
        if (item?.sessionId) ids.add(item.sessionId)
      }
      return ids
    },
    runningSessionCount() {
      if (!this.busySessionIds.size) return 0
      return store.sessions.filter((session) => this.busySessionIds.has(session.id)).length
    },
    totalTodoCount() {
      let total = 0
      for (const session of store.sessions) {
        total += Number(store.todoCounts[session.id]) || 0
      }
      return total
    },
    /** 所有会话里排队的任务总数；口径与会话行徽标保持一致，都走 pendingFor。 */
    totalQueueCount() {
      let total = 0
      for (const session of store.sessions) {
        total += this.pendingFor(session.id)
      }
      return total
    },
    todoSheetGroups() {
      const groups = []
      for (const entry of this.todoSheetRows) {
        const items = (entry.rows || []).filter((item) => item?.status === 'pending' && item.text)
        if (!items.length) continue
        const session = store.sessions.find((item) => item.id === entry.sessionId)
        groups.push({
          sessionId: entry.sessionId,
          title: session?.title || t('未命名会话'),
          project: session ? projectName(session) : '',
          items
        })
      }
      return groups
    },
    todoSheetSubtitle() {
      if (this.todoSheetLoading) return t('正在读取待办…')
      const total = this.todoSheetGroups.reduce((sum, group) => sum + group.items.length, 0)
      return t('共 {v1} 条待办', { v1: total })
    },
    todoSheetHeight() {
      // 每个任务一行标题，每条待办一行；最多显示 7 行，超出在弹层里滚动。
      let rows = 0
      for (const group of this.todoSheetGroups) rows += group.items.length + 1
      return `${Math.min(Math.max(rows, 2), 7) * 96}rpx`
    },
    /** 首页「全部任务」入口的数量：算上已暂停的任务，与弹层里能看到的条数一致。 */
    scheduledSummary() {
      let tasks = 0
      let enabled = 0
      let sessions = 0
      for (const group of store.scheduledAllGroups || []) {
        const list = Array.isArray(group?.tasks) ? group.tasks : []
        if (!list.length) continue
        sessions += 1
        tasks += list.length
        enabled += list.filter((task) => task?.enabled !== false).length
      }
      return { tasks, enabled, sessions }
    },
    scheduleGroups() {
      return buildScheduledGroups(this.scheduleSheetRows, store.sessions).map((group) => ({
        ...group,
        // 会话已被删掉时，标题说清楚为什么点不进去。
        title: group.missing ? t('会话已删除') : group.title
      }))
    },
    scheduleSheetSubtitle() {
      if (this.scheduleSheetLoading) return t('正在读取定时任务…')
      const total = this.scheduleGroups.reduce((sum, group) => sum + group.tasks.length, 0)
      // 没读到时不报「0 条」：那会让人以为任务被删了。
      if (!total && (this.scheduleSheetOffline || this.scheduleSheetFailed)) {
        return t('暂时读不到定时任务')
      }
      return t('共 {v1} 条定时任务', { v1: total })
    },
    scheduleSheetHeight() {
      let rows = 0
      for (const group of this.scheduleGroups) rows += group.tasks.length + 1
      return `${Math.min(Math.max(rows, 2), 8) * 96}rpx`
    },
    currentFilter() {
      if (!this.projectFilter) {
        return { name: t("全部项目"), count: store.sessions.length }
      }
      const found = this.filters.find((item) => item.key === this.projectFilter)
      return found || { name: t("全部项目"), count: store.sessions.length }
    },
    filterMenuHeight() {
      // 下拉菜单最多显示 8 行，超出的项目在菜单里上下滑动。
      const rows = Math.min(this.filters.length + 1, 8)
      return `${rows * 88}rpx`
    },
    groups() {
      let groups = this.allGroups
      if (this.projectFilter) {
        const found = this.allGroups.find((group) => group.key === this.projectFilter)
        if (found) groups = [found]
      }
      if (this.runningOnly) {
        const ids = this.busySessionIds
        groups = groups
          .map((group) => ({ ...group, items: group.items.filter((item) => ids.has(item.id)) }))
          .filter((group) => group.items.length > 0)
      }
      return groups
    },
    emptyTitle() {
      if (store.loadingSessions) return t("正在读取会话…")
      if (this.runningOnly) {
        return this.projectFilter ? t("该项目下没有进行中的任务") : t("没有进行中的任务")
      }
      if (this.projectFilter && this.allGroups.length > 0) return t("该项目下还没有会话")
      return t("还没有会话")
    },
    emptyHint() {
      if (this.runningOnly) return t("取消勾选「进行中」即可查看全部会话。")
      return t("点击右下角「＋」，选择一个工作目录开始新的对话。")
    },
    sessionRenameDisabled() {
      return this.renameBusy || !String(this.renameValue || '').trim()
    }
  },
  watch: {
    filters(list) {
      // 项目被删除或刷新后不再存在时，自动回到「全部」。
      if (this.projectFilter && !list.some((item) => item.key === this.projectFilter)) {
        this.projectFilter = ''
      }
      // 只剩一个项目时不再显示下拉筛选。
      if (list.length <= 1) this.filterMenuVisible = false
    }
  },
  onLoad() {
    init()
    this.updateUnsubscribe = subscribeUpdateDownload((state) => {
      this.updateState = state
    })
  },
  onReady() {
    // 目标页渲染完成后最后再关一次启动图：首页已经出来了，遮罩一定不能还在。
    closeSplash()
  },
  onShow() {
    init()
    // 页面切换会重新应用全局导航栏配置，回到首页时再对齐一次状态栏底色。
    applySystemBars()
    this.filterMenuVisible = false
    if (!store.pairing) {
      uni.reLaunch({ url: '/pages/pair/index' })
      return
    }
    // 回到前台时 onAppShow 会先探活，再对账会话、运行状态与当前待办。
    onAppShow()
  },
  onUnload() {
    if (typeof this.updateUnsubscribe === 'function') this.updateUnsubscribe()
    this.updateUnsubscribe = null
    this.sessionPress?.dispose()
  },
  onBackPress() {
    // 弹层打开时，返回键先关闭弹层，不直接退出页面。
    if (this.menuVisible) {
      this.menuVisible = false
      return true
    }
    if (this.renameVisible) {
      this.closeSessionRename()
      return true
    }
    if (this.deleteVisible) {
      this.deleteVisible = false
      return true
    }
    if (this.filterMenuVisible) {
      this.filterMenuVisible = false
      return true
    }
    if (this.todoSheetVisible) {
      this.closeTodoSheet()
      return true
    }
    if (this.scheduleSheetVisible) {
      this.closeScheduleSheet()
      return true
    }
    if (this.deviceSheetVisible) {
      this.deviceSheetVisible = false
      return true
    }
    if (this.pickerVisible) {
      this.pickerVisible = false
      return true
    }
    return false
  },
  methods: {
    setProjectFilter(key) {
      this.projectFilter = String(key || '')
      this.filterMenuVisible = false
    },
    toggleFilterMenu() {
      this.filterMenuVisible = !this.filterMenuVisible
    },
    closeFilterMenu() {
      this.filterMenuVisible = false
    },
    toggleRunningOnly() {
      this.runningOnly = !this.runningOnly
      this.filterMenuVisible = false
    },
    /** 排队汇总条：只切换到「进行中」筛选，不会把已经在筛选中的列表又关掉。 */
    showQueued() {
      this.runningOnly = true
      this.filterMenuVisible = false
    },
    async openTodoSheet() {
      this.filterMenuVisible = false
      this.todoSheetVisible = true
      const seq = ++this.todoSheetSeq
      this.todoSheetLoading = true
      try {
        const rows = await loadPendingTodosBySession()
        if (seq !== this.todoSheetSeq) return
        this.todoSheetRows = rows
      } finally {
        if (seq === this.todoSheetSeq) this.todoSheetLoading = false
      }
    },
    closeTodoSheet() {
      this.todoSheetVisible = false
      this.todoSheetRows = []
      // 作废还在路上的读取，避免关闭后回填旧数据。
      this.todoSheetSeq += 1
      this.todoSheetLoading = false
    },
    openTodoSession(group) {
      const session = store.sessions.find((item) => item.id === group?.sessionId)
      this.todoSheetVisible = false
      this.todoSheetRows = []
      this.todoSheetSeq += 1
      if (session) this.open(session)
    },
    /** 全部任务：与「全部待办」一致，先把手上的缓存铺上，再联网补一次。 */
    async openScheduleSheet() {
      this.filterMenuVisible = false
      this.scheduleSheetVisible = true
      // 缓存就是上一次读到的分组：先用它铺满弹层，避免点开后空白一闪（甚至看起来
      // 像「什么都没读到」）。联网结果回来后原地替换。
      this.scheduleSheetRows = (store.scheduledAllGroups || []).slice()
      this.scheduleSheetFailed = false
      const seq = ++this.scheduleSheetSeq
      this.scheduleSheetLoading = this.scheduleSheetRows.length === 0
      try {
        const result = await loadAllScheduled()
        if (seq !== this.scheduleSheetSeq) return
        // stale（被后发请求抢占）/ 离线都保留已有列表，不清空。
        const merged = mergeScheduledResult(result, this.scheduleSheetRows)
        if (merged.updated) this.scheduleSheetRows = merged.rows
        this.scheduleSheetOffline = merged.offline
        this.scheduleSheetFailed = merged.failed === true
      } catch {
        if (seq === this.scheduleSheetSeq) {
          this.scheduleSheetOffline = false
          this.scheduleSheetFailed = this.scheduleSheetRows.length === 0
        }
      } finally {
        if (seq === this.scheduleSheetSeq) this.scheduleSheetLoading = false
      }
    },
    closeScheduleSheet() {
      this.scheduleSheetVisible = false
      this.scheduleSheetRows = []
      this.scheduleSheetOffline = false
      this.scheduleSheetFailed = false
      // 作废还在路上的读取，避免关闭后回填旧数据。
      this.scheduleSheetSeq += 1
      this.scheduleSheetLoading = false
    },
    /** 「重新读取」：没读到内容时的唯一出口，重走一遍与打开时相同的链路。 */
    retryScheduleSheet() {
      if (this.scheduleSheetLoading) return
      void this.openScheduleSheet()
    },
    openScheduleSession(group) {
      const session = store.sessions.find((item) => item.id === group?.sessionId)
      this.scheduleSheetVisible = false
      this.scheduleSheetRows = []
      this.scheduleSheetOffline = false
      this.scheduleSheetFailed = false
      this.scheduleSheetSeq += 1
      // 会话已被删掉时留在弹层里：那里还能看到任务内容，进去只会是一页空白。
      if (session) this.open(session)
    },
    async onRefresh() {
      this.refreshing = true
      try {
        await this.refresh()
      } finally {
        this.refreshing = false
      }
    },
    runningFor(sessionId) {
      const session = store.sessions.find((item) => item.id === sessionId)
      if (session?.running) return true
      return Object.values(store.activeRuns).some((run) => run.sessionId === sessionId)
    },
    pendingFor(sessionId) {
      const session = store.sessions.find((item) => item.id === sessionId)
      if (session && Number(session.queueCount) > 0) return Number(session.queueCount)
      return store.queue.filter((item) => item.sessionId === sessionId).length
    },
    /** 结束但还没打开的会话：'done' / 'failed'，没有标记时返回空串。 */
    unreadFor(sessionId) {
      const entry = store.unreadSessions?.[sessionId]
      if (!entry) return ''
      return entry.status === 'failed' ? 'failed' : 'done'
    },
    /**
     * 会话列表里的计划只在任务执行中显示。
     *
     * 电脑端的执行框才会展开完整计划；列表只回答「这个任务的计划走到哪了」：
     * 一排彩色数字序号 + 完成数，再带出当前步骤的文字。任务结束后整行收起，
     * 既不占列表空间，也避免让人误以为还在执行。
     */
    planStats(session) {
      if (!this.runningFor(session?.id)) return null
      return planProgress(session?.plan, true)
    },
    sessionMeta(session) {
      const parts = []
      const instructions = Number(session.instructionCount)
      // 每个任务里用户实际下过的指令数；旧版电脑端没有这个字段时直接省略。
      if (Number.isFinite(instructions) && instructions > 0) {
        parts.push(t('{v1} 条指令', { v1: instructions }))
      }
      if (session.gitBranch) parts.push(session.gitBranch)
      parts.push(relativeTime(session.lastModified))
      return parts.filter(Boolean).join(' · ')
    },
    async refresh() {
      if (!this.connected) {
        reconnectClient()
        return
      }
      await refreshAll()
    },
    reconnect() {
      reconnectClient()
    },
    toggleTheme() {
      // 只做深/浅两态：跟随系统时以当前解析结果为准取反，切完即固定为显式模式。
      // setThemeMode 内部会写 storage、重算页面配色并刷新系统栏。
      setThemeMode(store.theme === 'light' ? 'dark' : 'light')
    },
    openSettings() {
      uni.navigateTo({ url: '/pages/settings/index' })
    },
    openUpdate() {
      // 所有更新状态都进独立更新页：进度条、重试/取消与浏览器下载集中展示。
      if (this.updateState.status === 'idle' || this.updateState.status === 'done') {
        this.openSettings()
        return
      }
      openUpdatePage()
    },
    async checkUpdates() {
      if (this.checkingUpdate) return
      this.checkingUpdate = true
      try {
        // manual 模式：跳过静默节流，总会请求并把结果反馈给用户。
        await checkAndPromptUpdate({ manual: true })
      } finally {
        this.checkingUpdate = false
      }
    },
    open(session) {
      if (!session?.id) return
      // 长按菜单或拖动列表之后，抬手产生的 click 不应再打开会话。
      if (this.sessionPress?.clickBlocked()) return
      // 先选中并跳转，历史记录由会话页自己加载：点开即有反馈，不再等网络。
      selectSession(session.id)
      uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(session.id)}` })
    },
    /**
     * 行内快捷入口：直接进这个任务的文件列表。
     *
     * 这里刻意不调用 selectSession：只是看一眼文件，不该把当前会话切走
     * （切换会清空正文、重新拉待办）。文件页按 URL 里的 sessionId 自己找会话。
     */
    openSessionFiles(session) {
      if (!session?.id) return
      if (this.sessionPress?.clickBlocked()) return
      uni.navigateTo({
        url: `/pages/files/index?sessionId=${encodeURIComponent(session.id)}`
      })
    },
    /** 行内快捷入口：直接进这个任务的会话知识库（不带 from=chat，避免跳回列表）。 */
    openSessionKnowledge(session) {
      if (!session?.id) return
      if (this.sessionPress?.clickBlocked()) return
      uni.navigateTo({
        url: `/pages/knowledge/index?sessionId=${encodeURIComponent(session.id)}&from=sessions`
      })
    },
    /** 行内快捷入口：这个任务里出现过的链接，进独立的链接页。 */
    openSessionLinks(session) {
      if (!session?.id) return
      if (this.sessionPress?.clickBlocked()) return
      uni.navigateTo({
        url: `/pages/session-links/index?sessionId=${encodeURIComponent(session.id)}`
      })
    },
    /** 行内快捷入口：这个任务可用的工具，进独立的工具页。 */
    openSessionTools(session) {
      if (!session?.id) return
      if (this.sessionPress?.clickBlocked()) return
      uni.navigateTo({
        url: `/pages/session-tools/index?sessionId=${encodeURIComponent(session.id)}`
      })
    },
    /** 行内快捷入口：这个任务用到的项目记忆，进独立的记忆页。 */
    openSessionMemory(session) {
      if (!session?.id) return
      if (this.sessionPress?.clickBlocked()) return
      uni.navigateTo({
        url: `/pages/session-memory/index?sessionId=${encodeURIComponent(session.id)}`
      })
    },
    /** 汇总条点一下：直接打开最近结束、还没看过的那个会话。 */
    openLatestUnread() {
      const latest = this.unreadEntries[0]
      const session = latest && store.sessions.find((item) => item.id === latest.id)
      if (session) {
        this.open(session)
        return
      }
      // 会话已经不在列表里（被删或还没同步到），退回刷新列表。
      this.refresh()
    },
    // 会话长按：按下后计时，拖动或列表滚动立即取消。
    startSessionPress(session, event) {
      this.sessionPress?.start(event, session)
    },
    moveSessionPress(event) {
      this.sessionPress?.move(event)
    },
    endSessionPress() {
      this.sessionPress?.end()
    },
    cancelSessionPress() {
      this.sessionPress?.cancel()
    },
    onSessionListScroll() {
      this.sessionPress?.scroll()
    },
    // 会话长按菜单：重命名 / 复制任务 / 删除任务，对应电脑端侧栏的同类操作。
    openSessionMenu(session) {
      if (!session?.id) return
      this.menuSession = session
      this.menuVisible = true
    },
    closeSessionMenu() {
      this.menuVisible = false
    },
    startSessionRename() {
      const session = this.menuSession
      if (!session?.id) return
      this.menuVisible = false
      this.renameSessionId = session.id
      this.renameValue = String(session.title || '')
      this.renameError = ''
      this.renameBusy = false
      this.renameFocus = false
      this.renameVisible = true
      // 等弹层挂载后再聚焦：过早 focus 在安卓上会被输入法忽略。
      setTimeout(() => {
        if (this.renameVisible) this.renameFocus = true
      }, 120)
    },
    closeSessionRename() {
      if (this.renameBusy) return
      this.renameVisible = false
      this.renameFocus = false
      this.renameSessionId = ''
      this.renameValue = ''
      this.renameError = ''
    },
    async submitSessionRename() {
      if (this.sessionRenameDisabled) return
      const id = this.renameSessionId
      const title = String(this.renameValue || '').trim()
      if (!id || !title) return
      this.renameBusy = true
      this.renameError = ''
      try {
        await renameSession(id, title)
        this.renameVisible = false
        this.renameFocus = false
        this.renameSessionId = ''
        this.menuSession = null
        uni.showToast({ title: t('已重命名'), icon: 'none' })
      } catch (error) {
        this.renameError = String(error?.message || t('重命名失败')).slice(0, 80)
      } finally {
        this.renameBusy = false
      }
    },
    async forkCurrentSession() {
      const session = this.menuSession
      if (!session?.id) return
      this.menuVisible = false
      this.menuSession = null
      uni.showLoading({ title: t('正在复制…'), mask: true })
      try {
        const created = await forkSession(session.id)
        uni.hideLoading()
        uni.showToast({ title: t('已复制任务'), icon: 'none' })
        const id = String(created?.id || '')
        if (id) {
          selectSession(id)
          uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(id)}` })
        }
      } catch (error) {
        uni.hideLoading()
        uni.showToast({
          title: String(error?.message || t('复制失败')).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      }
    },
    askDeleteSession() {
      if (!this.menuSession?.id) return
      this.menuVisible = false
      this.deleteVisible = true
    },
    async confirmDeleteSession() {
      if (this.deleteBusy) return
      const session = this.menuSession
      this.deleteVisible = false
      if (!session?.id) return
      this.deleteBusy = true
      try {
        await deleteSession(session.id)
        this.menuSession = null
        uni.showToast({ title: t('已删除任务'), icon: 'none' })
      } catch (error) {
        uni.showToast({
          title: String(error?.message || t('删除失败')).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.deleteBusy = false
      }
    },
    async newChat() {
      if (!this.connected || !this.agentOnline) {
        uni.showToast({ title: t("请先连接电脑"), icon: 'none' })
        return
      }
      if (!store.roots.length) await refreshRoots()
      const roots = store.roots.filter(Boolean)
      if (!roots.length) {
        // 电脑上没有打开的工作区时，只要有授权目录就可以直接新建一个。
        if (store.workspaceRoots.length > 0) {
          this.openCreator()
          return
        }
        this.noRootsVisible = true
        return
      }
      this.pickerRoots = roots.map((root) => String(root))
      this.pickerQuery = ''
      this.pickerVisible = true
    },
    newTaskInGroup(group) {
      if (!this.connected || !this.agentOnline) {
        uni.showToast({ title: t("请先连接电脑"), icon: 'none' })
        return
      }
      const workdir = String(group?.cwd || '')
      if (!workdir) {
        // 分组只有项目名没有目录（老会话）时，退回通用的项目选择器。
        void this.newChat()
        return
      }
      startNewChat(workdir)
      uni.navigateTo({ url: '/pages/chat/index?new=1' })
    },
    openCreator() {
      this.pickerVisible = false
      this.pickerQuery = ''
      if (!store.workspaceRoots.length) {
        this.noRootsVisible = true
        return
      }
      this.creatorRoot = store.workspaceRoots[0]
      this.creatorName = ''
      this.creatorBusy = false
      this.creatorPath = ''
      this.creatorParent = ''
      this.creatorFolders = []
      this.creatorBrowseError = ''
      this.browseTruncated = false
      this.creatorVisible = true
      void this.loadFolders()
    },
    closeCreator() {
      if (this.creatorBusy) return
      this.creatorVisible = false
      this.creatorName = ''
      this.creatorPath = ''
      this.creatorParent = ''
      this.creatorFolders = []
      this.creatorBrowseError = ''
      this.browseTruncated = false
      // 作废还在路上的目录请求，避免关闭后回填旧数据。
      this.creatorBrowseSeq += 1
      this.creatorBrowseBusy = false
    },
    chooseCreatorRoot(root) {
      if (this.creatorRoot === root || this.creatorBusy) return
      this.creatorRoot = root
      this.creatorPath = ''
      this.creatorParent = ''
      this.creatorFolders = []
      this.creatorBrowseError = ''
      void this.loadFolders()
    },
    enterFolder(folder) {
      if (this.creatorBusy || this.creatorBrowseBusy) return
      this.creatorPath = folder.path
      this.creatorParent = this.creatorPath.split('/').slice(0, -1).join('/')
      void this.loadFolders()
    },
    browseUp() {
      if (this.creatorBusy || this.creatorBrowseBusy || !this.creatorPath) return
      this.creatorPath = this.creatorParent
      this.creatorParent = this.creatorPath.split('/').slice(0, -1).join('/')
      void this.loadFolders()
    },
    async loadFolders() {
      const root = this.creatorRoot
      const path = this.creatorPath
      if (!root) return
      const seq = ++this.creatorBrowseSeq
      this.creatorBrowseBusy = true
      this.creatorBrowseError = ''
      try {
        const data = await browseWorkspaceFolders(root, path)
        if (seq !== this.creatorBrowseSeq) return
        this.creatorFolders = data.entries
        this.creatorParent = data.parent
        this.browseTruncated = data.truncated
      } catch (error) {
        if (seq !== this.creatorBrowseSeq) return
        this.creatorFolders = []
        this.browseTruncated = false
        const message = String(error?.message || t("读取文件夹失败"))
        this.creatorBrowseError = message.includes(t("不支持该操作"))
          ? t("电脑端版本较旧，暂时不能浏览子文件夹。升级后可选任意层级，也可以直接在授权目录新建。")
          : message.slice(0, 60)
      } finally {
        if (seq === this.creatorBrowseSeq) this.creatorBrowseBusy = false
      }
    },
    async useCurrentFolder() {
      if (this.creatorBusy || this.creatorBrowseBusy) return
      if (!this.creatorRoot) return
      this.creatorBusy = true
      try {
        const workspace = await openWorkspaceFolder(this.creatorRoot, this.creatorPath)
        const path = String(workspace?.path || '')
        if (!path) throw new Error(t("电脑端没有返回工作区路径"))
        // 直接收起弹层：closeCreator 在忙碌时会忽略关闭。
        this.creatorBrowseSeq += 1
        this.creatorVisible = false
        this.creatorName = ''
        startNewChat(path)
        uni.navigateTo({ url: '/pages/chat/index?new=1' })
      } catch (error) {
        const message = String(error?.message || t("打开工作区失败"))
        uni.showToast({
          title: message.includes(t("不支持该操作"))
            ? t("请先升级电脑端 Pilot，再选择已有文件夹")
            : message.slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.creatorBusy = false
      }
    },
    async submitWorkspace() {
      if (this.creatorBusy || this.creatorBrowseBusy) return
      const check = this.creatorNameCheck
      if (!check.ok) {
        if (check.error) {
          uni.showToast({ title: check.error, icon: 'none' })
        }
        return
      }
      if (!this.creatorRoot) return
      this.creatorBusy = true
      try {
        const workspace = await createWorkspace(this.creatorRoot, check.name, this.creatorPath)
        const path = String(workspace?.path || '')
        this.creatorVisible = false
        this.creatorName = ''
        if (!path) throw new Error(t("电脑端没有返回工作区路径"))
        startNewChat(path)
        uni.navigateTo({ url: '/pages/chat/index?new=1' })
      } catch (error) {
        uni.showToast({
          title: String(error?.message || t("新建工作区失败")).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.creatorBusy = false
      }
    },
    rootName(root) {
      const value = String(root || '').replace(/[\\/]+$/, '')
      const parts = value.split(/[\\/]/).filter(Boolean)
      return parts[parts.length - 1] || value || t("工作目录")
    },
    chooseRoot(root) {
      this.pickerVisible = false
      this.pickerQuery = ''
      startNewChat(root)
      uni.navigateTo({ url: '/pages/chat/index?new=1' })
    },
    closePicker() {
      this.pickerVisible = false
      this.pickerQuery = ''
    },
    openDeviceSheet() {
      if (!store.pairings.length) return
      this.deviceSheetVisible = true
    },
    closeDeviceSheet() {
      this.deviceSheetVisible = false
    },
    isActiveDevice(deviceId) {
      return store.pairing?.deviceId === deviceId
    },
    relayHost(url) {
      const match = /^(?:wss?|https?):\/\/([^/?#]+)/i.exec(String(url || ''))
      return match ? match[1] : String(url || '')
    },
    chooseDevice(deviceId) {
      this.deviceSheetVisible = false
      if (this.isActiveDevice(deviceId)) return
      switchToDevice(deviceId)
    },
    addDevice() {
      this.deviceSheetVisible = false
      uni.navigateTo({ url: '/pages/pair/index?add=1' })
    }
  }
}
</script>

<style>
.sessions-page {
  /* 固定头部的布局：状态栏 + 导航/筛选占满顶部，只有下面的列表滚动。 */
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  /* 自定义导航栏：为系统状态栏留出高度，H5 下变量为 0。 */
  padding: calc(var(--status-bar-height) + 24rpx) 28rpx 0;
  box-sizing: border-box;
}
.sessions-header {
  flex-shrink: 0;
}
.session-scroll {
  flex: 1;
  min-height: 0;
  /* 滚动容器会裁掉超出自身宽度的阴影。向左右各借 28rpx 页面留白，
     让卡片的横向阴影有地方画；宽度必须同步加宽，否则只向左偏移，
     右侧会空出一条。内容再用同样的内边距把卡片放回原位。 */
  width: calc(100% + 56rpx);
  margin: 0 -28rpx;
}
.session-content {
  /* 顶部留一点空间，第一张卡片的上方光晕才不会被滚动容器裁掉。 */
  padding: 12rpx 28rpx calc(180rpx + env(safe-area-inset-bottom));
}
/* 结束但还没点开的会话：列表上方一条可点的汇总，切了项目筛选也不会漏。 */
.unread-summary {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 0 0 16rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: var(--resume-soft);
  box-shadow: 0 0 2rpx rgba(152, 183, 158, 0.4), 0 8rpx 22rpx rgba(152, 183, 158, 0.14);
}
.unread-summary:active {
  opacity: 0.75;
}
.unread-summary-dot {
  flex-shrink: 0;
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: var(--resume);
  animation: unread-pulse 1.8s ease-in-out infinite;
}
.unread-summary-text {
  flex: 1;
  min-width: 0;
  color: var(--resume);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.unread-summary-action {
  flex-shrink: 0;
  color: var(--resume);
  font-size: calc(22rpx * var(--font-scale));
  opacity: 0.85;
}
/* 排队汇总行：和「未查看」汇总同一位置、同一结构，只换成暂停色。 */
.queue-summary {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 0 0 16rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: var(--pause-soft);
  box-shadow: var(--control-shadow);
}
.queue-summary:active {
  opacity: 0.75;
}
.queue-summary-dot {
  background: var(--pause);
  animation: none;
}
.queue-summary-count {
  flex: 1;
  min-width: 0;
  color: var(--pause);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.queue-summary-action {
  flex-shrink: 0;
  color: var(--pause);
  font-size: calc(22rpx * var(--font-scale));
  opacity: 0.85;
}
.filter-bar {
  /* 下拉菜单浮在会话列表上方，不占用列表高度。 */
  position: relative;
  z-index: 30;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16rpx;
  row-gap: 12rpx;
  padding: 0 0 16rpx;
}
.running-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  flex-shrink: 0;
  padding: 12rpx 20rpx;
  border-radius: 14rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.running-toggle.active {
  background: rgba(152, 183, 158, 0.12);
}
.running-check {
  width: 28rpx;
  height: 28rpx;
  border-radius: 8rpx;
  background: var(--surface-3);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.running-check.checked {
  background: #98b79e;
}
.running-check-mark {
  color: #000000;
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1;
  font-weight: 700;
}
.running-toggle-label {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
}
.running-toggle.active .running-toggle-label {
  color: var(--ok-soft);
}
.running-toggle-count {
  color: var(--ok);
  font-size: calc(20rpx * var(--font-scale));
  background: rgba(152, 183, 158, 0.14);
  padding: 2rpx 10rpx;
  border-radius: 20rpx;
}
/* 进行中后面的「全部待办」：和筛选、进行中同一排，空间不够时让筛选先收缩。 */
.todo-entry {
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  flex-shrink: 0;
  padding: 12rpx 20rpx;
  border-radius: 14rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.todo-entry:active {
  background: rgba(143, 168, 192, 0.12);
}
.todo-entry-label {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
}
.todo-entry-count {
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
  background: var(--bg-soft);
  padding: 2rpx 10rpx;
  border-radius: 20rpx;
}
.filter-trigger {
  position: relative;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  padding: 12rpx 22rpx;
  border-radius: 14rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.filter-trigger.open {
  background: rgba(143, 168, 192, 0.12);
}
.filter-trigger-label {
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  flex: 0 1 auto;
  min-width: 0;
  max-width: 420rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.filter-trigger.open .filter-trigger-label {
  color: var(--accent-soft);
}
.filter-trigger-count {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  background: var(--bg-soft);
  padding: 2rpx 10rpx;
  border-radius: 20rpx;
}
.filter-caret {
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1;
  transition: transform 0.15s ease;
}
.filter-trigger.open .filter-caret {
  transform: rotate(180deg);
}
.filter-mask {
  /* 透明遮罩只用来接收「点击外部关闭」，位于触发按钮和菜单之下。 */
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 1;
}
.filter-menu {
  position: absolute;
  left: 0;
  top: calc(100% - 6rpx);
  z-index: 2;
  width: 560rpx;
  max-width: 100%;
  border-radius: 18rpx;
  background: var(--surface-2);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.filter-menu-list {
  width: 100%;
}
.filter-option {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 88rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
}
.filter-option:last-child {
  border-bottom: none;
}
.filter-option.active {
  background: rgba(143, 168, 192, 0.14);
}
.filter-option-name {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.filter-option.active .filter-option-name {
  color: var(--accent-soft);
}
.filter-option-count {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  background: var(--surface-3);
  padding: 2rpx 12rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
}
.filter-check {
  width: 26rpx;
  flex-shrink: 0;
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  text-align: center;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx 4rpx 24rpx;
}
.topbar-main {
  display: flex;
  align-items: center;
  gap: 18rpx;
  min-width: 0;
  flex: 1;
  padding: 6rpx 0;
}
.device-caret {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  flex-shrink: 0;
  padding-left: 4rpx;
}
.dot {
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
  background: var(--dim);
  flex-shrink: 0;
}
.dot.ok {
  background: var(--ok);
  box-shadow: 0 0 14rpx rgba(152, 183, 158, 0.6);
}
.dot.warn {
  background: var(--warn);
}
.dot.err {
  background: var(--danger);
}
.titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.title {
  color: var(--text-strong);
  font-size: calc(38rpx * var(--font-scale));
  font-weight: 650;
}
.subtitle {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  margin-top: 6rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topbar-actions {
  display: flex;
  gap: 14rpx;
  flex-shrink: 0;
}
/* 主题/设置放大成两个拇指好点的圆角按钮，弱光下也更容易看到。 */
.action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: var(--btn-h-sm);
  padding: 0 var(--btn-pad-sm);
  border: 1rpx solid transparent;
  border-radius: var(--btn-radius-pill);
  background: var(--surface);
  color: var(--accent-soft);
  font-size: var(--btn-font-sm);
  font-weight: 500;
  line-height: 1.2;
  box-shadow: var(--control-shadow);
}
.action:active {
  background: var(--hover-strong);
}
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  padding: 18rpx 22rpx;
  margin-bottom: 22rpx;
  border-radius: 16rpx;
  background: rgba(201, 171, 124, 0.1);
}
.banner.error {
  background: rgba(201, 146, 141, 0.1);
}
.banner-text {
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.5;
  flex: 1;
}
.banner-action {
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  flex-shrink: 0;
}
.update-banner {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 18rpx 22rpx;
  margin-bottom: 18rpx;
  border-radius: 16rpx;
  background: rgba(143, 168, 192, 0.1);
}
.update-banner.ready {
  background: rgba(152, 183, 158, 0.1);
}
.update-banner.error {
  background: rgba(201, 146, 141, 0.1);
}
.update-banner-main {
  flex: 1;
  min-width: 0;
}
.update-banner-title {
  display: block;
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.update-banner.ready .update-banner-title {
  color: var(--ok-soft);
}
.update-banner.error .update-banner-title {
  color: var(--danger);
}
.update-banner-meta {
  display: block;
  margin-top: 6rpx;
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.update-banner-bar {
  height: 6rpx;
  margin-top: 10rpx;
  border-radius: 4rpx;
  background: var(--surface-3);
  overflow: hidden;
}
.update-banner-fill {
  height: 100%;
  border-radius: 4rpx;
  background: var(--accent-gradient);
  transition: width 0.2s ease;
}
.update-banner-action {
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  flex-shrink: 0;
}
.empty {
  margin-top: 120rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  padding: 0 40rpx;
}
.empty-title {
  color: var(--text);
  font-size: calc(30rpx * var(--font-scale));
}
.empty-hint {
  color: var(--dim);
  font-size: calc(24rpx * var(--font-scale));
  text-align: center;
  line-height: 1.6;
}
.project {
  margin-bottom: 18rpx;
}
.project-head {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 18rpx 10rpx 10rpx;
}
.project-name {
  color: var(--muted);
  font-size: calc(25rpx * var(--font-scale));
  font-weight: 600;
  letter-spacing: 0.5rpx;
}
.project-count {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  background: var(--bg-soft);
  border-radius: 20rpx;
  padding: 2rpx 12rpx;
}
/* 项目名右侧的加号：靠右对齐，点击直接在该项目目录里新建任务。 */
.project-add {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  border-radius: 22rpx;
  background: var(--bg-soft);
}
.project-add-icon {
  color: var(--muted);
  font-size: calc(26rpx * var(--font-scale));
  line-height: 1;
}
.project-add:active {
  background: var(--accent-wash);
}
.session {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 22rpx;
  margin-bottom: 12rpx;
  background: var(--surface);
  border-radius: 18rpx;
  box-shadow: var(--card-shadow);
}
.session.running {
  background: linear-gradient(0deg, rgba(152, 183, 158, 0.06), rgba(152, 183, 158, 0.06)),
    var(--surface);
  /* 运行中的卡片用绿色勾边和光晕，四周都能看出这一条正在执行。 */
  box-shadow: 0 0 2rpx rgba(152, 183, 158, 0.45), 0 0 20rpx rgba(152, 183, 158, 0.2),
    0 10rpx 28rpx rgba(152, 183, 158, 0.14);
}
/* 结束但还没点开：左侧竖条 + 淡底 + 加粗标题，扫一眼就能挑出来。 */
.session.unread {
  border-left: 6rpx solid var(--resume);
  padding-left: 16rpx;
  background: linear-gradient(0deg, rgba(152, 183, 158, 0.1), rgba(152, 183, 158, 0.1)),
    var(--surface);
  box-shadow: 0 0 2rpx rgba(152, 183, 158, 0.45), 0 10rpx 26rpx rgba(152, 183, 158, 0.16);
}
.session.unread .session-title {
  font-weight: 600;
}
.session.unread-failed {
  border-left-color: var(--stop);
  background: linear-gradient(0deg, rgba(201, 146, 141, 0.12), rgba(201, 146, 141, 0.12)),
    var(--surface);
  box-shadow: 0 0 2rpx rgba(201, 146, 141, 0.45), 0 10rpx 26rpx rgba(201, 146, 141, 0.16);
}
.session-main {
  flex: 1;
  min-width: 0;
}
.session-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.session-title {
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.badge {
  font-size: calc(20rpx * var(--font-scale));
  padding: 2rpx 12rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
}
.running-badge {
  color: var(--resume);
  background: var(--resume-soft);
}
.queue-badge {
  color: var(--pause);
  background: var(--pause-soft);
}
.todo-badge {
  color: var(--file);
  background: var(--file-soft);
}
.paused-badge {
  color: var(--pause);
  background: var(--pause-soft);
}
/* 未查看徽标：实色底 + 圆点，比原来的浅色小字更容易在列表里跳出来。 */
.unread-badge {
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 4rpx 14rpx;
  font-size: calc(21rpx * var(--font-scale));
  font-weight: 600;
  color: var(--bg);
}
.unread-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: var(--bg);
  animation: unread-pulse 1.8s ease-in-out infinite;
}
@keyframes unread-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.72);
  }
}
.done-badge {
  background: var(--resume);
  color: var(--bg);
}
.failed-badge {
  background: var(--stop);
  color: var(--bg);
}
.session-instruction {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 8rpx;
  min-width: 0;
}
.session-instruction-tag {
  flex-shrink: 0;
  padding: 0 10rpx;
  border-radius: 8rpx;
  background: rgba(143, 168, 192, 0.16);
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.6;
}
.session-instruction-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
}
.session-meta {
  display: block;
  margin-top: 8rpx;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
}
/* 行内快捷入口：五个入口同一套胶囊样式，字号/高度/圆角全走 .chip；
   这里只给底色和描边，不再按分类上语义色——「记忆」以前是唯一一个
   用主色的按钮，看起来像另一档次的操作。
   底色必须比会话卡片（--surface）高一档：用 --surface-2 时和卡片只差
   10 级亮度，深色下五颗按钮几乎糊在卡片上，看不出是按钮。 */
.session-links {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 12rpx;
}
.session-link {
  color: var(--text);
  background: var(--surface-3);
  border-color: var(--line);
  /* 深色主题的 --line 只有 10% 白，1rpx 描边压在 --surface-3 上几乎看不出来，
     按钮外形全靠底色差，低亮度屏上就糊成一片。补一圈内描边把边缘提亮，
     不改主题变量（浅色主题下改成淡黑，同样不动 --line）。 */
  box-shadow: inset 0 0 0 1rpx rgba(255, 255, 255, 0.16);
}
.theme-light .session-link {
  box-shadow: inset 0 0 0 1rpx rgba(0, 0, 0, 0.09);
}
.session-link:active {
  color: var(--accent-soft);
  border-color: var(--accent-soft);
}
.session-plan-row {
  margin-top: 8rpx;
}
.session-plan-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.session-plan-tag {
  flex-shrink: 0;
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
}
.session-plan-steps {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
}
.session-plan-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--muted);
  font-size: calc(18rpx * var(--font-scale));
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.session-plan-dot.done {
  border-color: var(--ok);
  background: var(--ok);
  color: var(--bg);
}
.session-plan-dot.active {
  border-color: var(--warn);
  background: var(--warn);
  color: var(--bg);
  animation: plan-pulse 1.6s ease-in-out infinite;
}
@keyframes plan-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.62;
  }
}
.session-plan-more {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  font-variant-numeric: tabular-nums;
}
.session-plan-count {
  flex-shrink: 0;
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  font-variant-numeric: tabular-nums;
}
.session-plan-step {
  display: block;
  margin-top: 4rpx;
  overflow: hidden;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chevron {
  color: var(--muted);
  font-size: calc(40rpx * var(--font-scale));
  line-height: 1;
}
.fab {
  position: fixed;
  right: 40rpx;
  /* 版本号移到左下角后，FAB 回到右下角，只避开底部安全区。 */
  bottom: calc(40rpx + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 104rpx;
  height: 104rpx;
  border: var(--btn-primary-border, 1rpx solid transparent);
  border-radius: var(--btn-radius-pill);
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-ink));
  font-size: calc(56rpx * var(--font-scale));
  line-height: 1;
  box-shadow: var(--btn-primary-shadow, 0 16rpx 40rpx rgba(143, 168, 192, 0.4));
}
.fab:active {
  transform: scale(var(--btn-press-scale));
}
/* 左下角版本号：圆角胶囊底 + 次级文字，点按后原地显示“检查更新中…”。 */
.version-chip {
  position: fixed;
  left: 40rpx;
  bottom: calc(22rpx + env(safe-area-inset-bottom));
  z-index: 20;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: var(--surface-3);
  box-sizing: border-box;
}
.version-text {
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.4;
}
.version-chip:active .version-text {
  color: var(--accent-soft);
}
.version-chip.busy .version-text {
  color: var(--accent-soft);
}
/* 全部待办弹层：任务一行标题，下面逐条列出待办。 */
.todo-sheet-list {
  width: 100%;
}
.todo-sheet-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  padding: 56rpx 30rpx;
  text-align: center;
  color: var(--dim);
  font-size: calc(24rpx * var(--font-scale));
}
.todo-sheet-retry {
  padding: 10rpx 24rpx;
  border-radius: 14rpx;
  background: var(--bg-soft);
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
}
.todo-sheet-retry:active {
  opacity: 0.7;
}
.todo-sheet-group {
  margin-bottom: 16rpx;
}
.todo-sheet-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 30rpx;
}
.todo-sheet-session {
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  font-weight: 600;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 52%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.todo-sheet-project {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  flex: 0 1 auto;
  min-width: 0;
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.todo-sheet-count {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
  background: var(--bg-soft);
  border-radius: 20rpx;
  padding: 2rpx 10rpx;
}
.todo-sheet-go {
  flex-shrink: 0;
  color: var(--dim);
  font-size: calc(24rpx * var(--font-scale));
}
.todo-sheet-item {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  padding: 16rpx 18rpx;
  margin: 0 30rpx 8rpx;
  border-radius: 14rpx;
  background: var(--surface-2);
}
.todo-sheet-dot {
  width: 10rpx;
  height: 10rpx;
  margin-top: 12rpx;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--accent-line);
}
.todo-sheet-text {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.55;
  word-break: break-word;
}
.todo-sheet-tag {
  flex-shrink: 0;
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
}
/* 全部任务弹层沿用待办的行结构，只多一条「计划 + 时间」的副行。 */
.todo-sheet-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.todo-sheet-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
}
.todo-sheet-kind {
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
}
.todo-sheet-tag.error {
  background: var(--pause-soft);
  color: var(--pause);
}
.todo-sheet-dot.off {
  opacity: 0.35;
}
.sheet-search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 4rpx 30rpx 14rpx;
  padding: 0 20rpx;
  height: 78rpx;
  border-radius: 20rpx;
  background: var(--input-bg);
  box-sizing: border-box;
}
.sheet-search-icon {
  color: var(--muted);
  font-size: calc(30rpx * var(--font-scale));
  line-height: 1;
}
.sheet-search-input {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
}
.sheet-search-placeholder {
  color: var(--dim);
}
.sheet-search-clear {
  color: var(--muted);
  font-size: calc(34rpx * var(--font-scale));
  line-height: 1;
  padding: 6rpx 4rpx;
}
.sheet-list {
  width: 100%;
}
.sheet-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 22rpx 30rpx;
}
.sheet-item:active {
  background: var(--hover-strong);
}
.sheet-item-main {
  flex: 1;
  min-width: 0;
}
.sheet-item-name {
  display: block;
  color: var(--text);
  font-size: calc(29rpx * var(--font-scale));
  font-weight: 550;
}
.sheet-item-path {
  display: block;
  margin-top: 6rpx;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sheet-item-go {
  flex: none;
  color: var(--dim);
  font-size: calc(34rpx * var(--font-scale));
  line-height: 1;
}
.sheet-item-create .sheet-item-name {
  color: var(--accent-soft);
}
.create-body {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 4rpx 30rpx 10rpx;
  overflow-y: auto;
}
.create-label {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  margin-top: 8rpx;
}
.create-root {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  background: var(--input-bg);
}
.create-root.active {
  background: rgba(143, 168, 192, 0.1);
}
.create-root-main {
  flex: 1;
  min-width: 0;
}
.create-root-name {
  display: block;
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 550;
}
.create-root-path {
  display: block;
  margin-top: 4rpx;
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  word-break: break-all;
}
.create-root-check {
  flex: none;
  width: 28rpx;
  color: var(--accent-soft);
  font-size: calc(26rpx * var(--font-scale));
  text-align: center;
}
.create-roots {
  width: 100%;
  white-space: nowrap;
}
.create-roots-inner {
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  padding: 2rpx 0;
}
.create-chip {
  flex: none;
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background: var(--input-bg);
}
.create-chip.active {
  background: rgba(143, 168, 192, 0.12);
}
.create-chip-name {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
}
.create-chip.active .create-chip-name {
  color: var(--text-strong);
  font-weight: 550;
}
.browse-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 10rpx;
  padding: 6rpx 2rpx;
}
.browse-crumbs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  overflow: hidden;
}
.browse-crumb-root {
  flex: none;
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
}
.browse-crumb-rest {
  margin-left: 8rpx;
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.browse-up {
  flex: none;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  background: var(--surface-3);
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
}
.browse-list {
  width: 100%;
  border-radius: 18rpx;
  background: var(--input-bg);
  box-sizing: border-box;
}
.browse-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 20rpx 24rpx;
}
.browse-row:active {
  background: var(--hover-strong);
}
.browse-name {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.browse-go {
  flex: none;
  color: var(--dim);
  font-size: calc(32rpx * var(--font-scale));
  line-height: 1;
}
.browse-empty {
  padding: 40rpx 24rpx;
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
  text-align: center;
  line-height: 1.5;
}
.browse-actions {
  display: flex;
  justify-content: flex-end;
}
.browse-use {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: var(--btn-h-sm);
  padding: 0 var(--btn-pad-md);
  border: var(--btn-soft-border, 1rpx solid var(--accent-soft));
  border-radius: var(--btn-radius-pill);
  background: var(--btn-soft-bg, transparent);
  color: var(--btn-soft-fg, var(--accent-soft));
  font-size: var(--btn-font-sm);
  font-weight: 550;
}
.browse-use.disabled {
  opacity: 0.5;
}
.create-input-wrap {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 82rpx;
  padding: 0 20rpx;
  border-radius: 18rpx;
  background: var(--input-bg);
  box-sizing: border-box;
}
.create-input {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
}
.create-placeholder {
  color: var(--dim);
}
.create-clear {
  flex: none;
  color: var(--muted);
  font-size: calc(34rpx * var(--font-scale));
  line-height: 1;
  padding: 6rpx 4rpx;
}
.create-hint {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.create-error {
  color: var(--danger);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.device-action.disabled {
  color: var(--dim);
  opacity: 0.6;
}
.sheet-empty {
  padding: 54rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
}
.sheet-empty-title {
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
}
.sheet-empty-hint {
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
  text-align: center;
}
.device-list {
  width: 100%;
}
.device-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 22rpx 32rpx;
}
.device-row:active {
  background: var(--hover-strong);
}
.device-row.active {
  background: rgba(143, 168, 192, 0.1);
}
.device-main {
  flex: 1;
  min-width: 0;
}
.device-name {
  display: block;
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.device-host {
  display: block;
  margin-top: 6rpx;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.device-check {
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  flex-shrink: 0;
}
.device-switch {
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(143, 168, 192, 0.12);
  flex-shrink: 0;
}
.device-actions {
  display: flex;
  gap: 16rpx;
  padding: 2rpx 0 6rpx;
}
.device-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  box-sizing: border-box;
  height: var(--btn-h-md);
  padding: 0 var(--btn-pad-sm);
  border: var(--btn-secondary-border, 1rpx solid transparent);
  border-radius: var(--btn-radius-sm);
  background: var(--btn-secondary-bg, var(--surface-3));
  color: var(--btn-secondary-fg, var(--muted));
  font-size: var(--btn-font-md);
  line-height: 1.2;
  text-align: center;
}
.device-action.primary {
  border: var(--btn-primary-border, 1rpx solid transparent);
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-soft));
  font-weight: 600;
  box-shadow: var(--btn-primary-shadow, none);
}
/* 会话长按菜单：三行等宽动作，删除单独用危险色。 */
.session-actions {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 4rpx 30rpx 12rpx;
}
.session-action {
  display: flex;
  align-items: center;
  gap: 18rpx;
  min-height: 96rpx;
  padding: 0 24rpx;
  border-radius: 18rpx;
  background: var(--surface-3);
  box-sizing: border-box;
}
.session-action:active {
  opacity: 0.72;
}
.session-action-icon {
  width: 40rpx;
  flex: none;
  text-align: center;
  color: var(--muted);
  font-size: calc(30rpx * var(--font-scale));
  line-height: 1;
}
.session-action-label {
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
}
.session-action.danger .session-action-icon,
.session-action.danger .session-action-label {
  color: var(--danger);
}
.session-rename-field {
  position: relative;
  margin: 4rpx 30rpx 0;
  padding: 0 20rpx;
  border-radius: 16rpx;
  background: var(--surface-3);
  box-sizing: border-box;
}
.session-rename-input {
  height: 88rpx;
  padding-right: 48rpx;
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
  box-sizing: border-box;
}
.session-rename-placeholder {
  color: var(--dim);
}
.session-rename-clear {
  position: absolute;
  right: 16rpx;
  top: 50%;
  width: 44rpx;
  height: 44rpx;
  transform: translateY(-50%);
  text-align: center;
  color: var(--muted);
  font-size: calc(32rpx * var(--font-scale));
  line-height: calc(44rpx * var(--font-scale));
}
.session-rename-error {
  display: block;
  margin: 12rpx 30rpx 0;
  color: var(--danger);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.4;
}
.session-rename-actions {
  display: flex;
  gap: 16rpx;
  padding-bottom: 6rpx;
}
.session-rename-action {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--btn-h-md);
  border-radius: var(--btn-radius-sm);
  background: var(--btn-secondary-bg, var(--surface-3));
  color: var(--btn-secondary-fg, var(--text));
  font-size: var(--btn-font-md);
  line-height: 1.2;
}
.session-rename-action.primary {
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-soft));
  font-weight: 600;
  box-shadow: var(--btn-primary-shadow, none);
}
.session-rename-action.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
