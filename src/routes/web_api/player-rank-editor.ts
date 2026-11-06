import type { FastifyInstance } from "fastify"
import { createHash } from "node:crypto"
import { getContentSnapshot } from "../../content/runtime/content-snapshot"
import { parsePlayerRankContent } from "../../lib/player-rank-content"
import { getDb } from "../../data/db"
import { getPlayerSync } from "../../data/domains/player"
import { MAX_INT } from "./validation"

interface RankLevel { level: number; threshold: number; nextThreshold: number | null }

// Read the same active content snapshot as gameplay; never ship a second XP table.
export function readRankEditorTable() {
    const raw = getContentSnapshot().repository.table<Record<string, unknown[][]>>("cdndata/player_rank_full.json")
    const content = parsePlayerRankContent(raw)
    const levels: RankLevel[] = Object.keys(raw).map(Number).filter(level => level >= 1)
        .sort((a, b) => a - b)
        .map(level => ({ level, threshold: Number(raw[String(level)][0][1]), nextThreshold: null }))
    for (let i = 0; i < levels.length; i++) {
        const row = levels[i]
        if (row.level !== i + 1 || row.threshold > MAX_INT
            || (i === 0 ? row.threshold !== 0 : row.threshold <= levels[i - 1].threshold)
            || content.getRankDegree(row.threshold) !== row.level) {
            throw new Error("等级经验表不连续或阈值异常，请检查当前内容配置")
        }
        row.nextThreshold = levels[i + 1]?.threshold ?? null
    }
    return {
        version: createHash("sha256").update(JSON.stringify(levels)).digest("hex"),
        maxRankPoint: MAX_INT,
        levels,
    }
}

export function registerPlayerRankEditorRoutes(fastify: FastifyInstance) {
    // Mounted inside the existing /api/player plugin and its admin authentication scope.
    fastify.get("/rank-table", async (_request, reply) => {
        reply.header("Cache-Control", "no-store")
        return readRankEditorTable()
    })

    fastify.patch("/:id/rank", async (request, reply) => {
        const id = Number((request.params as { id: string }).id)
        if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: "存档 ID 无效" })
        const input = request.body
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            return reply.code(400).send({ error: "等级修改参数无效" })
        }
        const body = input as Record<string, unknown>
        const uint = (value: unknown): value is number => typeof value === "number"
            && Number.isSafeInteger(value) && value >= 0 && value <= MAX_INT
        if (!uint(body.expectedRankPoint) || typeof body.tableVersion !== "string") {
            return reply.code(400).send({ error: "请刷新页面后重新调整等级" })
        }
        const byLevel = Object.prototype.hasOwnProperty.call(body, "level")
        const byPoint = Object.prototype.hasOwnProperty.call(body, "rankPoint")
        if (byLevel === byPoint) return reply.code(400).send({ error: "请选择按等级或按累计经验调整" })
        const table = readRankEditorTable()
        if (body.tableVersion !== table.version) {
            return reply.code(409).send({ error: "等级经验表已更新，请刷新并重新选择目标等级" })
        }
        let target: number
        if (byLevel) {
            const row = table.levels.find(entry => entry.level === body.level)
            if (!row) return reply.code(400).send({ error: `等级必须为 1–${table.levels.length} 的整数` })
            target = row.threshold
        } else {
            if (!uint(body.rankPoint)) return reply.code(400).send({ error: `累计经验必须为 0–${MAX_INT} 的整数` })
            target = body.rankPoint
        }
        if (!getPlayerSync(id)) return reply.code(404).send({ error: "存档不存在" })
        // Atomic compare-and-swap also protects against concurrent game/admin writes.
        const result = getDb().prepare("UPDATE players SET rank_point = ? WHERE id = ? AND rank_point = ?")
            .run(target, id, body.expectedRankPoint)
        if (result.changes !== 1) {
            return reply.code(409).send({ error: "玩家经验已发生变化，请刷新并重新调整，避免覆盖新的进度" })
        }
        let level = 1
        for (const row of table.levels) {
            if (target < row.threshold) break
            level = row.level
        }
        return { ok: true, rankPoint: target, level }
    })
}
