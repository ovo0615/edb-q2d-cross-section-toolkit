// 截面剖視圖：WYSIWYG 呈現「即將建立的 Q2D 模型」，同時是編輯介面。
//
// 這是唯一能在花掉一次求解之前抓到錯誤的地方。所有疊構層一律列出，
// 在切線上沒有導體的層必須明顯留白——把空層省略掉，正是參考面被誤判的成因。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import React, { useMemo, useRef, useState } from 'react'
import type { CrossSectionData, SafetyItem, Segment } from '../api'

interface Props {
  data: CrossSectionData | null
  scanning?: boolean
  onToggleRole?: (segment: Segment) => void
  disabled?: boolean
}

const SIG = '#e3b341'
const REF = '#6e7681'
const DIE = '#233041'
const LINE = '#2b323c'
const HARD = '#f85149'
const RISK = '#d29922'

const ROW_H = 24
const GAP = 3
const PAD_L = 132
const PAD_R = 168
const PAD_T = 14
const PAD_B = 34

export default function CrossSectionView({
  data, onToggleRole, disabled, scanning,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Segment | null>(null)
  const [width, setWidth] = useState(1040)

  React.useEffect(() => {
    const el = svgRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(680, el.clientWidth - 20)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bySeverity = useMemo(() => {
    const map = new Map<string, SafetyItem[]>()
    for (const item of data?.safety ?? []) {
      const key = `${item.layer}|${item.net}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return map
  }, [data])

  if (!data) {
    return (
      <div className="xs-empty">
        {scanning
          ? '正在掃描切線上的各層幾何 …'
          : '尚未有截面。請先在上方 Layout 放置一條切線。'}
      </div>
    )
  }

  const half = data.cut.length_mm / 2
  const H = PAD_T + PAD_B + data.layers.length * (ROW_H + GAP)
  const sx = (mm: number) => PAD_L + ((mm + half) / (2 * half)) * (width - PAD_L - PAD_R)

  const hardCount = data.safety.filter((s) => s.severity === 'hard').length
  const riskCount = data.safety.filter((s) => s.severity === 'risk').length

  return (
    <div className="xs-root">
      <div className="xs-head">
        <span>
          切線 <b>{data.cut.name}</b>　中心 (
          {data.cut.centre_mm[0].toFixed(4)}, {data.cut.centre_mm[1].toFixed(4)}) mm
          方向 <b>{data.cut.axis === 'x' ? '沿 X' : '沿 Y'}</b>　寬度{' '}
          <b>{data.cut.length_mm.toFixed(3)} mm</b>
          {data.excluded_nets?.length > 0 && (
            <>　已排除 <b className="warnq">{data.excluded_nets.join('、')}</b></>
          )}
        </span>
        <span className="xs-badges">
          {hardCount > 0 && <i className="bad">{hardCount} 項必須修正</i>}
          {riskCount > 0 && <i className="warn">{riskCount} 項需判斷</i>}
          {hardCount + riskCount === 0 && <i className="ok">無警告</i>}
        </span>
      </div>

      <div className="xs-canvas">
        <svg ref={svgRef} width={width} height={H} style={{ display: 'block' }}>
          {data.layers.map((layer, i) => {
            const y = PAD_T + i * (ROW_H + GAP)
            const flagged = bySeverity.get(`${layer.name}|`) ?? []
            const empty = layer.kind === 'signal' && layer.segments.length === 0
            return (
              <g key={layer.name}>
                <rect x={PAD_L} y={y} width={width - PAD_L - PAD_R} height={ROW_H}
                      fill={DIE} stroke={LINE} />
                {/* 空的訊號層要明顯：斜線填滿，不能讓它看起來像介電層 */}
                {empty && (
                  <text x={(PAD_L + width - PAD_R) / 2} y={y + ROW_H / 2 + 4}
                        textAnchor="middle" fontSize="10.5" fill="#5a6673">
                    此層在切線上沒有導體
                  </text>
                )}
                {layer.segments.map((seg, j) => {
                  const x0 = sx(seg.s0_mm)
                  const x1 = sx(seg.s1_mm)
                  const isSig = seg.role === 'signal'
                  return (
                    <rect
                      key={j} x={x0} y={y + 3}
                      width={Math.max(x1 - x0, 1.5)} height={ROW_H - 6}
                      fill={isSig ? SIG : REF}
                      stroke={seg.is_via ? RISK : 'none'}
                      strokeWidth={seg.is_via ? 1.4 : 0}
                      style={{ cursor: disabled ? 'default' : 'pointer' }}
                      onClick={() => !disabled && onToggleRole?.(seg)}
                      onMouseEnter={() => setHover(seg)}
                      onMouseLeave={() => setHover(null)}
                    >
                      <title>
                        {`${seg.conductor}（${isSig ? '訊號' : '參考'}）\n`}
                        {`${seg.s0_mm.toFixed(4)} ~ ${seg.s1_mm.toFixed(4)} mm，寬 ${seg.width_mm.toFixed(4)} mm`}
                        {seg.is_via ? `\nvia pad: ${seg.label}` : ''}
                        {disabled ? '' : '\n點擊切換訊號／參考'}
                      </title>
                    </rect>
                  )
                })}
                <text x={PAD_L - 8} y={y + ROW_H / 2 + 4} textAnchor="end"
                      fontSize="11" fill={empty ? '#5a6673' : '#8b949e'}>
                  {layer.name}
                </text>
                <text x={width - PAD_R + 8} y={y + ROW_H / 2 + 4}
                      fontSize="10.5" fill="#6e7681">
                  {layer.thickness_um.toFixed(2)} µm · {layer.material}
                </text>
                {flagged.length > 0 && (
                  <circle cx={PAD_L - 118} cy={y + ROW_H / 2} r={4}
                          fill={flagged.some((f) => f.severity === 'hard') ? HARD : RISK} />
                )}
              </g>
            )
          })}

          {/* 底部座標尺 */}
          {[-half, -half / 2, 0, half / 2, half].map((mm, i) => {
            const yAxis = PAD_T + data.layers.length * (ROW_H + GAP) + 12
            return (
              <g key={i}>
                {i === 0 && (
                  <line x1={PAD_L} y1={yAxis} x2={width - PAD_R} y2={yAxis} stroke={LINE} />
                )}
                <line x1={sx(mm)} y1={yAxis - 4} x2={sx(mm)} y2={yAxis + 4} stroke="#8b949e" />
                <text x={sx(mm)} y={yAxis + 16} textAnchor="middle"
                      fontSize="10" fill="#6e7681">{mm.toFixed(2)}</text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="xs-legend">
        <span><i className="sw" style={{ background: SIG }} />訊號導體</span>
        <span><i className="sw" style={{ background: REF }} />參考導體</span>
        <span><i className="sw" style={{ background: DIE, border: `1px solid ${LINE}` }} />介電層</span>
        <span><i className="sw" style={{ background: 'transparent', border: `1.5px solid ${RISK}` }} />via pad</span>
        {!disabled && <span className="hint">點擊任一導體可切換訊號／參考</span>}
        {hover && (
          <span className="hint">
            {hover.conductor}：{hover.width_mm.toFixed(4)} mm
          </span>
        )}
      </div>

      {data.safety.length > 0 && (
        <ul className="xs-safety">
          {data.safety.map((item, i) => (
            <li key={i} className={item.severity}>
              <b>{item.severity === 'hard' ? '必須修正' : '需判斷'}</b>
              {item.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
