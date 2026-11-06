import { getDb } from "../db"
import { parseRecentQuestParty, type RecentQuestParty } from "../../lib/quest/recent-party-protocol"

export function recordRecentQuestPartySync(input: {
    playerId: number
    category: number
    questId: number
    playId: string
    party: RecentQuestParty
    clearedAt: number
}): void {
    // Updating the sequence preserves completion order even if the game clock changes.
    // The battle settlement transaction owns this write and its rollback.
    getDb().prepare(`
        INSERT INTO recent_quest_parties
            (player_id, category, quest_id, play_id, party_json, cleared_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (player_id, category, quest_id) DO UPDATE SET
            id = excluded.id,
            play_id = excluded.play_id,
            party_json = excluded.party_json,
            cleared_at = excluded.cleared_at
        WHERE recent_quest_parties.play_id <> excluded.play_id
    `).run(input.playerId, input.category, input.questId, input.playId,
        JSON.stringify(input.party), input.clearedAt)
}

export function getRecentQuestPartiesSync(category: number, questId: number): RecentQuestParty[] {
    const rows = getDb().prepare(`
        SELECT party_json FROM recent_quest_parties
        WHERE category = ? AND quest_id = ? ORDER BY id DESC
    `).all(category, questId) as { party_json: string }[]
    return rows.flatMap(row => {
        try {
            const party = parseRecentQuestParty(JSON.parse(row.party_json))
            return party === null ? [] : [party]
        } catch {
            // A damaged history row must not prevent other players opening the list.
            return []
        }
    })
}
