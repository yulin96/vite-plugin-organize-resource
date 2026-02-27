import chalk from 'chalk'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { normalizePath, Plugin } from 'vite'

const DEFAULT_RESOURCE_CONFIG = {
  IMG_RESOURCES: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'],
} satisfies Record<string, string[]>

const RESOURCE_SCRIPT_ID = 'vite-plugin-organize-resource'
const RESOURCE_SCRIPT_PATTERN = new RegExp(
  `[ \\t]*<script id="${RESOURCE_SCRIPT_ID}">[\\s\\S]*?<\\/script>\\r?\\n?`,
)

type ResourceConfig = Record<string, string | string[]>

interface ExtensionRule {
  key: string
  extensions: Set<string>
}

export interface VitePluginOrganizeResourceOption {
  config?: ResourceConfig
  /** 是否输出调试信息 */
  verbose?: boolean
}

const directoryExists = (dirPath: string): boolean => {
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

const ensureTrailingSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`)

const isAbsoluteUrl = (value: string): boolean => /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)

const normalizeExtension = (value: string): string | null => {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  return normalized.startsWith('.') ? normalized : `.${normalized}`
}

const encodePathSegment = (segment: string): string => {
  try {
    return encodeURIComponent(decodeURIComponent(segment))
  } catch {
    return encodeURIComponent(segment)
  }
}

const encodePathSegments = (value: string): string =>
  value
    .split('/')
    .map((segment) => (segment ? encodePathSegment(segment) : segment))
    .join('/')

const toSingleQuotedJsString = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const createExtensionRules = (config: ResourceConfig): ExtensionRule[] => {
  const rules: ExtensionRule[] = []

  for (const [key, extensions] of Object.entries(config)) {
    const extList = (Array.isArray(extensions) ? extensions : [extensions])
      .map(normalizeExtension)
      .filter((ext): ext is string => Boolean(ext))

    if (extList.length > 0) {
      rules.push({ key, extensions: new Set(extList) })
    }
  }

  return rules
}

const buildResourceUrl = (base: string, relativeFilePath: string): string => {
  const normalizedRelativePath = normalizePath(relativeFilePath).replace(/^\/+/, '')
  const encodedRelativePath = encodePathSegments(normalizedRelativePath)

  if (isAbsoluteUrl(base)) {
    try {
      return new URL(encodedRelativePath, ensureTrailingSlash(base)).toString()
    } catch {
      // 无法解析时回退到路径拼接
    }
  }

  const normalizedBase = normalizePath(base || '/')
  return normalizePath(`${ensureTrailingSlash(normalizedBase)}${encodedRelativePath}`).replace(/\/{2,}/g, '/')
}

const walkDirectory = (dir: string, onFile: (filePath: string) => void): void => {
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const filePath = resolve(dir, entry.name)

    if (entry.isDirectory()) {
      walkDirectory(filePath, onFile)
      continue
    }

    if (entry.isFile()) {
      onFile(filePath)
    }
  }
}

const generateResourceScript = (resources: Record<string, string[]>): string =>
  Object.entries(resources)
    .filter(([, files]) => files.length > 0)
    .map(([key, files]) => {
      const fileList = files.map((file) => toSingleQuotedJsString(file)).join(',')
      return `window[${toSingleQuotedJsString(key)}] = [${fileList}];`
    })
    .join('\n')

const injectScriptToHtml = (htmlPath: string, script: string): boolean => {
  if (!existsSync(htmlPath)) {
    console.log(chalk.yellow(`:: index.html 文件不存在: ${htmlPath}`))
    return false
  }

  try {
    const html = readFileSync(htmlPath, 'utf-8')
    const lineBreak = html.includes('\r\n') ? '\r\n' : '\n'
    const htmlWithoutScript = html.replace(RESOURCE_SCRIPT_PATTERN, '')
    const headMatch = htmlWithoutScript.match(/^([ \t]*)<\/head>/im)
    const headIndent = headMatch?.[1] ?? ''
    const scriptIndent = `${headIndent}  `
    const scriptContentIndent = `${scriptIndent}  `
    const scriptTag = [
      `${scriptIndent}<script id="${RESOURCE_SCRIPT_ID}">`,
      ...script.split(/\r?\n/).map((line) => `${scriptContentIndent}${line}`),
      `${scriptIndent}</script>`,
    ].join(lineBreak)
    let injectedHtml = htmlWithoutScript

    const headOpenMatch = /<head\b[^>]*>/i.exec(injectedHtml)
    const headCloseMatch = /<\/head>/i.exec(injectedHtml)

    if (headOpenMatch) {
      const insertIndex = headOpenMatch.index + headOpenMatch[0].length
      injectedHtml = `${injectedHtml.slice(0, insertIndex)}${lineBreak}${scriptTag}${injectedHtml.slice(insertIndex)}`
    } else if (headCloseMatch) {
      injectedHtml = injectedHtml.replace(/^([ \t]*)<\/head>/im, `${scriptTag}${lineBreak}$1</head>`)
    } else if (/<\/head>/i.test(injectedHtml)) {
      injectedHtml = injectedHtml.replace(/^([ \t]*)<\/head>/im, `${scriptTag}${lineBreak}$1</head>`)
    } else {
      injectedHtml = `${scriptTag}${lineBreak}${injectedHtml}`
    }

    writeFileSync(htmlPath, injectedHtml)
    return true
  } catch (error) {
    console.error(chalk.red(`:: 注入脚本失败: ${error}`))
    return false
  }
}

export default function vitePluginOrganizeResource(option: VitePluginOrganizeResourceOption = {}): Plugin {
  const mergedOption: Required<VitePluginOrganizeResourceOption> = {
    verbose: option.verbose ?? false,
    config: {
      ...DEFAULT_RESOURCE_CONFIG,
      ...option.config,
    },
  }

  const extensionRules = createExtensionRules(mergedOption.config)
  let outDir = normalizePath(resolve('dist'))
  let base = '/'

  return {
    name: 'vite-plugin-organize-resource',
    apply: 'build',
    configResolved(config) {
      outDir = normalizePath(resolve(config.root, config.build.outDir))
      base = config.base

      if (mergedOption.verbose) {
        console.log(chalk.blue(`:: 输出目录: ${outDir}`))
        console.log(chalk.blue(`:: 基础路径: ${base}`))
      }
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        if (extensionRules.length === 0) {
          console.log(chalk.yellow(':: 未配置有效的资源后缀，跳过资源整理'))
          return
        }

        if (!directoryExists(outDir)) {
          console.log(chalk.yellow(`:: 输出目录不存在，跳过资源整理: ${outDir}`))
          return
        }

        const resources = Object.fromEntries(extensionRules.map((rule) => [rule.key, [] as string[]]))

        try {
          walkDirectory(outDir, (filePath) => {
            const fileExt = extname(filePath).toLowerCase()
            if (!fileExt) return

            for (const rule of extensionRules) {
              if (!rule.extensions.has(fileExt)) continue

              const resourceUrl = buildResourceUrl(base, relative(outDir, filePath))
              resources[rule.key].push(resourceUrl)

              if (mergedOption.verbose) {
                console.log(chalk.gray(`   找到资源: ${rule.key} -> ${resourceUrl}`))
              }
              break
            }
          })
        } catch (error) {
          console.error(chalk.red(`:: 读取目录失败: ${outDir} - ${error}`))
          return
        }

        for (const files of Object.values(resources)) {
          files.sort()
        }

        const script = generateResourceScript(resources)
        if (!script) {
          console.log(chalk.yellow(':: 未找到匹配的资源文件'))
          return
        }

        const indexHtml = resolve(outDir, 'index.html')
        const success = injectScriptToHtml(indexHtml, script)
        if (!success) return

        const resourceTypes = Object.keys(resources).filter((key) => resources[key].length > 0)
        const totalFiles = Object.values(resources).reduce((sum, files) => sum + files.length, 0)

        console.log(chalk.green(`:: 已整理 ${totalFiles} 个资源文件 => ${resourceTypes.join(', ')}`))
        if (mergedOption.verbose) {
          resourceTypes.forEach((type) => {
            console.log(chalk.gray(`   ${type}: ${resources[type].length} 个文件`))
          })
        }
      },
    },
  }
}
