"use strict"

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const Fastify = require("fastify")
const { pack, unpack } = require("msgpackr")

require("ts-node/register/transpile-only")

const previousDataDirectory = process.env.DATA_DIR
const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "quest-recent-party-"))
process.env.DATA_DIR = databaseDirectory

const data = require("../src/data")
const { insertAccountSync } = require("../src/data/domains/account")
const { insertDefaultPlayerSync } = require("../src/data/domains/player")
const { insertSessionWithToken } = require("../src/data/domains/session")
const { SessionType } = require("../src/data/types")
const questUnlockRoutes = require("../src/routes/api/questUnlock").default
const { registerCnMsgpackOnSend } = require("../src/routes/cn/msgpack")
const { installBundledGameplaySnapshot } = require("./helpers/install-bundled-gameplay-snapshot.cjs")
const { getDb } = require("../src/data/db")
const { recordClearedQuestPartySync } = require("../src/lib/quest/recent-party")
const { getRecentQuestPartiesSync } = require("../src/data/domains/recent-quest-party")
const { getEquipmentLookupSync } = require("../src/lib/equipment-content")
const { getItemLookupSync } = require("../src/lib/item-content")
const { updatePlayerCharacterSync } = require("../src/data/domains/character")
const { ensurePlayerPartyGroupListSync, updatePlayerPartySync } = require("../src/data/domains/party")

const restoreContentSnapshot = installBundledGameplaySnapshot()
data.initializeDatabase()

let viewerId
let playerId

function decode(response) {
    return unpack(Buffer.from(response.body, "base64"))
}

async function postQuest(app, url, body) {
    return app.inject({
        method: "POST",
        url,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: pack(body).toString("base64"),
    })
}

async function buildQuestApp(t) {
    const app = Fastify({ logger: false })
    app.addContentTypeParser(
        "application/x-www-form-urlencoded",
        { parseAs: "string" },
        (_request, body, done) => done(null, unpack(Buffer.from(body, "base64"))),
    )
    registerCnMsgpackOnSend(app)
    await app.register(questUnlockRoutes, { prefix: "/api/index.php/quest" })
    await app.ready()
    t.after(() => app.close())
    return app
}

test.before(async () => {
    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "test",
        idpId: `quest-recent-party-${randomUUID()}`,
        status: "normal",
    })
    playerId = insertDefaultPlayerSync(account.id).id
    viewerId = 730000000 + playerId
    await insertSessionWithToken({
        token: String(viewerId),
        accountId: account.id,
        expires: new Date("2099-12-31T23:59:59.000Z"),
        type: SessionType.VIEWER,
    })
})

test.after(() => {
    data.closeDatabase()
    restoreContentSnapshot()
    fs.rmSync(databaseDirectory, { recursive: true, force: true })
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDirectory
})

test("quest get_recent_other_player_party returns a legal empty party projection", async t => {
    const app = await buildQuestApp(t)
    const response = await postQuest(app, "/api/index.php/quest/get_recent_other_player_party", {
        viewer_id: viewerId,
        category: 1,
        quest_id: 1000001,
    })
    assert.equal(response.statusCode, 200, response.body)

    const decoded = decode(response)
    assert.equal(decoded.data_headers.result_code, 1)
    assert.equal(decoded.data_headers.viewer_id, viewerId)
    assert.ok(Array.isArray(decoded.data.recent_other_player_party))
    assert.equal(decoded.data.recent_other_player_party.length, 0)
})

test("quest get_recent_other_player_party rejects an unknown viewer", async t => {
    const app = await buildQuestApp(t)
    const response = await postQuest(app, "/api/index.php/quest/get_recent_other_player_party", {
        viewer_id: 999999999,
        category: 1,
        quest_id: 1000001,
    })
    assert.equal(response.statusCode, 400)
})

test("quest get_recent_other_player_party rejects a malformed body", async t => {
    const app = await buildQuestApp(t)
    const response = await postQuest(app, "/api/index.php/quest/get_recent_other_player_party", {
        category: 1,
    })
    assert.equal(response.statusCode, 400)
})

// CN-reachable: the quest screen reads the same shared list for unrelated accounts.
test("all viewers see every player's latest clear, newest first, with complete CN fields", async t => {
    const app = await buildQuestApp(t)
    const equipmentId = Number(Object.keys(getEquipmentLookupSync())[0])
    const soulId = Number(Object.keys(getItemLookupSync()).find(id => Number(id) >= 1000000))
    assert.ok(soulId > 0)
    const statistics = {
        max_power: 12345,
        party: {
            characters: [{ id: 1 }, null, null],
            unison_characters: [null, { id: 1 }, null],
            equipments: [{ id: equipmentId }, null, null],
            ability_soul_ids: [soulId, null, null],
        },
    }
    const record = (owner, playId, overrides = {}) => recordClearedQuestPartySync({
        playerId: owner, playerName: `玩家${owner}`, category: 1, questId: 1000001,
        playId, statistics, ...overrides,
    })
    const owners = [playerId]
    for (let i = 0; i < 12; i++) {
        const account = insertAccountSync({
            appId: "wf_cn", idpAlias: "", idpCode: "test",
            idpId: `recent-peer-${randomUUID()}`, status: "normal",
        })
        const peer = insertDefaultPlayerSync(account.id).id
        owners.push(peer)
        await insertSessionWithToken({
            token: String(730000000 + peer), accountId: account.id,
            expires: new Date("2099-12-31T23:59:59.000Z"), type: SessionType.VIEWER,
        })
    }
    for (const owner of owners) record(owner, `clear-${owner}`)
    record(playerId, "clear-updated", { statistics: { ...statistics, max_power: 67890 } })
    // Identical retries cannot replace the snapshot or reorder it.
    record(playerId, "clear-updated", { statistics: { ...statistics, max_power: 999 } })
    record(playerId, "other-category", { category: 2 })
    record(playerId, "other-quest", { questId: 1000002 })
    const read = async viewer => {
        const response = await postQuest(app, "/api/index.php/quest/get_recent_other_player_party", {
            viewer_id: viewer, category: 1, quest_id: 1000001,
        })
        assert.equal(response.statusCode, 200, response.body)
        return decode(response).data.recent_other_player_party
    }
    const parties = await read(viewerId)
    assert.equal(parties.length, owners.length, "must not silently cap the list at 10 players")
    assert.deepEqual(await read(730000000 + owners[1]), parties)
    assert.equal(parties[0].power, 67890)
    assert.equal(parties[1].party_name, `玩家${owners.at(-1)}的通关编队`)
    assert.equal(parties[0].character_id_1, 1)
    assert.equal(parties[0].unison_character_id_2, 1)
    assert.equal(parties[0].equipment_id_1, equipmentId)
    assert.equal(parties[0].ability_soul_id_1, soulId)
    assert.equal(parties[0].evolution_img_level_2, null)
    assert.equal(parties[0].unison_evolution_img_level_1, null)
    assert.equal(Object.keys(parties[0]).length, 20)

    // Existing-database startup and restart preserve the complete list.
    data.closeDatabase()
    data.initializeDatabase()
    assert.deepEqual(await read(viewerId), parties)
    getDb().prepare("DELETE FROM players WHERE id = ?").run(owners.at(-1))
    assert.equal((await read(viewerId)).length, owners.length - 1)
})

// server-boundary: malformed cross-player snapshots must never reach the client.
test("invalid references and broken stored snapshots do not poison the shared list", () => {
    const before = getRecentQuestPartiesSync(1, 1000001)
    recordClearedQuestPartySync({
        playerId, playerName: "invalid", category: 1, questId: 1000001, playId: "invalid-id",
        statistics: { party: {
            characters: [{ id: 2147483647 }], unison_characters: [], equipments: [], ability_soul_ids: [],
        } },
    })
    assert.deepEqual(getRecentQuestPartiesSync(1, 1000001), before)
    getDb().prepare("UPDATE recent_quest_parties SET party_json = ? WHERE category = 2").run("broken")
    assert.deepEqual(getRecentQuestPartiesSync(2, 1000001), [])
})

test("recent-party request validates null bodies and positive integer identities", async t => {
    const app = await buildQuestApp(t)
    for (const body of [null, [], { viewer_id: viewerId, category: 0, quest_id: 1 },
        { viewer_id: viewerId, category: 1, quest_id: "1000001" }]) {
        const response = await postQuest(app, "/api/index.php/quest/get_recent_other_player_party", body)
        assert.equal(response.statusCode, 400, response.body)
    }
})

test("party name and face choice are captured at settlement and remain immutable", () => {
    updatePlayerCharacterSync(playerId, 1, { evolutionLevel: 1, illustrationSettings: [1, 0, 1, 1, 1, 1] })
    const lineup = {
        name: "测试通关队", characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
        equipmentIds: [null, null, null], abilitySoulIds: [null, null, null], edited: true,
        options: { allowOtherPlayersToHealMe: true }, category: 1,
    }
    ensurePlayerPartyGroupListSync(playerId, { 1: { list: { 1: lineup }, colorId: 0, category: 1 } })
    updatePlayerPartySync(playerId, 1, lineup, 1)
    recordClearedQuestPartySync({
        playerId, playerName: "测试玩家", category: 1, questId: 1000003, playId: "appearance",
        statistics: { max_power: 9988, party: {
            characters: [{ id: 1 }, null, null], unison_characters: [null, null, null],
            equipments: [null, null, null], ability_soul_ids: [null, null, null],
        } },
    })
    const snapshot = getRecentQuestPartiesSync(1, 1000003)
    assert.equal(snapshot[0].party_name, "测试通关队")
    assert.equal(snapshot[0].evolution_img_level_1, 0, "face choice overrides evolved appearance")
    updatePlayerCharacterSync(playerId, 1, { illustrationSettings: [1, 1, 1, 1, 1, 1] })
    getDb().prepare("UPDATE players_parties SET name = '之后改名' WHERE player_id = ?").run(playerId)
    assert.deepEqual(getRecentQuestPartiesSync(1, 1000003), snapshot)
})
