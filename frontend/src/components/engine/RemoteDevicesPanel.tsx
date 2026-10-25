import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { App, Form, Input, Modal } from 'antd'
import { Pause, Play, Plus, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { engineApi, errorMessage, type DriveTask } from '../../lib/api'
import { useAppSettings } from '../../lib/settingsContext'
import OptionSelect from '../OptionSelect'
import { Card, IconButton, PillButton, SectionHeader } from '../ui'

const PHASES: Record<string, string> = { PHASE_TYPE_PENDING: '等待中', PHASE_TYPE_RUNNING: '下载中', PHASE_TYPE_PAUSED: '已暂停', PHASE_TYPE_COMPLETE: '已完成', PHASE_TYPE_ERROR: '失败' }

export default function RemoteDevicesPanel({ scope }: { scope: string }) {
  const { settings } = useAppSettings()
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const devices = settings?.engine.remote_devices ?? []
  const [choice, setChoice] = useState('')
  const selected = devices.some((device) => device.device_id === choice) ? choice : devices[0]?.device_id ?? ''
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const tasks = useInfiniteQuery({ queryKey: ['remote-tasks', scope, selected], initialPageParam: '', queryFn: ({ pageParam }) => engineApi.remoteTasks(selected, pageParam), getNextPageParam: (page) => page.next_page_token || undefined, enabled: Boolean(selected), retry: false, refetchInterval: 5000 })

  const control = async (task: DriveTask, action: 'pause' | 'resume' | 'delete') => {
    setBusy(true)
    try {
      const result = await engineApi.remoteAction(selected, task.id, action)
      void queryClient.invalidateQueries({ queryKey: ['remote-tasks', scope, selected] })
      message.success(result.confirmed ? '操作已完成' : '操作已提交')
    } catch (error) { message.error(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const create = async () => {
    try {
      const values = await form.validateFields()
      setBusy(true)
      await engineApi.remoteCreate(selected, String(values.url), String(values.name ?? ''))
      await tasks.refetch()
      setOpen(false)
      form.resetFields()
      message.success('已添加')
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      message.error(errorMessage(error))
    } finally { setBusy(false) }
  }
  return <Card className="p-4 md:p-6">
    <SectionHeader title="远程设备" extra={<div className="flex gap-2">
      <IconButton icon={Settings} label="管理设备" size="sm" onClick={() => navigate('/settings/engine#devices')} />
      <IconButton icon={RefreshCw} label="刷新远程任务" size="sm" disabled={!selected || busy} onClick={() => tasks.refetch()} />
      <IconButton icon={Plus} label="新建远程下载" size="sm" disabled={!selected || busy} onClick={() => setOpen(true)} />
    </div>} />
    {!devices.length ? <PillButton icon={Plus} onClick={() => navigate('/settings/engine#devices')}>添加设备</PillButton> : <>
      <OptionSelect title="远程设备" disabled={busy} value={selected} onChange={setChoice} options={devices.map((device) => ({ value: device.device_id, label: device.name || device.device_id }))} />
      {tasks.error && <div className="mt-3 text-[13px] text-danger">{errorMessage(tasks.error)}</div>}
      <div className="mt-3 divide-y divide-line">
        {tasks.data?.pages.flatMap((page) => page.tasks).map((task) => <div key={task.id} className="flex items-center gap-2 py-3">
          <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-medium">{task.name || task.file_name || task.id}</div>
            <div className="text-xs text-ink-3">{PHASES[task.phase] ?? task.phase}</div></div>
          {['PHASE_TYPE_RUNNING', 'PHASE_TYPE_PENDING', 'PHASE_TYPE_PAUSED'].includes(task.phase) && <IconButton size="sm" disabled={busy} icon={task.phase === 'PHASE_TYPE_PAUSED' ? Play : Pause} label={task.phase === 'PHASE_TYPE_PAUSED' ? '继续远程任务' : '暂停远程任务'} onClick={() => control(task, task.phase === 'PHASE_TYPE_PAUSED' ? 'resume' : 'pause')} />}
          <IconButton size="sm" icon={Trash2} label="删除远程任务" disabled={busy} onClick={() => modal.confirm({ title: '删除此远程任务？', okText: '删除', onOk: () => control(task, 'delete') })} />
        </div>)}
      </div>
      {tasks.hasNextPage && <PillButton disabled={tasks.isFetchingNextPage} onClick={() => tasks.fetchNextPage()}>加载更多</PillButton>}
      {!tasks.error && !tasks.isPending && !tasks.data?.pages.some((page) => page.tasks.length) && <PillButton icon={Plus} onClick={() => setOpen(true)}>新建下载</PillButton>}
    </>}
    <Modal open={open} title="新建远程下载" confirmLoading={busy} onCancel={() => !busy && setOpen(false)} onOk={() => void create()} okText="添加" destroyOnHidden afterClose={() => form.resetFields()}>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="url" label="下载链接" rules={[{ required: true, message: '请输入下载链接' }]}><Input.TextArea disabled={busy} autoSize={{ minRows: 3, maxRows: 6 }} /></Form.Item>
        <Form.Item name="name" label="名称"><Input disabled={busy} maxLength={255} /></Form.Item>
      </Form>
    </Modal>
  </Card>
}
