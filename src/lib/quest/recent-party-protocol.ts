const SLOT_PREFIXES = [
    "character_id", "unison_character_id", "equipment_id", "ability_soul_id",
    "evolution_img_level", "unison_evolution_img_level",
] as const

export type RecentQuestParty = {
    party_name: string
    power: number
} & Record<`${typeof SLOT_PREFIXES[number]}_${1 | 2 | 3}`, number | null>

export function isProtocolInt(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value)
        && value >= 0 && value <= 2_147_483_647
}

/** Fixed-key projection of the CN 1.8.1 recent-party response. */
export function parseRecentQuestParty(value: unknown): RecentQuestParty | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null
    const raw = value as Record<string, unknown>
    if (typeof raw.party_name !== "string" || raw.party_name.length > 128
        || !isProtocolInt(raw.power)) return null
    const result = { party_name: raw.party_name, power: raw.power } as RecentQuestParty
    for (const prefix of SLOT_PREFIXES) {
        for (const slot of [1, 2, 3] as const) {
            const key = `${prefix}_${slot}` as const
            const entry = raw[key]
            if (entry !== null && (!isProtocolInt(entry)
                || (prefix.endsWith("_id") && entry === 0))) return null
            result[key] = entry as number | null
        }
    }
    return result.character_id_1 === null ? null : result
}
