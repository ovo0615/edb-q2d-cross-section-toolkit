// 版面：左側工作區（依序的操作步驟）／右側舞台（頁籤切換的檢視）／底部系統日誌。
//
// Layout、結構剖面、Q2D 模型、結果各自需要整個畫面：把它們塞進同一個上下分割，
// 每一個都只剩一半高度，而它們之間本來就不需要同時看見。
//
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import Preview2D, { CutMarker, Region } from './components/Preview2D'
import CrossSectionView from './components/CrossSectionView'
import Q2DModelView from './components/Q2DModelView'
import NetPanel from './components/NetPanel'
import ResultsView, { ResultRow } from './components/ResultsView'
import BrandMark from './components/BrandMark'
import MenuBar, { Menu } from './components/MenuBar'
import HelpDialog, { HelpTopic } from './components/HelpDialog'
import partnerLogo from './assets/cadmen-ansys-partner.png'
import {
  api, Axis, BuildResult, CrossSectionData, PreviewData, Q2DGeometry, Segment,
  SolveMode,
} from './api'
import { mainSplitSize, logSplitSize, saveMainSplit, saveLogSplit } from './splitLayout'

const CUT_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#18ffff']

type Stage = 'layout' | 'section' | 'q2d' | 'results'

const STAGES: { key: Stage; label: string }[] = [
  { key: 'layout', label: 'Layout' },
  { key: 'section', label: '結構剖面' },
  { key: 'q2d', label: 'Q2D 模型' },
  { key: 'results', label: '結果' },
]

interface Cut {
  name: string
  axis: Axis
  coord: number
  roles: Record<string, string>
  excluded: string[]
  reference: string[]
  section: CrossSectionData | null
  result: BuildResult | null
}

export default function App() {
  const [health, setHealth] = useState('連線中…')
  const [versions, setVersions] = useState<{ installed: string[]; validated: string[]; default: string }>()
  const [version, setVersion] = useState('2026.1')
  const [aedb, setAedb] = useState('')
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [cuts, setCuts] = useState<Cut[]>([])
  const [active, setActive] = useState(0)
  const [placing, setPlacing] = useState(false)
  const [selectingRegion, setSelectingRegion] = useState(false)
  const [region, setRegion] = useState<Region | null>(null)
  const [axis, setAxis] = useState<Axis>('x')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [freq, setFreq] = useState('8GHz')
  const [modes, setModes] = useState<SolveMode[]>([])
  const [mode, setMode] = useState('fast')
  const [warning, setWarning] = useState('')
  const [models, setModels] = useState<Q2DGeometry[]>([])
  const [solveJob, setSolveJob] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('layout')
  const [help, setHelp] = useState<HelpTopic | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const scanSeq = useRef(0)

  const say = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-500), line])
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [log])

  useEffect(() => {
    api.health().then((h) => setHealth(h.status === 'ok' ? '服務正常 · 本機運算' : '服務異常'))
      .catch(() => setHealth('無法連線到後端'))
    api.versions().then((v) => { setVersions(v); setVersion(v.default) }).catch(() => {})
    api.solveModes().then((m) => { setModes(m.modes); setMode(m.default) }).catch(() => {})
  }, [])

  const current = cuts[active]

  /** 這條切線上出現的 net：來自截面，加上已排除的（否則排掉就找不回來）。 */
  const cutNets = useMemo(() => {
    const section = current?.section
    if (!section) return []
    const found = new Set<string>()
    for (const layer of section.layers) {
      for (const seg of layer.segments) if (seg.net) found.add(seg.net)
    }
    for (const n of current?.excluded || []) found.add(n)
    return [...found].sort()
  }, [current])

  // ── 檔案 ──────────────────────────────────────────
  const browse = async () => {
    try {
      const r = await api.browse('選擇 EDB（.aedb 請選其中的 edb.def）', aedb)
      if (r.path) setAedb(r.path)
    } catch (e: any) { say('瀏覽失敗：' + e.message) }
  }

  const openBoard = async () => {
    if (!aedb) { say('請先選擇 .aedb 資料夾。'); return }
    setBusy(true); setLog([]); setWarning(''); setModels([])
    try {
      const r = await api.open(aedb, version, say)
      setPreview(r.preview)
      setSelectingRegion(false)
      setStage('layout')
      const box: Region | null = r.cutset?.region_mm
        ? { x0: r.cutset.region_mm[0], y0: r.cutset.region_mm[1],
            x1: r.cutset.region_mm[2], y1: r.cutset.region_mm[3] }
        : null
      setRegion(box)
      const restored: Cut[] = []
      for (const c of (r.cutset?.cuts || [])) {
        if (!c.axis || c.coord_mm === null || c.coord_mm === undefined) {
          // 舊格式的自由端點切線可能是斜的，換算會給出不同的數字。
          say(`略過切線「${c.name}」：舊格式的自由端點切線無法轉為軸向模型，請重新建立。`)
          continue
        }
        restored.push({
          name: c.name, axis: c.axis, coord: c.coord_mm,
          roles: c.roles || {}, excluded: c.excluded_nets || [],
          reference: c.reference_nets || [], section: null,
          // 還原時把摘要拼回 BuildResult 的形狀，介面才讀得到差分值。
          result: c.result || c.pairs
            ? ({ impedance: c.result, pairs: c.pairs || undefined,
                 solve_mode: c.solve_mode, solve_option: c.solve_option,
                 per_error: c.per_error } as BuildResult)
            : null,
        })
      }
      attempted.current.clear()
      setCuts(restored)
      setActive(0)
      if (restored.length) say(`已載入既有截面設定：${r.cutset_path}`)
      if (r.preview.preview_mode === 'coarse') {
        setWarning(`圖元數 ${r.preview.source_primitive_count} 超過精確渲染上限，已降級為粗略模式。`)
      }
    } catch (e: any) { say('開啟失敗：' + e.message) }
    finally { setBusy(false) }
  }

  // ── 切線 ──────────────────────────────────────────
  const rescan = useCallback(async (index: number, list: Cut[], box: Region | null) => {
    const cut = list[index]
    if (!cut || !box) return
    const seq = ++scanSeq.current
    setScanning(true)
    try {
      const section = await api.scan({
        cut: {
          name: cut.name, axis: cut.axis, coord_mm: cut.coord,
          region_mm: [box.x0, box.y0, box.x1, box.y1],
        },
        roles: cut.roles,
        excluded_nets: cut.excluded,
        reference_nets: cut.reference,
      }, say)
      // 拖動時會連續觸發，只採用最後一次的結果。
      if (seq !== scanSeq.current) return
      setCuts((prev) => prev.map((c, i) => (i === index ? { ...c, section } : c)))
    } catch (e: any) {
      if (seq === scanSeq.current) say('掃描失敗：' + e.message)
    } finally {
      // 只有最後一次掃描能把狀態關掉，否則先回來的那次會讓介面看起來已經完成。
      if (seq === scanSeq.current) setScanning(false)
    }
  }, [say])

  // 選到一條還沒掃描過的切線就補掃一次。
  //
  // 從側檔還原回來的切線只有位置，沒有截面——而訊號線清單是從截面來的，
  // 所以第 4 步會是空的。使用者看到的是「工具沒把訊號線列出來」，
  // 不是「還沒掃描」，兩者在畫面上長得一模一樣。
  //
  // 寫成一條規則而不是在每個選取的地方各補一次：新增、還原、切換都走這裡。
  // attempted 記下已經試過的 (位置)，掃描失敗時才不會在失敗與重試之間空轉；
  // 切線被移動過就換一個鍵，所以移動後仍然會重掃。
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    if (!region || scanning || busy) return
    const cut = cuts[active]
    if (!cut || cut.section) return
    const key = `${active}|${cut.axis}|${cut.coord}`
    if (attempted.current.has(key)) return
    attempted.current.add(key)
    rescan(active, cuts, region)
  }, [cuts, active, region, scanning, busy, rescan])

  const placeCut = (coord: number) => {
    setPlacing(false)
    setCuts((prev) => {
      const next = [...prev, {
        name: `Cut${prev.length + 1}`, axis, coord,
        roles: {}, excluded: [], reference: [], section: null, result: null,
      }]
      setActive(next.length - 1)
      setTimeout(() => rescan(next.length - 1, next, region), 0)
      return next
    })
  }

  const patchCut = (index: number, patch: Partial<Cut>) => {
    setCuts((prev) => {
      const next = prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
      setTimeout(() => rescan(index, next, region), 0)
      return next
    })
  }

  const deleteCut = () => {
    setCuts((p) => p.filter((_, i) => i !== active))
    setActive((i) => Math.max(0, i - 1))
  }

  const toggleRole = (segment: Segment) => {
    if (!current) return
    const key = `${segment.layer}|${segment.net}|${segment.index}`
    const flipped = segment.role === 'signal' ? 'reference' : 'signal'
    patchCut(active, { roles: { ...current.roles, [key]: flipped } })
  }

  // ── 求解 ──────────────────────────────────────────
  const solve = async () => {
    if (!cuts.length || !region) { say('請先框選工作範圍並建立至少一條切線。'); return }
    setBusy(true); setModels([]); setStage('q2d')
    try {
      const r = await api.build({
        cuts: cuts.map((c) => ({
          cut: {
            name: c.name, axis: c.axis, coord_mm: c.coord,
            region_mm: [region.x0, region.y0, region.x1, region.y1],
          },
          roles: c.roles,
          excluded_nets: c.excluded,
          reference_nets: c.reference,
        })),
        frequency: freq, mode, solve: true,
      }, {
        onLog: say,
        onJob: setSolveJob,
        onGeometry: (g) => {
          // 模型一建好就顯示——求解開始之後才發現模型不對，授權與時間都已經花掉了。
          setModels((prev) => [...prev, g])
          setStage('q2d')
        },
      })
      setCuts((prev) => prev.map((c, i) => ({ ...c, result: r.results[i] || c.result })))
      if (r.cancelled) {
        say(`已終止。完成 ${r.results.length} / ${cuts.length} 條切線，結果保留。`)
      } else {
        setStage('results')
      }
      await saveCutSet(r.results)
    } catch (e: any) { say('求解失敗：' + e.message) }
    finally { setBusy(false); setSolveJob(null) }
  }

  const cancelSolve = async () => {
    if (!solveJob) return
    try {
      const r = await api.cancel(solveJob)
      say(r.cancelled ? '終止要求已送出，正在停止 AEDT 的求解 ...'
                      : (r.message || '目前沒有可終止的求解。'))
    } catch (e: any) { say('終止失敗：' + e.message) }
  }

  const saveCutSet = async (results?: BuildResult[]) => {
    try {
      // 存的是整個結果摘要，不是只有 impedance。三個導體以上時 impedance 走單端
      // 分支、沒有 Zdiff，差分值在 pairs 裡——只存 impedance 會讓重新開啟後
      // 那條切線顯示「未求解」，而它其實解過了。
      // 精度與導體清單也要一起存：兩個數字擺在一起，若不知道各自的前提就無從比較。
      const r = await api.saveCutSet(aedb, cuts.map((c, i) => {
        const solved = results?.[i] ?? c.result
        return {
          name: c.name, axis: c.axis, coord_mm: c.coord,
          roles: c.roles, excluded_nets: c.excluded, reference_nets: c.reference,
          result: solved?.impedance ?? null,
          pairs: solved?.pairs ?? null,
          conductors: solved?.impedance?.conductors ?? null,
          solve_mode: solved?.solve_mode ?? null,
          solve_option: solved?.solve_option ?? null,
          per_error: solved?.per_error ?? null,
        }
      }), say, region ? [region.x0, region.y0, region.x1, region.y1] : null)
      if (r.warning) setWarning(r.warning)
      say('截面設定已存至 ' + r.path)
    } catch (e: any) { say('儲存失敗：' + e.message) }
  }

  // ── 選單列 ────────────────────────────────────────
  //
  // 每一項都指向左側面板已經有的動作，沒有任何只能從這裡做的事：選單是給已經知道
  // 要做什麼的人抄近路用的，不是第二套流程。做不到的時候一律變灰而不是消失。
  const menus: Menu[] = [
    {
      label: '檔案',
      items: [
        { label: '瀏覽 EDB…', hint: 'Ctrl+O', disabled: busy, onSelect: browse },
        { label: '開啟板檔', disabled: !aedb || busy, onSelect: openBoard },
        { separator: true },
        { label: '儲存截面設定', hint: 'Ctrl+S',
          disabled: !preview || !cuts.length || busy, onSelect: () => saveCutSet() },
        { separator: true },
        { label: '複製日誌', disabled: !log.length,
          onSelect: () => navigator.clipboard?.writeText(log.join('\n')) },
        { label: '清除日誌', disabled: !log.length, onSelect: () => setLog([]) },
      ],
    },
    {
      label: '執行',
      items: [
        { label: '框選工作範圍', checked: selectingRegion, disabled: !preview || busy,
          onSelect: () => { setSelectingRegion((p) => !p); setPlacing(false); setStage('layout') } },
        { label: '新增切線', checked: placing, disabled: !region || busy,
          onSelect: () => { setPlacing((p) => !p); setSelectingRegion(false); setStage('layout') } },
        { label: '刪除目前切線', disabled: !cuts.length || busy, onSelect: deleteCut },
        { separator: true },
        { label: '重新掃描目前截面',
          disabled: !current || !region || busy || scanning,
          onSelect: () => rescan(active, cuts, region) },
        { separator: true },
        { label: '建立並求解', hint: 'F5', disabled: !cuts.length || busy, onSelect: solve },
        { label: '終止求解', hint: 'Esc', disabled: !solveJob, onSelect: cancelSolve },
      ],
    },
    {
      label: '檢視',
      items: STAGES.map((s) => ({
        label: s.label, checked: stage === s.key, onSelect: () => setStage(s.key),
      })),
    },
    {
      label: '說明',
      items: [
        { label: '快速上手', onSelect: () => setHelp('guide') },
        { label: '關於 EDB to Q2D', onSelect: () => setHelp('about') },
      ],
    },
  ]

  // 快捷鍵。條件和選單項目的 disabled 一致，否則按鍵會做到選單說做不到的事。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName
      if (typing === 'INPUT' || typing === 'TEXTAREA') return
      if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault(); if (!busy) browse()
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault(); if (preview && cuts.length && !busy) saveCutSet()
      } else if (e.key === 'F5') {
        e.preventDefault(); if (cuts.length && !busy) solve()
      } else if (e.key === 'Escape' && solveJob) {
        cancelSolve()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const markers: CutMarker[] = cuts.map((c, i) => ({
    name: c.name, axis: c.axis, coord: c.coord,
    color: CUT_COLORS[i % CUT_COLORS.length], active: i === active,
  }))
  const rows: ResultRow[] = cuts.map((c, i) => ({
    name: c.name, color: CUT_COLORS[i % CUT_COLORS.length],
    result: c.result, excluded: c.excluded,
  }))
  const plan = current?.section?.plan

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandMark height={46} />
          <div>
            <h1>EDB to Q2D</h1>
            <p className="sub">
              在 Layout 上指定截面，萃取實際幾何並求解特徵阻抗
            </p>
          </div>
        </div>
        <img className="partner-logo" src={partnerLogo}
             alt="虎門科技股份有限公司 · Ansys Elite Channel Partner" />
      </header>

      <MenuBar menus={menus}
               right={
                 <span className={'status ' + (health.includes('正常') ? 'ok' : 'bad')}>
                   {health}
                 </span>
               } />

      <main style={{ flex: 1, minHeight: 0 }}>
        <Allotment onChange={saveMainSplit}>
          <Allotment.Pane minSize={300} preferredSize={mainSplitSize()}>
            <div className="pane">
              <section className="section">
                <h2><span className="step">1</span> 板檔</h2>
                <div className="row">
                  <label>EDB（.aedb 資料夾）
                    <input type="text" value={aedb} onChange={(e) => setAedb(e.target.value)}
                           placeholder="尚未選擇，或直接貼上路徑" spellCheck={false} />
                  </label>
                  <button onClick={browse} disabled={busy}>瀏覽…</button>
                </div>
                <span className="hint">
                  對話框中請選 <code>.aedb</code> 裡的 <code>edb.def</code>；
                  也可直接貼上路徑，帶引號或指到 <code>edb.def</code> 都會自動修正。
                </span>
                <div className="row" style={{ marginTop: 10 }}>
                  <label>AEDT 版本
                    <select value={version} onChange={(e) => setVersion(e.target.value)}>
                      {(versions?.installed || [version]).map((v) => (
                        <option key={v} value={v}>
                          {v}{versions?.validated.includes(v) ? '' : '（未驗證）'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary" onClick={openBoard} disabled={busy}>開啟</button>
                </div>
                {versions && !versions.validated.includes(version) && (
                  <div className="warnbox">
                    此版本未經完整流程驗證，結果請自行覆核。已驗證：{versions.validated.join('、')}
                  </div>
                )}
                {warning && <div className="warnbox">{warning}</div>}
              </section>

              <section className="section">
                <h2><span className="step">2</span> 工作範圍</h2>
                <div className="row">
                  <button className={selectingRegion ? 'accent' : ''}
                          disabled={!preview || busy}
                          onClick={() => {
                            setSelectingRegion((p) => !p); setPlacing(false); setStage('layout')
                          }}>
                    {selectingRegion ? '在 Layout 上框出範圍…' : '▣ 框選範圍'}
                  </button>
                  <button className="mini" disabled={!region || busy}
                          onClick={() => setRegion(null)}>清除</button>
                </div>
                {region ? (
                  <span className="hint">
                    X {region.x0.toFixed(3)} ~ {region.x1.toFixed(3)}
                    Y {region.y0.toFixed(3)} ~ {region.y1.toFixed(3)} mm
                    （{(region.x1 - region.x0).toFixed(3)} × {(region.y1 - region.y0).toFixed(3)}）
                  </span>
                ) : (
                  <span className="hint">
                    切線的長度由工作範圍決定，所以要先框範圍；範圍同時是截面的側向截斷邊界。
                  </span>
                )}
              </section>

              <section className="section">
                <h2><span className="step">3</span> 截面</h2>
                <div className="row">
                  <label>切線方向
                    <select value={axis} onChange={(e) => setAxis(e.target.value as Axis)}>
                      <option value="x">水平（沿 X）</option>
                      <option value="y">垂直（沿 Y）</option>
                    </select>
                  </label>
                </div>
                <div className="row">
                  <button className={placing ? 'accent' : ''} disabled={!region || busy}
                          onClick={() => {
                            setPlacing((p) => !p); setSelectingRegion(false); setStage('layout')
                          }}>
                    {placing ? '在範圍內點一下…' : '＋ 新增切線'}
                  </button>
                  <button className="mini" disabled={!cuts.length || busy}
                          onClick={deleteCut}>
                    刪除
                  </button>
                </div>
                <span className="hint">
                  切線只能是正 X 或正 Y，兩端貼齊工作範圍。斜切會讓線寬看起來變寬、阻抗偏低。
                </span>
                <div className="cutlist">
                  {cuts.map((c, i) => {
                    const zd = c.result?.pairs?.[0]?.Zdiff ?? c.result?.impedance?.Zdiff
                    return (
                      <div key={i} className={'cutrow' + (i === active ? ' active' : '')}
                           onClick={() => setActive(i)}>
                        <span className="swatch" style={{ background: CUT_COLORS[i % CUT_COLORS.length] }} />
                        <span className="nm">
                          {c.name}
                          <span className="sub">　{c.axis === 'x' ? 'Y=' : 'X='}{c.coord.toFixed(3)}</span>
                        </span>
                        <span className={'z' + (zd == null ? ' pending' : '')}>
                          {zd == null ? '未求解' : `${zd.toFixed(1)} Ω`}
                        </span>
                      </div>
                    )
                  })}
                  {!cuts.length && <span className="hint">尚無切線。框好範圍後按「新增切線」。</span>}
                </div>

                {plan && (
                  <div className="plan">
                    <div className="plan-row">
                      <span>訊號線 <b>{plan.signal_nets.length}</b> 條</span>
                      <span className={plan.has_reference ? 'ok' : 'bad'}>
                        參考導體：{plan.has_reference ? '有' : '無'}
                      </span>
                    </div>
                    {plan.reference_nets?.length > 1 && (
                      <span className="warnbox">
                        {plan.reference_nets.join('、')} 在模型中合併為單一導體 GND。
                        這假設它們在交流上同電位；若要看其中某一條的耦合，
                        請在訊號線清單把它改回訊號。
                      </span>
                    )}
                    <div className="plan-row">
                    </div>
                    <div className="plan-row">
                      <span>可算差分 <b>{plan.pairs.length}</b> 對</span>
                      <span>單端 <b>{plan.conductors.length}</b> 條</span>
                    </div>
                    {plan.pairs.map((p) => (
                      <div key={p.name} className="plan-pair">◇ {p.positive} ↔ {p.negative}</div>
                    ))}
                    {plan.unpaired.length > 0 && (
                      <span className="hint">未配對：{plan.unpaired.join('、')}</span>
                    )}
                    {plan.blocked.map((b, i) => (
                      <div key={i} className="warnbox">{b}</div>
                    ))}
                  </div>
                )}
              </section>

              <section className="section">
                <h2><span className="step">4</span> 訊號線</h2>
                <NetPanel nets={cutNets}
                          excluded={current?.excluded || []}
                          databaseReference={current?.section?.database_reference || []}
                          promotedReference={current?.section?.promoted_reference || []}
                          disabled={busy || !current}
                          onLog={say}
                          onExcludedChange={(ex) => current && patchCut(active, { excluded: ex })}
                          onPromotedChange={(rf) => current && patchCut(active, { reference: rf })} />
              </section>

              <section className="section">
                <h2><span className="step">5</span> 求解</h2>
                <div className="row">
                  <label>求解精度
                    <select value={mode} onChange={(e) => setMode(e.target.value)}>
                      {modes.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {modes.find((m) => m.key === mode) && (
                  <span className="hint">{modes.find((m) => m.key === mode)!.note}</span>
                )}
                <div className="row" style={{ marginTop: 10 }}>
                  <label>自適應頻率
                    <input type="text" value={freq} onChange={(e) => setFreq(e.target.value)} />
                  </label>
                  {busy && solveJob ? (
                    <button className="danger" onClick={cancelSolve}>■ 終止求解</button>
                  ) : (
                    <button className="accent" onClick={solve} disabled={!cuts.length || busy}>
                      建立並求解
                    </button>
                  )}
                </div>
                <span className="hint">會啟動 Ansys Electronics Desktop 並消耗授權。</span>
              </section>
            </div>
          </Allotment.Pane>

          <Allotment.Pane>
            <Allotment vertical onChange={saveLogSplit}>
              <Allotment.Pane preferredSize={logSplitSize()}>
                <div className="stage">
                  <nav className="stage-tabs">
                    {STAGES.map((s) => (
                      <button key={s.key} className={stage === s.key ? 'on' : ''}
                              onClick={() => setStage(s.key)}>
                        {s.label}
                        {s.key === 'q2d' && models.length > 0 ? `（${models.length}）` : ''}
                      </button>
                    ))}
                  </nav>
                  <div className="stage-body">
                    {stage === 'layout' && (
                      <Preview2D data={preview} cuts={markers} activeIndex={active}
                                 placing={placing} axis={axis} region={region}
                                 selectingRegion={selectingRegion}
                                 onRegionChange={(r) => { setRegion(r); setSelectingRegion(false) }}
                                 onSelectCut={setActive}
                                 onCutChange={(i, coord) => patchCut(i, { coord })}
                                 onPlaceCut={placeCut} />
                    )}
                    {stage === 'section' && (
                      <CrossSectionView data={current?.section || null}
                                        scanning={scanning} disabled={busy}
                                        onToggleRole={toggleRole} />
                    )}
                    {stage === 'q2d' && (
                      <Q2DModelView models={models} solving={busy && !!solveJob}
                                    onCancel={cancelSolve} />
                    )}
                    {stage === 'results' && (
                      <ResultsView rows={rows} activeIndex={active} onSelect={setActive} />
                    )}
                  </div>
                </div>
              </Allotment.Pane>
              <Allotment.Pane minSize={90} preferredSize="22%">
                <div className="logpane">
                  <div className="logbar">
                    <span>系統日誌</span>
                    <span className="logbar-actions">
                      <button className="mini"
                              onClick={() => navigator.clipboard?.writeText(log.join('\n'))}>
                        複製
                      </button>
                      <button className="mini" onClick={() => setLog([])}>清除</button>
                    </span>
                  </div>
                  <pre className="log" ref={logRef}>{log.join('\n') || '目前無日誌…'}</pre>
                </div>
              </Allotment.Pane>
            </Allotment>
          </Allotment.Pane>
        </Allotment>
      </main>

      <HelpDialog topic={help} version={version} onClose={() => setHelp(null)} />
    </div>
  )
}
