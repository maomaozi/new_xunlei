import { ZoomIn, X } from 'lucide-react'
import { useState } from 'react'
import { currentPhoneZoomedOut } from '../lib/viewport'

const KEY = 'xl-zoom-hint'

function dismissed() {
  try {
    return localStorage.getItem(KEY) === 'dismissed'
  } catch {
    return false
  }
}

/** Tells phone users why the whole page looks shrunk and how to restore normal size. */
export default function ZoomHint() {
  const [hidden, setHidden] = useState(() => dismissed() || !currentPhoneZoomedOut())
  if (hidden) return null
  // The page is scaled down to fit the screen; scale the hint back up so it stays readable.
  const scale = Math.max(1, window.innerWidth / Math.min(window.screen.width, window.screen.height))
  const close = () => {
    try {
      localStorage.setItem(KEY, 'dismissed')
    } catch {
      // Remembering the dismissal is a convenience only.
    }
    setHidden(true)
  }
  return (
    <div className="hero-gradient mt-3 mb-4 rounded-[22px] p-4" style={{ fontSize: 13 * scale }}>
      <div className="flex items-start gap-[0.8em]">
        <ZoomIn size={20 * scale} className="mt-[0.1em] shrink-0" />
        <div className="min-w-0 flex-1 leading-relaxed">
          <div className="font-bold" style={{ fontSize: '1.1em' }}>
            页面被缩小显示了
          </div>
          <div className="mt-[0.3em] text-white/90">
            浏览器的页面缩放低于 100%（或开启了「请求桌面网站」），文字和按钮都会变小。Safari 点地址栏的「页面菜单 / 大小」把缩放调回 100%，或选「请求移动网站」即可恢复。
          </div>
        </div>
        <button type="button" aria-label="不再提示" onClick={close} className="shrink-0 cursor-pointer rounded-full border-0 bg-white/20 p-[0.4em] text-white">
          <X size={14 * scale} />
        </button>
      </div>
    </div>
  )
}
