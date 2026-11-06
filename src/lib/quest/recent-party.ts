import { getPlayerCharactersByIdsSync } from "../../data/domains/character"
import { getPlayerPartyGroupListsSync } from "../../data/domains/party"
import { recordRecentQuestPartySync } from "../../data/domains/recent-quest-party"
import { PartyCategory, type PlayerCharacter } from "../../data/types"
import { getRealNowMs } from "../../runtime/time/game-time"
import { getCharacterFacts } from "../character-content"
import { getEquipmentLookupSync } from "../equipment-content"
import { getItemLookupSync } from "../item-content"
import { isProtocolInt, parseRecentQuestParty } from "./recent-party-protocol"

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null
}

function ids(value: unknown, memberObjects: boolean): (number | null)[] | null {
    if (!Array.isArray(value) || value.length > 3) return null
    const result: (number | null)[] = []
    for (let index = 0; index < 3; index++) {
        const member = value[index]
        const id = memberObjects && member != null ? object(member)?.id : member
        if (id == null) {
            if (member != null && memberObjects && object(member)?.id !== null) return null
            result.push(null)
        } else if (isProtocolInt(id) && id > 0) result.push(id)
        else return null
    }
    return result
}

function imageLevel(character: PlayerCharacter | undefined): number {
    // BattleCharacterLogic.getFaceImagePath uses illustration setting 1.
    const selected = character?.illustrationSettings?.[1]
    return isProtocolInt(selected) ? selected : Math.min(1, Math.max(0, character?.evolutionLevel ?? 0))
}

/** Called only inside a successful single/multi settlement's SQLite transaction. */
export function recordClearedQuestPartySync(input: {
    playerId: number
    playerName: string
    category: number
    questId: number
    playId: string
    statistics: unknown
}): void {
    const statistics = object(input.statistics)
    const party = object(statistics?.party)
    if (party === null) return
    // These IDs come from BattleClearParameter.getStatistics(), never the current slot.
    const main = ids(party.characters, true)
    const unison = ids(party.unison_characters, true)
    const equipment = ids(party.equipments, true)
    const souls = ids(party.ability_soul_ids, false)
    if (!main || main[0] === null || !unison || !equipment || !souls) return
    const characterIds = [...main, ...unison].filter((id): id is number => id !== null)
    // Invalid client-supplied references must not poison every viewer's list.
    if (characterIds.some(id => !getCharacterFacts().exists(id))
        || equipment.some(id => id !== null && getEquipmentLookupSync()[String(id)] === undefined)
        || souls.some(id => id !== null && getItemLookupSync()[String(id)] === undefined)) return

    const characters = getPlayerCharactersByIdsSync(input.playerId, characterIds)
    const groups = getPlayerPartyGroupListsSync(input.playerId, [
        PartyCategory.NORMAL, PartyCategory.CARNIVAL, PartyCategory.RAID, PartyCategory.RUSH,
    ])
    const same = (left: readonly (number | null)[], right: readonly (number | null)[]) => (
        right.every((id, index) => (left[index] ?? null) === id)
    )
    const matchedParty = Object.values(groups).flatMap(category => Object.values(category))
        .flatMap(group => Object.values(group.list)).find(saved => (
            same(saved.characterIds, main) && same(saved.unisonCharacterIds, unison)
            && same(saved.equipmentIds, equipment) && same(saved.abilitySoulIds, souls)
        ))
    const snapshot: Record<string, unknown> = {
        party_name: (matchedParty?.name || `${input.playerName}的通关编队`).slice(0, 128),
        power: isProtocolInt(statistics?.max_power) ? statistics.max_power : 0,
    }
    for (const slot of [1, 2, 3] as const) {
        const index = slot - 1
        snapshot[`character_id_${slot}`] = main[index]
        snapshot[`unison_character_id_${slot}`] = unison[index]
        snapshot[`equipment_id_${slot}`] = equipment[index]
        snapshot[`ability_soul_id_${slot}`] = souls[index]
        snapshot[`evolution_img_level_${slot}`] = main[index] === null
            ? null : imageLevel(characters[String(main[index])])
        snapshot[`unison_evolution_img_level_${slot}`] = unison[index] === null
            ? null : imageLevel(characters[String(unison[index])])
    }
    const projection = parseRecentQuestParty(snapshot)
    if (projection === null) return
    recordRecentQuestPartySync({ ...input, party: projection, clearedAt: getRealNowMs() })
}
