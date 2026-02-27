# vite-plugin-organize-resource

将资源文件整理后注册到 `window` 对象

## 介绍

`vite-plugin-organize-resource` 是一个用于在 Vite 构建过程中组织资源文件并将其注册到 `window` 对象的插件。它可以根据配置自动收集指定类型的资源文件，并在构建完成后，将资源列表注册到全局变量中，便于在应用中直接访问。

## 安装

```bash
pnpm add vite-plugin-organize-resource -D
```

## 使用

```ts
// vite.config.ts
import vitePluginOrganize from 'vite-plugin-organize-resource'

// ...existing code...
export default {
  // ...existing code...
  plugins: [
    // ...existing code...
    vitePluginOrganize({
      config: {
        IMG_RESOURCES: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'],
        // 你可以在这里添加更多的资源类型
      },
    }),
  ],
}
```

在你的应用中，你可以通过全局变量来访问资源列表：

```ts
console.log(window.IMG_RESOURCES)
// 输出类似 ["assets/image1.png", "assets/image2.jpg", ...]
```

## 说明

- 当前版本仅支持 ESM（`import`），不再提供 CommonJS（`require`）入口。
