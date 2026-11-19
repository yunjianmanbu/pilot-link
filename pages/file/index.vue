<template>
  <view class="page file-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="topbar">
      <view class="back" @click="back"><view class="back-arrow"></view></view>
      <view class="titles">
        <text class="title">{{ name || t('文件') }}</text>
        <text class="subtitle">{{ subtitle }}</text>
      </view>
      <text v-if="canReload" class="refresh" @click="reload">{{ t('重新读取') }}</text>
    </view>

    <scroll-view class="body" scroll-y>
      <view v-if="busy" class="card state-card">
        <text class="state-text">{{ loadingText }}</text>
      </view>

      <view v-if="error" class="card error-card">
        <text class="error-text">{{ error }}</text>
        <text class="error-action" @click="reload">{{ t('重试') }}</text>
      </view>

      <view v-if="isMedia" class="card media-card">
        <view class="html-head">
          <text class="html-title">{{ isVideo ? t('视频') : t('音乐') }}</text>
          <text class="html-badge">{{ badge }}</text>
        </view>
        <video
          v-if="isVideo && mediaUrl"
          class="media-video"
          :src="mediaUrl"
          controls
          object-fit="contain"
          :show-fullscreen-btn="true"
          :enable-progress-gesture="true"
          @error="onMediaError"
        />
        <view v-if="isAudio" class="audio-row">
          <text class="audio-toggle" @click="toggleAudio">{{ audioPlaying ? '❚❚' : '▶' }}</text>
          <view class="audio-info">
            <text class="audio-name">{{ name }}</text>
            <text class="audio-meta">{{ audioMeta }}</text>
          </view>
        </view>
        <text v-if="busy" class="state-text">{{ loadingText }}</text>
        <text v-if="mediaHint" class="html-hint">{{ mediaHint }}</text>
        <text v-if="cacheHint" class="html-hint">{{ cacheHint }}</text>
        <view class="action-row">
          <button class="file-action primary" :disabled="busy || !mediaLocalPath" @click="loadMedia(true)">
            {{ busy ? t('正在读取…') : t('重新加载') }}
          </button>
          <button
            class="file-action ghost"
            :disabled="busy || !mediaLocalPath"
            @click="openMediaExternally"
          >
            {{ t('用系统播放器打开') }}
          </button>
        </view>
      </view>

      <view v-if="textual" class="card text-card">
        <rich-text v-if="kind === 'markdown' && nodes.length" :nodes="nodes" />
        <text v-else-if="text" class="plain" user-select>{{ text }}</text>
        <text v-else-if="!busy && !error" class="state-text">{{ t('文件内容为空') }}</text>
        <text v-if="truncated" class="truncated">
          {{ t('文件较大，这里只显示前面部分。请回到电脑端查看完整内容。') }}
        </text>
      </view>

      <view v-if="isHtml" class="card html-card">
        <view class="html-head">
          <text class="html-title">{{ t('HTML 页面') }}</text>
          <text class="html-badge">HTML</text>
        </view>
        <text class="html-hint">
          {{ t('预览会按网页样式渲染；脚本、表单和跨域请求已禁用，外部图片和样式需要联网。') }}
        </text>
        <view class="action-row">
          <button
            class="file-action primary"
            :disabled="opening || !text"
            @click="previewHtml"
          >
            {{ opening ? t('正在打开…') : t('预览效果') }}
          </button>
          <button class="file-action ghost" :disabled="opening" @click="openInBrowser">
            {{ t('用浏览器打开') }}
          </button>
        </view>
        <text class="source-toggle" @click="toggleSource">
          {{ showSource ? t('隐藏源码') : t('查看源码') }}
        </text>
        <text v-if="showSource && text" class="plain source" user-select>{{ text }}</text>
        <text v-if="truncated" class="truncated">
          {{ t('文件较大，这里只显示前面部分。请回到电脑端查看完整内容。') }}
        </text>
      </view>

      <view v-if="isImage" class="card image-card">
        <image
          v-if="imageUrl"
          class="preview-image"
          :src="imageUrl"
          mode="widthFix"
          @click="zoomImage"
        />
        <text v-else-if="!busy && !error" class="state-text">{{ t('图片内容为空') }}</text>
      </view>

      <view v-if="isDocument" class="card doc-card">
        <view class="doc-badge">{{ badge }}</view>
        <text class="doc-name">{{ name }}</text>
        <text class="doc-meta">{{ kindLabel }}{{ size ? ` · ${sizeLabel}` : '' }}</text>
        <text class="doc-hint">
          {{ t('Word / PPT / Excel / PDF 会先下载到手机，再用系统里能打开它的应用查看；手机上需要安装对应的查看器。') }}
        </text>
        <view class="action-row">
          <button class="file-action primary" :disabled="opening" @click="openDocument()">
            {{ opening ? t('正在下载…') : cachedDoc ? t('打开缓存') : t('下载并打开') }}
          </button>
          <button
            v-if="cachedDoc"
            class="file-action ghost"
            :disabled="opening"
            @click="openDocument(true)"
          >
            {{ t('重新下载') }}
          </button>
        </view>
        <text v-if="cacheHint" class="doc-hint">{{ cacheHint }}</text>
        <text v-if="opening && progress" class="doc-progress">{{ progress }}%</text>
      </view>

      <view v-if="isBinary" class="card doc-card">
        <view class="doc-badge">{{ badge }}</view>
        <text class="doc-name">{{ name }}</text>
        <text class="doc-meta">{{ kindLabel }}{{ size ? ` · ${sizeLabel}` : '' }}</text>
        <text class="doc-hint">
          {{ t('该格式暂不支持在手机上预览。请在电脑端打开，或回到会话里让 Pilot 转成文本/图片后再查看。') }}
        </text>
      </view>

      <view class="card path-card">
        <view class="path-head">
          <text class="path-label">{{ t('工作区文件') }}</text>
          <text class="path-copy" @click="copyPath">{{ t('复制') }}</text>
        </view>
        <text class="path-value" user-select>{{ fullPath }}</text>
        <text v-if="language" class="path-meta">{{ language }}</text>
      </view>

      <view class="bottom-space"></view>
    </scroll-view>
    <app-dialog-host />
  </view>
</template>

<script>
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import {
  fileActionLabel,
  fileBadge,
  fileKind,
  formatFileSize,
  htmlPreviewDocument,
  imageDataUrl,
  IMAGE_PREVIEW_LIMIT,
  isHtmlName,
  openHtmlPreview,
  openLocalFile,
  readRemoteBytes,
  readRemoteText,
  safeFileName,
  TEXT_PREVIEW_LIMIT,
  writeLocalText
} from '../../lib/files.js'
import {
  fileCacheDaysLeft,
  findFileCacheEntry,
  openCachedDownload
} from '../../lib/file-cache.js'
import { renderMarkdown } from '../../lib/markdown.js'
import { mediaPlayableOnDevice } from '../../lib/media.js'
import { init, request, store } from '../../store/index.js'
import { LONG_TIMEOUT } from '../../lib/client.js'
import { t } from '../../lib/i18n.js'

function decode(value) {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return String(value)
  }
}

/** 整段媒体要走完分块传输，比普通读文件给更多时间。 */
const MEDIA_DOWNLOAD_TIMEOUT = 5 * 60 * 1000

function clock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`
}

export default {
  components: { AppDialogHost },
  data() {
    return {
      path: '',
      workspacePath: '',
      name: '',
      action: '',
      size: 0,
      language: '',
      kind: 'binary',
      text: '',
      nodes: [],
      imageUrl: '',
      truncated: false,
      busy: false,
      error: '',
      opening: false,
      progress: 0,
      showSource: false,
      mediaUrl: '',
      mediaLocalPath: '',
      mediaHint: '',
      audioPlaying: false,
      audioStatus: '',
      cachedDoc: false,
      cacheHint: ''
    }
  },
  computed: {
    store() {
      return store
    },
    isHtml() {
      return isHtmlName(this.name)
    },
    isImage() {
      return this.kind === 'image'
    },
    isDocument() {
      return this.kind === 'document'
    },
    isBinary() {
      return this.kind === 'binary'
    },
    isVideo() {
      return this.kind === 'video'
    },
    isAudio() {
      return this.kind === 'audio'
    },
    isMedia() {
      return this.isVideo || this.isAudio
    },
    audioMeta() {
      const parts = []
      if (this.audioStatus) parts.push(this.audioStatus)
      if (this.size) parts.push(this.sizeLabel)
      return parts.join(' · ')
    },
    textual() {
      return !this.isHtml && (this.kind === 'text' || this.kind === 'markdown')
    },
    canReload() {
      return this.textual || this.isHtml || this.isImage
    },
    loadingText() {
      if (this.isImage) return t("正在读取图片…")
      if (this.isHtml) return t("正在读取 HTML…")
      if (this.isVideo) return t("正在准备视频…")
      if (this.isAudio) return t("正在准备音频…")
      return t("正在读取文件…")
    },
    badge() {
      return fileBadge(this.name)
    },
    sizeLabel() {
      return formatFileSize(this.size)
    },
    kindLabel() {
      if (this.isHtml) return 'HTML'
      if (this.kind === 'markdown') return 'Markdown'
      if (this.kind === 'text') return t("文本")
      if (this.kind === 'image') return t("图片")
      if (this.kind === 'video') return t("视频")
      if (this.kind === 'audio') return t("音乐")
      if (this.kind === 'document') return fileBadge(this.name)
      return t("文件")
    },
    subtitle() {
      const parts = []
      if (this.action) parts.push(fileActionLabel(this.action))
      parts.push(this.kindLabel)
      if (this.size) parts.push(this.sizeLabel)
      return parts.join(' · ')
    },
    fullPath() {
      if (!this.workspacePath) return this.path
      return `${this.workspacePath.replace(/[\\/]+$/, '')}/${this.path}`.replace(/\\/g, '/')
    }
  },
  onLoad(options) {
    init()
    this.path = decode(options?.path)
    this.workspacePath = decode(options?.workspace)
    this.name = decode(options?.name) || this.path.split(/[\\/]/).pop() || ''
    this.action = decode(options?.action)
    this.kind = fileKind(this.name)
    if (!this.path) {
      this.error = t("缺少文件路径，请返回文件列表重新打开")
      return
    }
    if (!this.workspacePath) {
      const session = store.currentSession
      this.workspacePath = session?.cwd || session?.workspacePath || ''
    }
    if (!this.workspacePath) {
      this.error = t("缺少工作区信息，请返回会话后重新打开文件")
      return
    }
    if (this.isHtml) void this.loadHtml()
    else if (this.isImage) void this.loadImage()
    else if (this.isMedia) void this.loadMedia()
    else if (this.textual) void this.loadText()
    else if (this.isDocument) this.refreshCacheHint()
  },
  onUnload() {
    this.stopAudio()
  },
  methods: {
    friendlyError(error, fallback) {
      const message = String(error?.message || fallback)
      if (
        message.includes(t("手机端不支持")) ||
        message.includes(t("电脑返回的文件数据不正确"))
      ) {
        return t("电脑端版本过低，请先在电脑上更新 Pilot")
      }
      if (/too large/i.test(message)) return t("文件超过 2 MB，无法在手机上预览")
      if (/Binary files/i.test(message)) return t("这是二进制文件，暂不支持在手机上预览")
      return message
    },
    /**
     * 缓存提示：手机上留 7 天，再看一次从这次查看重新计时。
     * 只查索引，不碰文件系统，打开页面就能直接看到状态。
     */
    refreshCacheHint() {
      const entry = findFileCacheEntry(this.workspacePath, this.path)
      this.cachedDoc = Boolean(entry)
      this.cacheHint = entry
        ? t('已缓存到本机，{v1} 天后自动清理；再看一次会重新计时', {
            v1: fileCacheDaysLeft(entry)
          })
        : ''
    },
    /**
     * 手机和电脑之间只有中继连接，播放器拿不到远程地址，所以先把整个媒体
     * 文件分块取回 App 私有目录，再把本地路径交给播放器。
     * 已经缓存过的直接复用本地文件；force 为 true 时强制重下。
     */
    async loadMedia(force = false) {
      if (this.busy) return
      this.busy = true
      this.error = ''
      this.mediaHint = ''
      this.progress = 0
      try {
        const result = await openCachedDownload(
          request,
          { path: this.path, name: this.name, size: this.size },
          {
            workspacePath: this.workspacePath,
            timeout: MEDIA_DOWNLOAD_TIMEOUT,
            force,
            onProgress: (value) => {
              const received = Number(value?.received) || 0
              const total = Number(value?.total) || 0
              this.progress = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
            }
          }
        )
        // App 端的 video / innerAudioContext 只认本地文件路径，不认 file:// URL。
        this.mediaLocalPath = result.filePath
        this.mediaUrl = result.filePath
        if (result.size) this.size = Number(result.size) || this.size
        this.refreshCacheHint()
        if (!mediaPlayableOnDevice(this.name)) {
          this.mediaHint = t("这个格式系统播放器可能不支持，建议点「用系统播放器打开」或回到电脑端查看。")
        } else if (this.isAudio) {
          this.mediaHint = t("点左边的播放键开始，退出页面会自动停止。")
        }
      } catch (error) {
        this.error = this.friendlyError(error, t("下载媒体文件失败"))
      } finally {
        this.busy = false
      }
    },
    onMediaError() {
      this.error = t("这个格式当前无法在应用内播放，可以用系统播放器打开。")
    },
    async openMediaExternally() {
      if (!this.mediaLocalPath) return
      this.stopAudio()
      try {
        await openLocalFile(this.mediaLocalPath, this.name)
      } catch (error) {
        this.error = this.friendlyError(error, t("没有可以播放该文件的应用"))
      }
    },
    stopAudio() {
      const context = this.audioContext
      this.audioContext = null
      this.audioPlaying = false
      this.audioStatus = ''
      if (!context) return
      try {
        context.stop()
        context.destroy()
      } catch {
        // 已经销毁的上下文重复销毁会报错，忽略即可
      }
    },
    toggleAudio() {
      if (!this.mediaUrl) return
      if (!this.audioContext) {
        const context = uni.createInnerAudioContext()
        context.src = this.mediaUrl
        context.onPlay(() => {
          this.audioPlaying = true
        })
        context.onPause(() => {
          this.audioPlaying = false
        })
        context.onStop(() => {
          this.audioPlaying = false
        })
        context.onEnded(() => {
          this.audioPlaying = false
          this.audioStatus = t("播放完毕")
        })
        context.onTimeUpdate(() => {
          const current = Math.round(Number(context.currentTime) || 0)
          const total = Math.round(Number(context.duration) || 0)
          if (total > 0) this.audioStatus = `${clock(current)} / ${clock(total)}`
        })
        context.onError(() => {
          this.audioPlaying = false
          this.audioStatus = ''
          this.error = t("这个格式当前无法在应用内播放，可以用系统播放器打开。")
        })
        this.audioContext = context
      }
      if (this.audioPlaying) this.audioContext.pause()
      else this.audioContext.play()
    },
    async loadText() {
      if (this.busy) return
      this.busy = true
      this.error = ''
      this.truncated = false
      try {
        const result = await request(
          'files.read',
          { workspacePath: this.workspacePath, file: this.path },
          LONG_TIMEOUT
        )
        this.text = String(result?.content || '')
        this.truncated = Boolean(result?.truncated)
        if (result?.size) this.size = Number(result.size) || 0
        if (result?.language) this.language = String(result.language)
        this.nodes = this.kind === 'markdown' ? renderMarkdown(this.text) : []
      } catch (error) {
        this.error = this.friendlyError(error, t("读取文件失败"))
      } finally {
        this.busy = false
      }
    },
    async loadHtml() {
      if (this.busy) return
      this.busy = true
      this.error = ''
      this.truncated = false
      try {
        const result = await readRemoteText(request, {
          workspacePath: this.workspacePath,
          path: this.path,
          maxBytes: TEXT_PREVIEW_LIMIT,
          timeout: LONG_TIMEOUT
        })
        this.text = result.text
        this.size = result.size || this.size
        this.truncated = result.truncated
        this.language = 'html'
        this.nodes = []
      } catch (error) {
        this.error = this.friendlyError(error, t("读取文件失败"))
      } finally {
        this.busy = false
      }
    },
    async loadImage() {
      if (this.busy) return
      this.busy = true
      this.error = ''
      try {
        const result = await readRemoteBytes(request, {
          workspacePath: this.workspacePath,
          path: this.path,
          maxBytes: IMAGE_PREVIEW_LIMIT,
          timeout: LONG_TIMEOUT
        })
        if (result.truncated) {
          throw new Error(t("图片超过 12 MB，无法在手机内预览"))
        }
        this.imageUrl = imageDataUrl(this.name, result.bytes)
        this.size = result.size || this.size
      } catch (error) {
        this.error = this.friendlyError(error, t("读取图片失败"))
      } finally {
        this.busy = false
      }
    },
    async previewHtml() {
      if (this.opening || !this.text) return
      this.opening = true
      this.error = ''
      try {
        const document = htmlPreviewDocument(this.text, this.name)
        const fileName = `preview-${safeFileName(this.name || 'page.html')}`
        const written = await writeLocalText(fileName, document)
        await openHtmlPreview(written.filePath, this.name)
      } catch (error) {
        this.error = this.friendlyError(error, t("无法预览 HTML"))
      } finally {
        this.opening = false
      }
    },
    openDocument(force = false) {
      return this.downloadAndOpen(t("打开文件失败"), force)
    },
    openInBrowser() {
      return this.downloadAndOpen(t("打开文件失败"))
    },
    async downloadAndOpen(fallback, force = false) {
      if (this.opening) return
      this.opening = true
      this.progress = 0
      this.error = ''
      try {
        const result = await openCachedDownload(
          request,
          { path: this.path, name: this.name, size: this.size },
          {
            workspacePath: this.workspacePath,
            timeout: LONG_TIMEOUT,
            force,
            onProgress: ({ received, total }) => {
              this.progress =
                total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0
            }
          }
        )
        this.size = result.size || this.size
        this.refreshCacheHint()
        await openLocalFile(result.filePath, result.name)
      } catch (error) {
        this.error = this.friendlyError(error, fallback)
      } finally {
        this.opening = false
        this.progress = 0
      }
    },
    toggleSource() {
      this.showSource = !this.showSource
    },
    zoomImage() {
      if (!this.imageUrl) return
      try {
        uni.previewImage({ urls: [this.imageUrl] })
      } catch {
        // ignore
      }
    },
    copyPath() {
      if (!this.fullPath) return
      try {
        uni.setClipboardData({
          data: this.fullPath,
          success: () => uni.showToast({ title: t("路径已复制"), icon: 'none' })
        })
      } catch {
        // ignore
      }
    },
    reload() {
      if (this.busy || this.opening) return
      this.error = ''
      if (this.isHtml) void this.loadHtml()
      else if (this.isImage) void this.loadImage()
      else if (this.textual) void this.loadText()
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
.file-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: calc(var(--status-bar-height) + 20rpx) 28rpx 26rpx;
  flex-shrink: 0;
}
.back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  /* 标题下面是副标题，箭头要对齐第一行而不是整个两行块。
     标题行高 32rpx × 1.5 = 48rpx，图标框上移半个差值。 */
  align-self: flex-start;
  margin-top: -4rpx;
  margin-right: 2rpx;
  color: var(--accent-soft);
  flex-shrink: 0;
}
.titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.title {
  color: var(--text-strong);
  font-size: calc(32rpx * var(--font-scale));
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subtitle {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
}
.refresh {
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  padding: 10rpx 0 10rpx 16rpx;
  flex-shrink: 0;
}
.body {
  flex: 1;
  min-height: 0;
  padding: 0 28rpx;
  box-sizing: border-box;
}
.card {
  background: var(--surface);
  border-radius: 18rpx;
  padding: 24rpx;
  margin-bottom: 18rpx;
}
.state-card {
  display: flex;
  justify-content: center;
}
.error-card {
  background: rgba(201, 146, 141, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}
.error-text {
  color: var(--danger);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.55;
  flex: 1;
  word-break: break-word;
}
.error-action {
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  flex-shrink: 0;
}
.text-card .plain {
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.62;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
}
.state-text {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
}
.truncated {
  display: block;
  margin-top: 18rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  background: var(--bg-soft);
  color: var(--warn);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.html-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.html-title {
  color: var(--text-strong);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 600;
}
.html-badge {
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
  font-weight: 700;
  letter-spacing: 1rpx;
}
.html-hint {
  display: block;
  margin-top: 12rpx;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.media-video {
  width: 100%;
  height: 400rpx;
  margin-top: 16rpx;
  border-radius: 12rpx;
  background: #000000;
}
.audio-row {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-top: 16rpx;
  padding: 20rpx;
  border-radius: 14rpx;
  background: var(--bg-soft);
}
.audio-toggle {
  width: 84rpx;
  height: 84rpx;
  border-radius: 42rpx;
  background: var(--accent);
  color: #ffffff;
  font-size: calc(30rpx * var(--font-scale));
  line-height: calc(84rpx * var(--font-scale));
  text-align: center;
}
.audio-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.audio-name {
  color: var(--text-strong);
  font-size: calc(25rpx * var(--font-scale));
  font-weight: 600;
  word-break: break-all;
}
.audio-meta {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
}
.action-row {
  display: flex;
  gap: 14rpx;
  margin-top: 20rpx;
}
.file-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  box-sizing: border-box;
  margin: 0;
  padding: 0 var(--btn-pad-sm);
  height: var(--btn-h-md);
  border-radius: var(--btn-radius-sm);
  font-size: var(--btn-font-md);
  font-weight: 600;
  line-height: 1;
  text-align: center;
  border: none;
}
.file-action::after {
  border: none;
}
.file-action.primary {
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-ink));
  border: var(--btn-primary-border, 1rpx solid transparent);
  box-shadow: var(--btn-primary-shadow, none);
}
.file-action.ghost {
  background: var(--btn-secondary-bg, var(--surface-2));
  color: var(--btn-secondary-fg, var(--text));
  border: var(--btn-secondary-border, 1rpx solid transparent);
}
.file-action[disabled] {
  opacity: 0.55;
}
.source-toggle {
  display: block;
  margin-top: 20rpx;
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
}
.html-card .source {
  display: block;
  margin-top: 16rpx;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.62;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
}
.image-card {
  padding: 14rpx;
}
.preview-image {
  width: 100%;
  display: block;
  border-radius: 10rpx;
}
.doc-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  padding: 40rpx 28rpx;
  text-align: center;
}
.doc-badge {
  width: 120rpx;
  height: 120rpx;
  border-radius: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 700;
  background: rgba(143, 168, 192, 0.18);
  color: var(--accent-soft);
  margin-bottom: 8rpx;
}
.doc-name {
  color: var(--text-strong);
  font-size: calc(29rpx * var(--font-scale));
  font-weight: 600;
  word-break: break-all;
}
.doc-meta {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
}
.doc-hint {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
  max-width: 560rpx;
}
.doc-progress {
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  font-variant-numeric: tabular-nums;
}
.path-card {
  padding: 20rpx 24rpx;
}
.path-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.path-label {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
}
.path-copy {
  color: var(--accent-soft);
  font-size: calc(21rpx * var(--font-scale));
}
.path-value {
  display: block;
  margin-top: 10rpx;
  color: var(--text);
  font-size: calc(21rpx * var(--font-scale));
  word-break: break-all;
  font-family: monospace;
}
.path-meta {
  display: block;
  margin-top: 8rpx;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.bottom-space {
  height: calc(40rpx + env(safe-area-inset-bottom));
}
</style>
