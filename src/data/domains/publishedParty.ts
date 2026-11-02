import { randomInt } from "node:crypto"
import type { Database } from "better-sqlite3"
import { getDb } from "../db"
import {
    LOCAL_PARTY_CODE_ALPHABET, LOCAL_PARTY_CODE_LENGTH, LOCAL_PARTY_CODE_PATTERN,
    parsePublishedBattleParty, type SharedBattleParty,
} from "../../lib/party-share-codec"

export const MAX_PUBLISHED_PARTIES_PER_PLAYER = 50

export interface PublishedPartyRecord {
    code: string
    ownerPlayerId: number
    partyName: string
    battleParty: SharedBattleParty
    createdAt: number
}

type PartyRow = {
    code: string
    owner_player_id: number
    party_name: string
    battle_party_json: string
    schema_version: number
    created_at: number
}

function randomPartyCode(): string {
    let code = ""
    for (let i = 0; i < LOCAL_PARTY_CODE_LENGTH; i++) {
        code += LOCAL_PARTY_CODE_ALPHABET[randomInt(LOCAL_PARTY_CODE_ALPHABET.length)]
    }
    return code
}

/** DB injection is intentional: tests use an in-memory database, never a real save. */
export function publishPartyToDb(db: Database, ownerPlayerId: number, partyName: string, battleParty: SharedBattleParty): string {
    return db.transaction(() => {
        let code = ""
        for (let attempt = 0; attempt < 20; attempt++) {
            const candidate = randomPartyCode()
            if (!db.prepare("SELECT 1 FROM published_parties WHERE code = ?").get(candidate)) {
                code = candidate
                break
            }
        }
        if (!code) throw new Error("Could not allocate unique party code")
        db.prepare(`INSERT INTO published_parties
            (code, owner_player_id, party_name, battle_party_json, schema_version, created_at)
            VALUES (?, ?, ?, ?, 1, ?)`)
            .run(code, ownerPlayerId, partyName, JSON.stringify(battleParty), Date.now())

        db.prepare(`DELETE FROM published_parties WHERE owner_player_id = ? AND id NOT IN (
            SELECT id FROM published_parties WHERE owner_player_id = ? ORDER BY id DESC LIMIT ?
        )`).run(ownerPlayerId, ownerPlayerId, MAX_PUBLISHED_PARTIES_PER_PLAYER)
        return code
    })()
}
export function getPublishedPartyFromDb(db: Database, rawCode: string): PublishedPartyRecord | null {
    const code = rawCode.trim().toUpperCase()
    if (!LOCAL_PARTY_CODE_PATTERN.test(code)) return null
    const row = db.prepare(`SELECT code, owner_player_id, party_name, battle_party_json,
        schema_version, created_at FROM published_parties WHERE code = ?`).get(code) as PartyRow | undefined
    if (!row || row.schema_version !== 1) return null
    try {
        const battleParty = parsePublishedBattleParty(JSON.parse(row.battle_party_json))
        if (!battleParty) return null
        return {
            code: row.code, ownerPlayerId: row.owner_player_id, partyName: row.party_name,
            battleParty, createdAt: row.created_at,
        }
    } catch {
        return null
    }
}
export function publishPartySync(ownerPlayerId: number, partyName: string, battleParty: SharedBattleParty): string {
    return publishPartyToDb(getDb(), ownerPlayerId, partyName, battleParty)
}
export function getPublishedPartySync(code: string): PublishedPartyRecord | null {
    return getPublishedPartyFromDb(getDb(), code)
}
