'use strict'
require('ts-node/register/transpile-only')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { initializePublishedPartiesSchemaSync } = require('../src/data/schema/published-parties')
const { parsePublishedBattleParty, LOCAL_PARTY_CODE_PATTERN } = require('../src/lib/party-share-codec')
const { publishPartyToDb, getPublishedPartyFromDb, MAX_PUBLISHED_PARTIES_PER_PLAYER } = require('../src/data/domains/publishedParty')

function character(id) {
    return { id, mana_node_ids: [], evolution_level: 1, exp: 0, over_limit_step: 0, illustration_settings: null, ex_boost: null }
}
const sample = { characters: [character(101001), null, null], unison_characters: [null, null, null],
    equipments: [{equipment_id: 501001, level: 5}, null, null], ability_soul_ids: [null, null, null] }
assert.ok(parsePublishedBattleParty(sample), 'valid native client party must parse')
assert.equal(parsePublishedBattleParty({...sample, characters: [null,null,null]}), null)
assert.equal(parsePublishedBattleParty({...sample, ability_soul_ids: [null]}), null)
assert.equal(parsePublishedBattleParty({...sample, unison_characters: [null,{},null]}), null)
assert.equal(parsePublishedBattleParty({...sample, character_ids: ['hidden'], secret: 'not stored'}).secret, undefined)

const db = new Database(':memory:')
try {
    db.pragma('foreign_keys = ON')
    db.exec('CREATE TABLE players (id INTEGER PRIMARY KEY); INSERT INTO players (id) VALUES (1),(2);')
    initializePublishedPartiesSchemaSync(db)
    initializePublishedPartiesSchemaSync(db) // idempotent
    const code = publishPartyToDb(db, 1, '队伍 A', parsePublishedBattleParty(sample))
    assert.match(code, LOCAL_PARTY_CODE_PATTERN)
    assert.deepEqual(getPublishedPartyFromDb(db, code.toLowerCase()).battleParty, sample)
    assert.equal(getPublishedPartyFromDb(db, 'INVALID-CODE'), null)
    assert.equal(getPublishedPartyFromDb(db, '23456789AB'), null)
    assert.equal(getPublishedPartyFromDb(db, code).partyName, '队伍 A')
    const another = publishPartyToDb(db, 2, '队伍 B', parsePublishedBattleParty(sample))
    assert.notEqual(another, code)
    assert.equal(getPublishedPartyFromDb(db, another).ownerPlayerId, 2)
    for (let i = 0; i < MAX_PUBLISHED_PARTIES_PER_PLAYER; i++) {
        publishPartyToDb(db, 1, `Extra ${i}`, parsePublishedBattleParty(sample))
    }
    assert.equal(getPublishedPartyFromDb(db, code), null, 'oldest party should expire after >50 newer codes')
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM published_parties WHERE owner_player_id=1').get().count, 50)
    assert.equal(getPublishedPartyFromDb(db, another).partyName, '队伍 B', 'separate player codes retained')
    db.prepare('DELETE FROM players WHERE id = ?').run(2)
    assert.equal(getPublishedPartyFromDb(db, another), null, 'player deletion cascades published parties')
    console.log('party-share codec/storage tests: PASS')
} finally { db.close() }
