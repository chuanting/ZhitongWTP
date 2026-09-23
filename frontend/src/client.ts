/** 数据层入口：按构建模式切换在线 API 或静态预计算数据。 */
import { api as liveApi } from './api'
import { staticApi } from './staticApi'

export const IS_STATIC = import.meta.env.VITE_STATIC === '1'

export const client = (IS_STATIC ? staticApi : liveApi) as typeof liveApi
export { scenariosFor, staticNote } from './staticApi'
