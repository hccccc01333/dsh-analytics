/**
 * Browser-half dictionary for dsh-analytics.
 *
 * Chinese is the source of truth; the English dictionary must stay
 * key-identical (the test enforces it).
 *
 * @module dsh-analytics/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'analytics' as const

/** Key set of the analytics dictionary. */
export type AnalyticsKey =
  | 'action.label'
  | 'action.footer'
  | 'app.title'
  | 'nav.overview'
  | 'nav.sessions'
  | 'nav.flow'
  | 'nav.models'
  | 'nav.cost'
  | 'nav.pricing'
  | 'range.label'
  | 'range.refresh'
  | 'budget.daily'
  | 'budget.monthly'
  | 'table.session'
  | 'table.calls'
  | 'table.tokens'
  | 'table.cost'
  | 'table.model'
  | 'table.input'
  | 'table.cache'
  | 'table.output'
  | 'table.bucket'
  | 'table.window'
  | 'table.price'
  | 'table.effectiveFrom'
  | 'panel.title'
  | 'panel.dashboard'
  | 'panel.close'
  | 'tail.unit'
  | 'kpi.cost'
  | 'kpi.tokens'
  | 'kpi.cache'
  | 'kpi.calls'
  | 'kpi.unpriced'
  | 'cache.saved'
  | 'waterfall.title'
  | 'waterfall.turn'
  | 'waterfall.calls'
  | 'waterfall.input'
  | 'waterfall.cache'
  | 'waterfall.output'
  | 'waterfall.reasoning'
  | 'waterfall.cost'
  | 'tools.title'
  | 'tools.name'
  | 'tools.calls'
  | 'tools.errors'
  | 'tools.success'
  | 'tools.tokens'
  | 'tools.cost'
  | 'state.loading'
  | 'state.error'
  | 'state.empty'

/** Chinese dictionary (source of truth). */
export const zh: Record<AnalyticsKey, string> = {
  'action.label': '分析',
  'action.footer': 'Token 分析',
  'app.title': 'Token Analytics',
  'nav.overview': '概览',
  'nav.sessions': '会话',
  'nav.flow': 'Token 流',
  'nav.models': '模型',
  'nav.cost': '成本',
  'nav.pricing': '定价',
  'range.label': '时间范围',
  'range.refresh': '刷新',
  'budget.daily': '每日预算',
  'budget.monthly': '每月预算',
  'table.session': '会话',
  'table.calls': '调用',
  'table.tokens': 'Token',
  'table.cost': '成本',
  'table.model': '模型',
  'table.input': '输入',
  'table.cache': '缓存',
  'table.output': '输出',
  'table.bucket': '时间桶',
  'table.window': '时段',
  'table.price': '$/百万 Token',
  'table.effectiveFrom': '生效时间',
  'panel.title': 'Token 分析',
  'panel.dashboard': '打开完整仪表盘',
  'panel.close': '关闭',
  'tail.unit': 'Token',
  'kpi.cost': '成本',
  'kpi.tokens': 'Token',
  'kpi.cache': '缓存命中',
  'kpi.calls': 'API 调用',
  'kpi.unpriced': '未计价',
  'cache.saved': '节省',
  'waterfall.title': 'Turn 成本瀑布',
  'waterfall.turn': 'Turn',
  'waterfall.calls': '调用',
  'waterfall.input': '输入',
  'waterfall.cache': '缓存',
  'waterfall.output': '输出',
  'waterfall.reasoning': '推理',
  'waterfall.cost': '成本',
  'tools.title': '工具',
  'tools.name': '工具',
  'tools.calls': '调用',
  'tools.errors': '错误',
  'tools.success': '成功率',
  'tools.tokens': '步骤 Token',
  'tools.cost': '步骤成本',
  'state.loading': '加载中…',
  'state.error': '分析数据加载失败',
  'state.empty': '该会话暂无用量记录',
}

/** English dictionary; key-identical to {@link zh}. */
export const en: Record<AnalyticsKey, string> = {
  'action.label': 'Analytics',
  'action.footer': 'Token Analytics',
  'app.title': 'Token Analytics',
  'nav.overview': 'Overview',
  'nav.sessions': 'Sessions',
  'nav.flow': 'Token Flow',
  'nav.models': 'Models',
  'nav.cost': 'Cost',
  'nav.pricing': 'Pricing',
  'range.label': 'Time range',
  'range.refresh': 'Refresh',
  'budget.daily': 'Daily budget',
  'budget.monthly': 'Monthly budget',
  'table.session': 'Session',
  'table.calls': 'Calls',
  'table.tokens': 'Tokens',
  'table.cost': 'Cost',
  'table.model': 'Model',
  'table.input': 'Input',
  'table.cache': 'Cache',
  'table.output': 'Output',
  'table.bucket': 'Bucket',
  'table.window': 'Window',
  'table.price': '$/1M tokens',
  'table.effectiveFrom': 'Effective from',
  'panel.title': 'Token Analytics',
  'panel.dashboard': 'Open full dashboard',
  'panel.close': 'Close',
  'tail.unit': 'tokens',
  'kpi.cost': 'Cost',
  'kpi.tokens': 'Tokens',
  'kpi.cache': 'Cache hit',
  'kpi.calls': 'API calls',
  'kpi.unpriced': 'unpriced',
  'cache.saved': 'saved',
  'waterfall.title': 'Turn Waterfall',
  'waterfall.turn': 'Turn',
  'waterfall.calls': 'Calls',
  'waterfall.input': 'Input',
  'waterfall.cache': 'Cache',
  'waterfall.output': 'Output',
  'waterfall.reasoning': 'Reasoning',
  'waterfall.cost': 'Cost',
  'tools.title': 'Tools',
  'tools.name': 'Tool',
  'tools.calls': 'Calls',
  'tools.errors': 'Errors',
  'tools.success': 'Success',
  'tools.tokens': 'Step tokens',
  'tools.cost': 'Step cost',
  'state.loading': 'Loading…',
  'state.error': 'Failed to load analytics',
  'state.empty': 'No usage recorded for this session yet',
}
