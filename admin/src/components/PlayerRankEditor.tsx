import { useState } from "react"
import { Alert, Button, Card, InputNumber, Modal, Progress, Space, Table, Tag, message } from "antd"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPatch } from "../api/client"
import "./PlayerRankEditor.css"

interface LevelRow { level: number; threshold: number; nextThreshold: number | null }
interface RankTable { version: string; maxRankPoint: number; levels: LevelRow[] }
interface Draft { mode: "level" | "xp"; value: number | null; base: number; version: string }
const format = (value: number) => value.toLocaleString("zh-CN")
function levelAt(levels: LevelRow[], xp: number) {
    let found = levels[0]
    for (const row of levels) {
        if (xp < row.threshold) break
        found = row
    }
    return found
}

export default function PlayerRankEditor({ playerId, rankPoint }: { playerId: number; rankPoint: number }) {
    const qc = useQueryClient()
    const [draft, setDraft] = useState<Draft | null>(null)
    const [tableOpen, setTableOpen] = useState(false)
    const [filter, setFilter] = useState<number | null>(null)
    const { data: table, isPending, error, refetch } = useQuery({
        queryKey: ["playerRankTable"],
        queryFn: () => apiGet<RankTable>("/api/player/rank-table"),
    })
    const save = useMutation({
        mutationFn: (body: Record<string, unknown>) => apiPatch<{ level: number; rankPoint: number }>(`/api/player/${playerId}/rank`, body),
        onSuccess: async result => {
            await Promise.all([
                qc.invalidateQueries({ queryKey: ["playerDetail", playerId] }),
                qc.invalidateQueries({ queryKey: ["accounts"] }),
            ])
            setDraft(null)
            message.success(`已保存为 Lv ${result.level}，累计经验 ${format(result.rankPoint)}`)
        },
        onError: (err: Error) => {
            message.error(err.message)
            void qc.invalidateQueries({ queryKey: ["playerDetail", playerId] })
            void qc.invalidateQueries({ queryKey: ["playerRankTable"] })
        },
    })
    if (isPending) return <Card title="玩家等级" loading className="admin-dash-card" />
    if (error || !table?.levels.length) return <Card title="玩家等级" className="admin-dash-card">
        <Alert type="error" showIcon message="等级经验表加载失败" description={error?.message ?? "经验表为空"}
            action={<Button onClick={() => void refetch()}>重试</Button>} />
    </Card>

    const levels = table.levels
    const current = levelAt(levels, rankPoint)
    const maxLevel = levels[levels.length - 1].level
    const validValue = draft?.value != null && Number.isSafeInteger(draft.value) && draft.value >= 0
    const selected = draft?.mode === "level" && validValue ? levels.find(row => row.level === draft.value) : undefined
    const targetXp = !draft ? rankPoint : draft.mode === "level" ? selected?.threshold
        : validValue && draft.value! <= table.maxRankPoint ? draft.value! : undefined
    const targetLevel = targetXp === undefined ? undefined : levelAt(levels, targetXp)
    const stale = draft !== null && (draft.base !== rankPoint || draft.version !== table.version)
    const changed = targetXp !== undefined && targetXp !== rankPoint
    const remaining = current.nextThreshold === null ? null : current.nextThreshold - rankPoint
    const progress = current.nextThreshold === null ? 100
        : (rankPoint - current.threshold) / (current.nextThreshold - current.threshold) * 100
    const edit = (mode: Draft["mode"], value: number | null) => setDraft({
        mode, value, base: draft?.base ?? rankPoint, version: draft?.version ?? table.version,
    })
    const levelValue = draft?.mode === "level" ? draft.value : targetLevel?.level ?? null
    const xpValue = draft?.mode === "xp" ? draft.value : targetXp ?? null
    const submit = () => {
        if (!draft || stale || !changed || targetXp === undefined || save.isPending) return
        save.mutate({
            expectedRankPoint: draft.base, tableVersion: draft.version,
            ...(draft.mode === "level" ? { level: draft.value } : { rankPoint: targetXp }),
        })
    }

    return <Card title="玩家等级" className="admin-dash-card wf-rank-card"
        extra={<Button onClick={() => setTableOpen(true)}>等级经验表</Button>}>
        <div className="wf-rank-summary">
            <div><span className="wf-rank-caption">当前等级</span><strong className="wf-rank-number">Lv {current.level}</strong></div>
            <div><span className="wf-rank-caption">累计玩家经验</span><strong>{format(rankPoint)}</strong></div>
            <div><span className="wf-rank-caption">{remaining === null ? "等级状态" : `距 Lv ${current.level + 1}`}</span>
                <strong>{remaining === null ? "已达最高等级" : `还需 ${format(remaining)} 经验`}</strong></div>
        </div>
        <Progress percent={Math.max(0, Math.min(100, progress))} showInfo={false} strokeColor="#e5af00" />
        <div className="wf-rank-caption">{current.nextThreshold === null
            ? `满级起始累计经验 ${format(current.threshold)}`
            : `本级进度 ${format(rankPoint - current.threshold)} / ${format(current.nextThreshold - current.threshold)} · 累计经验区间 ${format(current.threshold)}–${format(current.nextThreshold - 1)}`}</div>
        <div className="wf-rank-form">
            <label htmlFor="wf-target-level"><span>目标等级（1–{maxLevel}）</span>
                <InputNumber id="wf-target-level" aria-label="目标等级" min={1} max={maxLevel} step={1}
                    value={levelValue} disabled={save.isPending} onChange={value => edit("level", value)} />
            </label>
            <label htmlFor="wf-target-xp"><span>目标累计经验</span>
                <InputNumber id="wf-target-xp" aria-label="目标累计经验" min={0} max={table.maxRankPoint} step={1}
                    value={xpValue} disabled={save.isPending} onChange={value => edit("xp", value)} />
            </label>
        </div>
        <p className="wf-rank-caption">选择等级会自动填入该级起始经验；输入累计经验会自动换算等级。经验池用于角色培养，与玩家等级无关。</p>
        {draft && <Alert showIcon type={stale ? "warning" : targetXp === undefined ? "error" : "info"}
            message={stale ? "玩家经验或等级表已更新，请点「重置」后重新调整。"
                : targetXp === undefined ? "请输入范围内的整数。"
                : `调整预览：Lv ${current.level} → Lv ${targetLevel!.level}；累计经验 ${format(rankPoint)} → ${format(targetXp)}（${targetXp - rankPoint >= 0 ? "+" : ""}${format(targetXp - rankPoint)}）`} />}
        <div className="wf-rank-actions">
            <span className="wf-rank-caption">保存后更新存档等级，不补发升级奖励。游戏已打开时请重新登录查看。</span>
            <Space><Button disabled={!draft || save.isPending} onClick={() => setDraft(null)}>重置</Button>
                <Button type="primary" disabled={!draft || !changed || stale} loading={save.isPending} onClick={submit}>保存等级</Button></Space>
        </div>
        <Modal title="等级与累计经验对照表" open={tableOpen} onCancel={() => setTableOpen(false)} footer={null} width={780}>
            <div className="wf-rank-table-search">
                <InputNumber aria-label="查找等级" placeholder="输入等级查找" min={1} max={maxLevel} value={filter} onChange={setFilter} />
                <Button onClick={() => setFilter(null)}>显示全部</Button><span>共 {levels.length} 级 · 当前 Lv {current.level}</span>
            </div>
            <Table<LevelRow> size="small" rowKey="level" scroll={{ x: 570, y: 390 }}
                dataSource={filter === null ? levels : levels.filter(row => row.level === filter)}
                pagination={false}
                columns={[
                    { title: "等级", dataIndex: "level", width: 90, render: level => <span>Lv {level}{level === current.level && <Tag color="blue">当前</Tag>}</span> },
                    { title: "累计经验起点", dataIndex: "threshold", render: format },
                    { title: "升下一级所需经验", render: (_, row) => row.nextThreshold === null ? "满级" : format(row.nextThreshold - row.threshold) },
                    { title: "", width: 75, render: (_, row) => <Button type="link" disabled={save.isPending} onClick={() => { edit("level", row.level); setTableOpen(false) }}>选用</Button> },
                ]} />
            <p className="wf-rank-caption">「选用」只填写调整预览，点击「保存等级」后才会生效。</p>
        </Modal>
    </Card>
}
