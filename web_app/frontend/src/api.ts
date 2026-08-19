// 與 FastAPI 後端溝通。長任務走 job + WebSocket 串流日誌，
// 並保留 REST 輪詢作為狀態的真實來源——socket 斷線不該讓結果消失。
export interface Primitive {
  kind: 'polygon' | 'path' | 'rect' | 'circle' | 'comp' | 'port'
  net?: string
  points?: [number, number][]
  holes?: [number, number][][]
  width?: number
  x?: number; y?: number; w?: number; h?: number; r?: number
  via?: boolean
  name?: string
}

export interface PreviewData {
  layers: Record<string, Primitive[]>
  layer_order: string[]
  layer_colors: Record<string, number[]>
  bounds: { min: [number, number]; max: [number, number] }
  preview_mode: 'exact' | 'coarse'
  source_primitive_count: number
  rendered_primitive_count: number
  nets: string[]
  power_nets: string[]
  signal_nets: string[]
}

export interface Segment {
  layer: string; net: string
  s0_mm: number; s1_mm: number; width_mm: number
  source: string; label: string; is_via: boolean
  role: 'signal' | 'reference'
  index: number; conductor: string
}

export interface SectionLayer {
  name: string; kind: string
  thickness_um: number; y0_mm: number; y1_mm: number
  material: string; fill: string | null
  segments: Segment[]
}

export interface SafetyItem {
  severity: 'hard' | 'risk'
  kind: string; message: string
  layer: string; net: string
  s0_mm?: number; s1_mm?: number
}

export type Axis = 'x' | 'y'

export interface CutDto {
  name: string
  axis: Axis | null
  coord_mm: number | null
  p1_mm: [number, number]; p2_mm: [number, number]
  centre_mm: [number, number]
  angle_deg: number; length_mm: number
}

/** 一對被視為差分的導體。exact 為 false 時是 2x2 子區塊的近似。 */
export interface PairResult {
  name: string
  positive: string; negative: string
  exact: boolean
  Zdiff: number | null; Zcomm: number | null
  Z_odd: number | null; Z_even: number | null
  error: string | null
}

export interface ConductorPair {
  name: string; positive: string; negative: string
}

/** 掃描後、求解前就能回答的：有哪些訊號、能算什麼、什麼算不出來。 */
export interface ImpedancePlan {
  /** 這些 net 的銅箔全部合併成單一 Q2D 導體 GND。 */
  reference_nets: string[]
  signal_nets: string[]
  conductors: string[]
  pairs: ConductorPair[]
  unpaired: string[]
  has_reference: boolean
  blocked: string[]
}

export interface CrossSectionData {
  cut: CutDto
  signal_nets: string[]
  layers: SectionLayer[]
  safety: SafetyItem[]
  excluded_nets: string[]
  plan: ImpedancePlan
  /** EDB 以 is_power_ground 標記的參考網路：鎖定，不可排除。 */
  database_reference: string[]
  /** 使用者提升為參考的網路：可以取消。 */
  promoted_reference: string[]
}

export interface Impedance {
  mode: 'differential' | 'single_ended'
  conductors: string[]
  Zdiff?: number; Z_odd?: number; Z_even?: number; Zcomm?: number
  C11_pF_per_m?: number; C12_pF_per_m?: number
  L11_nH_per_m?: number; L12_nH_per_m?: number
  Zse?: Record<string, number>
}

/** 求解前送來的「Q2D 實際建出來的幾何」。單位 mm，y 是疊構高程。 */
export interface Q2DRect {
  x: number; y: number; w: number; h: number
  role: 'signal' | 'reference' | 'dielectric'
  name: string; material: string; net?: string
}

export interface Q2DGeometry {
  design: string
  geometry: Q2DRect[]
  conductors: string[]
  reference_objects: number
  /** AEDT 自己畫的模型畫面（data URI）。出圖失敗時為 null。 */
  picture?: string | null
}

export interface SolveMode {
  key: string; label: string
  solve_option: string; per_error: number; note: string
}

export interface BuildResult {
  design: string
  project_file: string
  conductors: string[]
  impedance: Impedance | null
  pairs?: PairResult[]
  solve_mode?: string
  solve_option?: string
  per_error?: number
  cut: CutDto
  cross_section: CrossSectionData
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`)
  return data as T
}

export interface JobHooks {
  onLog?: (line: string) => void
  onGeometry?: (g: Q2DGeometry) => void
  onJob?: (jobId: string) => void
}

/** 送出工作並串流日誌。WebSocket 失敗時自動退回輪詢。 */
export async function runJob<T>(
  url: string, body: unknown, hooks?: JobHooks | ((line: string) => void),
): Promise<T> {
  const h: JobHooks = typeof hooks === 'function' ? { onLog: hooks } : (hooks || {})
  const { job } = await post<{ job: string }>(url, body)
  h.onJob?.(job)
  try {
    return await streamJob<T>(job, h)
  } catch {
    return await pollJob<T>(job, h)
  }
}

function streamJob<T>(job: string, h: JobHooks): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/job/${job}`)
    let settled = false
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'log') { h.onLog?.(msg.message); return }
      if (msg.type === 'geometry') { h.onGeometry?.(msg as Q2DGeometry); return }
      settled = true
      ws.close()
      if (msg.type === 'done') resolve(msg.result as T)
      else reject(new Error(msg.error || '工作失敗'))
    }
    ws.onerror = () => { if (!settled) reject(new Error('WebSocket 連線失敗')) }
    ws.onclose = () => { if (!settled) reject(new Error('WebSocket 已關閉')) }
  })
}

async function pollJob<T>(job: string, h: JobHooks): Promise<T> {
  let sent = 0
  let sentGeometry = 0
  for (;;) {
    const res = await fetch(`./api/job/${job}`)
    const state = await res.json()
    while (sent < state.log.length) h.onLog?.(state.log[sent++])
    while (sentGeometry < (state.geometry?.length || 0)) {
      h.onGeometry?.(state.geometry[sentGeometry++])
    }
    if (state.state === 'done') return state.result as T
    if (state.state === 'error') throw new Error(state.error || '工作失敗')
    await new Promise((r) => setTimeout(r, 400))
  }
}

export const api = {
  health: () => fetch('./api/health').then((r) => r.json()),
  versions: () => fetch('./api/versions').then((r) => r.json()),
  solveModes: () => fetch('./api/solve-modes')
    .then((r) => r.json()) as Promise<{ modes: SolveMode[]; default: string }>,
  browse: (title: string, initial: string) =>
    post<{ path: string }>('./api/browse', { title, initial }),
  open: (aedb: string, version: string, onLog?: (l: string) => void) =>
    runJob<{ preview: PreviewData; cutset: any; cutset_path: string | null; stackup: any[] }>(
      './api/open', { aedb, version }, onLog),
  scan: (body: unknown, onLog?: (l: string) => void) =>
    runJob<CrossSectionData>('./api/scan', body, onLog),
  build: (body: unknown, hooks?: JobHooks) =>
    runJob<{ results: BuildResult[]; cancelled?: boolean }>('./api/build', body, hooks),
  cancel: (job: string) =>
    fetch(`./api/job/${job}/cancel`, { method: 'POST' }).then((r) => r.json()),
  saveCutSet: (aedb: string, cuts: unknown[], onLog?: (l: string) => void,
               region_mm?: number[] | null) =>
    runJob<{ path: string; warning: string | null }>(
      './api/cutset/save', { aedb, cuts, region_mm }, onLog),
}
