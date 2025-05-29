import chalk from 'chalk'
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath, Plugin } from 'vite'

export interface VitePluginOrganizeResourceOption {
  config: Record<string, string | string[]>
  /** 是否输出调试信息 */
  verbose?: boolean
}

export default function vitePluginOrganizeResource(
  option: VitePluginOrganizeResourceOption = {
    config: {
      IMG_RESOURCES: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'],
    },
    verbose: false,
  }
): Plugin {
  let outDir = ''
  let base = ''
  const outList: Record<string, string[]> = {}

  /**
   * 检查目录是否存在
   */
  function directoryExists(dirPath: string): boolean {
    try {
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
    } catch {
      return false
    }
  }

  /**
   * 生成资源脚本内容
   */
  function generateResourceScript(): string {
    let result = ''
    for (const [key, files] of Object.entries(outList)) {
      if (files.length > 0) {
        const fileList = files.map((file) => `"${file}"`).join(',')
        result += `    window.${key}=[${fileList}];\n`
      }
    }
    return result
  }

  /**
   * 注入脚本到 HTML
   */
  function injectScriptToHtml(htmlPath: string, script: string): boolean {
    try {
      if (!fs.existsSync(htmlPath)) {
        console.log(chalk.yellow(`:: index.html 文件不存在: ${htmlPath}`))
        return false
      }

      let html = fs.readFileSync(htmlPath, 'utf-8')
      html = html.replace('<head>', `<head>\n\n    <script>\n${script}\n    </script>\n`)

      fs.writeFileSync(htmlPath, html)
      return true
    } catch (error) {
      console.error(chalk.red(`:: 注入脚本失败: ${error}`))
      return false
    }
  }

  return {
    name: 'vite-plugin-organize-resource',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
      base = config.base

      if (option.verbose) {
        console.log(chalk.blue(`:: 输出目录: ${outDir}`))
        console.log(chalk.blue(`:: 基础路径: ${base}`))
      }
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        // 检查输出目录是否存在
        if (!directoryExists(outDir)) {
          console.log(chalk.yellow(`:: 输出目录不存在，跳过资源整理: ${outDir}`))
          return
        }

        // 清空之前的结果
        Object.keys(outList).forEach((key) => delete outList[key])

        // 读取资源文件
        readPath(path.resolve(outDir), option.config)

        // 生成脚本内容
        const script = generateResourceScript()

        if (!script.trim()) {
          console.log(chalk.yellow(':: 未找到匹配的资源文件'))
          return
        }

        // 注入到 HTML
        const indexHtml = path.resolve(outDir, 'index.html')
        const success = injectScriptToHtml(indexHtml, script)

        if (success) {
          const resourceTypes = Object.keys(outList).filter((key) => outList[key].length > 0)
          const totalFiles = Object.values(outList).reduce((sum, files) => sum + files.length, 0)
          console.log(chalk.green(`:: 已整理 ${totalFiles} 个资源文件 => ${resourceTypes.join(', ')}`))

          if (option.verbose) {
            resourceTypes.forEach((type) => {
              console.log(chalk.gray(`   ${type}: ${outList[type].length} 个文件`))
            })
          }
        }
      },
    },
  }

  /**
   * 递归读取目录中的资源文件
   */
  function readPath(dir: string, config: VitePluginOrganizeResourceOption['config']): void {
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true })

      files.forEach((file) => {
        const filePath = path.join(dir, file.name)

        if (file.isDirectory()) {
          readPath(filePath, config)
          return
        }

        const fileExt = path.extname(file.name).toLowerCase()

        // 遍历配置的资源类型
        for (const [key, extensions] of Object.entries(config)) {
          const extArray = Array.isArray(extensions) ? extensions : [extensions]
          const normalizedExts = extArray.map((ext) => ext.toLowerCase())

          if (normalizedExts.includes(fileExt)) {
            const imgURL = normalizePath(base + filePath.replace(path.resolve(outDir), ''))
              .replace('https:/', 'https://')
              .replace('http:/', 'http://')

            if (!outList[key]) {
              outList[key] = []
            }
            outList[key].push(imgURL)

            if (option.verbose) {
              console.log(chalk.gray(`   找到资源: ${key} -> ${imgURL}`))
            }
            break // 找到匹配的类型后跳出循环
          }
        }
      })
    } catch (error) {
      console.error(chalk.red(`:: 读取目录失败: ${dir} - ${error}`))
    }
  }
}
