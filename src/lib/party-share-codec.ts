/** The CN 1.8.1 PartyReferRemote wire shape; no player inventory is changed here. */
export interface SharedCharacter {
    id: number
    mana_node_ids: number[] | null
    evolution_level: number
    exp: number
    over_limit_step: number
    illustration_settings: number[] | null
    ex_boost: { ability_id_list: number[]; status_id: number } | null
}

export interface SharedBattleParty {
    characters: (SharedCharacter | null)[]
    unison_characters: (SharedCharacter | null)[]
    equipments: ({ equipment_id: number; level: number } | null)[]
    ability_soul_ids: (number | null)[]
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}
function uint(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647
}
function intArray(value: unknown, maximum: number): number[] | null {
    if (!Array.isArray(value) || value.length > maximum || !value.every(uint)) return null
    return [...value]
}
function optionalArray(value: unknown, maximum: number): number[] | null | undefined {
    if (value === null || value === undefined) return null
    return intArray(value, maximum) ?? undefined
}
function character(value: unknown): SharedCharacter | null | undefined {
    if (value === null) return null
    if (!object(value) || !uint(value.id) || value.id === 0
        || !uint(value.evolution_level) || !uint(value.exp) || !uint(value.over_limit_step)) return undefined
    const nodes = optionalArray(value.mana_node_ids, 256)
    const illustration = optionalArray(value.illustration_settings, 32)
    if (nodes === undefined || illustration === undefined) return undefined
    let exBoost: SharedCharacter["ex_boost"] = null
    if (value.ex_boost != null) {
        if (!object(value.ex_boost) || !uint(value.ex_boost.status_id)) return undefined
        const abilities = intArray(value.ex_boost.ability_id_list, 32)
        if (abilities === null) return undefined
        exBoost = { ability_id_list: abilities, status_id: value.ex_boost.status_id }
    }
    return {
        id: value.id, mana_node_ids: nodes, evolution_level: value.evolution_level,
        exp: value.exp, over_limit_step: value.over_limit_step,
        illustration_settings: illustration, ex_boost: exBoost,
    }
}
function characters(value: unknown): (SharedCharacter | null)[] | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    const result: (SharedCharacter | null)[] = []
    for (const item of value) {
        const parsed = character(item)
        if (parsed === undefined) return null
        result.push(parsed)
    }
    return result
}
function equipments(value: unknown): ({ equipment_id: number; level: number } | null)[] | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    const result: ({ equipment_id: number; level: number } | null)[] = []
    for (const item of value) {
        if (item === null) { result.push(null); continue }
        if (!object(item) || !uint(item.equipment_id) || item.equipment_id === 0 || !uint(item.level)) return null
        result.push({ equipment_id: item.equipment_id, level: item.level })
    }
    return result
}
function souls(value: unknown): (number | null)[] | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    if (!value.every(v => v === null || uint(v))) return null
    return [...value]
}

/** Returns a detached, fixed-key canonical snapshot. Extra client fields are discarded. */
export function parsePublishedBattleParty(value: unknown): SharedBattleParty | null {
    if (!object(value)) return null
    const main = characters(value.characters)
    const unison = characters(value.unison_characters)
    const weapons = equipments(value.equipments)
    const soul = souls(value.ability_soul_ids)
    if (main === null || main[0] === null || unison === null || weapons === null || soul === null) return null
    const result: SharedBattleParty = {
        characters: main, unison_characters: unison, equipments: weapons, ability_soul_ids: soul,
    }
    return Buffer.byteLength(JSON.stringify(result), "utf8") <= 65536 ? result : null
}

export const LOCAL_PARTY_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
export const LOCAL_PARTY_CODE_LENGTH = 10
export const LOCAL_PARTY_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{10}$/
