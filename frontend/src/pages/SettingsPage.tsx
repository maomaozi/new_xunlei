import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Form, Input, InputNumber, Switch, type FormInstance } from 'antd'
import {
  Cloud,
  Cpu,
  Download,
  Globe,
  HardDrive,
  Info,
  Magnet,
  Minus,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Save,
  Server,
  Share2,
  Upload,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import FolderPickerModal from '../components/FolderPickerModal'
import LocalPathPicker from '../components/LocalPathPicker'
import OptionSelect from '../components/OptionSelect'
import PageHeader from '../components/PageHeader'
import { cx } from '../lib/cx'
import { Card, IconButton, IconTile, ListGroup, ListItem, PillButton, SectionHeader, type Tone } from '../components/ui'
import { useIsMobile } from '../hooks/useMediaQuery'
import { errorMessage, settingsApi, systemApi, type AppSettings, type SettingsSection } from '../lib/api'
import { formatBytes } from '../lib/format'
import { PLAYERS } from '../lib/players'
import { useAppSettings } from '../lib/settingsContext'
import AccountPanel from './settings/AccountPanel'

interface Tab {
  key: string
  label: string
  icon: LucideIcon
  tone: Tone
  group: string
  hint: string
}

const TABS: Tab[] = [
  { key: 'account', label: '账号', icon: UserRound, tone: 'accent', group: '账号', hint: '登录方式、Token 与设备 ID' },
  { key: 'engine', label: '下载引擎', icon: Cpu, tone: 'accent', group: '下载与传输', hint: '目录、限速、并发与进程' },
  { key: 'download', label: '云盘下载', icon: Download, tone: 'success', group: '下载与传输', hint: '下载方式与内置下载器' },
  { key: 'upload', label: '上传', icon: Upload, tone: 'success', group: '下载与传输', hint: '秒传、分片与并发' },
  { key: 'offline', label: '云添加', icon: Magnet, tone: 'violet', group: '下载与传输', hint: '默认保存位置与刷新' },
  { key: 'drive', label: '云盘', icon: Cloud, tone: 'warning', group: '云盘', hint: '视图、排序与删除方式' },
  { key: 'share', label: '分享', icon: Share2, tone: 'violet', group: '云盘', hint: '有效期与提取码默认值' },
  { key: 'player', label: '播放', icon: Play, tone: 'danger', group: '云盘', hint: '外部播放器与自动播放' },
  { key: 'ui', label: '外观', icon: Palette, tone: 'violet', group: '通用', hint: '主题、强调色与动画' },
  { key: 'network', label: '网络', icon: Globe, tone: 'accent', group: '通用', hint: '代理、超时与直连 IP' },
  { key: 'system', label: '系统', icon: Server, tone: 'muted', group: '通用', hint: '本机访问范围与运行环境' },
  { key: 'about', label: '关于', icon: Info, tone: 'muted', group: '通用', hint: '说明与 API 文档' },
]

const TAB_GROUPS = [...new Set(TABS.map((t) => t.group))]

const ACCENTS = ['#5b7cfa', '#7a6cf6', '#2fb6a5', '#3fa1f0', '#f0739a', '#f2994a', '#2fb67c', '#e5566b']

/* --------------------------------------------------------------- form parts */

function Row({ label, desc, children }: { label: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0 sm:max-w-[55%]">
        <div className="text-[14px] font-medium text-ink">{label}</div>
        {desc && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{desc}</div>}
      </div>
      <div className="w-full shrink-0 sm:w-auto sm:min-w-[260px] [&_.ant-form-item]:mb-0">{children}</div>
    </div>
  )
}

function Field({ name, label, desc, children, valuePropName }: { name: string | (string | number)[]; label: string; desc?: ReactNode; children: ReactNode; valuePropName?: string }) {
  return (
    <Row label={label} desc={desc}>
      <Form.Item name={name} valuePropName={valuePropName} noStyle>
        {children}
      </Form.Item>
    </Row>
  )
}

function SwitchField({ name, label, desc }: { name: string; label: string; desc?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{label}</div>
        {desc && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{desc}</div>}
      </div>
      <Form.Item name={name} valuePropName="checked" noStyle>
        <Switch />
      </Form.Item>
    </div>
  )
}

function NumberInput(props: { min?: number; max?: number; step?: number; suffix?: string; value?: number; onChange?: (v: number | null) => void }) {
  return <InputNumber {...props} className="!w-full sm:!w-[260px]" />
}

function SectionForm<S extends SettingsSection>({
  section,
  title,
  description,
  toForm,
  fromForm,
  children,
}: {
  section: S
  title: string
  description?: string
  toForm?: (value: AppSettings[S]) => Record<string, unknown>
  fromForm?: (values: Record<string, unknown>) => Partial<AppSettings[S]>
  children: (form: FormInstance) => ReactNode
}) {
  const { message, modal } = App.useApp()
  const { settings, update } = useAppSettings()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const value = settings?.[section]

  useEffect(() => {
    if (!value) return
    form.setFieldsValue(toForm ? toForm(value) : (value as Record<string, unknown>))
    // toForm is a pure mapper that callers pass inline; only the stored value matters here.
  }, [value, form]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      await update(section, fromForm ? fromForm(values) : (values as Partial<AppSettings[S]>))
      setDirty(false)
      message.success('设置已保存并立即生效')
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      message.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const reset = () =>
    modal.confirm({
      title: `恢复「${title}」的默认设置？`,
      okText: '恢复默认',
      onOk: async () => {
        try {
          const saved = await settingsApi.reset(section)
          queryClient.setQueryData(['settings'], saved)
          setDirty(false)
          message.success('已恢复默认')
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })

  if (!value) return null
  return (
    <Card className="p-4 md:p-7">
      <SectionHeader
        title={title}
        extra={<IconButton icon={RotateCcw} label="恢复默认" size="sm" onClick={reset} />}
        className="!mb-1"
      />
      {description && <div className="mb-2 text-[13px] text-ink-3">{description}</div>}
      <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} onFinish={() => void save()} requiredMark={false}>
        {children(form)}
      </Form>
      <div
        className={cx(
          'glass-card sticky bottom-[calc(env(safe-area-inset-bottom)+88px)] z-30 mt-5 flex items-center justify-end gap-2.5 rounded-[22px] p-2 pl-4 transition-all duration-300 md:bottom-6',
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
      >
        <span className="mr-auto text-[12px] text-ink-3">有未保存的修改</span>
        <PillButton onClick={() => (form.resetFields(), form.setFieldsValue(toForm ? toForm(value) : value), setDirty(false))}>撤销</PillButton>
        <PillButton primary icon={Save} disabled={saving} onClick={() => save()}>
          保存
        </PillButton>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ panels */

function NetworkPanel() {
  return (
    <SectionForm
      section="network"
      title="网络"
      description="修改后会重建 HTTP 连接池，对之后的请求立即生效。"
      toForm={(v) => ({ ...v, host_overrides: Object.entries(v.host_overrides).map(([host, ip]) => ({ host, ip })) })}
      fromForm={(values) => ({
        ...(values as Partial<AppSettings['network']>),
        host_overrides: Object.fromEntries(
          ((values.host_overrides as { host?: string; ip?: string }[] | undefined) ?? [])
            .filter((row) => row.host && row.ip)
            .map((row) => [row.host!.trim(), row.ip!.trim()]),
        ),
      })}
    >
      {() => (
        <>
          <Field name="pan_host" label="云盘 API 地址" desc="api-pan.xunlei.com">
            <Input />
          </Field>
          <Field name="auth_host" label="认证 API 地址" desc="xluser-ssl.xunlei.com">
            <Input />
          </Field>
          <Row
            label="域名直连 IP"
            desc="为指定域名设置固定连接 IP，连接时仍校验原域名证书。默认 api-pan.xunlei.com → 101.91.143.206。"
          >
            <Form.List name="host_overrides">
              {(fields, { add, remove }) => (
                <div className="space-y-2">
                  {fields.map((field) => (
                    <div key={field.key} className="flex gap-2">
                      <Form.Item name={[field.name, 'host']} noStyle>
                        <Input placeholder="域名" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'ip']} noStyle>
                        <Input placeholder="IP" className="!w-44 shrink-0" />
                      </Form.Item>
                      <IconButton icon={Minus} label="删除" size="sm" onClick={() => remove(field.name)} />
                    </div>
                  ))}
                  <PillButton icon={Plus} onClick={() => add({ host: '', ip: '' })} className="!py-2">
                    添加映射
                  </PillButton>
                </div>
              )}
            </Form.List>
          </Row>
          <Field name="connect_timeout" label="连接超时" desc="建立 TCP/TLS 连接的最长等待时间">
            <NumberInput min={1} max={120} suffix="秒" />
          </Field>
          <Field name="request_timeout" label="请求超时" desc="单次 API 请求读取响应的最长时间">
            <NumberInput min={3} max={300} suffix="秒" />
          </Field>
          <Field name="max_retries" label="失败重试次数" desc="连接失败、超时或 5xx 时自动重试（非幂等请求仅在未送达时重试）">
            <NumberInput min={0} max={10} suffix="次" />
          </Field>
          <Field name="retry_backoff" label="重试退避基数" desc="第 n 次重试等待 基数 × 2ⁿ 秒">
            <NumberInput min={0} max={30} step={0.1} suffix="秒" />
          </Field>
          <Field name="proxy" label="代理服务器" desc="例如 http://127.0.0.1:7890 或 socks5://…，留空直连">
            <Input placeholder="不使用代理" />
          </Field>
          <SwitchField name="verify_tls" label="校验 TLS 证书" desc="关闭后可配合抓包调试，生产环境请保持开启" />
          <Field name="api_user_agent" label="API User-Agent">
            <Input />
          </Field>
          <Field name="cdn_user_agent" label="CDN User-Agent" desc="VIP 加速 CDN 会断开非浏览器 UA 的连接">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          </Field>
        </>
      )}
    </SectionForm>
  )
}

function DrivePanel() {
  return (
    <SectionForm section="drive" title="云盘">
      {() => (
        <>
          <Field name="page_size" label="每页加载数量" desc="滚动到底部自动加载下一页">
            <NumberInput min={20} max={500} suffix="项" />
          </Field>
          <Field name="default_view" label="默认视图">
            <OptionSelect title="默认视图" options={[{ value: 'list', label: '列表' }, { value: 'grid', label: '网格' }]} />
          </Field>
          <Field name="sort_by" label="排序方式">
            <OptionSelect title="排序方式"
              options={[
                { value: 'name', label: '名称' },
                { value: 'modified_time', label: '修改时间' },
                { value: 'created_time', label: '创建时间' },
                { value: 'size', label: '大小' },
              ]}
            />
          </Field>
          <Field name="sort_order" label="排序方向">
            <OptionSelect title="排序方向" options={[{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }]} />
          </Field>
          <SwitchField name="folders_first" label="文件夹优先" />
          <SwitchField name="show_thumbnails" label="显示缩略图" desc="视频 / 图片显示迅雷生成的预览图" />
          <Field name="delete_mode" label="默认删除方式">
            <OptionSelect title="默认删除方式" options={[{ value: 'trash', label: '移入回收站' }, { value: 'permanent', label: '彻底删除' }]} />
          </Field>
          <SwitchField name="confirm_delete" label="删除前确认" />
        </>
      )}
    </SectionForm>
  )
}

function DownloadPanel() {
  const [picking, setPicking] = useState(false)
  const disk = useQuery({ queryKey: ['system'], queryFn: systemApi.info })
  return (
    <SectionForm section="download" title="云盘文件下载到本机" description="云盘文件可交给迅雷引擎（会员加速、文件夹取回），或使用内置 HTTP 下载器从 VIP CDN 多线程拉取。以下目录与线程设置仅作用于内置下载器。">
      {(form) => (
        <>
          <Field name="cloud_engine" label="下载方式" desc="迅雷引擎任务显示在「下载」页，内置下载器任务显示在「传输」页">
            <OptionSelect title="下载方式"
              options={[
                { value: 'engine', label: '迅雷下载引擎（推荐）' },
                { value: 'builtin', label: '内置 HTTP 下载器' },
              ]}
            />
          </Field>
          <Row
            label="下载目录"
            desc={disk.data?.download_disk ? `可用 ${formatBytes(disk.data.download_disk.free)} / 共 ${formatBytes(disk.data.download_disk.total)}` : '服务器上的绝对路径'}
          >
            <div className="flex gap-2">
              <Form.Item name="directory" noStyle rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <PillButton icon={HardDrive} onClick={() => setPicking(true)} className="!py-2">
                浏览
              </PillButton>
            </div>
            <LocalPathPicker
              open={picking}
              title="选择下载目录"
              mode="dir"
              initialPath={form.getFieldValue('directory') as string}
              onCancel={() => setPicking(false)}
              onPick={(path) => {
                form.setFieldValue('directory', path)
                form.validateFields(['directory']).catch(() => undefined)
                setPicking(false)
                form.submit()
              }}
            />
          </Row>
          <Field name="max_concurrent" label="同时下载任务数">
            <NumberInput min={1} max={10} suffix="个" />
          </Field>
          <Field name="connections_per_file" label="单文件线程数" desc="大文件会被切成多个分段并行下载">
            <NumberInput min={1} max={16} suffix="线程" />
          </Field>
          <Field name="min_segment_mb" label="最小分段大小" desc="文件小于 线程数 × 分段大小 时会减少线程">
            <NumberInput min={1} max={1024} suffix="MB" />
          </Field>
          <Field name="chunk_kb" label="读写块大小">
            <NumberInput min={16} max={8192} suffix="KB" />
          </Field>
          <Field name="speed_limit_kbps" label="全局限速" desc="所有下载共享，0 表示不限速">
            <NumberInput min={0} suffix="KB/s" />
          </Field>
          <Field name="retry_count" label="分段重试次数" desc="连接中断后自动重试，并在连续失败时刷新 CDN 直链">
            <NumberInput min={0} max={50} suffix="次" />
          </Field>
          <Field name="conflict" label="同名文件处理">
            <OptionSelect title="同名文件处理"
              options={[
                { value: 'rename', label: '自动重命名' },
                { value: 'overwrite', label: '覆盖' },
                { value: 'skip', label: '跳过' },
              ]}
            />
          </Field>
          <SwitchField name="preserve_tree" label="保留文件夹结构" desc="下载文件夹时在本地重建目录层级" />
          <SwitchField name="auto_resume" label="启动时自动继续" desc="服务重启后继续未完成的任务" />
          <SwitchField
            name="proxy_browser_downloads"
            label="浏览器下载 / 播放经由服务器中转"
            desc="CDN 直链与服务器公网 IP 绑定；从外网访问本站时请开启"
          />
        </>
      )}
    </SectionForm>
  )
}

function DirField({ name, label, desc, form }: { name: string; label: string; desc?: string; form: FormInstance }) {
  const [picking, setPicking] = useState(false)
  return (
    <Row label={label} desc={desc}>
      <div className="flex gap-2">
        <Form.Item name={name} noStyle>
          <Input placeholder="默认" className="!font-mono" />
        </Form.Item>
        <PillButton icon={HardDrive} onClick={() => setPicking(true)} className="!py-2">
          浏览
        </PillButton>
      </div>
      <LocalPathPicker
        open={picking}
        title={label}
        mode="dir"
        initialPath={(form.getFieldValue(name) as string) || undefined}
        onCancel={() => setPicking(false)}
        onPick={(path) => {
          form.setFieldValue(name, path)
          setPicking(false)
          form.submit()
        }}
      />
    </Row>
  )
}

/** Additional engine download folders, each picked from the host file system. */
function ExtraDirsField({ form }: { form: FormInstance }) {
  // Row index being edited, or -1 to append a new folder.
  const [picking, setPicking] = useState<number | null>(null)
  const name = 'extra_download_dirs'
  const current = () => ((form.getFieldValue(name) as string[] | undefined) ?? []).filter(Boolean)
  return (
    <Row label="其他下载目录" desc="新建下载时可选择的其他保存位置">
      <Form.List name={name}>
        {(fields, { remove }) => (
          <div className="space-y-2">
            {fields.map((field) => (
              <div key={field.key} className="flex gap-2">
                <Form.Item name={field.name} noStyle rules={[{ required: true }]}>
                  <Input placeholder="/mnt/disk/downloads" className="!font-mono" />
                </Form.Item>
                <PillButton icon={HardDrive} onClick={() => setPicking(field.name)} className="!py-2">
                  浏览
                </PillButton>
                <IconButton icon={Minus} label="移除" size="sm" onClick={() => remove(field.name)} />
              </div>
            ))}
            <PillButton icon={Plus} onClick={() => setPicking(-1)} className="!py-2">
              添加目录
            </PillButton>
          </div>
        )}
      </Form.List>
      <LocalPathPicker
        open={picking !== null}
        title="选择下载目录"
        mode="dir"
        initialPath={picking !== null && picking >= 0 ? current()[picking] : undefined}
        onCancel={() => setPicking(null)}
        onPick={(path) => {
          const dirs = [...((form.getFieldValue(name) as string[] | undefined) ?? [])]
          if (picking !== null && picking >= 0) dirs[picking] = path
          else if (!dirs.includes(path)) dirs.push(path)
          form.setFieldValue(name, dirs)
          setPicking(null)
          form.submit()
        }}
      />
    </Row>
  )
}

function EnginePanel() {
  return (
    <div className="space-y-6">
      <SectionForm
        section="engine"
        title="下载引擎"
        description="限速、并发、目录等修改会立即生效；程序、端口、平台、数据目录变更会自动重启引擎。"
      >
        {(form) => (
          <>
            <SwitchField name="enabled" label="启用下载引擎" desc="关闭后停止引擎，「下载」页不可用" />
            <DirField name="download_dir" label="默认下载目录" desc="链接、种子与云盘取回的默认保存位置" form={form} />
            <ExtraDirsField form={form} />
            <Field name="speed_limit_kbps" label="下载限速" desc="引擎全部任务共享，0 表示不限速">
              <NumberInput min={0} suffix="KB/s" />
            </Field>
            <Field name="max_running_tasks" label="同时下载任务数">
              <NumberInput min={1} max={30} suffix="个" />
            </Field>
            <Field name="device_name" label="设备名称" desc="在迅雷 App「远程设备」中显示的名称，留空使用平台默认名">
              <Input placeholder="默认" maxLength={60} />
            </Field>
            <SwitchField name="delete_files_with_task" label="删除任务时默认同时删除文件" />
            <SwitchField name="live_progress" label="实时进度" desc="直接从本机引擎内存读取进度与速度（约 10ms，不经迅雷云端；云端记录约每分钟才更新一次）" />
            <Field name="live_poll_ms" label="实时进度刷新间隔">
              <NumberInput min={500} max={10000} step={500} suffix="毫秒" />
            </Field>
            <Field name="task_poll_seconds" label="云端任务列表刷新间隔" desc="有进行中任务时同步任务列表与状态的频率；任务开始、完成或状态变化时会立即刷新">
              <NumberInput min={2} max={120} suffix="秒" />
            </Field>
          </>
        )}
      </SectionForm>
      <SectionForm section="engine" title="进程与运行环境（高级）" description="通常无需修改。">
        {(form) => (
          <>
            <Field name="binary_path" label="引擎程序路径" desc="留空使用自带的下载引擎，自动匹配当前设备架构">
              <Input placeholder="自动查找" className="!font-mono" />
            </Field>
            <DirField name="home_dir" label="引擎数据目录" desc="引擎的 HOME（含 .drive 登录状态），留空使用 <数据目录>/engine" form={form} />
            <DirField name="torrent_dir" label="种子缓存目录" desc="磁力解析得到的 .torrent，留空使用 <引擎数据目录>/torrents" form={form} />
            <Field name="platform" label="平台身份" desc="需账号拥有对应平台的使用权限">
              <OptionSelect title="平台身份"
                options={[
                  { value: 'qnap', label: '威联通 QNAP' },
                  { value: 'synology', label: '群晖 Synology' },
                  { value: 'docker', label: '通用平台' },
                ]}
              />
            </Field>
            <Field name="nas_id" label="NAS ID">
              <Input className="!font-mono" />
            </Field>
            <Field name="control_port" label="本地控制端口" desc="仅监听 127.0.0.1；开启实时进度后引擎还会占用 端口+2 作为 pprof 调试端口">
              <NumberInput min={1024} max={65533} />
            </Field>
            <Field name="public_port" label="内部服务端口">
              <NumberInput min={1024} max={65535} />
            </Field>
            <Field name="launcher_port" label="本地验证端口" desc="用于下载引擎的本地连接验证">
              <NumberInput min={1024} max={65535} />
            </Field>
            <Field name="single_task_max_mb" label="单任务缓存上限">
              <NumberInput min={10} max={4096} suffix="MB" />
            </Field>
            <Field name="single_task_reserve_mb" label="单任务预留缓存">
              <NumberInput min={1} max={1024} suffix="MB" />
            </Field>
            <Field name="overall_share_max_mb" label="全局共享缓存上限">
              <NumberInput min={10} max={8192} suffix="MB" />
            </Field>
            <SwitchField name="auto_restart" label="异常退出自动重启" desc="按 5 秒起指数退避，最长 60 秒" />
            <SwitchField name="stop_with_app" label="随本服务一起停止" desc="关闭后本服务重启时引擎继续运行，并在下次启动时自动接管" />
            <Field name="log_max_mb" label="日志轮转大小" desc="引擎日志超过该大小时转存为 engine.log.1（运行中也会检查；实时进度需要 debug 日志级别，日志增长较快）">
              <NumberInput min={1} max={1024} suffix="MB" />
            </Field>
          </>
        )}
      </SectionForm>
    </div>
  )
}

function UploadPanel() {
  return (
    <SectionForm section="upload" title="上传到云盘" description="先计算迅雷 GCID 尝试秒传，未命中时使用阿里云 OSS 临时凭证直传。">
      {() => (
        <>
          <Field name="temp_dir" label="浏览器上传暂存目录" desc="留空使用 <数据目录>/uploads">
            <Input placeholder="默认" />
          </Field>
          <Field name="max_concurrent" label="同时上传任务数">
            <NumberInput min={1} max={8} suffix="个" />
          </Field>
          <Field name="multipart_threshold_mb" label="分片上传阈值" desc="超过该大小使用 OSS Multipart（单次 PUT 上限 5GB）">
            <NumberInput min={5} max={5000} suffix="MB" />
          </Field>
          <Field name="part_size_mb" label="分片大小">
            <NumberInput min={1} max={512} suffix="MB" />
          </Field>
          <Field name="part_concurrency" label="分片并发数">
            <NumberInput min={1} max={16} suffix="个" />
          </Field>
          <Field name="retry_count" label="上传重试次数">
            <NumberInput min={0} max={20} suffix="次" />
          </Field>
          <SwitchField name="instant_only" label="仅秒传" desc="未命中秒传时直接失败，不上传实际数据" />
          <SwitchField name="delete_temp_after" label="完成后删除暂存文件" />
        </>
      )}
    </SectionForm>
  )
}

function OfflinePanel() {
  const [picking, setPicking] = useState(false)
  return (
    <SectionForm section="offline" title="云添加" description="链接由迅雷云端离线下载并保存到云盘。要直接下载到本机，请使用「下载」页。">
      {(form) => (
        <>
          <Row label="默认保存位置" desc="新建云添加任务时默认保存的云盘文件夹">
            <div className="flex gap-2">
              <Form.Item name="default_parent_name" noStyle>
                <Input readOnly />
              </Form.Item>
              <Form.Item name="default_parent_id" noStyle>
                <Input type="hidden" />
              </Form.Item>
              <PillButton icon={Cloud} onClick={() => setPicking(true)} className="!py-2">
                选择
              </PillButton>
            </div>
            <FolderPickerModal
              open={picking}
              title="默认保存位置"
              onCancel={() => setPicking(false)}
              onPick={(folder) => {
                form.setFieldsValue({ default_parent_id: folder.id, default_parent_name: folder.name })
                setPicking(false)
                form.submit()
              }}
            />
          </Row>
          <Field name="refresh_interval_seconds" label="任务进度刷新间隔" desc="有进行中任务时的轮询频率">
            <NumberInput min={2} max={120} suffix="秒" />
          </Field>
          <SwitchField name="delete_files_with_task" label="删除任务时默认同时删除文件" />
        </>
      )}
    </SectionForm>
  )
}

function SharePanel() {
  return (
    <SectionForm section="share" title="分享默认值">
      {() => (
        <>
          <Field name="expiration_days" label="默认有效期">
            <OptionSelect title="默认有效期"
              options={[
                { value: 1, label: '1 天' },
                { value: 7, label: '7 天' },
                { value: 30, label: '30 天' },
                { value: 365, label: '365 天' },
                { value: -1, label: '永久' },
              ]}
            />
          </Field>
          <SwitchField name="use_pass_code" label="默认使用提取码" />
          <Field name="restore_limit" label="默认转存次数上限" desc="-1 表示不限">
            <NumberInput min={-1} />
          </Field>
          <Field name="title" label="默认分享标题">
            <Input />
          </Field>
        </>
      )}
    </SectionForm>
  )
}

function PlayerPanel() {
  return (
    <SectionForm section="player" title="播放">
      {() => (
        <>
          <Field name="external_player" label="外部播放器" desc="在文件详情中提供一键调用（需在设备上安装对应播放器）">
            <OptionSelect title="外部播放器" options={PLAYERS} />
          </Field>
          <SwitchField name="autoplay" label="打开视频时自动播放" />
          <SwitchField name="remember_volume" label="记住音量" />
        </>
      )}
    </SectionForm>
  )
}

function UiPanel() {
  return (
    <SectionForm section="ui" title="外观与交互">
      {(form) => (
        <>
          <Field name="theme" label="主题">
            <OptionSelect title="主题"
              options={[
                { value: 'auto', label: '跟随系统' },
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
              ]}
            />
          </Field>
          <Row label="强调色" desc="用于选中态、进度条与主要按钮；点缀色会随之自动搭配">
            <Form.Item name="accent" noStyle>
              <Input type="hidden" />
            </Form.Item>
            <Form.Item noStyle shouldUpdate>
              {() => (
                <div className="flex flex-wrap items-center gap-2.5">
                  {ACCENTS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      onClick={() => {
                        form.setFieldValue('accent', color)
                        form.submit()
                      }}
                      className={cx(
                        'h-8 w-8 cursor-pointer rounded-full border-0 transition',
                        form.getFieldValue('accent') === color ? 'neu-inset-sm scale-95 p-1' : 'neu-raised-xs p-1.5',
                      )}
                    >
                      <span className="block h-full w-full rounded-full" style={{ background: color }} />
                    </button>
                  ))}
                  <input
                    type="color"
                    aria-label="自定义颜色"
                    value={(form.getFieldValue('accent') as string | undefined) ?? '#5b7cfa'}
                    onChange={(e) => form.setFieldValue('accent', e.target.value)}
                    onBlur={() => form.submit()}
                    className="neu-raised-xs h-8 w-8 cursor-pointer overflow-hidden rounded-full border-0 p-1 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                  />
                </div>
              )}
            </Form.Item>
          </Row>
          <Field name="density" label="列表密度">
            <OptionSelect title="列表密度" options={[{ value: 'comfortable', label: '舒适' }, { value: 'compact', label: '紧凑' }]} />
          </Field>
          <SwitchField name="animations" label="界面动画" />
          <Field name="transfer_poll_ms" label="传输进度刷新间隔" desc="有活动传输时的刷新频率">
            <NumberInput min={300} max={10000} step={100} suffix="毫秒" />
          </Field>
          <SwitchField name="show_hidden_tasks" label="显示内部任务" desc="在远程设备列表中显示 event-deletion 等系统任务" />
        </>
      )}
    </SectionForm>
  )
}

function SystemPanel() {
  const info = useQuery({ queryKey: ['system'], queryFn: systemApi.info })
  return (
    <div className="space-y-6">
      <SectionForm
        section="system"
        title="本机访问范围"
        description="路径选择器与“上传服务器本机文件 / 自定义下载目录”只能访问以下目录。"
        toForm={(v) => ({ browse_roots: v.browse_roots })}
      >
        {() => (
          <Form.List name="browse_roots">
            {(fields, { add, remove }) => (
              <div className="space-y-2 pt-3">
                {fields.map((field) => (
                  <div key={field.key} className="flex gap-2">
                    <Form.Item name={field.name} noStyle rules={[{ required: true }]}>
                      <Input placeholder="/home/user" className="!font-mono" />
                    </Form.Item>
                    <IconButton icon={Minus} label="移除" size="sm" onClick={() => remove(field.name)} />
                  </div>
                ))}
                <PillButton icon={Plus} onClick={() => add('')} className="!py-2">
                  添加目录
                </PillButton>
              </div>
            )}
          </Form.List>
        )}
      </SectionForm>
      <Card>
        <SectionHeader title="运行环境" />
        <div className="neu-inset divide-y divide-line rounded-3xl px-4 py-1 text-[13px]">
          {[
            ['版本', info.data?.version],
            ['平台', info.data?.platform],
            ['Python', info.data?.python],
            ['数据目录', info.data?.data_dir],
            ['下载磁盘', info.data?.download_disk ? `${formatBytes(info.data.download_disk.free)} 可用 / ${formatBytes(info.data.download_disk.total)}` : '--'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-2.5">
              <span className="text-ink-3">{label}</span>
              <span className="text-right break-all text-ink">{value ?? '--'}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function AccountAdvanced() {
  return (
    <SectionForm section="account" title="OAuth 客户端（高级）" description="用于迅雷账号登录与授权，通常无需修改。">
      {() => (
        <>
          <Field name="client_id" label="Client ID">
            <Input className="!font-mono" />
          </Field>
          <Field name="client_secret" label="Client Secret">
            <Input.Password className="!font-mono" />
          </Field>
          <Field name="scope" label="授权范围">
            <Input />
          </Field>
          <Field name="client_version" label="客户端版本">
            <Input />
          </Field>
          <Field name="package_name" label="包名">
            <Input />
          </Field>
          <SwitchField name="auto_refresh" label="自动续期 Access Token" desc="到期前使用 Refresh Token 无感刷新" />
          <Field name="refresh_ahead_seconds" label="提前续期时间">
            <NumberInput min={30} max={7200} suffix="秒" />
          </Field>
        </>
      )}
    </SectionForm>
  )
}

function AboutPanel() {
  return (
    <Card className="space-y-4 p-6 text-[14px] leading-relaxed text-ink-2">
      <SectionHeader title="关于" />
      <p className="m-0">
        支持链接、种子与云盘文件下载，以及云盘管理、云添加、分享、回收站和文件上传。
      </p>
      <p className="m-0">站点本身不做二次认证：任何能访问本站的人都可以使用已登录的迅雷账号，请仅在可信网络中使用。</p>
      <div className="flex flex-wrap gap-2.5 pt-2">
        <PillButton onClick={() => window.open('/docs', '_blank')}>API 文档（Swagger）</PillButton>
        <PillButton onClick={() => window.open('/redoc', '_blank')}>ReDoc</PillButton>
      </div>
    </Card>
  )
}

export default function SettingsPage() {
  const { tab } = useParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const active = TABS.find((t) => t.key === tab) ?? TABS[0]

  const content: Record<string, ReactNode> = {
    account: (
      <div className="space-y-4 md:space-y-6">
        <AccountPanel />
        <AccountAdvanced />
      </div>
    ),
    network: <NetworkPanel />,
    drive: <DrivePanel />,
    engine: <EnginePanel />,
    download: <DownloadPanel />,
    upload: <UploadPanel />,
    offline: <OfflinePanel />,
    share: <SharePanel />,
    player: <PlayerPanel />,
    ui: <UiPanel />,
    system: <SystemPanel />,
    about: <AboutPanel />,
  }

  // Phones: a grouped menu of sections, each section on its own page.
  if (isMobile && !tab) {
    return (
      <div>
        <PageHeader title="设置" subtitle="所有设置均保存在服务器并立即生效" />
        <div className="space-y-5">
          {TAB_GROUPS.map((group) => (
            <ListGroup key={group} title={group}>
              {TABS.filter((t) => t.group === group).map((item) => (
                <ListItem key={item.key} icon={item.icon} tone={item.tone} title={item.label} subtitle={item.hint} onClick={() => navigate(`/settings/${item.key}`)} />
              ))}
            </ListGroup>
          ))}
        </div>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div>
        <PageHeader title={active.label} subtitle={active.hint} back={() => navigate('/settings')} />
        <div key={active.key} className="page-enter">
          {content[active.key]}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="设置" subtitle="所有设置均保存在服务器并立即生效" />
      <div className="flex gap-6">
        <Card className="sticky top-6 h-fit w-60 shrink-0 p-3">
          {TAB_GROUPS.map((group, index) => (
            <div key={group} className={cx(index > 0 && 'mt-3')}>
              <div className="mb-1 px-3 text-[11px] font-medium tracking-wider text-ink-3">{group}</div>
              <div className="space-y-1">
                {TABS.filter((t) => t.group === group).map((item) => {
                  const on = item.key === active.key
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => navigate(`/settings/${item.key}`)}
                      className={cx(
                        'flex w-full cursor-pointer items-center gap-3 rounded-2xl border-0 bg-transparent px-2.5 py-2 text-left text-[14px] font-medium transition',
                        on ? 'neu-inset-sm text-accent' : 'text-ink-2 hover:bg-black/[0.03] hover:text-ink dark:hover:bg-white/[0.03]',
                      )}
                    >
                      <IconTile icon={item.icon} tone={on ? 'accent' : item.tone} size={30} />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </Card>
        <div key={active.key} className="page-enter min-w-0 flex-1">
          {content[active.key]}
        </div>
      </div>
    </div>
  )
}
