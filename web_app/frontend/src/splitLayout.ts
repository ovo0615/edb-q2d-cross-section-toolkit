// 分隔線位置的記憶：拖過一次就當成預設，下次開啟維持原樣。
//
// 存「比例」而不是「像素」：這個工具常在不同機器、不同解析度的螢幕上開
// （自己的筆電、會議室投影、求解機的遠端桌面）。存像素在窄螢幕上會讓某一側
// 幾乎消失，在寬螢幕上又只佔一小條；存比例則在任何寬度下維持同樣的版面感覺。
//
// 但比例只能透過 <Allotment.Pane preferredSize="30%"> 交給 Allotment。
// 它的 defaultSizes 參數單位是「像素」——把 [30, 70] 餵進去，Allotment 會以為
// 整個容器只有 100 px；側欄的 minSize 佔掉 280 之後，右邊那格就是 0 寬，
// 畫布整個消失。這個錯誤在畫面上看起來像「圖層面板跑到下面去了」。
const DEFAULT_MAIN = 30
const DEFAULT_LOG = 80
const MAIN_KEY = 'edb2q2d.split.main.v2'
const LOG_KEY = 'edb2q2d.split.log.v2'

/** 第一格佔的百分比。夾在 10~90 之間，避免存到會讓某一側消失的值。 */
function loadPct(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const value = Number(raw)
    if (!isFinite(value) || value < 10 || value > 90) return fallback
    return value
  } catch { return fallback }
}

function savePct(key: string, sizes: number[]): void {
  if (!Array.isArray(sizes) || sizes.length < 2) return
  const total = sizes.reduce((s, n) => s + n, 0)
  // 面板收合或還沒量到寬度時 onChange 也會觸發，那時的值不能拿來當偏好。
  if (!isFinite(total) || total <= 0) return
  const pct = (sizes[0] / total) * 100
  if (!isFinite(pct) || pct < 10 || pct > 90) return
  try {
    window.localStorage.setItem(key, String(Math.round(pct * 10) / 10))
  } catch {
    // localStorage 不可用（無痕、配額滿）時不該讓介面壞掉，只是這次拖曳不被記住。
  }
}

export const mainSplitSize = () => `${loadPct(MAIN_KEY, DEFAULT_MAIN)}%`
export const logSplitSize = () => `${loadPct(LOG_KEY, DEFAULT_LOG)}%`
export const saveMainSplit = (sizes: number[]) => savePct(MAIN_KEY, sizes)
export const saveLogSplit = (sizes: number[]) => savePct(LOG_KEY, sizes)
