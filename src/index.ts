import chalk from 'chalk'
import fs from 'node:fs'
import path from 'node:path'
import { normalizePath, Plugin } from 'vite'

export type vitePluginOrganizeResourceOption = {
  config: Record<string, string | string[]>
}

export default function vitePluginOrganizeResource(
  option: vitePluginOrganizeResourceOption = {
    config: {
      IMG_RESOURCES: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'],
    },
  }
): Plugin {
  let outDir = ''
  let base = ''
  const outList: Record<string, string[]> = {}

  return {
    name: 'vite-plugin-organize-resource',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
      base = config.base
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        readPath(path.resolve(outDir), option.config)

        let result = ``
        for (const key in outList) {
          if (Object.prototype.hasOwnProperty.call(outList, key)) {
            const element = outList[key]
            result += `    window.${key}=[${element.map((i) => `"${i}"`)}];\n`
          }
        }

        if (!result) {
          console.log(chalk.yellow(':: 未找到资源'))
          return
        }

        const indexHtml = path.resolve(outDir, 'index.html')
        let html = fs.readFileSync(indexHtml, 'utf-8')
        html = html.replace('<head>', `<head>\n\n    <script>\n${result}\n    </script>\n`)

        fs.writeFileSync(indexHtml, html)
        console.log(chalk.green(`:: 已整理资源 => ${Object.keys(outList).join(', ')}`))
      },
    },
  }

  function readPath(dir: string, option: vitePluginOrganizeResourceOption['config']) {
    const files = fs.readdirSync(dir, { withFileTypes: true })
    files.forEach((file) => {
      const filePath = path.join(dir, file.name)
      if (file.isDirectory()) return readPath(filePath, option)

      for (const key in option) {
        if (Object.prototype.hasOwnProperty.call(option, key)) {
          const element = Array.isArray(option[key]) ? option[key] : [option[key]]
          if (element.includes(path.extname(file.name))) {
            const imgURL = normalizePath(base + filePath.replace(path.resolve(outDir), ''))
              .replace('https:/', 'https://')
              .replace('http:/', 'http://')

            if (outList[key]) {
              outList[key].push(imgURL)
            } else {
              outList[key] = [imgURL]
            }
          }
        }
      }
    })
  }
}
