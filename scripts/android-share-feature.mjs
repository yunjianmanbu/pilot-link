#!/usr/bin/env node
/**
 * 给离线打包工程注册 Share 原生模块。
 *
 * 现象：手机上点「分享」弹出「打包时未加入 share 模块」。
 * 根因：`lib.5plus.base-release.aar` 里有 `io.dcloud.share.ShareFeatureImpl`（APK 的
 * classes.dex 里也确实存在），但 `assets/data/dcloud_properties.xml` 的 `<features>`
 * 没有 `<feature name="Share" .../>` 这一行，5+ 运行时的 feature 注册表查不到，于是
 * `plus.share` 直接抛错。改 Java / 换基座都没用，补这一行即可。
 *
 * 用法：node pilot/scripts/android-share-feature.mjs [dcloud_properties.xml 路径]
 * 幂等：已经有 Share 声明时不改动文件。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 只注册 feature 本身：sendWithSystem 走系统 Intent，不需要微信/QQ 等第三方 SDK 模块。 */
export const SHARE_FEATURE_ENTRY = '\t\t<feature name="Share" value="io.dcloud.share.ShareFeatureImpl"/>'

export const DEFAULT_PROPERTIES = path.join(
  '.build',
  'pilot-android',
  'simpleDemo',
  'src',
  'main',
  'assets',
  'data',
  'dcloud_properties.xml'
)

/**
 * 在 <features> 开头插入 Share 声明。
 * 返回 `{ xml, changed }`，纯函数，方便单测。
 */
export function ensureShareFeature(xml) {
  const source = String(xml ?? '')
  if (/<feature\s+name="Share"/.test(source)) return { xml: source, changed: false }
  const opened = source.match(/<features>\s*\r?\n/)
  if (!opened) throw new Error('dcloud_properties.xml 里找不到 <features> 容器，无法插入 Share 声明')
  const at = opened.index + opened[0].length
  return {
    xml: `${source.slice(0, at)}${SHARE_FEATURE_ENTRY}\n${source.slice(at)}`,
    changed: true
  }
}

/** 读写落地：存在才写，写之前留一份 .bak 方便回退。 */
export function patchPropertiesFile(file, { backup = true } = {}) {
  const before = fs.readFileSync(file, 'utf8')
  const { xml, changed } = ensureShareFeature(before)
  if (!changed) return { changed: false, file }
  if (backup) fs.writeFileSync(`${file}.bak`, before)
  fs.writeFileSync(file, xml)
  return { changed: true, file }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('android-share-feature.mjs')
if (invokedDirectly) {
  const target = process.argv[2] || DEFAULT_PROPERTIES
  try {
    const result = patchPropertiesFile(target)
    console.log(`${result.changed ? 'SHARE_FEATURE=added' : 'SHARE_FEATURE=present'} ${target}`)
  } catch (error) {
    console.error(`SHARE_FEATURE=failed ${target}: ${error && error.message}`)
    process.exit(1)
  }
}
