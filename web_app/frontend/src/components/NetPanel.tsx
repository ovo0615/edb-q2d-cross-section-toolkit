// 訊號線：這條切線上實際切到的 net，逐條決定角色與去留。
//
// 清單來自截面而不是工作範圍——範圍內有十幾條 net，切線只切到其中幾條，
// 列出切不到的只會讓人在無關的項目上做決定。所以操作順序是先有截面，再挑訊號線。
//
// 參考導體不可排除。判定依據是 EDB 自己的 is_power_ground 旗標，不是名字叫 GND；
// 沒有參考平面阻抗根本沒有定義，那不該是一個能誤按進去的狀態。
// 使用者可以把某條訊號提升為參考（例如刻意接地的鄰線），提升過的可以取消。
//
// 關掉一條 net 的語意是「這塊銅箔不存在」——見
// docs/adr/0001-excluded-nets-become-dielectric.md。
import React, { useMemo, useRef, useState } from 'react'

interface Props {
  /** 這條切線上出現的 net（含已排除的，否則排掉就找不回來）。 */
  nets: string[]
  excluded: string[]
  /** EDB 標記為 power/ground：鎖定，不可排除也不可取消。 */
  databaseReference: string[]
  /** 使用者提升為參考的：可以取消。 */
  promotedReference: string[]
  disabled?: boolean
  onExcludedChange: (excluded: string[]) => void
  onPromotedChange: (promoted: string[]) => void
  onLog?: (line: string) => void
}

export default function NetPanel({
  nets, excluded, databaseReference, promotedReference, disabled,
  onExcludedChange, onPromotedChange, onLog,
}: Props) {
  const [filter, setFilter] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const excludedSet = useMemo(() => new Set(excluded), [excluded])
  const lockedSet = useMemo(() => new Set(databaseReference), [databaseReference])
  const promotedSet = useMemo(() => new Set(promotedReference), [promotedReference])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? nets.filter((n) => n.toLowerCase().includes(needle)) : nets
  }, [nets, filter])

  const signalNets = useMemo(
    () => nets.filter((n) => !lockedSet.has(n) && !promotedSet.has(n)),
    [nets, lockedSet, promotedSet])

  const toggleExcluded = (net: string) => {
    if (lockedSet.has(net) || promotedSet.has(net)) return
    const next = new Set(excludedSet)
    if (next.has(net)) next.delete(net); else next.add(net)
    onExcludedChange([...next].sort())
  }

  const togglePromoted = (net: string) => {
    if (lockedSet.has(net)) return
    const next = new Set(promotedSet)
    if (next.has(net)) {
      next.delete(net)
    } else {
      next.add(net)
      // 提升為參考的同時解除排除：兩者同時成立沒有意義。
      if (excludedSet.has(net)) {
        const rest = new Set(excludedSet)
        rest.delete(net)
        onExcludedChange([...rest].sort())
      }
    }
    onPromotedChange([...next].sort())
  }

  const setAll = (exclude: boolean) => {
    if (!exclude) { onExcludedChange([]); return }
    const target = shown.filter((n) => !lockedSet.has(n) && !promotedSet.has(n))
    onExcludedChange([...new Set([...excluded, ...target])].sort())
  }

  /** 匯出「要保留的訊號」而不是「被排除的」。
   *  一份清單被別人拿去用時，「這些是我要的訊號」比「這些是我不要的」好懂得多。 */
  const exportList = () => {
    const keep = signalNets.filter((n) => !excludedSet.has(n))
    const body = ['# EDB to Q2D 訊號清單（列出的是要納入模型的訊號 net）',
                  '# 參考導體不在此清單中，它們一律納入。',
                  ...keep].join('\r\n')
    // BOM：記事本與 Excel 開 UTF-8 純文字時，沒有 BOM 會把中文註解顯示成亂碼。
    const blob = new Blob(['﻿' + body], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'signal_nets.txt'
    a.click()
    URL.revokeObjectURL(url)
    onLog?.(`已匯出 ${keep.length} 條訊號 net。`)
  }

  const importList = async (file: File) => {
    const text = await file.text()
    const wanted = new Set(
      text.replace(/^﻿/, '')          // 去掉 BOM，否則第一條 net 永遠對不上
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
          .map((l) => l.toLowerCase()))    // 名稱比對不分大小寫
    if (!wanted.size) { onLog?.('匯入的清單是空的，沒有變更。'); return }
    const matched = signalNets.filter((n) => wanted.has(n.toLowerCase()))
    const missing = [...wanted].filter(
      (w) => !nets.some((n) => n.toLowerCase() === w))
    onExcludedChange(signalNets.filter((n) => !matched.includes(n)).sort())
    onLog?.(`匯入 ${wanted.size} 條：這條切線上命中 ${matched.length} 條。`
            + (missing.length
               ? `　切線上找不到 ${missing.length} 條：${missing.slice(0, 5).join('、')}`
                 + (missing.length > 5 ? ' …' : '')
               : ''))
  }

  if (!nets.length) {
    return (
      <span className="hint">
        建立切線後，這裡會列出切線實際切到的 net。
      </span>
    )
  }

  const kept = signalNets.filter((n) => !excludedSet.has(n)).length
  return (
    <div className="netpanel">
      <div className="row">
        <button className="mini" disabled={disabled} onClick={() => fileRef.current?.click()}>
          匯入清單
        </button>
        <button className="mini" disabled={disabled} onClick={exportList}>匯出清單</button>
        <input ref={fileRef} type="file" accept=".txt,.csv" style={{ display: 'none' }}
               onChange={(e) => {
                 const f = e.target.files?.[0]
                 if (f) importList(f)
                 e.target.value = ''
               }} />
      </div>
      <div className="row">
        <input type="text" placeholder="過濾 net…" value={filter}
               onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
      </div>
      <div className="row netpanel-bulk">
        <span className="hint">訊號納入 {kept} / {signalNets.length}</span>
        <button className="mini" disabled={disabled} onClick={() => setAll(false)}>全部納入</button>
        <button className="mini" disabled={disabled} onClick={() => setAll(true)}>全部排除</button>
      </div>

      <div className="netlist">
        {shown.map((net) => {
          const locked = lockedSet.has(net)
          const promoted = promotedSet.has(net)
          const reference = locked || promoted
          const off = !reference && excludedSet.has(net)
          return (
            <div key={net} className={'netrow' + (off ? ' off' : '')}>
              <input type="checkbox" checked={reference || !off}
                     disabled={disabled || reference}
                     title={reference ? '參考導體一律納入模型' : '納入 / 排除'}
                     onChange={() => toggleExcluded(net)} />
              <span className="nm">{net}</span>
              {locked ? (
                <span className="tag ref" title="EDB 將這條 net 標記為 power/ground">參考</span>
              ) : promoted ? (
                <button className="tag ref promoted" disabled={disabled}
                        title="你把它提升為參考；點一下改回訊號"
                        onClick={() => togglePromoted(net)}>參考 ✕</button>
              ) : (
                <button className="tag" disabled={disabled}
                        title="提升為參考平面（例如刻意接地的鄰線）"
                        onClick={() => togglePromoted(net)}>設為參考</button>
              )}
            </div>
          )
        })}
        {!shown.length && <span className="hint">沒有符合的 net。</span>}
      </div>

      <span className="hint">
        參考導體由 EDB 的 power/ground 標記決定，不是看名稱；它們一律納入模型，不可排除。
      </span>
      {excluded.length > 0 && (
        <div className="warnbox">
          已排除 {excluded.length} 條。算出來的是拿掉它們之後的阻抗，不是這片板子原本的阻抗。
        </div>
      )}
    </div>
  )
}
