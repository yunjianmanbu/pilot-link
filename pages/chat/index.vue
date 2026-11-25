<template>
  <view class="page chat-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="topbar">
      <view class="back" @click="back"><view class="back-arrow"></view></view>
      <view class="titles">
        <!-- 和电脑端一致：点标题就能改任务名称，右上角「更多」里也有入口。 -->
        <text
          class="title"
          :class="{ editable: store.currentSessionId }"
          @click="openRename"
        >{{ title }}</text>
        <text class="subtitle">{{ subtitle }}</text>
      </view>
      <view v-if="running" class="run-actions">
        <text class="chip pause" @click="pause">{{ t('暂停') }}</text>
        <text class="chip stop" @click="stop">{{ t('停止') }}</text>
      </view>
      <text v-else-if="paused" class="chip resume" @click="resume">{{ t('继续') }}</text>
      <view v-if="store.currentSessionId" class="more-wrap">
        <view class="more-btn" :class="{ open: moreOpen }" @click="toggleMore">
          <view class="more-dot" />
          <view class="more-dot" />
          <view class="more-dot" />
        </view>
        <view v-if="moreOpen" class="more-mask" @click="moreOpen = false"></view>
        <view v-if="moreOpen" class="more-pop">
          <view
            v-for="(option, index) in moreOptions"
            :key="index"
            class="more-item"
            @click="onMorePick(index)"
          >
            <text class="more-label">{{ option.label }}</text>
            <!-- 会话模型这类有当前值的入口，把当前值放在第二行，省掉输入区那枚胶囊。 -->
            <text v-if="option.hint" class="more-hint">{{ option.hint }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="bannerText" class="banner" :class="{ error: !agentOnline }">
      <text class="banner-text">{{ bannerText }}</text>
      <text v-if="showRetry" class="banner-action" @click="reconnect">{{ t('重连') }}</text>
    </view>

    <scroll-view
      class="messages"
      scroll-y
      :scroll-into-view="scrollTarget"
      :scroll-with-animation="false"
      :lower-threshold="120"
      @scroll="onScroll"
      @scrolltolower="nearBottom = true"
    >
      <view v-if="store.historyBefore" class="load-earlier" @click="loadEarlier">
        {{ store.historyLoading ? t('正在加载…') : t('加载更早的消息') }}
      </view>
      <view v-if="store.historyLoading && store.messages.length === 0" class="loading-hint">
        {{ t('正在读取会话记录…') }}
      </view>

      <view
        v-for="item in rendered"
        :id="item.anchorId"
        :key="item.key"
        class="msg"
        :class="[item.role, { 'msg-focused': item.focused }]"
      >
        <view
          v-if="item.role === 'user' && (item.hasText || item.hasImage || item.hasReference)"
          class="bubble user-bubble"
          @touchstart="startMessagePress(item, $event)"
          @touchmove="moveMessagePress"
          @touchend="endMessagePress"
          @touchcancel="cancelMessagePress"
        >
          <view v-for="part in item.parts" v-show="part.kind === 'text'" :key="part.key" class="msg-text">
            <template v-for="seg in part.segments" :key="seg.index">
              <!-- 正文里的网址单独包一层，点一下进内置预览，长按出菜单。 -->
              <text
                v-if="seg.kind === 'link'"
                class="msg-link"
                user-select
                @touchstart.stop
                @click.stop="openInlineLink(seg.url)"
                @longpress.stop="openInlineLinkMenu(seg.url)"
                >{{ seg.text }}</text
              >
              <text v-else user-select>{{ seg.text }}</text>
            </template>
          </view>
          <view v-if="item.hasReference" class="user-refs">
            <text
              v-for="part in item.parts"
              v-show="part.kind === 'reference'"
              :key="part.key"
              class="user-ref"
            >▤ {{ shortPath(part.path) }}</text>
          </view>
          <view v-if="item.hasImage" class="user-images">
            <image
              v-for="part in item.parts"
              v-show="part.kind === 'image'"
              :key="part.key"
              class="user-image"
              :src="part.url"
              mode="aspectFill"
              @click="previewImage(part.url)"
            />
          </view>
        </view>
        <view v-else-if="item.role === 'user'" class="assistant-body">
          <!-- 工具结果的记录在网络协议里是 user 消息，没有文字时单独渲染成结果行。 -->
          <view
            v-if="item.execHidden"
            class="tool-row exec-more-row"
            @click="toggleExecGroup(item)"
          >
            <text class="tool-icon">⋯</text>
            <text class="tool-summary">{{ t('更早的{v1}项执行过程 · 展开', { v1: item.execHidden }) }}</text>
          </view>
          <view
            v-else-if="item.execExpanded"
            class="tool-row exec-more-row"
            @click="toggleExecGroup(item)"
          >
            <text class="tool-icon">⋯</text>
            <text class="tool-summary">{{ t('收起更早的执行过程') }}</text>
          </view>
          <view
            v-for="part in item.parts"
            :key="part.key"
            v-show="part.kind === 'result'"
            class="tool-row result-row"
            :class="{ error: part.isError }"
            @click="toggle(part.key)"
          >
            <text class="tool-icon">↳</text>
            <text class="tool-summary" :class="{ mono: expanded[part.key] }">{{
              expanded[part.key] ? part.text : part.preview
            }}</text>
            <text class="tool-toggle">{{ expanded[part.key] ? t('收起') : t('展开') }}</text>
          </view>
        </view>
        <view v-else-if="item.role === 'system'" class="system-bubble" :class="{ error: item.error }">
          <view class="msg-text">
            <template v-for="seg in segmentsOf(item)" :key="seg.index">
              <text
                v-if="seg.kind === 'link'"
                class="msg-link"
                user-select
                @touchstart.stop
                @click.stop="openInlineLink(seg.url)"
                @longpress.stop="openInlineLinkMenu(seg.url)"
                >{{ seg.text }}</text
              >
              <text v-else user-select>{{ seg.text }}</text>
            </template>
          </view>
          <!-- 失败的运行可以原地重试；电脑端会沿用最后一条指令，不必重新打字。 -->
          <view v-if="item.error" class="system-retry" @click="retryFailedRun">
            <text class="system-retry-text">{{ retryBusy ? t('正在重试…') : t('重试') }}</text>
          </view>
        </view>
        <view v-else class="assistant-body">
          <view
            v-if="item.execHidden"
            class="tool-row exec-more-row"
            @click="toggleExecGroup(item)"
          >
            <text class="tool-icon">⋯</text>
            <text class="tool-summary">{{ t('更早的{v1}项执行过程 · 展开', { v1: item.execHidden }) }}</text>
          </view>
          <view
            v-else-if="item.execExpanded"
            class="tool-row exec-more-row"
            @click="toggleExecGroup(item)"
          >
            <text class="tool-icon">⋯</text>
            <text class="tool-summary">{{ t('收起更早的执行过程') }}</text>
          </view>
          <template v-for="part in item.parts" :key="part.key">
            <view v-if="part.kind === 'text'" class="msg-text assistant-text">
              <rich-text :nodes="part.nodes" />
              <view v-if="part.links && part.links.length" class="link-row">
                <view
                  v-for="link in part.links"
                  :key="link.url"
                  class="link-chip"
                  @click.stop="openLink(link)"
                  @longpress.stop="openLinkMenu(link)"
                >
                  <text class="link-chip-icon">↗</text>
                  <text class="link-chip-text">{{ link.label }}</text>
                </view>
              </view>
            </view>
            <view v-else-if="part.kind === 'thinking'" class="tool-row thinking-row" @click="toggle(part.key)">
              <text class="tool-icon">✳</text>
              <text class="tool-name">{{ t('思考') }}</text>
              <text class="tool-summary">{{ expanded[part.key] ? '' : shortText(part.text, 60) }}</text>
              <text class="tool-toggle">{{ expanded[part.key] ? t('收起') : t('展开') }}</text>
              <text v-if="expanded[part.key]" class="tool-body" user-select>{{ part.text }}</text>
            </view>
            <view v-else-if="part.kind === 'tool'" class="tool-row" @click="toggle(part.key)">
              <text class="tool-icon">⚙</text>
              <text class="tool-name">{{ part.name }}</text>
              <text class="tool-summary">{{ part.summary }}</text>
              <text class="tool-toggle">{{ expanded[part.key] ? t('收起') : t('参数') }}</text>
              <text v-if="expanded[part.key]" class="tool-body mono" user-select>{{ part.body }}</text>
              <view v-if="part.file" class="tool-file" @click.stop="openFilePart(part)">
                <text class="tool-file-icon">▤</text>
                <text class="tool-file-name">{{ part.file.name }}</text>
                <text class="tool-file-action">{{ t('预览 ›') }}</text>
              </view>
            </view>
            <view
              v-else-if="part.kind === 'result'"
              class="tool-row result-row"
              :class="{ error: part.isError }"
              @click="toggle(part.key)"
            >
              <text class="tool-icon">↳</text>
              <text class="tool-summary" :class="{ mono: expanded[part.key] }">{{
                expanded[part.key] ? part.text : part.preview
              }}</text>
              <text class="tool-toggle">{{ expanded[part.key] ? t('收起') : t('展开') }}</text>
            </view>
            <view v-else-if="part.kind === 'image'" class="tool-row">
              <text class="tool-icon">▧</text>
              <text class="tool-summary">{{ t('［图片］') }}</text>
            </view>
          </template>
          <view v-if="item.plan" class="turn-plan">
            <view class="tool-row turn-plan-row" @click="toggleTurnPlan(item)">
              <text class="tool-icon">☰</text>
              <text class="tool-name">{{ t('本轮计划') }}</text>
              <text class="tool-summary">{{ t('{v1}/{v2}完成', { v1: item.turnPlanDone, v2: item.turnPlanRows.length }) }}</text>
              <text class="tool-toggle">{{ turnPlanOpen[item.key] ? t('收起') : t('查看') }}</text>
            </view>
            <view v-if="turnPlanOpen[item.key]" class="turn-plan-body">
              <view
                v-for="row in item.turnPlanRows"
                :key="row.key"
                class="plan-item"
                :class="row.className"
              >
                <text class="plan-mark">{{ row.isDone ? '✓' : row.isActive ? '' : '○' }}</text>
                <text class="plan-text">{{ row.text }}</text>
              </view>
            </view>
          </view>
        </view>
        <view v-if="item.timeLabel || item.copyText" class="msg-actions">
          <text v-if="item.timeLabel" class="msg-time">{{ item.timeLabel }}</text>
          <text v-if="item.copyText" class="chip msg-action" @click.stop="copyMessage(item)">{{ t('复制') }}</text>
          <text v-if="item.copyText" class="chip msg-action" @click.stop="selectMessage(item)">{{ t('选择复制') }}</text>
        </view>
      </view>

      <view v-if="showStream" class="msg assistant">
        <view class="assistant-body">
          <view
            v-if="store.streamReasoning"
            class="tool-row thinking-row"
            @click="toggle('stream-reasoning')"
          >
            <text class="tool-icon">✳</text>
            <text class="tool-name">{{ t('思考') }}</text>
            <text class="tool-summary">{{
              expanded['stream-reasoning'] ? '' : shortText(store.streamReasoning, 60)
            }}</text>
            <text class="tool-toggle">{{ expanded['stream-reasoning'] ? t('收起') : t('展开') }}</text>
            <text v-if="expanded['stream-reasoning']" class="tool-body" user-select>{{
              store.streamReasoning
            }}</text>
          </view>
          <view v-if="store.streamText" class="msg-text assistant-text">
            <rich-text :nodes="streamNodes" />
            <view v-if="streamLinks.length" class="link-row">
              <view
                v-for="link in streamLinks"
                :key="link.url"
                class="link-chip"
                @click.stop="openLink(link)"
                @longpress.stop="openLinkMenu(link)"
              >
                <text class="link-chip-icon">↗</text>
                <text class="link-chip-text">{{ link.label }}</text>
              </view>
            </view>
          </view>
          <view class="stream-status">
            <view class="typing"><text></text><text></text><text></text></view>
            <text>{{ streamStatusLabel }}</text>
            <text v-if="runElapsed" class="stream-status-elapsed">{{ runElapsed }}</text>
          </view>
        </view>
      </view>

      <view id="chat-bottom" class="bottom-anchor"></view>
    </scroll-view>

    <view v-if="permissions.length" class="permission-stack">
      <view v-for="request in permissions" :key="request.requestId" class="permission-card">
        <view class="permission-head">
          <text class="permission-warn">{{ t('⚠ 需要审批') }}</text>
          <text class="permission-tool">{{ request.toolName || t('工具') }}</text>
          <text class="permission-session">{{ sessionTitle(request.sessionId) }}</text>
        </view>
        <text class="permission-summary">{{ request.summary || t('（无摘要）') }}</text>
        <text v-if="request.decisionReason" class="permission-reason">{{ request.decisionReason }}</text>
        <view class="permission-actions">
          <button class="pbtn ghost" size="mini" @click="respond(request.requestId, 'deny')">{{ t('拒绝') }}</button>
          <button
            v-if="request.hasSuggestions"
            class="pbtn ghost"
            size="mini"
            @click="respond(request.requestId, 'allow_always')"
          >
            {{ t('总是允许') }}
          </button>
          <button class="pbtn primary" size="mini" @click="respond(request.requestId, 'allow')">{{ t('允许') }}</button>
        </view>
      </view>
    </view>

    <view v-if="plan" class="todo-panel plan-panel">
      <view class="todo-head" @click="planOpen = !planOpen">
        <view class="todo-head-main">
          <text class="todo-title">{{ t('计划') }}</text>
          <text class="todo-count plan-progress">{{ planDone }}/{{ plan.items.length }}</text>
          <text class="todo-hint">{{ plan.goal || t('当前任务') }}</text>
        </view>
        <view class="todo-head-actions">
          <text class="todo-chevron" :class="{ open: planOpen }" />
        </view>
      </view>
      <view v-if="planOpen" class="todo-body">
        <view
          v-for="item in planItems"
          :key="item.key"
          class="plan-item"
          :class="item.className"
        >
          <text class="plan-mark">{{ item.isDone ? '✓' : item.isActive ? '' : '○' }}</text>
          <text class="plan-text">{{ item.text }}</text>
        </view>
      </view>
    </view>

    <view v-if="store.currentSessionId && !store.newChat" class="todo-panel">
      <view class="todo-head" @click="todoOpen = !todoOpen">
        <view class="todo-head-main">
          <text class="todo-title">{{ t('待办') }}</text>
          <text v-if="pendingTodos.length" class="todo-count">{{ pendingTodos.length }}</text>
          <text class="todo-hint">{{ todoOffline ? t('离线暂存，联网后自动同步') : t('暂存，点发送才执行') }}</text>
        </view>
        <view class="todo-head-actions">
          <text class="todo-chevron" :class="{ open: todoOpen }" />
        </view>
      </view>
      <view v-if="todoOpen" class="todo-body">
        <view v-for="todo in pendingTodos" :key="todo.id" class="todo-item">
          <template v-if="todoEditingId === todo.id">
            <textarea
              v-model="todoEditDraft"
              class="todo-edit-input"
              :disabled="store.todoBusy"
              auto-height
              maxlength="-1"
              :placeholder="t('编辑待办内容')"
            />
            <view class="todo-actions">
              <text
                class="todo-action primary"
                :class="{ disabled: store.todoBusy || !todoEditDraft.trim() }"
                @click="saveTodoEdit(todo.id)"
              >{{ t('保存') }}</text>
              <text class="todo-action" @click="cancelTodoEdit">{{ t('取消') }}</text>
            </view>
          </template>
          <template v-else>
            <text class="todo-text">{{ todo.text }}</text>
            <text v-if="todo.offline" class="todo-offline">{{ t('待同步') }}</text>
            <view class="todo-actions">
              <text
                v-if="!todo.offline"
                class="todo-action primary"
                :class="{ disabled: store.todoBusy || todoOffline }"
                @click="sendTodoItem(todo.id)"
              >
                {{ t('发送') }}
              </text>
              <text
                class="todo-action"
                :class="{ disabled: store.todoBusy }"
                @click="startTodoEdit(todo)"
              >{{ t('编辑') }}</text>
              <text
                v-if="!todo.offline"
                class="todo-action"
                :class="{ disabled: store.scheduledBusy || todoOffline }"
                @click="todoToSchedule(todo)"
              >{{ t('定时') }}</text>
              <text class="todo-action" @click="removeTodoItem(todo.id)">{{ t('删除') }}</text>
            </view>
          </template>
        </view>
        <view class="todo-add-row">
          <input
            v-model="todoDraft"
            class="todo-input"
            :disabled="store.todoBusy"
            :placeholder="t('添加待办（不会立即发送）')"
            confirm-type="done"
            @confirm="addTodoItem"
          />
          <button
            class="todo-add-btn"
            :disabled="store.todoBusy || !todoDraft.trim()"
            @click="addTodoItem"
          >
            {{ t('添加') }}
          </button>
        </view>
        <view v-if="pendingTodos.length" class="todo-send-all-row">
          <text
            class="todo-send-all"
            :class="{ disabled: store.todoBusy || todoOffline }"
            @click="sendAllTodoItems"
          >{{ t('全部发送') }}</text>
        </view>
        <view v-if="sentTodos.length" class="todo-sent">
          <text class="todo-sent-toggle" @click="sentOpen = !sentOpen">
            {{ t('{v1}已发送{v2}', { v1: sentOpen ? t('收起') : t('展开'), v2: sentTodos.length }) }}
          </text>
          <view v-if="sentOpen" class="todo-sent-list">
            <view v-for="todo in sentTodos" :key="todo.id" class="todo-item sent">
              <text class="todo-text">{{ todo.text }}</text>
              <text class="todo-action" @click="removeTodoItem(todo.id)">{{ t('删除') }}</text>
            </view>
            <text class="todo-sent-clear" @click="clearSentItems">{{ t('清除已发送') }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="store.currentSessionId && !store.newChat" class="todo-panel schedule-panel">
      <view class="todo-head" @click="scheduledOpen = !scheduledOpen">
        <view class="todo-head-main">
          <text class="todo-title">{{ t('定时任务') }}</text>
          <text v-if="scheduledTasks.length" class="todo-count">{{ scheduledTasks.length }}</text>
          <text class="todo-hint">{{ t('到点加入队列，电脑端执行') }}</text>
        </view>
        <view class="todo-head-actions">
          <text class="todo-send-all" :class="{ disabled: todoOffline }" @click.stop="openScheduleForm">{{ t('新建') }}</text>
          <text class="todo-chevron" :class="{ open: scheduledOpen }" />
        </view>
      </view>
      <view v-if="scheduledOpen" class="todo-body">
        <view v-if="scheduleFormOpen" class="schedule-form">
          <textarea
            v-model="scheduleDraft"
            class="todo-edit-input"
            auto-height
            maxlength="-1"
            :placeholder="t('到点要执行的内容')"
          />
          <view class="schedule-kinds">
            <text
              v-for="option in scheduleKindOptions"
              :key="option.value"
              class="mode-chip"
              :class="{ active: scheduleKind === option.value }"
              @click="scheduleKind = option.value"
            >{{ option.label }}</text>
          </view>
          <view class="schedule-form-row">
            <input
              v-if="scheduleKind === 'once'"
              v-model="scheduleDelay"
              class="schedule-input"
              type="number"
              :placeholder="t('延迟分钟')"
            />
            <input
              v-else-if="scheduleKind === 'interval'"
              v-model="scheduleInterval"
              class="schedule-input"
              type="number"
              :placeholder="t('间隔分钟')"
            />
            <view v-else class="schedule-input schedule-time" @click="openScheduleTime">
              {{ t('每天{v1}', { v1: scheduleTime }) }}
            </view>
          </view>
          <view v-if="scheduleKind === 'daily'" class="schedule-form-row">
            <input
              v-model="scheduleStartDate"
              class="schedule-input"
              :placeholder="t('起始日期（可选）2026-11-25')"
            />
          </view>
          <view class="todo-actions">
            <text
              class="todo-action primary"
              :class="{ disabled: store.scheduledBusy || !scheduleDraft.trim() }"
              @click="saveSchedule"
            >{{ schedulePendingTodoId ? t('转为定时') : t('保存') }}</text>
            <text class="todo-action" @click="cancelScheduleForm">{{ t('取消') }}</text>
          </view>
        </view>
        <view v-for="task in scheduledTasks" :key="task.id" class="todo-item schedule-item">
          <text class="todo-text">{{ task.content }}</text>
          <view class="todo-actions schedule-actions">
            <text class="todo-action" @click="toggleSchedule(task)">
              {{ task.enabled ? t('暂停') : t('启用') }}
            </text>
            <text class="todo-action" @click="startScheduleEdit(task)">{{ t('编辑') }}</text>
            <text class="todo-action" @click="scheduleToTodo(task)">{{ t('转待办') }}</text>
            <text class="todo-action" @click="removeSchedule(task)">{{ t('删除') }}</text>
          </view>
          <text class="schedule-meta">
            {{ scheduleLabel(task) }}
            · {{ task.enabled ? `下次 ${scheduleTimeText(task.nextRunAt)}` : t('已暂停') }}
          </text>
        </view>
        <view v-if="!scheduledTasks.length && !scheduleFormOpen" class="schedule-empty">
          {{ t('还没有定时任务。电脑端关闭时不会触发。') }}
        </view>
      </view>
    </view>

    <view v-if="queueItems.length" class="queue-panel">
      <view class="queue-head" @click="queueOpen = !queueOpen">
        <text>{{ t('排队{v1}条', { v1: queueItems.length }) }}</text>
        <text class="queue-chevron" :class="{ open: queueOpen }" />
      </view>
      <view v-if="queueOpen" class="queue-list">
        <view v-for="(item, index) in queueItems" :key="item.queueId" class="queue-item">
          <view class="queue-row">
            <text class="queue-index">{{ index + 1 }}</text>
            <textarea
              v-if="queueEditingId === item.queueId"
              v-model="queueEditDraft"
              class="queue-edit-input"
              auto-height
              maxlength="-1"
              :placeholder="t('编辑排队消息')"
            />
            <view v-else class="queue-text">
              <text class="queue-text-body">{{ item.prompt || item.preview }}</text>
            </view>
          </view>
          <view class="queue-actions">
            <template v-if="queueEditingId === item.queueId">
              <text
                class="queue-action"
                :class="{ primary: queueEditDraft.trim() }"
                @click.stop="saveQueueEdit(item.queueId)"
              >{{ t('保存') }}</text>
              <text class="queue-action" @click.stop="cancelQueueEdit">{{ t('取消') }}</text>
            </template>
            <template v-else>
              <text
                v-if="index > 0"
                class="queue-action move"
                @click.stop="moveQueue(item.queueId, 'up')"
              >{{ t('上移') }}</text>
              <text
                v-if="index < queueItems.length - 1"
                class="queue-action move"
                @click.stop="moveQueue(item.queueId, 'down')"
              >{{ t('下移') }}</text>
              <text class="queue-action" @click.stop="insertQueue(item.queueId)">{{ t('插入') }}</text>
              <text class="queue-action" @click.stop="startQueueEdit(item)">{{ t('编辑') }}</text>
              <text class="queue-action" @click.stop="convertQueueToTodo(item.queueId)">{{ t('转待办') }}</text>
              <text class="queue-action danger" @click.stop="removeQueue(item.queueId)">{{ t('移除') }}</text>
            </template>
          </view>
        </view>
      </view>
    </view>

    <!-- 从知识库定位到旧消息后，提示还有更新的内容可以回到末尾。 -->
    <view v-if="store.historyNewer" class="newer-bar" @click="returnToLatest">
      <text class="newer-bar-text">{{ t('↓ 回到最新消息') }}</text>
    </view>

    <!-- 评审会话的结论直接渲染在输入框上方，默认折叠，展开看分数与发现。 -->
    <view v-if="reviewReport" class="review-card">
      <view class="review-head" @click="reviewOpen = !reviewOpen">
        <text class="review-badge" :class="reviewVerdictClass">{{ reviewVerdictLabel }}</text>
        <view class="review-head-main">
          <text class="review-title">{{ t('评审报告') }}</text>
          <text class="review-meta">{{ reviewMeta }}</text>
        </view>
        <text class="review-chevron" :class="{ open: reviewOpen }" />
      </view>
      <view v-if="reviewOpen" class="review-body">
        <text v-if="reviewReport.summary" class="review-summary">{{ reviewReport.summary }}</text>
        <view class="review-scores">
          <view v-for="row in reviewScoreRows" :key="row.key" class="review-score">
            <text class="review-score-label">{{ row.label }}</text>
            <text class="review-score-value">{{ row.value }}</text>
          </view>
        </view>
        <view v-for="(finding, index) in reviewReport.findings" :key="index" class="review-finding">
          <view class="review-finding-head">
            <text class="review-severity" :class="finding.severity">{{ severityLabel(finding.severity) }}</text>
            <text class="review-finding-title">{{ finding.title }}</text>
          </view>
          <text v-if="finding.rootCause" class="review-finding-cause">
            {{ t('原因：{v1}', { v1: finding.rootCause }) }}
          </text>
          <text class="review-finding-text">{{ finding.recommendation }}</text>
        </view>
        <text v-if="!reviewReport.findings.length" class="review-empty">
          {{ t('没有发现需要处理的问题。') }}
        </text>
      </view>
    </view>

    <!-- 新会话欢迎页：显示电脑端快捷指令，点一下填进输入框，不直接发送。 -->
    <view v-if="store.newChat && !store.messages.length && !draft.trim() && quickPrompts.length" class="quick-prompts">
      <text
        v-for="prompt in quickPrompts"
        :key="prompt"
        class="quick-prompt"
        @click="useQuickPrompt(prompt)"
      >{{ shortText(prompt, 30) }}</text>
    </view>

    <view class="composer">
      <view v-if="images.length || references.length" class="attach-strip">
        <view
          v-for="path in references"
          :key="path"
          class="attach-chip"
          @click="removeReference(path)"
        >
          <text class="attach-name">▤ {{ shortPath(path) }}</text>
          <text class="attach-x">×</text>
        </view>
        <view
          v-for="(image, index) in images"
          :key="`image-${index}`"
          class="attach-thumb"
          @click="removeImage(index)"
        >
          <image :src="image.preview || image.url" mode="aspectFill" class="attach-thumb-img" />
          <text class="attach-x">×</text>
        </view>
      </view>
      <view class="mode-row">
        <view class="mode-select" @click="modeSheetOpen = true">
          <text class="mode-select-label">{{ currentModeLabel }}</text>
          <text class="mode-select-caret">▾</text>
        </view>
        <view class="attach-buttons">
          <text
            class="attach-btn"
            :class="{ disabled: picking || store.sending || running || images.length >= 3 }"
            @click="pickImages"
          >{{ picking ? t('处理中…') : t('图片{v1}', { v1: images.length ? ` ${images.length}` : '' }) }}</text>
          <text
            class="attach-btn"
            :class="{ disabled: filesUploading || store.sending || running || references.length >= 8 }"
            @click="pickFiles"
          >{{ uploadLabel }}</text>
          <text
            class="attach-btn"
            :class="{ disabled: store.sending || running || references.length >= 8 }"
            @click="openReferences"
          >{{ t('参照{v1}', { v1: references.length ? ` ${references.length}` : '' }) }}</text>
        </view>
      </view>
      <view class="input-row">
        <textarea
          v-model="draft"
          class="composer-input"
          :auto-height="!draftLong"
          :style="draftLong ? { height: '320rpx' } : {}"
          :maxlength="-1"
          :disabled="store.sending"
          :placeholder="t('输入指令，发送给这台电脑…')"
          :show-confirm-bar="false"
          :cursor-spacing="24"
          :adjust-position="true"
        />
        <button
          class="send-btn"
          :disabled="store.sending || filesUploading || (!draft.trim() && !images.length) || !canSend"
          @click="send"
        >
          {{ store.sending ? '…' : t('发送') }}
        </button>
      </view>
    </view>

    <app-sheet
      :visible="refOpen"
      :title="t('参照其他项目')"
      subtitle="只读；模型需要时读取其中的文件"
      @close="closeReferences"
    >
      <view class="ref-path">
        <text class="ref-hint">{{ t('其他项目空间') }}</text>
        <text class="ref-count">{{ references.length }}/8</text>
      </view>
      <scroll-view class="ref-list" scroll-y :style="{ height: refListHeight }">
        <view v-if="refLoading" class="ref-empty">{{ t('读取中…') }}</view>
        <view v-else-if="refError" class="ref-empty error">{{ refError }}</view>
        <view v-else-if="!refProjects.length" class="ref-empty">
          {{ t('还没有其他项目，先在电脑端打开另一个工作区。') }}
        </view>
        <view
          v-for="project in refProjects"
          :key="project.path"
          class="ref-item"
          :class="{ picked: references.includes(project.path) }"
          @click="toggleReference(project)"
        >
          <text class="ref-icon">▤</text>
          <view class="ref-main">
            <text class="ref-name">{{ project.name }}</text>
            <text class="ref-path-text">{{ project.path }}</text>
          </view>
          <text class="ref-tag">{{ references.includes(project.path) ? t('已参照') : t('参照') }}</text>
        </view>
      </scroll-view>
      <template #footer>
        <view class="ref-foot">{{ t('只加入其他项目的路径；读取权限由电脑端校验。') }}</view>
      </template>
    </app-sheet>

    <!-- 任务名称：输入框预填当前标题，点保存后交给电脑端落盘。 -->
    <app-sheet
      :visible="renameOpen"
      :title="t('修改任务名称')"
      :subtitle="t('只改标题，不影响工作区和执行记录')"
      @close="closeRename"
    >
      <view class="rename-field">
        <input
          v-model="renameValue"
          class="rename-input"
          type="text"
          :maxlength="120"
          :focus="renameFocus"
          :placeholder="t('输入任务名称')"
          placeholder-class="rename-placeholder"
          confirm-type="done"
          :disabled="renameSaving"
          @confirm="submitRename"
        />
        <text v-if="renameValue" class="rename-clear" @click="renameValue = ''">×</text>
      </view>
      <text v-if="renameError" class="rename-error">{{ renameError }}</text>
      <text v-else class="rename-hint">{{ t('名称最多 120 个字') }}</text>
      <template #footer>
        <view class="rename-actions">
          <text class="rename-action" @click="closeRename">{{ t('取消') }}</text>
          <text
            class="rename-action primary"
            :class="{ disabled: !canRename }"
            @click="submitRename"
          >{{ renameSaving ? t('保存中…') : t('保存') }}</text>
        </view>
      </template>
    </app-sheet>

    <!-- 长按自己的消息：编辑后重发，或只复制文字。 -->
    <app-picker
      :visible="messageMenuOpen"
      :title="t('消息操作')"
      :subtitle="messageMenuPreview"
      :options="messageMenuOptions"
      :value="-1"
      @select="onMessageMenuPick"
      @close="closeMessageMenu"
    />

    <app-sheet
      :visible="editOpen"
      :title="t('编辑并重新生成')"
      :subtitle="t('保存后会从这条指令重新执行，后面的回答会被替换。')"
      @close="closeEditMessage"
    >
      <view class="rename-field edit-field">
        <textarea
          v-model="editValue"
          class="edit-message-input"
          auto-height
          maxlength="-1"
          :focus="editFocus"
          :placeholder="t('输入修改后的指令')"
          :disabled="editBusy"
        />
      </view>
      <text v-if="editError" class="rename-error">{{ editError }}</text>
      <template #footer>
        <view class="rename-actions">
          <text class="rename-action" @click="closeEditMessage">{{ t('取消') }}</text>
          <text
            class="rename-action primary"
            :class="{ disabled: editBusy || !editValue.trim() }"
            @click="submitEditMessage"
          >{{ editBusy ? t('正在重新生成…') : t('保存并重发') }}</text>
        </view>
      </template>
    </app-sheet>

    <!-- 回退点：远程出错后的安全网，恢复前电脑端会自动再存一个安全点。 -->
    <app-sheet
      :visible="checkpointsOpen"
      :title="t('回退点')"
      :subtitle="t('恢复文件或对话到某个快照；恢复前会自动保存安全点。')"
      tall
      @close="closeCheckpoints"
    >
      <view class="tool-sheet-toolbar">
        <text class="tool-sheet-link" @click="loadCheckpointList">{{ t('刷新') }}</text>
        <text
          class="tool-sheet-action"
          :class="{ disabled: checkpointCreating }"
          @click="createCheckpointNow"
        >{{ checkpointCreating ? t('正在保存…') : t('新建快照') }}</text>
      </view>
      <scroll-view scroll-y class="tool-sheet-scroll">
        <view v-if="checkpointsLoading" class="tool-sheet-empty">{{ t('读取中…') }}</view>
        <view v-else-if="checkpointsError" class="tool-sheet-empty error">{{ checkpointsError }}</view>
        <view v-else-if="!checkpointList.length" class="tool-sheet-empty">
          {{ t('还没有回退点。电脑端开始执行后会自动创建，也可以手动新建。') }}
        </view>
        <view v-for="cp in checkpointList" :key="cp.id" class="sheet-row">
          <view class="sheet-row-main">
            <view class="sheet-row-title">
              <text class="sheet-row-label">{{ cp.label }}</text>
              <text v-if="cp.baseline" class="sheet-row-badge">{{ t('基线') }}</text>
            </view>
            <text class="sheet-row-meta">{{ checkpointMeta(cp) }}</text>
          </view>
          <view class="sheet-row-actions">
            <text class="sheet-row-action" @click="askRestoreCheckpoint(cp, 'code')">{{ t('恢复文件') }}</text>
            <text class="sheet-row-action primary" @click="askRestoreCheckpoint(cp, 'both')">{{ t('全部恢复') }}</text>
          </view>
        </view>
      </scroll-view>
    </app-sheet>

    <!-- 变更审阅：本次会话改过的文件，可展开 diff 并逐个还原。 -->
    <app-sheet
      :visible="changesOpen"
      :title="t('变更审阅')"
      :subtitle="t('本次任务改过的文件；还原只影响该文件。')"
      tall
      @close="closeChanges"
    >
      <view class="tool-sheet-toolbar">
        <text class="tool-sheet-link" @click="loadChangeList">{{ t('刷新') }}</text>
        <text class="tool-sheet-hint">{{ t('{v1} 个文件', { v1: changeList.length }) }}</text>
      </view>
      <scroll-view scroll-y class="tool-sheet-scroll">
        <view v-if="changesLoading" class="tool-sheet-empty">{{ t('读取中…') }}</view>
        <view v-else-if="changesError" class="tool-sheet-empty error">{{ changesError }}</view>
        <view v-else-if="!changeList.length" class="tool-sheet-empty">
          {{ t('这个任务还没有改动文件。') }}
        </view>
        <view v-for="change in changeList" :key="change.path" class="change-block">
          <view class="sheet-row" @click="toggleChangeDiff(change.path)">
            <view class="sheet-row-main">
              <view class="sheet-row-title">
                <text class="sheet-row-label">{{ change.name }}</text>
                <text class="change-stat add">+{{ change.added }}</text>
                <text class="change-stat del">−{{ change.removed }}</text>
              </view>
              <text class="sheet-row-meta">{{ change.path }}</text>
            </view>
            <view class="sheet-row-actions">
              <text class="change-status" :class="change.status">{{ changeStatusLabel(change.status) }}</text>
              <text
                v-if="change.canRevert"
                class="sheet-row-action danger"
                @click.stop="askRevertChange(change)"
              >{{ t('还原') }}</text>
            </view>
          </view>
          <view v-if="expandedChanges[change.path]" class="change-diff">
            <text class="change-diff-text" user-select>{{ changeDiffText(change) }}</text>
          </view>
        </view>
      </scroll-view>
    </app-sheet>

    <!-- 项目长期记忆：看得到、删得掉，也可以从手机补一条。 -->
    <app-sheet
      :visible="memoryOpen"
      :title="t('项目记忆')"
      :subtitle="t('记忆只存在电脑端，会影响这个项目后续的任务。')"
      tall
      @close="closeMemory"
    >
      <view class="memory-add">
        <textarea
          v-model="memoryDraft"
          class="memory-input"
          auto-height
          maxlength="2000"
          :placeholder="t('新增一条项目记忆…')"
          :disabled="memoryBusy"
        />
        <text
          class="memory-add-btn"
          :class="{ disabled: memoryBusy || !memoryDraft.trim() }"
          @click="submitMemory"
        >{{ memoryBusy ? t('保存中…') : t('添加') }}</text>
      </view>
      <scroll-view scroll-y class="tool-sheet-scroll">
        <view v-if="memoryLoading" class="tool-sheet-empty">{{ t('读取中…') }}</view>
        <view v-else-if="memoryError" class="tool-sheet-empty error">{{ memoryError }}</view>
        <view v-else-if="!memoryList.length" class="tool-sheet-empty">
          {{ t('这个项目还没有长期记忆。') }}
        </view>
        <view v-for="entry in memoryList" :key="entry.id" class="sheet-row">
          <view class="sheet-row-main">
            <text class="memory-text">{{ entry.content }}</text>
            <text class="sheet-row-meta">{{ memorySourceLabel(entry) }}</text>
          </view>
          <text class="sheet-row-action danger" @click="askRemoveMemory(entry)">{{ t('删除') }}</text>
        </view>
      </scroll-view>
    </app-sheet>

    <app-dialog
      :visible="!!restoreTarget"
      danger
      :title="t('恢复到这个回退点？')"
      :message="restoreMessage"
      :cancel-text="t('取消')"
      :confirm-text="t('恢复')"
      :busy="restoreBusy"
      icon="!"
      @confirm="confirmRestoreCheckpoint"
      @close="restoreTarget = null"
    />
    <app-dialog
      :visible="!!revertTarget"
      danger
      :title="t('还原这个文件？')"
      :message="revertMessage"
      :cancel-text="t('取消')"
      :confirm-text="t('还原')"
      :busy="revertBusy"
      icon="!"
      @confirm="confirmRevertChange"
      @close="revertTarget = null"
    />
    <app-dialog
      :visible="!!memoryTarget"
      danger
      :title="t('删除这条记忆？')"
      :message="memoryTarget ? String(memoryTarget.content || '').slice(0, 100) : ''"
      :cancel-text="t('取消')"
      :confirm-text="t('删除')"
      :busy="memoryBusy"
      icon="!"
      @confirm="confirmRemoveMemory"
      @close="memoryTarget = null"
    />

    <app-picker
      :visible="linkSheetOpen"
      :title="t('打开链接')"
      :subtitle="linkSheetUrl"
      :options="linkOptions"
      :value="-1"
      @select="onLinkPick"
      @close="linkSheetOpen = false"
    />
    <app-picker
      :visible="modeSheetOpen"
      :title="t('执行模式')"
      :subtitle="t('选择工具调用的审批方式')"
      :options="modeOptions"
      :value="modeIndex"
      @select="onModePick"
      @close="modeSheetOpen = false"
    />
    <app-picker
      :visible="modelSheetOpen"
      :title="t('会话模型')"
      :subtitle="t('只影响这个任务，不会改统一设置')"
      :options="modelOptions"
      :value="modelIndex"
      @select="onModelPick"
      @close="modelSheetOpen = false"
    />
    <app-time-sheet
      :visible="scheduleTimeOpen"
      :title="t('每天执行时间')"
      :subtitle="t('定时任务只会在电脑端开启时触发')"
      :value="scheduleTime"
      @confirm="onScheduleTime"
      @close="scheduleTimeOpen = false"
    />
    <app-dialog
      :visible="!!scheduleToDelete"
      :title="t('删除定时任务')"
      :message="scheduleToDelete ? String(scheduleToDelete.content || '').slice(0, 80) : ''"
      :cancel-text="t('保留')"
      :confirm-text="t('删除')"
      icon="!"
      danger
      @confirm="confirmRemoveSchedule"
      @cancel="scheduleToDelete = null"
      @close="scheduleToDelete = null"
    />
    <app-dialog
      :visible="!!runConfirm"
      :title="runConfirm === 'stop' ? t('停止当前任务') : t('暂停当前任务')"
      :message="
        runConfirm === 'stop'
          ? t('停止后不会自动继续，需要重新发送。')
          : t('暂停后可随时点「继续」接着执行。')
      "
      :cancel-text="t('取消')"
      :confirm-text="runConfirm === 'stop' ? t('停止') : t('暂停')"
      :icon="runConfirm === 'stop' ? '!' : '?'"
      :danger="runConfirm === 'stop'"
      :busy="runConfirmBusy"
      @confirm="confirmRunAction"
      @cancel="runConfirm = ''"
      @close="runConfirm = ''"
    />
    <app-dialog
      :visible="!!todoConfirm"
      :title="todoConfirm ? todoConfirm.title : ''"
      :message="todoConfirm ? todoConfirm.message : ''"
      :cancel-text="t('取消')"
      :confirm-text="todoConfirm ? todoConfirm.confirmText : ''"
      :danger="!!todoConfirm && todoConfirm.danger"
      :icon="todoConfirm && todoConfirm.danger ? '!' : '?'"
      :busy="todoConfirmBusy"
      @confirm="confirmTodoAction"
      @cancel="todoConfirm = null"
      @close="todoConfirm = null"
    />
    <app-dialog
      :visible="!!deleteMessageTarget"
      danger
      :title="t('删除这条还没有回复的指令？')"
      :message="t('删除后不会执行，也不会留在对话里。')"
      :cancel-text="t('取消')"
      :confirm-text="t('删除')"
      :busy="deleteMessageBusy"
      icon="!"
      @confirm="confirmDeleteMessage"
      @cancel="deleteMessageTarget = null"
      @close="deleteMessageTarget = null"
    />
    <app-dialog-host />
  </view>
</template>

<script>
import AppDialog from '../../components/app-dialog/app-dialog.vue'
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import AppPicker from '../../components/app-picker/app-picker.vue'
import AppSheet from '../../components/app-sheet/app-sheet.vue'
import AppTimeSheet from '../../components/app-time-sheet/app-time-sheet.vue'
import { copyText, stageSelectionText } from '../../lib/clipboard.js'
import { openExternalUrl, openWebPreview } from '../../lib/files.js'
import { MODE_LABELS, messageTime, projectName, relativeTime, shortText, summarizeToolInput } from '../../lib/format.js'
import { pickImageAttachments } from '../../lib/image.js'
import { pickUploadFiles, uploadFileToWorkspace } from '../../lib/upload.js'
import { renderMarkdown } from '../../lib/markdown.js'
import { extractLinks, linkLabel, linkifySegments } from '../../lib/media.js'
import { modelOptionLabel } from '../../lib/model-label.js'
import { planRows } from '../../lib/plan.js'
import { createPressGesture } from '../../lib/press.js'
import { runProgressParts } from '../../lib/run-progress.js'
import { clearDraft, loadDraft, saveDraft } from '../../lib/storage.js'
import {
  addMemory,
  addScheduledTask,
  addTodo,
  applySystemBars,
  backToLatest,
  clearSentTodos,
  convertQueueItemToTodo,
  convertScheduleToTodo,
  convertTodoToSchedule,
  createCheckpoint,
  deleteMessage,
  editMessage,
  init,
  insertQueueItem,
  loadChanges,
  loadCheckpoints,
  loadEarlier,
  loadMemory,
  loadQuickCommands,
  loadScheduled,
  loadTodos,
  moveQueueItem,
  onAppShow,
  openSession,
  openSessionAt,
  reconnect as reconnectClient,
  regenerateMessage,
  reloadHistory,
  removeMemory,
  removeQueueItem,
  removeScheduledTask,
  removeTodo,
  renameSession,
  request,
  respondPermission,
  restoreCheckpoint,
  retrySession,
  revertChange,
  runForSession,
  sendAllTodos,
  sendMessage,
  sendTodo,
  sessionMode,
  setSessionMode,
  setSessionModel,
  startNewChat,
  stopRun,
  pauseRun,
  resumeSession,
  store,
  syncSessionTail,
  updateQueueItem,
  updateScheduledTask,
  updateTodo,
  visibleQueue
} from '../../store/index.js'
import { t } from '../../lib/i18n.js'

// 消息块只解析一次：工具参数是 JSON 字符串，工具结果可能有上万字符，
// 每次流式刷新都重新解析会把主线程占满。按消息 id 缓存，切换会话时清空。
const partsCache = new Map()
const PARTS_CACHE_LIMIT = 400
// 一轮执行过程只展示最近 5 项，避免工具调用很多时把会话撑得很长。
const EXEC_PART_KINDS = new Set(['thinking', 'tool', 'result'])
const EXEC_LATEST_LIMIT = 5

/** 工作区路径比较：统一分隔符并忽略大小写，手机无法得知电脑端平台。 */
function sameWorkspacePath(left, right) {
  const normalize = (value) =>
    String(value || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase()
  return normalize(left) === normalize(right)
}

/** scroll-into-view 的 id 只保留字母、数字、下划线和短横线。 */
function messageAnchorId(id, index) {
  const safe = String(id || '').replace(/[^A-Za-z0-9_-]/g, '')
  return safe ? `msg-${safe}` : `msg-index-${index}`
}

function isExecPart(part) {
  return Boolean(part) && EXEC_PART_KINDS.has(part.kind)
}

function isUserTurnItem(item) {
  return item.role === 'user' && (item.hasText || item.hasImage || item.hasReference)
}

/**
 * 把相邻的助手/工具消息归为一轮执行过程，默认只保留最近 5 项。
 * 更早的条目仍可展开查看，但不会撑高默认视图。
 */
function limitExecParts(items, expandedGroups) {
  let groupKey = ''
  const groups = new Map()
  for (const item of items) {
    if (isUserTurnItem(item) || !groupKey) groupKey = item.key
    item.execGroupKey = groupKey
    let entry = groups.get(groupKey)
    if (!entry) {
      entry = { items: [], keys: [] }
      groups.set(groupKey, entry)
    }
    entry.items.push(item)
    for (const part of item.parts) {
      if (isExecPart(part)) entry.keys.push(part.key)
    }
  }

  for (const [key, entry] of groups) {
    if (entry.keys.length <= EXEC_LATEST_LIMIT) continue
    // 用户消息本身没有执行过程行，展开入口挂到它后面的第一条助手/工具消息上。
    const first = entry.items.find((item) => !isUserTurnItem(item)) || entry.items[0]
    if (expandedGroups[key]) {
      first.execExpanded = true
      continue
    }
    const keep = new Set(entry.keys.slice(-EXEC_LATEST_LIMIT))
    let hidden = 0
    for (const item of entry.items) {
      const before = item.parts.length
      item.parts = item.parts.filter((part) => !isExecPart(part) || keep.has(part.key))
      hidden += before - item.parts.length
    }
    first.execHidden = hidden
  }

  return items
}

function buildParts(message, index, theme) {
  const blocks = Array.isArray(message.blocks) ? message.blocks : []
  const parts = []
  blocks.forEach((block, blockIndex) => {
    if (!block || typeof block !== 'object') return
    const key = `${message.id || index}-${blockIndex}`
    if (block.type === 'text') {
      const text = block.text || ''
      // 助手回复按 Markdown 渲染；用户消息保持原样，避免把自己输入的符号当语法。
      // Markdown 只解析一次并随消息缓存，流式刷新时不会重复解析历史消息。
      parts.push({
        kind: 'text',
        key,
        text,
        nodes: message.role === 'assistant' ? renderMarkdown(text, { theme }) : null,
        // 用户 / 系统消息是纯文本，正文里的网址按片段切出来内联可点；
        // 助手回复走 rich-text，点不到里面的节点，另用下面一行链接按钮。
        segments: message.role === 'assistant' ? null : linkifySegments(text),
        // 助手回复里的网页链接会单独列一行按钮：rich-text 内部点不到链接。
        links:
          message.role === 'assistant'
            ? extractLinks(text).map((url) => ({ url, label: linkLabel(url) }))
            : null
      })
    } else if (block.type === 'thinking') {
      parts.push({ kind: 'thinking', key, text: block.text || '' })
    } else if (block.type === 'tool_use') {
      parts.push({
        kind: 'tool',
        key,
        name: block.name || t("工具"),
        summary: summarizeToolInput(block.name, block.input),
        body: block.input || '',
        file: block.file && block.file.path ? block.file : null
      })
    } else if (block.type === 'tool_result') {
      parts.push({
        kind: 'result',
        key,
        text: block.content || '',
        preview: shortText(block.content, 180),
        isError: block.isError === true
      })
    } else if (block.type === 'image') {
      parts.push({ kind: 'image', key, url: block.url || '' })
    } else if (block.type === 'reference') {
      parts.push({ kind: 'reference', key, path: block.path || '' })
    }
  })
  return parts
}

function cachedParts(message, index, theme) {
  // 主题写进缓存键：切换深浅色后 Markdown 文字/表格/代码块要换一套颜色。
  const cacheKey = `${message.id || `m-${index}`}|${theme}`
  let parts = partsCache.get(cacheKey)
  if (parts) return parts
  parts = buildParts(message, index, theme)
  partsCache.set(cacheKey, parts)
  if (partsCache.size > PARTS_CACHE_LIMIT) {
    partsCache.delete(partsCache.keys().next().value)
  }
  return parts
}

export default {
  components: { AppDialog, AppDialogHost, AppPicker, AppSheet, AppTimeSheet },
  data() {
    return {
      draft: '',
      // 输入框草稿按会话 / 新建工作区分别保存在本机，离开页面再回来不会丢。
      draftKey: '',
      draftTimer: null,
      sendInFlight: false,
      modeValue: 'auto',
      modeSheetOpen: false,
      // 任务级会话模型：下拉里选，不写统一设置。
      modelSheetOpen: false,
      modelSettings: null,
      modelsLoading: false,
      modelSaving: false,
      // 知识、文件收进「更多」弹层：头部只留标题与执行控制，标题才有位置。
      moreOpen: false,
      modeTouched: false,
      queueOpen: false,
      // 消息里的网页链接：点一下直接进内置浏览器预览，长按再选系统浏览器或复制。
      linkSheetOpen: false,
      linkSheetUrl: '',
      pendingLink: '',
      linkMenuAt: 0,
      // 暂停和停止都会打断当前执行，先弹框确认，避免误触。
      runConfirm: '',
      runConfirmBusy: false,
      // 发送与删除待办都会立刻生效，同样先弹框确认。
      todoConfirm: null,
      todoConfirmBusy: false,
      // 还没有回复的指令可以撤回，删除前同样需要确认。
      deleteMessageTarget: null,
      deleteMessageBusy: false,
      // 计划面板默认收起，需要时手动展开，避免长时间运行挤占输入区。
      planOpen: false,
      turnPlanOpen: {},
      todoDraft: '',
      // 待办面板默认收起：头部只显示数量，全部发送放在展开后的列表底部。
      todoOpen: false,
      sentOpen: false,
      todoEditingId: '',
      todoEditDraft: '',
      queueEditingId: '',
      queueEditDraft: '',
      expanded: {},
      execExpanded: {},
      scrollTarget: '',
      nearBottom: true,
      // 知识库定位只自动滚动一次，之后用户自己翻看历史时不再被拉回命中项。
      focusScrolled: false,
      permissionStamp: 0,
      images: [],
      references: [],
      picking: false,
      filesUploading: false,
      uploadProgress: 0,
      refOpen: false,
      refProjects: [],
      refLoading: false,
      refError: '',
      scheduledOpen: false,
      scheduleFormOpen: false,
      scheduleEditingId: '',
      schedulePendingTodoId: '',
      scheduleDraft: '',
      scheduleKind: 'once',
      scheduleDelay: '10',
      scheduleInterval: '60',
      scheduleTime: '09:00',
      scheduleTimeOpen: false,
      scheduleToDelete: null,
      // 起始日期：只在「每天」下有值，空串表示不设，到点即触发。
      scheduleStartDate: '',
      // 任务改名弹层：预填当前标题，空名称和保存中都不允许提交。
      renameOpen: false,
      renameValue: '',
      renameError: '',
      renameSaving: false,
      renameFocus: false,
      // 失败重试：同一时间只允许点一次。
      retryBusy: false,
      // 评审报告卡片默认折叠，展开后看分数和逐条发现。
      reviewOpen: false,
      // 长按消息：编辑并重新生成。
      messageMenuOpen: false,
      messageMenuItem: null,
      editOpen: false,
      editMessageId: '',
      editValue: '',
      editError: '',
      editBusy: false,
      editFocus: false,
      // 回退点。
      checkpointsOpen: false,
      checkpointsLoading: false,
      checkpointsError: '',
      checkpointList: [],
      checkpointCreating: false,
      restoreTarget: null,
      restoreMode: 'code',
      restoreBusy: false,
      // 变更审阅。
      changesOpen: false,
      changesLoading: false,
      changesError: '',
      changeList: [],
      expandedChanges: {},
      revertTarget: null,
      revertBusy: false,
      // 项目记忆。
      memoryOpen: false,
      memoryLoading: false,
      memoryError: '',
      memoryList: [],
      memoryDraft: '',
      memoryBusy: false,
      memoryTarget: null,
      // 新会话欢迎页的快捷指令；电脑端未自定义时使用内置预设。
      quickPrompts: [],
      // 等待行里的已运行时长：每秒自增触发重算，没有在跑的任务时不走定时器。
      // 秒表句柄（不参与渲染，放 data 只为了能在各生命周期里统一清理）。
      runTicker: null,
      nowTick: 0
    }
  },
  created() {
    // 消息气泡同样只在按住不动时打开菜单，滚动聊天不会误触。
    this.messagePress = createPressGesture({
      onLongPress: (item) => this.openMessageMenu(item)
    })
  },
  computed: {
    store() {
      return store
    },
    refListHeight() {
      // 弹层里的 scroll-view 需要明确高度；最多显示 7 行，更多的上下滑动。
      const rows = Math.min(Math.max(this.refProjects.length, 1), 7)
      return `${rows * 112}rpx`
    },
    markdownTheme() {
      return store.theme === 'light' ? 'light' : 'dark'
    },
    connected() {
      return store.connectionState === 'connected'
    },
    agentOnline() {
      return store.agentOnline
    },
    canSend() {
      return this.connected && this.agentOnline && Boolean(store.currentSessionId || store.newChat)
    },
    canRename() {
      // 空名称一律不提交；保存中禁用，避免连点发出两次改名。
      return !this.renameSaving && Boolean(String(this.renameValue || '').trim())
    },
    uploadLabel() {
      if (!this.filesUploading) return t("文件")
      if (this.uploadProgress > 0) return t("上传 {v1}%", { v1: this.uploadProgress })
      return t("上传中…")
    },
    // 长指令超过 6 行或 240 字后固定输入框高度、内部滚动，
    // 否则 auto-height 会一直长下去，把消息区和发送按钮挤出屏幕。
    draftLong() {
      return this.draft.length > 240 || this.draft.split('\n').length > 6
    },
    todoOffline() {
      return !this.connected || !this.agentOnline
    },
    title() {
      const session = store.currentSession
      if (store.currentSessionId && session?.title) return session.title
      if (store.newChat) return t("新对话")
      return session?.title || t("会话")
    },
    subtitle() {
      const session = store.currentSession
      const parts = []
      if (session?.cwd) parts.push(projectName(session))
      parts.push(MODE_LABELS[this.modeValue] || this.modeValue)
      if (this.running) parts.push(t("执行中"))
      return parts.join(' · ')
    },
    bannerText() {
      if (!this.connected) {
        if (store.connectionState === 'replaced') return t("这个配对正在另一处使用。")
        return store.connectionMessage || t("连接已断开，正在重连…")
      }
      if (!this.agentOnline) return t("电脑端离线，暂时无法发送消息。")
      if (store.serverError) return store.serverError
      return ''
    },
    showRetry() {
      return store.connectionState === 'disconnected' || store.connectionState === 'replaced'
    },
    rendered() {
      const items = store.messages
        .map((message, index) => {
          const parts = cachedParts(message, index, this.markdownTheme)
          const copyable = parts
            .filter((part) => part.kind === 'text')
            .map((part) => String(part.text || '').trim())
            .filter(Boolean)
            .join('\n\n')
          // 本轮计划快照跟着最终回答一起存下来，后续轮次更新计划也不会把
          // 这一轮的计划弄丢。运行已结束，in_progress 一律按终态展示。
          const plan =
            message.plan && Array.isArray(message.plan.items) && message.plan.items.length
              ? message.plan
              : null
          const turnPlanRows = plan ? planRows(plan, false) : []
          const role = message.role || 'assistant'
          const hasText = parts.some((part) => part.kind === 'text')
          const hasImage = parts.some((part) => part.kind === 'image')
          const hasReference = parts.some((part) => part.kind === 'reference')
          // 只给真正的指令和回复显示时间；工具结果、纯执行过程不占一行。
          const showsTime =
            (role === 'user' && (hasText || hasImage || hasReference)) ||
            (role === 'assistant' && hasText)
          // 思考、工具调用和结果跟随消息内联展示，和电脑端保持一致；
          // 长结果默认折叠，点开后再显示。
          return {
            id: message.id || '',
            key: message.id || `m-${index}`,
            anchorId: messageAnchorId(message.id, index),
            focused: Boolean(store.focusMessageId) && message.id === store.focusMessageId,
            role,
            control: message.control === true,
            error: message.error === true,
            parts,
            copyText: copyable,
            hasText,
            hasImage,
            hasReference,
            timeLabel: showsTime
              ? messageTime(message.createdAt || message.timestamp)
              : '',
            plan,
            turnPlanRows,
            turnPlanDone: turnPlanRows.filter((row) => row.isDone).length
          }
        })
        .filter(
          (item) =>
            item.hasText ||
            item.hasImage ||
            item.hasReference ||
            item.role === 'tool' ||
            item.parts.length > 0
        )
      // 只在界面层裁剪，store 里仍保留完整记录；展开后可以看到被收起的条目。
      return limitExecParts(items, this.execExpanded).filter(
        (item) =>
          item.hasText ||
          item.hasImage ||
          item.hasReference ||
          item.parts.length > 0 ||
          item.execHidden ||
          item.execExpanded
      )
    },
    scheduledTasks() {
      return Array.isArray(store.scheduled) ? store.scheduled : []
    },
    showStream() {
      // 只要本会话有运行中的任务就显示「执行中…」：从列表直接进入正在运行的
      // 会话时没有收到 chat.started，streamRunId 为空，但任务仍在执行。
      return Boolean(store.streamText) || Boolean(runForSession(store.currentSessionId))
    },
    // 当前会话的运行记录：步号与已运行时长都从它读。
    currentRun() {
      return runForSession(store.currentSessionId)
    },
    /**
     * 等待行的第一段：第 1 步仍然说「执行中…」，与电脑端 ThinkingIndicator 同口径。
     */
    streamStatusLabel() {
      const parts = runProgressParts(this.currentRun)
      if (parts.step > 1) return t('正在执行第 {v1} 步', { v1: parts.step })
      return t('执行中…')
    },
    // 不足 3 秒的秒数只会闪一下，纯函数返回空串，模板据此不渲染这一段。
    // nowTick 必须在这里被读到，否则定时器改了它 computed 也不会重算。
    runElapsed() {
      this.nowTick
      return runProgressParts(this.currentRun, Date.now()).elapsed
    },
    streamNodes() {
      return renderMarkdown(store.streamText || '', { theme: this.markdownTheme })
    },
    // 流式阶段已经吐出的链接也能点，不用等整段结束。
    streamLinks() {
      return extractLinks(store.streamText || '').map((url) => ({ url, label: linkLabel(url) }))
    },
    running() {
      return Boolean(runForSession(store.currentSessionId))
    },
    // 消息尾部指纹：长度与最后一条 id。重新拉一页尾部时长度常常不变，
    // 只看 length 的侦听器不会触发，答案就会停在可视区下方看不见。
    messagesTailKey() {
      const rows = store.messages
      const last = rows.length ? rows[rows.length - 1] : null
      return `${rows.length}|${(last && last.id) || ''}`
    },
    paused() {
      return Boolean(store.currentSession?.paused)
    },
    permissions() {
      return store.permissions
    },
    queueItems() {
      return visibleQueue(store.currentSessionId)
    },
    plan() {
      const plan = store.currentSession?.plan
      if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) return null
      return plan
    },
    planItems() {
      return planRows(this.plan, this.running)
    },
    planDone() {
      return this.planItems.filter((item) => item.isDone).length
    },
    pendingTodos() {
      return (store.todos || []).filter((item) => item?.status === 'pending')
    },
    sentTodos() {
      return (store.todos || []).filter((item) => item?.status === 'sent')
    },
    modeOptions() {
      return [
        {
          value: 'auto',
          label: t("全部自动"),
          hint: t("直接执行工具，不再逐条询问")
        },
        {
          value: 'manual',
          label: t("只读自动"),
          hint: t("读取自动执行，写入和命令需要审批")
        },
        {
          value: 'ask',
          label: t("逐条审批"),
          hint: t("每次工具调用都等你确认")
        }
      ]
    },
    modeIndex() {
      const index = this.modeOptions.findIndex((option) => option.value === this.modeValue)
      return index < 0 ? 0 : index
    },
    sessionModelResources() {
      const resources = this.modelSettings?.resources
      return Array.isArray(resources)
        ? resources.filter((item) => item && typeof item.id === 'string')
        : []
    },
    currentSessionModelId() {
      const id = store.currentSession?.sessionModelId
      return typeof id === 'string' ? id : ''
    },
    inheritedSessionModel() {
      const resources = this.sessionModelResources
      return (
        resources.find((item) => item.id === this.modelSettings?.sessionModelId) ||
        resources[0] ||
        null
      )
    },
    effectiveSessionModel() {
      return (
        this.sessionModelResources.find((item) => item.id === this.currentSessionModelId) ||
        this.inheritedSessionModel
      )
    },
    // 「更多」里的会话模型副标题：切完模型 / 列表加载完后显示当前实际生效的模型。
    sessionModelMenuHint() {
      if (this.modelSaving) return t('切换中…')
      const model = this.effectiveSessionModel
      return model ? this.modelResourceLabel(model) : ''
    },
    modelOptions() {
      const inherited = this.inheritedSessionModel
      const inheritedLabel = inherited ? this.modelResourceLabel(inherited) : ''
      return [
        {
          value: '',
          label: inheritedLabel
            ? t('跟随全局（{v1}）', { v1: inheritedLabel })
            : t('跟随全局会话模型')
        },
        ...this.sessionModelResources.map((resource) => ({
          value: resource.id,
          label: this.modelResourceLabel(resource),
          hint: resource.model || ''
        }))
      ]
    },
    modelIndex() {
      const index = this.modelOptions.findIndex(
        (option) => option.value === this.currentSessionModelId
      )
      return index < 0 ? 0 : index
    },
    // 「更多」里只放和当前会话相关的入口，顺序和 onMorePick 的下标一一对应。
    // 分享只分享应用，入口统一放在设置 → 关于，不再出现在任务会话里。
    moreOptions() {
      return [
        { label: t('知识') },
        { label: t('文件') },
        { label: t('重命名') },
        { label: t('回退点') },
        { label: t('变更审阅') },
        { label: t('项目记忆') },
        // 会话模型有当前值：菜单里当一条带副标题的入口，比挤在输入区上方的胶囊干净。
        { label: t('会话模型'), hint: this.sessionModelMenuHint },
        { label: t('重新生成') }
      ]
    },
    reviewReport() {
      const report = store.currentSession?.reviewReport
      return report && typeof report === 'object' ? report : null
    },
    reviewAverage() {
      const scores = this.reviewReport?.scores
      if (!scores) return 0
      const values = [scores.correctness, scores.evidence, scores.safety, scores.efficiency]
        .map(Number)
        .filter((value) => Number.isFinite(value))
      if (!values.length) return 0
      return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    },
    reviewVerdictLabel() {
      const verdict = this.reviewReport?.verdict
      if (verdict === 'pass') return t('通过')
      if (verdict === 'blocked') return t('阻塞')
      if (verdict === 'needs_work') return t('需改进')
      return t('评审')
    },
    reviewVerdictClass() {
      const verdict = this.reviewReport?.verdict
      if (verdict === 'pass') return 'pass'
      if (verdict === 'blocked') return 'blocked'
      return 'needs-work'
    },
    reviewMeta() {
      const report = this.reviewReport
      if (!report) return ''
      const parts = []
      if (this.reviewAverage) parts.push(t('{v1} 分', { v1: this.reviewAverage }))
      if (report.model) parts.push(String(report.model))
      const findings = Array.isArray(report.findings) ? report.findings.length : 0
      parts.push(t('{v1} 项发现', { v1: findings }))
      return parts.join(' · ')
    },
    reviewScoreRows() {
      const scores = this.reviewReport?.scores
      if (!scores) return []
      return [
        { key: 'correctness', label: t('正确性'), value: scores.correctness },
        { key: 'evidence', label: t('证据'), value: scores.evidence },
        { key: 'safety', label: t('安全'), value: scores.safety },
        { key: 'efficiency', label: t('效率'), value: scores.efficiency }
      ].filter((row) => Number.isFinite(Number(row.value)))
    },
    messageMenuPreview() {
      return shortText(this.messageMenuItem?.copyText || '', 60)
    },
    messageMenuOptions() {
      const options = [{ label: t('编辑并重新生成') }, { label: t('复制文本') }]
      if (this.canDeleteMessage(this.messageMenuItem)) {
        options.push({ label: t('删除') })
      }
      return options
    },
    restoreMessage() {
      const target = this.restoreTarget
      if (!target) return ''
      const mode =
        this.restoreMode === 'both'
          ? t('文件和对话都会回到这个快照。')
          : t('只恢复工作区文件，对话记录保持不变。')
      return `${shortText(target.label || '', 40)} · ${mode}`
    },
    revertMessage() {
      const target = this.revertTarget
      if (!target) return ''
      return t('{v1} 会恢复到本次任务开始前的版本。', {
        v1: target.path || target.name || ''
      })
    },
    linkOptions() {
      return [
        { label: t("在应用内预览"), hint: t("不离开 Pilot，可回退到系统浏览器") },
        { label: t("用浏览器打开"), hint: t("交给手机默认浏览器") },
        { label: t("复制链接"), hint: '' }
      ]
    },
    currentModeLabel() {
      const option = this.modeOptions.find((item) => item.value === this.modeValue)
      return option?.label || MODE_LABELS[this.modeValue] || t("全部自动")
    },
    scheduleKindOptions() {
      return [
        { value: 'once', label: t("稍后一次") },
        { value: 'interval', label: t("每隔一段时间") },
        { value: 'daily', label: t("每天固定时间") }
      ]
    }
  },
  watch: {
    'messagesTailKey'() {
      // 知识库定位刚加载完时先滚到命中消息，不要拽回底部。
      if (store.focusMessageId && !this.focusScrolled) {
        this.scrollToFocus()
        return
      }
      this.autoScroll()
    },
    'store.focusMessageId'() {
      this.focusScrolled = false
      if (store.focusMessageId) this.scrollToFocus()
    },
    'store.streamText'() {
      this.autoScroll()
    },
    'store.permissions.length'() {
      this.autoScroll()
    },
    'store.currentSessionId'(id) {
      // 新会话创建时 ID 会从空变成新 ID，输入框里还是同一次发送的内容，
      // 这时不能拿新 ID 的空草稿覆盖正在发送的文字。
      const keepDraft = this.sendInFlight
      this.flushDraft()
      partsCache.clear()
      this.focusScrolled = false
      this.todoEditingId = ''
      this.todoEditDraft = ''
      this.queueEditingId = ''
      this.queueEditDraft = ''
      this.deleteMessageTarget = null
      this.images = []
      this.references = []
      this.refOpen = false
      this.cancelScheduleForm()
      this.planOpen = false
      this.todoOpen = false
      this.queueOpen = false
      this.scheduledOpen = false
      if (id && !this.modeTouched) this.modeValue = sessionMode(id)
      if (id && !this.modelSettings) void this.loadSessionModels(true)
      this.draftKey = this.draftKeyForCurrent()
      if (keepDraft) this.queueDraftSave(this.draft, true)
      else this.restoreDraft(this.draftKey)
    },
    draft(value) {
      this.queueDraftSave(value)
    },
    running(on) {
      if (on) this.startRunTicker()
      else this.stopRunTicker()
    },
    references() {
      // 参照条目也是输入的一部分，和草稿一起保存。
      this.queueDraftSave(this.draft)
    }
  },
  onLoad(options) {
    init()
    // “和 Pilot 聊源码改造”等入口会带一句开场白，只预填一次，不自动发送。
    let seed = ''
    if (options?.new) {
      if (!store.newChat) startNewChat('')
      seed = String(store.newChat?.prompt || '')
      if (seed) store.newChat.prompt = ''
    } else if (options?.id) {
      const id = decodeURIComponent(options.id)
      const focus = typeof options.focus === 'string' ? decodeURIComponent(options.focus) : ''
      if (focus) {
        // 知识库命中：以这条消息为中心加载历史，并滚动高亮。
        this.modeValue = sessionMode(id)
        void openSessionAt(id, focus).then(() => {
          this.$nextTick?.(() => this.scrollToFocus(true))
        })
      } else if (store.currentSessionId !== id || store.focusMessageId) {
        // 从知识库的「打开会话」进来时，清掉上一次的定位窗口，回到最新一页。
        this.modeValue = sessionMode(id)
        void openSession(id)
      } else if (store.messages.length === 0 && !store.historyLoading) {
        // 列表页已经选中了这个会话，这里只需要补拉历史，不再重复复位状态。
        void reloadHistory()
      }
    }
    this.modeValue = store.currentSessionId
      ? sessionMode(store.currentSessionId)
      : store.defaultMode || 'auto'
    this.restoreDraft(this.draftKeyForCurrent())
    if (seed && !this.draft.trim()) this.draft = seed
    if (store.newChat) void this.loadQuickPrompts()
  },
  onShow() {
    init()
    applySystemBars()
    this.bindKeyboardBars()
    // 从后台回来时可能仍在跑：补起秒表（running 侦听只在变化时触发）。
    if (this.running) this.startRunTicker()
    if (!store.pairing) {
      uni.reLaunch({ url: '/pages/pair/index' })
      return
    }
    onAppShow()
    void loadTodos(store.currentSessionId)
    void loadScheduled(store.currentSessionId)
    if (store.currentSessionId && !this.modelSettings) void this.loadSessionModels(true)
    // 回到会话页时核对一次尾部：运行期间 App 可能在后台、断线或切换直连，
    // 收尾事件丢了的话这里会把最后一轮问答补回来（内容没变时不会多发请求）。
    void syncSessionTail()
    if (!this.modeTouched) {
      this.modeValue = store.currentSessionId
        ? sessionMode(store.currentSessionId)
        : store.defaultMode || 'auto'
    }
    if (store.focusMessageId) this.scrollToFocus()
    else this.autoScroll(true)
  },
  onHide() {
    // 切后台时也可能被系统回收，先把还没落盘的草稿写掉。
    this.flushDraft()
    // 后台不累计界面秒数：回来时 onShow 会重新起表并按 startedAt 重算。
    this.stopRunTicker()
  },
  onUnload() {
    this.stopRunTicker()
    this.flushDraft()
    this.messagePress?.dispose()
    if (
      this.keyboardBarsHandler &&
      typeof uni !== 'undefined' &&
      typeof uni.offKeyboardHeightChange === 'function'
    ) {
      uni.offKeyboardHeightChange(this.keyboardBarsHandler)
    }
  },
  methods: {
    /**
     * 运行秒表：只为了让「已运行 1m 35s」每秒重算。
     * 没在运行时不起定时器，避免会话页常驻一个每秒唤醒的计时器。
     */
    startRunTicker() {
      if (this.runTicker) return
      this.nowTick = Date.now()
      this.runTicker = setInterval(() => {
        this.nowTick = Date.now()
        // 运行已经结束（收尾事件到了但 watch 还没触发）时顺手收掉。
        if (!this.running) this.stopRunTicker()
      }, 1000)
    },
    stopRunTicker() {
      if (!this.runTicker) return
      clearInterval(this.runTicker)
      this.runTicker = null
    },
    /** 键盘弹出后部分 ROM 会把状态栏图标恢复成白色，再对齐一次主题。 */
    bindKeyboardBars() {
      if (this.keyboardBarsHandler) return
      if (typeof uni === 'undefined' || typeof uni.onKeyboardHeightChange !== 'function') return
      this.keyboardBarsHandler = (res) => {
        if (Number(res?.height) > 0) applySystemBars()
      }
      uni.onKeyboardHeightChange(this.keyboardBarsHandler)
    },
    shortText,
    // 系统消息把多个文本块拼成一行渲染，片段的 key 前面拼上块的 key。
    segmentsOf(item) {
      const rows = []
      for (const part of item.parts) {
        if (part.kind !== 'text') continue
        if (rows.length) rows.push({ index: `${part.key}-sep`, kind: 'text', text: '\n' })
        const segments = part.segments || [{ index: 0, kind: 'text', text: part.text || '' }]
        for (const seg of segments) rows.push({ ...seg, index: `${part.key}-${seg.index}` })
      }
      return rows
    },
    toggle(key) {
      this.expanded = { ...this.expanded, [key]: !this.expanded[key] }
    },
    toggleExecGroup(item) {
      const key = item?.execGroupKey
      if (!key) return
      this.execExpanded = { ...this.execExpanded, [key]: !this.execExpanded[key] }
    },
    toggleTurnPlan(item) {
      const key = item?.key
      if (!key) return
      this.turnPlanOpen = { ...this.turnPlanOpen, [key]: !this.turnPlanOpen[key] }
    },
    shortPath(path) {
      const value = String(path || '')
      return value.split(/[\\/]/).filter(Boolean).pop() || value
    },
    previewImage(url) {
      if (!url) return
      try {
        uni.previewImage({ urls: [url], current: url })
      } catch {
        // ignore
      }
    },
    async pickImages() {
      if (store.sending || this.running || this.images.length >= 3) return
      if (this.picking) return
      this.picking = true
      try {
        const picked = await pickImageAttachments(3 - this.images.length)
        for (const image of picked) {
          if (this.images.length >= 3) break
          this.images = [...this.images, image]
        }
      } catch (error) {
        uni.showToast({ title: error?.message || t("选择图片失败"), icon: 'none' })
      } finally {
        this.picking = false
      }
    },
    removeImage(index) {
      this.images = this.images.filter((_, at) => at !== index)
    },
    async pickFiles() {
      if (store.sending || this.running || this.filesUploading) return
      const workspacePath =
        store.currentSession?.cwd ||
        store.currentSession?.workspacePath ||
        store.newChat?.cwd ||
        ''
      if (!workspacePath) {
        uni.showToast({ title: t("当前会话没有工作区，无法上传文件"), icon: 'none' })
        return
      }
      if (this.references.length >= 8) {
        uni.showToast({ title: t("最多参照 8 个文件或项目"), icon: 'none' })
        return
      }
      const sessionKey = store.currentSessionId || 'new'
      this.filesUploading = true
      this.uploadProgress = 0
      try {
        const picked = await pickUploadFiles(3)
        if (!picked.length) return
        let uploaded = 0
        for (const file of picked) {
          if (this.references.length >= 8) {
            uni.showToast({ title: t("最多参照 8 个文件或项目"), icon: 'none' })
            break
          }
          this.uploadProgress = 0
          const result = await uploadFileToWorkspace(request, {
            workspacePath,
            file,
            onProgress: ({ uploaded: done, total }) => {
              this.uploadProgress =
                total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0
            }
          })
          if ((store.currentSessionId || 'new') !== sessionKey) continue
          const path = String(result?.path || '')
          if (path && !this.references.includes(path)) {
            this.references = [...this.references, path]
            uploaded += 1
          }
        }
        if (uploaded) {
          uni.showToast({
            title: t("已上传 {v1} 个文件", { v1: uploaded }),
            icon: 'none',
            duration: 2000
          })
        }
      } catch (error) {
        uni.showToast({
          title: error?.message || t("上传失败"),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.filesUploading = false
        this.uploadProgress = 0
      }
    },
    async openReferences() {
      if (store.sending || this.running) return
      const workspacePath = store.currentSession?.cwd || ''
      if (!workspacePath) {
        uni.showToast({ title: t("当前会话没有工作区，无法参照其他项目"), icon: 'none' })
        return
      }
      this.refOpen = true
      this.refLoading = true
      this.refError = ''
      try {
        const data = await request('workspaces.list')
        const current = workspacePath
        this.refProjects = (Array.isArray(data?.workspaces) ? data.workspaces : [])
          .filter((workspace) => workspace && typeof workspace.path === 'string')
          .filter((workspace) => !sameWorkspacePath(workspace.path, current))
          .map((workspace) => ({
            path: workspace.path,
            name:
              String(workspace.name || '').trim() ||
              String(workspace.path).split(/[\\/]/).filter(Boolean).pop() ||
              workspace.path
          }))
      } catch (error) {
        this.refProjects = []
        this.refError = error?.message || t("读取项目列表失败")
      } finally {
        this.refLoading = false
      }
    },
    closeReferences() {
      this.refOpen = false
    },
    toggleReference(project) {
      if (!project?.path) return
      if (this.references.includes(project.path)) {
        this.removeReference(project.path)
        return
      }
      if (this.references.length >= 8) {
        uni.showToast({ title: t("最多参照 8 个项目"), icon: 'none' })
        return
      }
      this.references = [...this.references, project.path]
    },
    removeReference(path) {
      this.references = this.references.filter((entry) => entry !== path)
    },
    openScheduleForm() {
      if (this.todoOffline) {
        uni.showToast({ title: t("电脑端离线，暂时无法管理定时任务"), icon: 'none' })
        return
      }
      this.scheduleEditingId = ''
      this.schedulePendingTodoId = ''
      this.scheduleDraft = ''
      this.scheduleKind = 'once'
      this.scheduleDelay = '10'
      this.scheduleInterval = '60'
      this.scheduleTime = '09:00'
      this.scheduleStartDate = ''
      this.scheduleFormOpen = true
      this.scheduledOpen = true
      void loadScheduled(store.currentSessionId)
    },
    startScheduleEdit(task) {
      if (!task?.id || store.scheduledBusy) return
      this.scheduledOpen = true
      this.scheduleFormOpen = true
      this.scheduleEditingId = task.id
      this.schedulePendingTodoId = ''
      this.scheduleDraft = task.content || ''
      this.scheduleKind = task.kind || 'once'
      this.scheduleDelay = '10'
      this.scheduleInterval = task.intervalMinutes ? String(task.intervalMinutes) : '60'
      this.scheduleTime = task.timeOfDay || '09:00'
      this.scheduleStartDate = task.startDate || ''
    },
    cancelScheduleForm() {
      this.scheduleFormOpen = false
      this.scheduleEditingId = ''
      this.schedulePendingTodoId = ''
      this.scheduleDraft = ''
    },
    scheduleInputPayload() {
      const content = this.scheduleDraft.trim()
      if (!content) {
        uni.showToast({ title: t("先写清楚要定时执行的内容"), icon: 'none' })
        return null
      }
      const delay = Number(this.scheduleDelay)
      const interval = Number(this.scheduleInterval)
      if (this.scheduleKind === 'once' && (!Number.isFinite(delay) || delay < 1 || delay > 10080)) {
        uni.showToast({ title: t("延迟需要在 1 到 10080 分钟之间"), icon: 'none' })
        return null
      }
      if (
        this.scheduleKind === 'interval' &&
        (!Number.isFinite(interval) || interval < 1 || interval > 10080)
      ) {
        uni.showToast({ title: t("间隔需要在 1 到 10080 分钟之间"), icon: 'none' })
        return null
      }
      const startDate = this.scheduleKind === 'daily' ? String(this.scheduleStartDate || '').trim() : ''
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        uni.showToast({ title: t("起始日期要像 2026-11-25"), icon: 'none' })
        return null
      }
      return {
        content,
        kind: this.scheduleKind,
        ...(this.scheduleKind === 'once' ? { delayMinutes: delay } : {}),
        ...(this.scheduleKind === 'interval' ? { intervalMinutes: interval } : {}),
        ...(this.scheduleKind === 'daily'
          ? { timeOfDay: this.scheduleTime, ...(startDate ? { startDate } : {}) }
          : {})
      }
    },
    async saveSchedule() {
      if (store.scheduledBusy) return
      const input = this.scheduleInputPayload()
      if (!input) return
      let ok = false
      if (this.schedulePendingTodoId) {
        ok = await convertTodoToSchedule(this.schedulePendingTodoId, input)
      } else if (this.scheduleEditingId) {
        ok = await updateScheduledTask(this.scheduleEditingId, input)
      } else {
        ok = await addScheduledTask(input)
      }
      if (ok) this.cancelScheduleForm()
    },
    async toggleSchedule(task) {
      await updateScheduledTask(task.id, { enabled: task.enabled !== true })
    },
    removeSchedule(task) {
      if (!task?.id) return
      this.scheduleToDelete = task
    },
    async confirmRemoveSchedule() {
      const task = this.scheduleToDelete
      this.scheduleToDelete = null
      if (task?.id) await removeScheduledTask(task.id)
    },
    async scheduleToTodo(task) {
      await convertScheduleToTodo(task.id)
    },
    todoToSchedule(todo) {
      if (!todo?.id || store.scheduledBusy) return
      if (this.todoOffline) {
        uni.showToast({ title: t("电脑端离线，暂时无法转为定时任务"), icon: 'none' })
        return
      }
      this.scheduleEditingId = ''
      this.schedulePendingTodoId = todo.id
      this.scheduleDraft = todo.text || ''
      this.scheduleKind = 'once'
      this.scheduleDelay = '10'
      this.scheduleInterval = '60'
      this.scheduleTime = '09:00'
      this.scheduleStartDate = ''
      this.scheduleFormOpen = true
      this.scheduledOpen = true
    },
    openScheduleTime() {
      this.scheduleTimeOpen = true
    },
    onScheduleTime(value) {
      if (value) this.scheduleTime = value
    },
    scheduleLabel(task) {
      if (task.kind === 'interval') return t("每 {v1} 分钟", { v1: task.intervalMinutes || 60 })
      if (task.kind === 'daily') {
        const time = task.timeOfDay || '09:00'
        return task.startDate
          ? t("{v1}（从 {v2} 起）", { v1: time, v2: task.startDate })
          : t("每天 {v1}", { v1: time })
      }
      return t("一次性")
    },
    scheduleTimeText(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
    async copyMessage(item) {
      if (!item?.copyText) return
      const ok = await copyText(item.copyText)
      uni.showToast({
        title: ok ? t("已复制这条消息") : t("复制失败，请长按选择内容"),
        icon: 'none'
      })
    },
    selectMessage(item) {
      if (!item?.copyText) return
      if (!stageSelectionText(item.copyText)) return
      uni.navigateTo({ url: '/pages/select/index' })
    },
    openFiles() {
      const sessionId = store.currentSessionId
      if (!sessionId) return
      uni.navigateTo({
        url: `/pages/files/index?sessionId=${encodeURIComponent(sessionId)}`
      })
    },
    openKnowledge() {
      const sessionId = store.currentSessionId
      if (!sessionId) return
      uni.navigateTo({
        url: `/pages/knowledge/index?sessionId=${encodeURIComponent(sessionId)}&from=chat`,
        events: {
          // 知识库里点「定位指令」时回到当前会话并滚动到原消息，
          // 不再额外压入一个重复的聊天页。
          focusMessage: (messageId) => {
            if (typeof messageId !== 'string' || !messageId) return
            void openSessionAt(sessionId, messageId).then(() => {
              this.$nextTick?.(() => this.scrollToFocus(true))
            })
          }
        }
      })
    },
    openFilePart(part) {
      const file = part?.file
      if (!file?.path) return
      const name = file.name || String(file.path).split(/[\\/]/).pop() || ''
      uni.navigateTo({
        url: `/pages/file/index?path=${encodeURIComponent(file.path)}&name=${encodeURIComponent(name)}`
      })
    },
    sessionTitle(sessionId) {
      const session = store.sessions.find((item) => item.id === sessionId)
      return session?.title || ''
    },
    changeMode(value) {
      this.modeTouched = true
      this.modeValue = value
      if (store.currentSessionId) setSessionMode(store.currentSessionId, value)
    },
    onModePick(index) {
      const option = this.modeOptions[Number(index) || 0]
      if (option) this.changeMode(option.value)
    },
    modelResourceLabel(resource) {
      const title = modelOptionLabel(
        resource.label || resource.model || t('未命名模型'),
        resource.tag
      )
      return resource.model && resource.label ? `${title} · ${resource.model}` : title
    },
    // 模型资源列表只在打开下拉时按需读取；读取失败不阻塞会话，重开再试。
    async loadSessionModels(silent) {
      if (!store.agentOnline || this.modelsLoading) return
      this.modelsLoading = true
      try {
        const models = await request('models.get', {}, 20_000)
        if (models && Array.isArray(models.resources)) this.modelSettings = models
      } catch (error) {
        if (!silent) {
          const message = error instanceof Error ? error.message : String(error || '')
          uni.showToast({
            title: message || t('读取模型失败，稍后重试。'),
            icon: 'none',
            duration: 3000
          })
        }
      } finally {
        this.modelsLoading = false
      }
    },
    openModelSheet() {
      if (!store.currentSessionId) return
      if (!store.agentOnline) {
        uni.showToast({ title: t('电脑端离线，暂时无法切换模型'), icon: 'none' })
        return
      }
      void this.loadSessionModels(true)
      this.modelSheetOpen = true
    },
    async onModelPick(index) {
      const option = this.modelOptions[Number(index) || 0]
      this.modelSheetOpen = false
      const sessionId = store.currentSessionId
      if (!option || !sessionId || option.value === this.currentSessionModelId) return
      this.modelSaving = true
      try {
        await setSessionModel(sessionId, option.value)
        uni.showToast({
          title: option.value ? t('已切换这个任务的模型') : t('已跟随全局会话模型'),
          icon: 'none'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '')
        uni.showToast({
          title: message || t('切换模型失败，稍后重试。'),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.modelSaving = false
      }
    },
    openLink(link) {
      // 长按菜单弹出后，松手仍可能补一个 click；短时间内不要再叠一层预览。
      if (this.linkMenuAt && Date.now() - this.linkMenuAt < 700) return
      const url = String(link?.url || '').trim()
      if (!url) return
      this.previewLink(url, link?.label)
    },
    openLinkMenu(link) {
      const url = String(link?.url || '').trim()
      if (!url) return
      this.linkMenuAt = Date.now()
      this.pendingLink = url
      this.linkSheetUrl = link?.label || url
      this.linkSheetOpen = true
    },
    // 正文里的链接（用户自己粘的网址、系统提示里的地址）。
    openInlineLink(url) {
      const target = String(url || '').trim()
      if (!target) return
      this.previewLink(target, linkLabel(target))
    },
    openInlineLinkMenu(url) {
      const target = String(url || '').trim()
      if (!target) return
      this.openLinkMenu({ url: target, label: linkLabel(target) })
    },
    previewLink(url, label) {
      // H5 或旧版原生壳没有 plus.webview 时，退回系统浏览器而不是只弹错误。
      openWebPreview(url, label).catch(() => {
        openExternalUrl(url).catch((error) => {
          uni.showToast({ title: error?.message || t("无法打开预览窗口"), icon: 'none' })
        })
      })
    },
    onLinkPick(index) {
      const url = this.pendingLink
      this.linkSheetOpen = false
      if (!url) return
      const choice = Number(index) || 0
      if (choice === 0) {
        this.previewLink(url, this.linkSheetUrl)
        return
      }
      if (choice === 1) {
        openExternalUrl(url).catch((error) => {
          uni.showToast({ title: error?.message || t("无法打开链接"), icon: 'none' })
        })
        return
      }
      void copyText(url).then((ok) => {
        uni.showToast({ title: ok ? t("链接已复制") : t("复制失败"), icon: 'none' })
      })
    },
    openRename() {
      if (!store.currentSessionId) return
      this.renameValue = String(store.currentSession?.title || '')
      this.renameError = ''
      this.renameSaving = false
      this.renameFocus = false
      this.renameOpen = true
      this.$nextTick?.(() => {
        this.renameFocus = true
      })
    },
    closeRename() {
      if (this.renameSaving) return
      this.renameOpen = false
      this.renameFocus = false
    },
    async submitRename() {
      if (!this.canRename) return
      const title = String(this.renameValue || '').trim()
      if (!title) {
        this.renameError = t('任务名称不能为空')
        return
      }
      if (!store.currentSessionId) {
        this.renameError = t('没有选中的任务')
        return
      }
      this.renameSaving = true
      this.renameError = ''
      try {
        await renameSession(store.currentSessionId, title)
        this.renameOpen = false
        this.renameFocus = false
        uni.showToast({ title: t('任务名称已更新'), icon: 'none' })
      } catch (error) {
        this.renameError = error?.message || t('修改失败，请稍后再试')
      } finally {
        this.renameSaving = false
      }
    },
    toggleMore() {
      this.moreOpen = !this.moreOpen
    },
    onMorePick(index) {
      this.moreOpen = false
      const pick = Number(index)
      if (pick === 0) this.openKnowledge()
      else if (pick === 1) this.openFiles()
      else if (pick === 2) this.openRename()
      else if (pick === 3) this.openCheckpoints()
      else if (pick === 4) this.openChanges()
      else if (pick === 5) this.openMemory()
      else if (pick === 6) this.openModelSheet()
      else if (pick === 7) this.regenerateLast()
    },
    // —— 新会话快捷指令 ——
    async loadQuickPrompts() {
      const defaults = [
        t("先梳理一下这个项目的结构、技术栈和启动方式"),
        t("运行项目测试，定位并修复所有失败项"),
        t("阅读 README 和核心代码，指出三个最值得改进的地方"),
        t("为这个项目添加一个实用的新功能，先给出计划再实施")
      ]
      try {
        const list = await loadQuickCommands()
        const prompts =
          list === null ? defaults : list.map((item) => String(item?.content || '').trim())
        this.quickPrompts = prompts.filter(Boolean).slice(0, 8)
      } catch {
        // 旧版电脑端或离线时退回内置预设，保证欢迎页不是空的。
        this.quickPrompts = defaults
      }
    },
    useQuickPrompt(prompt) {
      this.draft = String(prompt || '')
    },

    // —— 失败重试 ——
    async retryFailedRun() {
      if (this.retryBusy) return
      const id = store.currentSessionId
      if (!id) return
      if (!this.connected || !this.agentOnline) {
        uni.showToast({ title: t('请先连接电脑'), icon: 'none' })
        return
      }
      this.retryBusy = true
      try {
        await retrySession(id)
        uni.showToast({ title: t('已重新开始'), icon: 'none' })
      } catch (error) {
        uni.showToast({
          title: String(error?.message || t('重试失败')).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.retryBusy = false
      }
    },

    // —— 消息编辑 / 复制 ——
    // 消息长按：按住不动才打开菜单，滚动聊天立即取消。
    startMessagePress(item, event) {
      this.messagePress?.start(event, item)
    },
    moveMessagePress(event) {
      this.messagePress?.move(event)
    },
    endMessagePress() {
      this.messagePress?.end()
    },
    cancelMessagePress() {
      this.messagePress?.cancel()
    },
    openMessageMenu(item) {
      if (!item?.id) {
        uni.showToast({ title: t('这条消息暂不支持编辑'), icon: 'none' })
        return
      }
      this.messageMenuItem = item
      this.messageMenuOpen = true
    },
    closeMessageMenu() {
      this.messageMenuOpen = false
      this.messageMenuItem = null
    },
    onMessageMenuPick(index) {
      const item = this.messageMenuItem
      this.closeMessageMenu()
      if (!item) return
      if (Number(index) === 0) this.startEditMessage(item)
      else if (Number(index) === 1) this.copyMessageText(item)
      else if (Number(index) === 2) this.askDeleteMessage(item)
    },
    /** 只有最后一条、且没有任何回复跟随时，才允许撤回这条指令。 */
    canDeleteMessage(item) {
      if (!item?.id || item.role !== 'user' || item.control) return false
      if (!this.connected || this.running || store.sending) return false
      if (!item.hasText && !item.hasImage && !item.hasReference) return false
      const rows = store.messages
      const last = rows.length ? rows[rows.length - 1] : null
      return Boolean(last && last.id === item.id)
    },
    askDeleteMessage(item) {
      if (!this.canDeleteMessage(item)) return
      this.deleteMessageTarget = item
    },
    async confirmDeleteMessage() {
      const target = this.deleteMessageTarget
      const sessionId = store.currentSessionId
      if (!target || !sessionId || this.deleteMessageBusy) return
      this.deleteMessageBusy = true
      try {
        await deleteMessage(sessionId, target.id)
        this.deleteMessageTarget = null
        uni.showToast({ title: t('指令已删除。'), icon: 'none' })
      } catch (error) {
        uni.showToast({
          title: String(error?.message || t('删除失败')).slice(0, 80),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.deleteMessageBusy = false
      }
    },
    async copyMessageText(item) {
      const text = String(item?.copyText || '').trim()
      if (!text) return
      const ok = await copyText(text)
      uni.showToast({ title: ok ? t('已复制') : t('复制失败'), icon: 'none' })
    },
    startEditMessage(item) {
      if (!item?.id) return
      this.editMessageId = item.id
      this.editValue = String(item.copyText || '')
      this.editError = ''
      this.editBusy = false
      this.editFocus = false
      this.editOpen = true
      setTimeout(() => {
        if (this.editOpen) this.editFocus = true
      }, 120)
    },
    closeEditMessage() {
      if (this.editBusy) return
      this.editOpen = false
      this.editFocus = false
      this.editMessageId = ''
      this.editValue = ''
      this.editError = ''
    },
    async submitEditMessage() {
      if (this.editBusy || !this.editValue.trim() || !this.editMessageId) return
      const id = store.currentSessionId
      if (!id) return
      this.editBusy = true
      this.editError = ''
      try {
        await editMessage(id, this.editMessageId, this.editValue)
        this.editOpen = false
        this.editFocus = false
        this.editMessageId = ''
        this.editValue = ''
        uni.showToast({ title: t('已重新生成'), icon: 'none' })
      } catch (error) {
        this.editError = String(error?.message || t('编辑失败')).slice(0, 80)
      } finally {
        this.editBusy = false
      }
    },
    async regenerateLast() {
      const id = store.currentSessionId
      if (!id || this.running) {
        if (this.running) uni.showToast({ title: t('任务执行中，请稍后'), icon: 'none' })
        return
      }
      uni.showLoading({ title: t('正在重新生成…'), mask: true })
      try {
        await regenerateMessage(id)
        uni.hideLoading()
        uni.showToast({ title: t('已重新生成'), icon: 'none' })
      } catch (error) {
        uni.hideLoading()
        uni.showToast({
          title: String(error?.message || t('重新生成失败')).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      }
    },

    // —— 回退点 ——
    openCheckpoints() {
      this.checkpointsOpen = true
      this.checkpointsError = ''
      this.checkpointList = []
      void this.loadCheckpointList()
    },
    closeCheckpoints() {
      this.checkpointsOpen = false
    },
    async loadCheckpointList() {
      const id = store.currentSessionId
      if (!id) {
        this.checkpointsError = t('当前没有选中的任务')
        return
      }
      this.checkpointsLoading = true
      this.checkpointsError = ''
      try {
        this.checkpointList = await loadCheckpoints(id)
      } catch (error) {
        this.checkpointsError = String(error?.message || t('读取回退点失败')).slice(0, 80)
      } finally {
        this.checkpointsLoading = false
      }
    },
    async createCheckpointNow() {
      if (this.checkpointCreating) return
      const id = store.currentSessionId
      if (!id) return
      this.checkpointCreating = true
      try {
        const created = await createCheckpoint(id)
        if (created) this.checkpointList = [created, ...this.checkpointList]
        uni.showToast({ title: t('已创建回退点'), icon: 'none' })
      } catch (error) {
        uni.showToast({
          title: String(error?.message || t('创建回退点失败')).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.checkpointCreating = false
      }
    },
    checkpointMeta(cp) {
      const parts = []
      if (cp?.createdAt) parts.push(relativeTime(cp.createdAt))
      if (Number.isFinite(Number(cp?.files))) parts.push(t('{v1} 个文件', { v1: cp.files }))
      if (Number.isFinite(Number(cp?.messageCount))) {
        parts.push(t('{v1} 条消息', { v1: cp.messageCount }))
      }
      return parts.join(' · ')
    },
    askRestoreCheckpoint(cp, mode) {
      if (!cp?.id || this.restoreBusy) return
      this.restoreMode = mode === 'both' ? 'both' : 'code'
      this.restoreTarget = cp
    },
    async confirmRestoreCheckpoint() {
      const target = this.restoreTarget
      const id = store.currentSessionId
      if (!target?.id || !id || this.restoreBusy) return
      this.restoreBusy = true
      try {
        const result = await restoreCheckpoint(id, target.id, this.restoreMode)
        this.restoreTarget = null
        this.checkpointsOpen = false
        const restored = Number(result?.restoredFiles) || 0
        uni.showToast({ title: t('已恢复 {v1} 个文件', { v1: restored }), icon: 'none' })
      } catch (error) {
        this.restoreTarget = null
        uni.showToast({
          title: String(error?.message || t('恢复失败')).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.restoreBusy = false
      }
    },

    // —— 变更审阅 ——
    openChanges() {
      this.changesOpen = true
      this.changesError = ''
      this.changeList = []
      this.expandedChanges = {}
      void this.loadChangeList()
    },
    closeChanges() {
      this.changesOpen = false
    },
    async loadChangeList() {
      const id = store.currentSessionId
      if (!id) {
        this.changesError = t('当前没有选中的任务')
        return
      }
      this.changesLoading = true
      this.changesError = ''
      try {
        this.changeList = await loadChanges(id)
      } catch (error) {
        this.changesError = String(error?.message || t('读取变更失败')).slice(0, 80)
      } finally {
        this.changesLoading = false
      }
    },
    toggleChangeDiff(path) {
      if (!path) return
      this.expandedChanges[path] = !this.expandedChanges[path]
    },
    changeDiffText(change) {
      const diff = String(change?.diff || '')
      if (!diff.trim()) return t('没有可显示的差异。')
      return diff.length > 4000 ? `${diff.slice(0, 4000)}\n…` : diff
    },
    changeStatusLabel(status) {
      if (status === 'added') return t('新增')
      if (status === 'deleted') return t('删除')
      if (status === 'unreadable') return t('无法读取')
      return t('修改')
    },
    askRevertChange(change) {
      if (!change?.canRevert || this.revertBusy) return
      this.revertTarget = change
    },
    async confirmRevertChange() {
      const target = this.revertTarget
      const id = store.currentSessionId
      if (!target?.path || !id || this.revertBusy) return
      this.revertBusy = true
      try {
        await revertChange(id, target.path)
        this.revertTarget = null
        uni.showToast({ title: t('已还原文件'), icon: 'none' })
        await this.loadChangeList()
      } catch (error) {
        this.revertTarget = null
        uni.showToast({
          title: String(error?.message || t('还原失败')).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.revertBusy = false
      }
    },

    // —— 项目记忆 ——
    memoryWorkspacePath() {
      return String(store.currentSession?.workspacePath || store.currentSession?.cwd || '')
    },
    openMemory() {
      this.memoryOpen = true
      this.memoryError = ''
      this.memoryList = []
      this.memoryDraft = ''
      void this.loadMemoryList()
    },
    closeMemory() {
      this.memoryOpen = false
    },
    async loadMemoryList() {
      const path = this.memoryWorkspacePath()
      if (!path) {
        this.memoryLoading = false
        this.memoryError = t('当前任务没有工作区')
        return
      }
      this.memoryLoading = true
      this.memoryError = ''
      try {
        this.memoryList = await loadMemory(path)
      } catch (error) {
        this.memoryError = String(error?.message || t('读取记忆失败')).slice(0, 80)
      } finally {
        this.memoryLoading = false
      }
    },
    async submitMemory() {
      if (this.memoryBusy) return
      const path = this.memoryWorkspacePath()
      const content = String(this.memoryDraft || '').trim()
      if (!path || !content) return
      this.memoryBusy = true
      try {
        const entry = await addMemory(path, content)
        this.memoryDraft = ''
        if (entry) this.memoryList = [entry, ...this.memoryList]
        else await this.loadMemoryList()
        uni.showToast({ title: t('已添加记忆'), icon: 'none' })
      } catch (error) {
        uni.showToast({
          title: String(error?.message || t('添加记忆失败')).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.memoryBusy = false
      }
    },
    askRemoveMemory(entry) {
      if (!entry?.id || this.memoryBusy) return
      this.memoryTarget = entry
    },
    async confirmRemoveMemory() {
      const target = this.memoryTarget
      const path = this.memoryWorkspacePath()
      if (!target?.id || !path || this.memoryBusy) return
      this.memoryBusy = true
      try {
        await removeMemory(path, target.id)
        this.memoryList = this.memoryList.filter((entry) => entry.id !== target.id)
        this.memoryTarget = null
        uni.showToast({ title: t('已删除记忆'), icon: 'none' })
      } catch (error) {
        this.memoryTarget = null
        uni.showToast({
          title: String(error?.message || t('删除记忆失败')).slice(0, 60),
          icon: 'none',
          duration: 3000
        })
      } finally {
        this.memoryBusy = false
      }
    },
    memorySourceLabel(entry) {
      const source = entry?.source
      const label =
        source === 'user' ? t('手动添加')
        : source === 'reflection' ? t('复盘总结')
        : t('任务记录')
      const when = entry?.createdAt ? relativeTime(entry.createdAt) : ''
      return when ? `${label} · ${when}` : label
    },
    severityLabel(level) {
      if (level === 'high') return t('高')
      if (level === 'medium') return t('中')
      return t('低')
    },

    onScroll(event) {
      // 聊天列表一开始滚动，就取消还没触发的消息长按。
      this.messagePress?.scroll()
      const deltaY = Number(event?.detail?.deltaY) || 0
      if (deltaY < 0) this.nearBottom = false
    },
    autoScroll(force) {
      if (!force && !this.nearBottom) return
      // 流式回复时增量很密集，滚动也做节流，避免和文字渲染一起抢占主线程。
      const now = Date.now()
      if (!force && now - (this._scrollAt || 0) < 120) return
      this._scrollAt = now
      if (this._scrollTimer) clearTimeout(this._scrollTimer)
      this._scrollTimer = setTimeout(() => {
        this._scrollTimer = null
        this.scrollTarget = ''
        this.$nextTick?.(() => {
          this.scrollTarget = 'chat-bottom'
        })
      }, 30)
    },
    scrollToFocus(force = false) {
      if (!store.focusMessageId) return
      if (this.focusScrolled && !force) return
      const item = this.rendered.find((entry) => entry.focused)
      if (!item) return
      this.focusScrolled = true
      this.nearBottom = false
      this.scrollTarget = ''
      this.$nextTick?.(() => {
        this.scrollTarget = item.anchorId
      })
    },
    async returnToLatest() {
      this.focusScrolled = false
      this.nearBottom = true
      await backToLatest()
      this.autoScroll(true)
    },
    async loadEarlier() {
      this.nearBottom = false
      await loadEarlier()
    },
    /** 输入框草稿的存储键：已有会话按会话 ID，新建任务按工作区分开。 */
    draftKeyForCurrent() {
      const sessionId = String(store.currentSessionId || '')
      if (sessionId) return `session:${sessionId}`
      const cwd = String(store.newChat?.cwd || '').trim()
      return cwd ? `new:${cwd}` : 'new:'
    },
    restoreDraft(key) {
      const name = String(key || '')
      this.draftKey = name
      const saved = name ? loadDraft(name) : null
      this.draft = saved?.text || ''
      if (saved?.references?.length) this.references = saved.references
    },
    /** 防抖保存；immediate 用于切换会话、发送等不能等的时刻。 */
    queueDraftSave(value, immediate = false) {
      const key = this.draftKey
      if (!key) return
      const text = typeof value === 'string' ? value : this.draft
      const references = this.references.slice()
      if (this.draftTimer) {
        clearTimeout(this.draftTimer)
        this.draftTimer = null
      }
      const persist = () => {
        this.draftTimer = null
        saveDraft(key, { text, references })
      }
      if (immediate) persist()
      else this.draftTimer = setTimeout(persist, 250)
    },
    flushDraft() {
      if (this.draftTimer) {
        clearTimeout(this.draftTimer)
        this.draftTimer = null
      }
      if (!this.draftKey) return
      saveDraft(this.draftKey, { text: this.draft, references: this.references })
    },
    insertDraftText(text) {
      const value = String(text || '').trim()
      if (!value) return
      const current = this.draft
      if (!current.trim()) {
        this.draft = value
        return
      }
      const separator = current.endsWith('\n') ? '' : '\n'
      this.draft = `${current}${separator}${value}`
    },
    async send() {
      const text = this.draft.trim()
      if (!text && !this.images.length) return
      if (this.filesUploading) {
        uni.showToast({ title: t("文件上传完成后再发送"), icon: 'none' })
        return
      }
      if (this.running && (this.images.length || this.references.length)) {
        uni.showToast({ title: t("任务执行中暂时不能发送图片或参照"), icon: 'none' })
        return
      }
      // 发送过程中新会话会拿到 ID，草稿键随之切换；成功后新旧键都要清掉，
      // 否则下一次新建任务会把已经发出去的内容又预填回输入框。
      const sendingKey = this.draftKey
      this.sendInFlight = true
      let ok = false
      try {
        ok = await sendMessage(text, {
          mode: this.modeValue,
          images: this.images.map((image) => image.url).filter(Boolean),
          references: this.references
        })
      } finally {
        this.sendInFlight = false
      }
      if (ok) {
        this.draft = ''
        this.images = []
        this.references = []
        clearDraft(sendingKey)
        clearDraft(this.draftKey)
      }
    },
    async addTodoItem() {
      const text = this.todoDraft.trim()
      if (!text) return
      const ok = await addTodo(text)
      if (ok) this.todoDraft = ''
    },
    startTodoEdit(todo) {
      if (!todo?.id || store.todoBusy) return
      this.todoOpen = true
      this.todoEditingId = todo.id
      this.todoEditDraft = todo.text || ''
    },
    cancelTodoEdit() {
      this.todoEditingId = ''
      this.todoEditDraft = ''
    },
    async saveTodoEdit(todoId) {
      const text = this.todoEditDraft.trim()
      if (!text) {
        uni.showToast({ title: t("待办内容不能为空"), icon: 'none' })
        return
      }
      const ok = await updateTodo(todoId, text)
      if (ok) {
        this.todoEditingId = ''
        this.todoEditDraft = ''
      }
    },
    sendTodoItem(todoId) {
      if (store.todoBusy || this.todoOffline) return
      const todo = this.pendingTodos.find((item) => item.id === todoId)
      this.todoConfirm = {
        action: 'send',
        todoId,
        title: t('发送这条待办？'),
        message: todo ? String(todo.text || '').slice(0, 100) : '',
        confirmText: t('发送'),
        danger: false
      }
    },
    sendAllTodoItems() {
      if (store.todoBusy || this.todoOffline) return
      const count = this.pendingTodos.length
      if (!count) return
      this.todoConfirm = {
        action: 'sendAll',
        title: t('全部发送这 {v1} 条待办？', { v1: count }),
        message: t('发送后会按顺序立即执行。'),
        confirmText: t('全部发送'),
        danger: false
      }
    },
    removeTodoItem(todoId) {
      if (store.todoBusy) return
      const todo = [...this.pendingTodos, ...this.sentTodos].find((item) => item.id === todoId)
      this.todoConfirm = {
        action: 'remove',
        todoId,
        title: t('删除这条待办？'),
        message: todo ? String(todo.text || '').slice(0, 100) : '',
        confirmText: t('删除'),
        danger: true
      }
    },
    async confirmTodoAction() {
      const action = this.todoConfirm
      if (!action || this.todoConfirmBusy) return
      this.todoConfirmBusy = true
      try {
        if (action.action === 'send') {
          await sendTodo(action.todoId)
          this.sentOpen = false
        } else if (action.action === 'sendAll') {
          await sendAllTodos()
          this.sentOpen = false
        } else if (action.action === 'remove') {
          await removeTodo(action.todoId)
        }
      } finally {
        this.todoConfirmBusy = false
        this.todoConfirm = null
      }
    },
    async clearSentItems() {
      await clearSentTodos()
    },
    pause() {
      this.runConfirm = 'pause'
    },
    async resume() {
      await resumeSession(this.modeValue)
    },
    stop() {
      this.runConfirm = 'stop'
    },
    async confirmRunAction() {
      const action = this.runConfirm
      if (!action || this.runConfirmBusy) return
      this.runConfirmBusy = true
      try {
        if (action === 'stop') await stopRun()
        else await pauseRun()
      } finally {
        this.runConfirmBusy = false
        this.runConfirm = ''
      }
    },
    async respond(requestId, behavior) {
      await respondPermission(requestId, behavior)
    },
    async insertQueue(queueId) {
      await insertQueueItem(queueId)
    },
    startQueueEdit(item) {
      if (!item?.queueId) return
      this.queueOpen = true
      this.queueEditingId = item.queueId
      this.queueEditDraft = item.prompt || ''
    },
    cancelQueueEdit() {
      this.queueEditingId = ''
      this.queueEditDraft = ''
    },
    async saveQueueEdit(queueId) {
      const text = this.queueEditDraft.trim()
      if (!text) {
        uni.showToast({ title: t("排队消息内容不能为空"), icon: 'none' })
        return
      }
      const ok = await updateQueueItem(queueId, text)
      if (ok) {
        this.queueEditingId = ''
        this.queueEditDraft = ''
      }
    },
    async convertQueueToTodo(queueId) {
      await convertQueueItemToTodo(queueId)
      if (this.queueEditingId === queueId) this.cancelQueueEdit()
    },
    async removeQueue(queueId) {
      await removeQueueItem(queueId)
      if (this.queueEditingId === queueId) this.cancelQueueEdit()
    },
    async moveQueue(queueId, direction) {
      // 正在编辑的那条被移到别的位置时，编辑态跟着队列项走，不用关闭。
      await moveQueueItem(queueId, direction)
    },
    reconnect() {
      reconnectClient()
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
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  /* 自定义导航栏：为系统状态栏留出高度，H5 下变量为 0。 */
  padding: calc(var(--status-bar-height) + 20rpx) 24rpx 18rpx;
  flex-shrink: 0;
}
.back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  /* 标题下面是副标题，整块垂直居中会把箭头压到两行之间。
     让箭头对齐第一行标题：标题行高 30rpx × 1.5 = 45rpx，
     56rpx 的图标框上移半个差值。 */
  align-self: flex-start;
  margin-top: -6rpx;
  margin-right: 2rpx;
  color: var(--accent-soft);
  flex-shrink: 0;
}
.titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title {
  color: var(--text-strong);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title.editable:active {
  opacity: 0.6;
}
.subtitle {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  margin-top: 4rpx;
}
.stop {
  color: var(--stop);
  background: var(--stop-soft);
}
.pause {
  color: var(--pause);
  background: var(--pause-soft);
}
.resume {
  color: var(--resume);
  background: var(--resume-soft);
}
.run-actions {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex-shrink: 0;
}
/* 「更多」：知识、文件收进弹层后，头部只剩这一个入口。
   三个点用实心圆绘制，避免「⋯」字形在不同系统字体里基线偏移，
   与暂停/停止胶囊的中点对不齐。 */
.more-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5rpx;
  width: 56rpx;
  height: var(--btn-h-xs);
  border-radius: var(--btn-radius-pill);
  color: var(--muted);
}
.more-dot {
  width: 6rpx;
  height: 6rpx;
  border-radius: 50%;
  background: currentColor;
}
.more-btn:active {
  color: var(--text);
  background: var(--hover);
}
/* 「更多」气泡：贴着 ⋯ 下方右侧弹出，点空白处收起。 */
.more-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.more-btn.open {
  color: var(--text);
  background: var(--hover);
}
.more-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 900;
}
.more-pop {
  position: absolute;
  top: calc(var(--btn-h-xs) + 12rpx);
  right: 0;
  z-index: 901;
  display: flex;
  flex-direction: column;
  min-width: 260rpx;
  max-width: 440rpx;
  padding: 8rpx;
  border-radius: 18rpx;
  background: var(--bg-elevated);
  box-shadow: var(--float-shadow);
}
.more-item {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding: 16rpx 22rpx;
  border-radius: 12rpx;
}
.more-item:active {
  background: var(--hover);
}
.more-label {
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  line-height: 1.2;
}
/* 副标题（当前会话模型）：模型名可能很长，单行省略，不撑宽气泡。 */
.more-hint {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  margin: 12rpx 24rpx 0;
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background: rgba(201, 171, 124, 0.1);
  flex-shrink: 0;
}
.banner.error {
  background: rgba(201, 146, 141, 0.1);
}
.banner-text {
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  flex: 1;
  line-height: 1.5;
}
.banner-action {
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  flex-shrink: 0;
}
.messages {
  flex: 1;
  min-height: 0;
  padding: 20rpx 24rpx 10rpx;
  box-sizing: border-box;
}
.load-earlier {
  text-align: center;
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  padding: 14rpx 0 20rpx;
}
.loading-hint {
  text-align: center;
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
  padding: 30rpx 0;
}
.bottom-anchor {
  height: 20rpx;
}
.msg {
  margin-bottom: 18rpx;
  display: flex;
  flex-direction: column;
}
.msg.user {
  align-items: flex-end;
}
/* 知识库定位到的消息整行描边，滑动后仍能看出是从哪条记录打开的。 */
.msg.msg-focused {
  padding: 10rpx;
  border-radius: 18rpx;
  background: rgba(143, 168, 192, 0.1);
  box-shadow: inset 0 0 0 2rpx rgba(143, 168, 192, 0.55);
}
.user-bubble {
  max-width: 84%;
  background: var(--accent-gradient);
  border-radius: 24rpx 24rpx 8rpx 24rpx;
  padding: 18rpx 22rpx;
  box-shadow: 0 10rpx 28rpx var(--accent-glow);
}
.user-bubble .msg-text {
  color: var(--accent-ink);
}
.system-bubble {
  align-self: center;
  max-width: 90%;
  padding: 16rpx 22rpx;
  border-radius: 14rpx;
  background: var(--bg-soft);
  box-shadow: var(--control-shadow);
}
.system-bubble.error {
  background: rgba(201, 146, 141, 0.1);
}
.system-bubble .msg-text {
  color: #c9928d;
  font-size: calc(24rpx * var(--font-scale));
}
.theme-light .system-bubble .msg-text {
  color: #a15a55;
}
.assistant-body {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  max-width: 100%;
}
.msg-actions {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 8rpx;
  padding: 0 4rpx;
}
/* 每条指令和回复脚下的时间；和操作按钮同一行，不额外占一行。 */
.msg-time {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.5;
}
.msg.user .msg-actions {
  justify-content: flex-end;
}
.msg.system .msg-actions {
  align-self: center;
}
.msg-action {
  color: var(--muted);
  background: var(--surface-3);
  box-shadow: var(--control-shadow);
}
.link-row {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  margin-top: 12rpx;
}
.link-chip {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  background: var(--surface-3);
  box-shadow: var(--control-shadow);
}
.link-chip-icon {
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
}
.link-chip-text {
  flex: 1;
  min-width: 0;
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
  word-break: break-all;
}
.msg-text {
  font-size: calc(27rpx * var(--font-scale));
  line-height: 1.62;
  word-break: break-word;
}
/* 正文里的网址：在气泡里也要一眼看出可点，点一下进内置预览。 */
.msg-link {
  color: var(--accent-soft);
  text-decoration: underline;
  text-underline-offset: 3rpx;
}
.user-bubble .msg-link {
  color: var(--accent-ink);
}
/* 系统消息的正文是暖灰色，链接跟着这一套但提亮一级，靠下划线强调可点。 */
.system-bubble .msg-link {
  color: #e8b3ae;
}
.theme-light .system-bubble .msg-link {
  color: #8a4a45;
}
.assistant-text {
  color: var(--text);
  background: var(--surface);
  border-radius: 8rpx 22rpx 22rpx 22rpx;
  padding: 18rpx 22rpx;
  white-space: pre-wrap;
  box-shadow: var(--card-shadow);
}
.tool-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10rpx;
  padding: 14rpx 18rpx;
  background: var(--bg-soft);
  border-radius: 14rpx;
}
.tool-row.error {
  background: rgba(201, 146, 141, 0.1);
}
.exec-more-row {
  background: transparent;
}
.tool-icon {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  flex-shrink: 0;
}
.tool-name {
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  font-weight: 600;
  flex-shrink: 0;
}
.tool-summary {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-summary.mono {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  font-family: monospace;
  font-size: calc(22rpx * var(--font-scale));
}
.tool-toggle {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  flex-shrink: 0;
}
.tool-body {
  width: 100%;
  margin-top: 8rpx;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-body.mono {
  font-family: monospace;
  font-size: calc(22rpx * var(--font-scale));
}
.tool-file {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 10rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  background: var(--file-soft);
  box-sizing: border-box;
}
.tool-file-icon {
  color: var(--file);
  font-size: calc(22rpx * var(--font-scale));
  flex-shrink: 0;
}
.tool-file-name {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-file-action {
  color: var(--file);
  font-size: calc(22rpx * var(--font-scale));
  flex-shrink: 0;
}
.thinking-row .tool-summary {
  font-style: italic;
}
.result-row .tool-icon {
  color: var(--ok);
}
.result-row.error .tool-icon {
  color: var(--danger);
}
.stream-status {
  display: flex;
  align-items: center;
  gap: 14rpx;
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
  padding: 6rpx 4rpx;
}
/* 已运行时长用等宽数字，秒数跳动时行宽不抖。 */
.stream-status-elapsed {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.typing {
  display: flex;
  gap: 6rpx;
}
.typing text {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: var(--muted);
  animation: blink 1.2s infinite ease-in-out;
}
.typing text:nth-child(2) {
  animation-delay: 0.2s;
}
.typing text:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}
.user-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 10rpx;
}
.user-ref {
  max-width: 320rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  background: var(--accent-ink-wash);
  color: var(--accent-ink);
  font-size: calc(20rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 12rpx;
}
.user-image {
  width: 300rpx;
  height: 225rpx;
  border-radius: 14rpx;
  background: rgba(0, 0, 0, 0.16);
}
.attach-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  padding: 10rpx 0 6rpx;
}
.attach-chip {
  display: flex;
  align-items: center;
  gap: 10rpx;
  max-width: 420rpx;
  padding: 10rpx 16rpx;
  border-radius: 12rpx;
  background: var(--bg-soft);
}
.attach-name {
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attach-x {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  flex-shrink: 0;
}
.attach-thumb {
  position: relative;
  width: 116rpx;
  height: 116rpx;
  border-radius: 12rpx;
  overflow: hidden;
}
.attach-thumb-img {
  width: 100%;
  height: 100%;
}
.attach-thumb .attach-x {
  position: absolute;
  top: 0;
  right: 4rpx;
  color: #fff;
  text-shadow: 0 0 6rpx rgba(0, 0, 0, 0.7);
}
.attach-buttons {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-left: auto;
  flex-shrink: 0;
}
.attach-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: var(--btn-h-sm);
  min-height: var(--btn-h-sm);
  padding: 0 var(--btn-pad-sm);
  border-radius: var(--btn-radius-pill);
  border: var(--btn-secondary-border, 1rpx solid var(--border));
  background: var(--btn-secondary-bg, var(--bg-soft));
  color: var(--btn-secondary-fg, var(--accent-soft));
  font-size: var(--btn-font-sm);
  line-height: 1.2;
}
.attach-btn.disabled {
  opacity: 0.45;
}
.schedule-panel .todo-head-actions {
  gap: 18rpx;
}
.schedule-form {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 4rpx 0 10rpx;
}
.schedule-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}
.schedule-form-row {
  display: flex;
  gap: 12rpx;
}
.schedule-input {
  min-width: 200rpx;
  padding: 10rpx 16rpx;
  border-radius: 12rpx;
  background: var(--bg-soft);
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
}
.schedule-item {
  /* 任务内容独占一行，操作按钮在下方，时间与下次时间再放到按钮下面 */
  flex-direction: column;
  align-items: stretch;
  gap: 8rpx;
}
.schedule-item .todo-text {
  flex: none;
  width: 100%;
}
.schedule-actions {
  justify-content: flex-start;
  gap: 24rpx;
}
.schedule-meta {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.5;
}
.schedule-empty {
  padding: 16rpx 4rpx;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
}
.ref-path {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 0 30rpx 16rpx;
}
.ref-hint {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: var(--surface-3);
}
.ref-count {
  margin-left: auto;
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
}
.ref-list {
  padding: 0 16rpx;
  box-sizing: border-box;
}
.ref-item {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 20rpx 14rpx;
  border-radius: 18rpx;
}
.ref-item:active {
  background: var(--hover);
}
.ref-item.picked {
  background: rgba(152, 183, 158, 0.09);
}
.ref-icon {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  flex-shrink: 0;
}
.ref-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.ref-name {
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref-path-text {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref-tag {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  flex-shrink: 0;
}
.ref-item.picked .ref-tag {
  color: var(--ok);
}
.ref-empty {
  padding: 60rpx 20rpx;
  text-align: center;
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
}
.ref-empty.error {
  color: var(--danger);
}
.ref-foot {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.6;
}
.rename-field {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 88rpx;
  padding: 0 20rpx;
  border-radius: 18rpx;
  background: var(--input-bg);
  box-sizing: border-box;
}
.rename-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
}
.rename-placeholder {
  color: var(--dim);
}
.rename-clear {
  flex: none;
  color: var(--muted);
  font-size: calc(34rpx * var(--font-scale));
  line-height: 1;
  padding: 6rpx 4rpx;
}
.rename-hint,
.rename-error {
  display: block;
  margin-top: 12rpx;
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.rename-hint {
  color: var(--dim);
}
.rename-error {
  color: var(--danger);
}
.rename-actions {
  display: flex;
  gap: 16rpx;
  padding: 2rpx 0 6rpx;
}
.rename-action {
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
.rename-action.primary {
  border: var(--btn-primary-border, 1rpx solid transparent);
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-soft));
  font-weight: 600;
  box-shadow: var(--btn-primary-shadow, none);
}
.rename-action.disabled {
  color: var(--dim);
}
.permission-stack {
  flex-shrink: 0;
  max-height: 46vh;
  overflow-y: auto;
  padding: 0 24rpx 12rpx;
}
.permission-card {
  background: rgba(201, 171, 124, 0.08);
  border-radius: 18rpx;
  padding: 20rpx;
  margin-bottom: 12rpx;
  box-shadow: var(--control-shadow);
}
.permission-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}
.permission-warn {
  color: var(--warn);
  font-size: calc(23rpx * var(--font-scale));
  font-weight: 600;
}
.permission-tool {
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
}
.permission-session {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  margin-left: auto;
}
.permission-summary {
  display: block;
  margin-top: 10rpx;
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-word;
}
.permission-reason {
  display: block;
  margin-top: 8rpx;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
}
.permission-actions {
  display: flex;
  justify-content: flex-end;
  gap: 14rpx;
  margin-top: 16rpx;
}
.pbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: var(--btn-h-sm);
  margin: 0;
  padding: 0 var(--btn-pad-md);
  border: var(--btn-secondary-border, 1rpx solid transparent);
  border-radius: var(--btn-radius-pill);
  font-size: var(--btn-font-sm);
  line-height: 1;
  text-align: center;
}
.pbtn.ghost {
  background: var(--btn-secondary-bg, var(--surface-3));
  color: var(--btn-secondary-fg, var(--text));
}
.pbtn.primary {
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-ink));
  border: var(--btn-primary-border, 1rpx solid transparent);
  box-shadow: var(--btn-primary-shadow, none);
}
.pbtn:active:not([disabled]) {
  transform: scale(var(--btn-press-scale));
}
.todo-panel {
  flex-shrink: 0;
  margin: 0 24rpx 12rpx;
  border-radius: 16rpx;
  background: var(--bg-elevated);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}
.todo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 16rpx 20rpx;
  cursor: pointer;
  user-select: none;
}
.todo-head-main {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}
.todo-title {
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 600;
}
.todo-count {
  min-width: 30rpx;
  padding: 0 10rpx;
  border-radius: 999rpx;
  background: rgba(152, 183, 158, 0.16);
  color: #98b79e;
  font-size: calc(20rpx * var(--font-scale));
  text-align: center;
}
.todo-hint {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.todo-offline {
  flex-shrink: 0;
  padding: 0 10rpx;
  border-radius: 999rpx;
  background: rgba(201, 171, 124, 0.16);
  color: #c9ab7c;
  font-size: calc(19rpx * var(--font-scale));
  line-height: calc(30rpx * var(--font-scale));
}
.todo-head-actions {
  display: flex;
  align-items: center;
  gap: 20rpx;
  flex-shrink: 0;
}
.todo-send-all {
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
}
.todo-chevron,
.queue-chevron {
  display: inline-block;
  flex: 0 0 auto;
  width: 14rpx;
  height: 14rpx;
  margin-left: 4rpx;
  border-right: 2rpx solid var(--dim);
  border-bottom: 2rpx solid var(--dim);
  transform: rotate(-45deg);
  transition: transform 0.16s ease;
}
.todo-chevron.open,
.queue-chevron.open {
  transform: rotate(45deg);
}
.todo-body {
}
.plan-panel .todo-hint {
  max-width: 40vw;
}
.plan-progress {
  background: rgba(176, 165, 192, 0.18);
  color: #b0a5c0;
}
.plan-item {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  padding: 12rpx 20rpx;
}
.plan-item:last-child {
  border-bottom: none;
}
.plan-mark {
  width: 26rpx;
  flex-shrink: 0;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.5;
  text-align: center;
}
.plan-text {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.plan-item.is-done .plan-mark {
  color: #98b79e;
}
.plan-item.is-done .plan-text {
  color: var(--dim);
  text-decoration: line-through;
}
.plan-item.is-active .plan-mark {
  /* 用 CSS 实心圆代替 ◐：字形在不同机型上大小不一，圆点能保证和 ○ 对齐。 */
  width: 22rpx;
  height: 22rpx;
  /* 2 + 22 + 2 = 基类的 26rpx，圆点和上下的 ✓ / ○ 在同一列。 */
  margin: 5rpx 2rpx 0;
  border-radius: 50%;
  background: var(--accent-soft);
  line-height: 0;
  animation: plan-mark-pulse 1.6s ease-in-out infinite;
}
@keyframes plan-mark-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
.plan-item.is-active .plan-text {
  font-weight: 600;
}
.plan-item.is-pending .plan-text {
  color: var(--dim);
}
/* 最终回答下方的本轮计划快照，默认只看一行入口。 */
.turn-plan {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.turn-plan-body {
  display: flex;
  flex-direction: column;
  border-radius: 14rpx;
  background: var(--bg-soft);
  overflow: hidden;
}
.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  padding: 14rpx 20rpx;
}
.todo-item.sent {
  opacity: 0.66;
}
.todo-text {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
  white-space: pre-wrap;
}
.todo-actions {
  display: flex;
  gap: 18rpx;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.todo-action {
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.5;
}
.todo-action.primary {
  font-weight: 600;
}
.todo-action.disabled,
.todo-send-all.disabled {
  color: var(--dim);
  opacity: 1;
}
.todo-edit-input,
.queue-edit-input {
  flex: 1;
  min-width: 0;
  min-height: 62rpx;
  padding: 10rpx 16rpx;
  border-radius: 12rpx;
  background: var(--bg);
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.5;
  box-sizing: border-box;
}
.todo-add-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 14rpx 20rpx;
}
.todo-input {
  flex: 1;
  min-width: 0;
  height: 62rpx;
  padding: 0 16rpx;
  border-radius: 12rpx;
  background: var(--bg);
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
}
.todo-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  height: var(--btn-h-sm);
  padding: 0 var(--btn-pad-sm);
  border: var(--btn-primary-border, 1rpx solid transparent);
  border-radius: var(--btn-radius-sm);
  background: var(--btn-primary-bg, var(--accent));
  color: var(--btn-primary-fg, var(--accent-ink));
  font-size: var(--btn-font-sm);
  line-height: 1;
  text-align: center;
  box-shadow: none;
}
.todo-add-btn::after {
  border: 0;
}
.todo-add-btn[disabled] {
  opacity: 1;
}
.todo-send-all-row {
  display: flex;
  justify-content: flex-end;
  padding: 0 20rpx 14rpx;
}
.todo-sent {
  padding: 10rpx 20rpx 16rpx;
}
.todo-sent-toggle {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
}
.todo-sent-list {
  margin-top: 8rpx;
}
.todo-sent-clear {
  display: block;
  padding: 10rpx 0;
  color: var(--accent-soft);
  font-size: calc(21rpx * var(--font-scale));
  text-align: right;
}
.queue-panel {
  flex-shrink: 0;
  margin: 0 24rpx 12rpx;
  border-radius: 16rpx;
  background: var(--bg-elevated);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}
.queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 20rpx;
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  cursor: pointer;
  user-select: none;
}
.queue-list {
}
.queue-item {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 14rpx 20rpx;
}
.queue-row {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
}
.queue-index {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  width: 28rpx;
  flex-shrink: 0;
  line-height: 1.55;
}
.queue-text {
  flex: 1;
  min-width: 0;
  max-height: 260rpx;
  overflow-y: auto;
}
.queue-text-body {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.queue-actions {
  display: flex;
  gap: 18rpx;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  /* 与上面正文左对齐（序号宽度 28 + 间距 14）。 */
  padding-left: 42rpx;
}
.queue-action {
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.5;
}
.queue-action.primary {
  font-weight: 600;
}
.queue-action.danger {
  color: var(--danger);
}
.queue-action.move {
  padding: 0 8rpx;
  border-radius: 8rpx;
  background: rgba(143, 168, 192, 0.12);
}
.newer-bar {
  flex-shrink: 0;
  margin: 0 24rpx 10rpx;
  padding: 14rpx;
  border-radius: 999rpx;
  background: rgba(143, 168, 192, 0.12);
  text-align: center;
}
.newer-bar-text {
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
}
.composer {
  flex-shrink: 0;
  padding: 12rpx 24rpx calc(20rpx + env(safe-area-inset-bottom));
  background: var(--bg);
}
.mode-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
  padding: 6rpx 0 8rpx;
}
.mode-chip {
  font-size: calc(22rpx * var(--font-scale));
  color: var(--muted);
  padding: 6rpx 18rpx;
  border-radius: 30rpx;
  background: var(--bg-soft);
  flex-shrink: 0;
}
.mode-chip.active {
  color: var(--accent-soft);
  background: rgba(143, 168, 192, 0.18);
}
.mode-select {
  display: flex;
  align-items: center;
  gap: 10rpx;
  box-sizing: border-box;
  height: 64rpx;
  min-height: 64rpx;
  padding: 0 24rpx;
  border-radius: 30rpx;
  background: var(--bg-soft);
}
.mode-select-label {
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1;
  color: var(--text);
}
.mode-select-caret {
  font-size: calc(20rpx * var(--font-scale));
  color: var(--muted);
}
.input-row {
  display: flex;
  align-items: flex-end;
  gap: 14rpx;
}
.composer-input {
  flex: 1;
  min-height: 80rpx;
  max-height: 420rpx;
  padding: 18rpx 20rpx;
  background: var(--surface);
  border-radius: 18rpx;
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
  line-height: 1.5;
  box-sizing: border-box;
  overflow-y: auto;
  box-shadow: var(--input-shadow);
}
.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  margin: 0;
  width: 128rpx;
  height: var(--btn-h-lg);
  padding: 0;
  border: var(--btn-primary-border, 1rpx solid transparent);
  border-radius: var(--btn-radius);
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-ink));
  font-size: var(--btn-font-lg);
  font-weight: 600;
  line-height: 1;
  text-align: center;
  flex-shrink: 0;
  box-shadow: var(--btn-primary-shadow, 0 10rpx 24rpx var(--accent-glow));
}
.send-btn[disabled] {
  background: var(--surface-3);
  color: var(--dim);
  box-shadow: none;
}
.ocr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  margin: 0;
  width: 104rpx;
  height: var(--btn-h-lg);
  padding: 0;
  border: var(--btn-secondary-border, 1rpx solid transparent);
  border-radius: var(--btn-radius);
  background: var(--btn-secondary-bg, var(--bg-soft));
  color: var(--btn-secondary-fg, var(--muted));
  font-size: var(--btn-font-sm);
  line-height: 1;
  text-align: center;
  flex-shrink: 0;
  box-shadow: none;
}
.ocr-btn[disabled] {
  background: var(--surface-3);
  color: var(--dim);
  box-shadow: none;
}
/* 新会话欢迎页的快捷指令：点一下填进输入框。 */
.quick-prompts {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  padding: 0 28rpx 10rpx;
}
.quick-prompt {
  max-width: 100%;
  padding: 12rpx 20rpx;
  border-radius: 16rpx;
  background: var(--surface);
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.45;
  box-shadow: var(--control-shadow);
}
.quick-prompt:active {
  background: var(--surface-3);
}
/* 失败消息下的重试入口：小号、低干扰，但明确可点。 */
.system-retry {
  display: inline-flex;
  align-items: center;
  margin-top: 12rpx;
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: var(--surface-3);
  align-self: flex-start;
}
.system-retry-text {
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.2;
}
/* 评审报告卡片：折叠时只占一行，展开后看分数与发现。 */
.review-card {
  flex: none;
  margin: 0 28rpx 8rpx;
  border-radius: 20rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
  overflow: hidden;
}
.review-head {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 18rpx 22rpx;
}
.review-badge {
  flex: none;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.3;
  background: var(--surface-3);
  color: var(--muted);
}
.review-badge.pass {
  background: rgba(152, 183, 158, 0.16);
  color: var(--ok);
}
.review-badge.blocked {
  background: rgba(210, 106, 106, 0.14);
  color: var(--danger);
}
.review-badge.needs-work {
  background: rgba(213, 176, 110, 0.16);
  color: var(--warn, #d5b06e);
}
.review-head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.review-title {
  color: var(--text-strong);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
}
.review-meta {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-chevron {
  width: 16rpx;
  height: 16rpx;
  margin-right: 4rpx;
  border-right: 2rpx solid var(--muted);
  border-bottom: 2rpx solid var(--muted);
  transform: rotate(45deg) translateY(-3rpx);
  transition: transform 0.15s ease;
}
.review-chevron.open {
  transform: rotate(225deg) translateY(-3rpx);
}
.review-body {
  padding: 0 22rpx 20rpx;
  border-top: 1rpx solid var(--line);
}
.review-summary {
  display: block;
  margin-top: 16rpx;
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.65;
}
.review-scores {
  display: flex;
  gap: 10rpx;
  margin-top: 16rpx;
}
.review-score {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding: 10rpx 0;
  border-radius: 12rpx;
  background: var(--bg-soft);
  text-align: center;
}
.review-score-label {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.review-score-value {
  color: var(--text-strong);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 600;
}
.review-finding {
  margin-top: 16rpx;
  padding-top: 14rpx;
  border-top: 1rpx solid var(--line);
}
.review-finding-head {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
}
.review-severity {
  flex: none;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  background: var(--surface-3);
  color: var(--muted);
  font-size: calc(19rpx * var(--font-scale));
  line-height: 1.4;
}
.review-severity.high {
  background: rgba(210, 106, 106, 0.14);
  color: var(--danger);
}
.review-severity.medium {
  background: rgba(213, 176, 110, 0.16);
  color: var(--warn, #d5b06e);
}
.review-finding-title {
  flex: 1;
  min-width: 0;
  color: var(--text-strong);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 600;
  line-height: 1.5;
}
.review-finding-cause,
.review-finding-text {
  display: block;
  margin-top: 8rpx;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.review-empty {
  display: block;
  margin-top: 14rpx;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
}
/* 回退点 / 变更 / 记忆三个弹层共用的列表骨架。 */
.tool-sheet-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 0 30rpx 14rpx;
}
.tool-sheet-link {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  padding: 8rpx 4rpx;
}
.tool-sheet-action {
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-soft));
  font-size: calc(23rpx * var(--font-scale));
  font-weight: 600;
}
.tool-sheet-action.disabled {
  opacity: 0.45;
  pointer-events: none;
}
.tool-sheet-hint {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
}
.tool-sheet-scroll {
  flex: 1;
  min-height: 0;
  height: 58vh;
  padding: 0 30rpx;
  box-sizing: border-box;
}
.tool-sheet-empty {
  padding: 48rpx 10rpx;
  text-align: center;
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.7;
}
.tool-sheet-empty.error {
  color: var(--danger);
}
.sheet-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 0;
  border-bottom: 1rpx solid var(--line);
}
.sheet-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.sheet-row-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
}
.sheet-row-label {
  color: var(--text-strong);
  font-size: calc(25rpx * var(--font-scale));
  font-weight: 600;
  line-height: 1.4;
}
.sheet-row-badge {
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  background: rgba(143, 168, 192, 0.14);
  color: var(--accent-soft);
  font-size: calc(19rpx * var(--font-scale));
}
.sheet-row-meta {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.45;
  word-break: break-all;
}
.sheet-row-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.sheet-row-action {
  padding: 8rpx 16rpx;
  border-radius: 12rpx;
  background: var(--surface-3);
  color: var(--text);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.3;
}
.sheet-row-action.primary {
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-soft));
  font-weight: 600;
}
.sheet-row-action.danger {
  color: var(--danger);
}
.change-stat {
  font-size: calc(20rpx * var(--font-scale));
  font-family: var(--mono-font, monospace);
}
.change-stat.add {
  color: var(--ok);
}
.change-stat.del {
  color: var(--danger);
}
.change-status {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  background: var(--bg-soft);
}
.change-status.added {
  color: var(--ok);
}
.change-status.deleted,
.change-status.unreadable {
  color: var(--danger);
}
.change-block {
  border-bottom: 1rpx solid var(--line);
}
.change-block .sheet-row {
  border-bottom: 0;
}
.change-diff {
  margin: 0 0 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background: var(--bg-soft);
  max-height: 360rpx;
  overflow-y: auto;
}
.change-diff-text {
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  font-family: var(--mono-font, monospace);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}
.memory-add {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 12rpx;
  padding: 0 30rpx 16rpx;
}
.memory-input {
  flex: 1;
  min-width: 0;
  min-height: 76rpx;
  max-height: 200rpx;
  padding: 16rpx 18rpx;
  border-radius: 16rpx;
  background: var(--input-bg);
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.5;
  box-sizing: border-box;
}
.memory-add-btn {
  flex: none;
  height: 64rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-soft));
  font-size: calc(23rpx * var(--font-scale));
  font-weight: 600;
  line-height: calc(64rpx * var(--font-scale));
  text-align: center;
}
.memory-add-btn.disabled {
  opacity: 0.45;
  pointer-events: none;
}
.memory-text {
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.55;
  word-break: break-word;
}
.edit-field {
  height: auto;
  min-height: 132rpx;
  align-items: stretch;
  padding: 16rpx 20rpx;
}
.edit-message-input {
  flex: 1;
  width: 100%;
  min-height: 100rpx;
  max-height: 360rpx;
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  line-height: 1.55;
}
</style>
