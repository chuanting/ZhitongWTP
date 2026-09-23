/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 构建为 GitHub Pages 静态展示版时置 "1"，数据层切换到离线预计算结果 */
  readonly VITE_STATIC?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  readonly url: string
}
