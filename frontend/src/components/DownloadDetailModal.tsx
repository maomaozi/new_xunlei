import { App, Descriptions, Modal } from 'antd'
import { Copy } from 'lucide-react'
import type { DownloadTask } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { DOWNLOAD_STATUS } from '../lib/downloads'
import { formatBytes, formatSpeed, formatTime } from '../lib/format'
import { PillButton } from './ui'

/** Full task information, including the raw parameters reported by the engine. */
export default function DownloadDetailModal({ task, onClose }: { task: DownloadTask | null; onClose: () => void }) {
  const { message } = App.useApp()
  const copy = (text: string) => void copyText(text).then((ok) => ok && message.success('已复制'))
  return (
    <Modal open={Boolean(task)} title="任务详情" footer={null} width={720} onCancel={onClose} destroyOnHidden>
      {task && (
        <div className="space-y-4">
          <Descriptions
            size="small"
            column={1}
            bordered
            items={[
              { key: 'name', label: '名称', children: task.name },
              { key: 'status', label: '状态', children: `${DOWNLOAD_STATUS[task.status].label}（${task.phase}）${task.message ? ` · ${task.message}` : ''}` },
              { key: 'size', label: '大小', children: task.size ? `${formatBytes(task.size)}（${task.size.toLocaleString()} 字节）` : '--' },
              { key: 'progress', label: '进度', children: `${task.progress}%` },
              { key: 'speed', label: '速度', children: `${formatSpeed(task.speed)}（加速 ${formatSpeed(task.speedup_speed)}）` },
              { key: 'accel', label: '加速通道', children: `P2P：${task.speedup.p2p || '--'} · 会员：${task.speedup.vip || '--'} · 超级：${task.speedup.super || '--'}` },
              { key: 'source', label: task.source === 'cloud' ? '云盘文件' : '下载链接', children: <span className="break-all">{task.url || task.cloud_file_id || '--'}</span> },
              { key: 'path', label: '本地路径', children: <span className="break-all">{task.local_path || '--'}</span> },
              { key: 'files', label: '选择的子文件', children: task.sub_files || '全部' },
              { key: 'hash', label: 'GCID', children: task.hash || '--' },
              { key: 'error', label: '错误', children: task.error || '--' },
              { key: 'time', label: '创建 / 更新', children: `${formatTime(task.created_at)} / ${formatTime(task.updated_at)}` },
              { key: 'id', label: '任务 ID', children: task.id },
            ]}
          />
          <details>
            <summary className="cursor-pointer text-[13px] text-ink-2">引擎上报的原始参数</summary>
            <pre className="neu-inset-sm mt-2 max-h-64 overflow-auto rounded-2xl p-3 text-[11px] break-all whitespace-pre-wrap text-ink-2">
              {JSON.stringify(task.params, null, 2)}
            </pre>
          </details>
          <div className="flex flex-wrap gap-2.5">
            {task.url && (
              <PillButton icon={Copy} onClick={() => copy(task.url)}>
                复制链接
              </PillButton>
            )}
            {task.local_path && (
              <PillButton icon={Copy} onClick={() => copy(task.local_path)}>
                复制本地路径
              </PillButton>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
