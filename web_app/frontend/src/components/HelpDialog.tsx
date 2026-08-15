// 「說明」選單開出來的視窗：快速上手與關於。
//
// 內容只寫工具真正的行為與限制，尤其是那些從介面上看不出來、但會影響數字的事
// （切線必須是軸向的、參考網路會合併、AEDT 在背景跑）。寫成一般的說明文只會被略過；
// 寫成「不知道就會算錯」的清單才有人看。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import React, { useEffect } from 'react'

export type HelpTopic = 'guide' | 'about'

interface Props {
  topic: HelpTopic | null
  version: string
  onClose: () => void
}

export default function HelpDialog({ topic, version, onClose }: Props) {
  useEffect(() => {
    if (!topic) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [topic, onClose])

  if (!topic) return null

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{topic === 'guide' ? '快速上手' : '關於 EDB to Q2D'}</h2>
          <button className="mini" onClick={onClose}>關閉</button>
        </div>

        {topic === 'guide' ? (
          <div className="modal-body">
            <ol className="guide">
              <li>
                <b>板檔</b>：選 <code>.aedb</code> 資料夾裡的 <code>edb.def</code>，
                按「開啟」。同一塊板子存過的截面設定會自動載回來。
              </li>
              <li>
                <b>工作範圍</b>：在 Layout 上框一個矩形。切線的長度由它決定，
                它同時是截面的側向截斷邊界——框太窄會把回流路徑切掉，阻抗會偏高。
              </li>
              <li>
                <b>截面</b>：選方向後按「新增切線」，在範圍內點一下。
                切線只能是正 X 或正 Y；斜切會讓線寬量起來變寬、阻抗偏低，所以不提供。
              </li>
              <li>
                <b>訊號線</b>：這裡列的是這條切線真正切到的 net。
                可以排除不想要的，或把某條升為參考。資料庫已標記為電源／接地的
                不能排除，因為模型會失去回流路徑。
              </li>
              <li>
                <b>求解</b>：設定精度與自適應頻率後按「建立並求解」。
                AEDT 會在背景啟動並消耗授權；「Q2D 模型」頁會顯示 AEDT 自己畫的截面，
                求解開始前就能確認建模有沒有錯。
              </li>
            </ol>
            <h3>會影響數字、但畫面上看不出來的事</h3>
            <ul className="guide">
              <li>所有參考角色的導體在 Q2D 裡合併成單一導體 <code>GND</code>，
                  這假設它們在交流上同電位。要看其中某一條的耦合，就得把它改回訊號。</li>
              <li>導體數不同的兩個結果不能直接比：多一條導體就是多一個耦合對象，
                  而且差分值會從精確變成近似。</li>
              <li>結果會連同精度與導體清單一起存進板檔旁的側檔，
                  下次開啟時看得到每個數字是在什麼前提下算出來的。</li>
            </ul>
          </div>
        ) : (
          <div className="modal-body">
            <p>
              在 PCB Layout 上指定一條切線，萃取該處的實際疊構幾何，
              於 Ansys Q2D Extractor 建立二維截面模型並求解特徵阻抗。
            </p>
            <table className="about">
              <tbody>
                <tr><th>目前 AEDT 版本</th><td>{version}</td></tr>
                <tr><th>求解器</th><td>Ansys Q2D Extractor（背景執行）</td></tr>
                <tr><th>資料處理位置</th><td>全部在本機，不會上傳板檔或求解結果</td></tr>
                <tr><th>提供者</th><td>虎門科技資深技術工程師 Jeff Hong 洪敬傑</td></tr>
              </tbody>
            </table>
            <p className="hint">
              Ansys 為 Ansys, Inc. 之商標。本工具為技術示範用途，非 Ansys, Inc. 之官方產品。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
