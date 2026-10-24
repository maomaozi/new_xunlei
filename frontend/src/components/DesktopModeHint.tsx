import { MonitorSmartphone, X } from 'lucide-react'
import { useState } from 'react'
import { currentPhoneInDesktopMode } from '../lib/viewport'

const KEY = 'xl-desktop-mode-hint'

function dismissed() {
  try {
    return localStorage.getItem(KEY) === 'dismissed'
  } catch {
    return false
  }
}

/** Explains why a phone sees the desktop layout and how to get the phone layout back. */
export default function DesktopModeHint() {
  const [hidden, setHidden] = useState(() => dismissed() || !currentPhoneInDesktopMode())
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
    <div className="hero-gradient mb-6 rounded-[24px] p-4" style={{ fontSize: 14 * scale }}>
      <div className="flex items-start gap-[0.8em]">
        <MonitorSmartphone size={22 * scale} className="mt-[0.1em] shrink-0" />
        <div className="min-w-0 flex-1 leading-relaxed">
          <div className="font-bold" style={{ fontSize: '1.15em' }}>
            浏览器正以「桌面网站」模式打开本站
          </div>
          <div className="mt-[0.3em] text-white/90">
            此模式下浏览器会忽略手机适配，只能显示电脑布局。关闭后即可使用手机界面：
            Safari 点地址栏左侧「页面菜单 / 大小」→「请求移动网站」，或在 设置 → Safari →「请求桌面网站」中关闭；Chrome 点菜单取消勾选「桌面版网站」。
          </div>
        </div>
        <button type="button" aria-label="不再提示" onClick={close} className="shrink-0 cursor-pointer rounded-full border-0 bg-white/20 p-[0.4em] text-white">
          <X size={16 * scale} />
        </button>
      </div>
    </div>
  )
}
