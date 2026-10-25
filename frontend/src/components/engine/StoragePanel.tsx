import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Form, Input, InputNumber, Modal, Switch } from 'antd'
import { HardDrive, Pencil, Plus, RefreshCw, Unplug } from 'lucide-react'
import { useState } from 'react'
import { engineApi, errorMessage, type StorageMount } from '../../lib/api'
import OptionSelect from '../OptionSelect'
import { Card, IconButton, PillButton, SectionHeader } from '../ui'

export default function StoragePanel({ scope }: { scope: string }) {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const types = useQuery({ queryKey: ['storage-types', scope], queryFn: engineApi.storageTypes, retry: false })
  const mounts = useInfiniteQuery({
    queryKey: ['storage', scope], initialPageParam: '', queryFn: ({ pageParam }) => engineApi.storage(pageParam),
    getNextPageParam: (page) => page.next_page_token || undefined, retry: false,
  })
  const [editing, setEditing] = useState<StorageMount | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm()
  const kind = Form.useWatch('type', form) as string | undefined
  const template = types.data?.types.find((type) => type.type === kind)
  const error = mounts.error || types.error

  const edit = (mount: StorageMount | null) => {
    setEditing(mount)
    form.resetFields()
    const selected = types.data?.types.find((type) => type.type === mount?.type) ?? types.data?.types[0]
    const values: Record<string, string | boolean | number> = {}
    for (const field of selected?.config_templates ?? []) {
      const value = mount?.config[field.key] ?? field.value
      values[field.key] = field.type === 'switch' ? String(value) === 'true' : value
    }
    form.setFieldsValue({ type: selected?.type, config: values })
    setOpen(true)
  }

  const save = async () => {
    try {
      const values = await form.validateFields()
      const config = Object.fromEntries((template?.config_templates ?? []).map((field) => [field.key, String(values.config?.[field.key] ?? '')]))
      setBusy(true)
      if (editing) await engineApi.updateStorage(editing.id, config)
      else await engineApi.connectStorage(String(values.type), config)
      await queryClient.invalidateQueries({ queryKey: ['storage'] })
      setOpen(false)
      form.resetFields()
      message.success('已保存')
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      message.error(errorMessage(error))
    } finally { setBusy(false) }
  }

  const disconnect = (mount: StorageMount) => modal.confirm({
    title: `断开「${mount.name || mount.type}」？`, okText: '断开',
    onOk: async () => {
      try {
        await engineApi.disconnectStorage(mount.id)
        await queryClient.invalidateQueries({ queryKey: ['storage'] })
      } catch (error) { message.error(errorMessage(error)); throw error }
    },
  })

  return <Card className="p-4 md:p-6">
    <SectionHeader title="连接存储" extra={<div className="flex gap-2">
      <IconButton icon={RefreshCw} label="刷新存储" size="sm" onClick={() => { void mounts.refetch(); void types.refetch() }} />
      <IconButton icon={Plus} label="添加存储" size="sm" disabled={!types.data?.types.length} onClick={() => edit(null)} />
    </div>} />
    {error && <div className="mb-3 text-[13px] text-danger">{errorMessage(error)}</div>}
    <div className="divide-y divide-line">
      {mounts.data?.pages.flatMap((page) => page.mounts).map((mount) => <div key={mount.id} className="flex items-center gap-3 py-3">
        <HardDrive size={19} className="shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-medium">{mount.name || mount.type}</div>
          <div className="truncate text-xs text-ink-3">{types.data?.types.find((type) => type.type === mount.type)?.name || mount.type}</div></div>
        {types.data?.types.some((type) => type.type === mount.type) && <IconButton icon={Pencil} label="编辑存储" size="sm" onClick={() => edit(mount)} />}
        <IconButton icon={Unplug} label="断开存储" size="sm" onClick={() => disconnect(mount)} />
      </div>)}
    </div>
    {mounts.hasNextPage && <PillButton disabled={mounts.isFetchingNextPage} onClick={() => mounts.fetchNextPage()}>加载更多</PillButton>}
    {!mounts.isPending && !error && !mounts.data?.pages.some((page) => page.mounts.length) && <PillButton icon={Plus} disabled={!types.data?.types.length} onClick={() => edit(null)}>添加存储</PillButton>}
    <Modal open={open} title={editing ? '编辑存储' : '添加存储'} onCancel={() => !busy && setOpen(false)} onOk={() => void save()} confirmLoading={busy} okText="保存" destroyOnHidden afterClose={() => form.resetFields()}>
      <Form form={form} layout="vertical" preserve={false} requiredMark={false}>
        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <OptionSelect disabled={Boolean(editing) || busy} title="存储类型" options={(types.data?.types ?? []).map((type) => ({ value: type.type, label: type.name }))}
            onChange={() => form.setFieldValue('config', {})} />
        </Form.Item>
        {template?.config_templates.map((field) => <Form.Item key={`${kind}:${field.key}`} name={['config', field.key]} label={field.title}
          valuePropName={field.type === 'switch' ? 'checked' : 'value'}
          initialValue={field.type === 'switch' ? String(field.value) === 'true' : field.value || undefined}
          rules={[{ required: field.required && !(editing && field.type === 'password'), message: `请填写${field.title}` }]}>
          {field.type === 'password' ? <Input.Password autoComplete="new-password" disabled={busy} placeholder={editing ? '留空保留' : field.placeholder} maxLength={field.max_length} />
            : field.type === 'switch' ? <Switch disabled={busy} />
              : field.type === 'number' ? <InputNumber disabled={busy} className="!w-full" />
                : <Input disabled={busy} placeholder={field.placeholder} maxLength={field.max_length} />}
        </Form.Item>)}
      </Form>
    </Modal>
  </Card>
}
