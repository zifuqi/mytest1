"use strict"

const assert = require("node:assert/strict")
const test = require("node:test")
const {
    MAIN_CATEGORY, MAIN_QUEST_ID, withSingleBattleHarness,
} = require("./perf/single_battle_settlement_harness.cjs")
const { getRecentQuestPartiesSync } = require("../src/data/domains/recent-quest-party")

const read = () => getRecentQuestPartiesSync(MAIN_CATEGORY, MAIN_QUEST_ID)

// CN-reachable / transport-replay: real MsgPack finish route and SQLite transaction.
test("single clear records its actual lineup; defeat, abort and replay preserve the last clear", async () => {
    await withSingleBattleHarness("recent-party-single", async harness => {
        const post = (route, payload) => harness.post(route, payload, { normalize: false })
        const payload = harness.finishPayload({ playId: "recent-win" })
        payload.statistics.max_power = 20260
        harness.insertActiveQuest(harness.createActiveQuest({ playId: payload.play_id }))
        const response = await post("finish", payload)
        assert.equal(response.statusCode, 200, JSON.stringify(response))
        const history = read()
        assert.equal(history.length, 1)
        assert.equal(history[0].character_id_1, payload.statistics.party.characters[0].id)
        assert.equal(history[0].power, 20260)

        const repeated = await post("finish", payload)
        assert.equal(repeated.statusCode, 400)
        assert.deepEqual(read(), history)

        harness.insertActiveQuest(harness.createActiveQuest({ playId: "recent-defeat" }))
        // The existing late-finish compatibility route returns a zero-reward 200.
        const stale = await post("finish", payload)
        assert.equal(stale.statusCode, 200)
        assert.deepEqual(read(), history)
        assert.equal(harness.db.prepare("SELECT play_id FROM players_active_quests WHERE player_id = ?")
            .get(harness.playerId).play_id, "recent-defeat")
        const defeat = await post("finish", {
            ...harness.finishPayload({ playId: "recent-defeat", characterId: 1 }),
            is_accomplished: false,
        })
        assert.equal(defeat.statusCode, 200, JSON.stringify(defeat))
        assert.deepEqual(read(), history)

        harness.insertActiveQuest(harness.createActiveQuest({ playId: "recent-abort" }))
        const aborted = await post("abort", {
            ...harness.finishPayload({ playId: "recent-abort" }), is_accomplished: false,
        })
        assert.equal(aborted.statusCode, 200, JSON.stringify(aborted))
        assert.deepEqual(read(), history)

        // A later clear replaces only this player's record; party edits do not rewrite history.
        harness.insertActiveQuest(harness.createActiveQuest({ playId: "recent-new-lineup" }))
        const changed = await post("finish", harness.finishPayload({
            playId: "recent-new-lineup", characterId: 1,
        }))
        assert.equal(changed.statusCode, 200, JSON.stringify(changed))
        assert.equal(read().length, 1)
        assert.equal(read()[0].character_id_1, 1)
        harness.db.prepare("UPDATE players_parties SET character_id_1 = ? WHERE player_id = ?")
            .run(payload.statistics.party.characters[0].id, harness.playerId)
        assert.equal(read()[0].character_id_1, 1)
    })
})

// save-integrity: a late settlement failure must roll back the shared snapshot too.
test("single settlement rollback removes the pending party and permits a clean retry", async () => {
    await withSingleBattleHarness("recent-party-rollback", async harness => {
        const payload = harness.finishPayload({ playId: "recent-rollback" })
        harness.insertActiveQuest(harness.createActiveQuest({ playId: payload.play_id }))
        harness.db.exec(`
            CREATE TRIGGER reject_recent_single_finish BEFORE DELETE ON players_active_quests
            BEGIN SELECT RAISE(ABORT, 'forced recent-party rollback'); END;
        `)
        const failed = await harness.post("finish", payload)
        assert.equal(failed.statusCode, 500)
        assert.deepEqual(read(), [])
        harness.db.exec("DROP TRIGGER reject_recent_single_finish")
        const retried = await harness.post("finish", payload)
        assert.equal(retried.statusCode, 200, JSON.stringify(retried))
        assert.equal(read().length, 1)
    })
})
