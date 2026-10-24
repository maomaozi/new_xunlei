import { StyleProvider } from '@ant-design/cssinjs'
import { App as AntApp, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'
import { useAppSettings } from '../lib/settingsContext'

/** Maps the neumorphic tokens and runtime theme/accent settings onto Ant Design. */
export default function ThemedApp({ children }: { children: ReactNode }) {
  const { resolvedTheme, settings } = useAppSettings()
  const dark = resolvedTheme === 'dark'
  const accent = settings?.ui.accent ?? '#5b7cfa'
  const surface = dark ? '#22252b' : '#e7ebf1'
  return (
    <StyleProvider layer>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: accent,
          colorInfo: accent,
          colorBgBase: surface,
          colorBgContainer: surface,
          colorBgElevated: surface,
          colorBgLayout: surface,
          colorBorder: 'transparent',
          colorBorderSecondary: dark ? 'rgba(255,255,255,0.06)' : 'rgba(120,132,156,0.18)',
          colorText: dark ? '#e5e8ef' : '#2a3140',
          colorTextSecondary: dark ? '#a7afbe' : '#5d6779',
          colorSuccess: '#2fb67c',
          colorWarning: '#e9a23b',
          colorError: '#e5566b',
          borderRadius: 14,
          borderRadiusLG: 22,
          borderRadiusSM: 10,
          controlHeight: 40,
          controlHeightLG: 46,
          fontFamily: 'Inter, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif',
          boxShadow: 'none',
          wireframe: false,
        },
        components: {
          Modal: { contentBg: surface, headerBg: surface, footerBg: surface, titleFontSize: 17 },
          Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', fontWeight: 500 },
          Segmented: { trackBg: surface, itemSelectedBg: surface },
          Tabs: { inkBarColor: accent },
          Checkbox: { colorBorder: dark ? '#4b515d' : '#b6bfce' },
          Radio: { colorBorder: dark ? '#4b515d' : '#b6bfce' },
          Dropdown: { paddingBlock: 8 },
          Tooltip: { colorBgSpotlight: dark ? '#353a44' : '#3a4152' },
        },
      }}
    >
      <AntApp message={{ top: 64, maxCount: 3 }}>{children}</AntApp>
    </ConfigProvider>
    </StyleProvider>
  )
}
