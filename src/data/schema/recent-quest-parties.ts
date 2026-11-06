import type { Database } from "better-sqlite3"

/** Server-wide history, added on startup for both new and existing databases. */
export function initializeRecentQuestPartiesSchemaSync(database: Database): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS recent_quest_parties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            category INTEGER NOT NULL,
            quest_id INTEGER NOT NULL,
            play_id TEXT NOT NULL,
            party_json TEXT NOT NULL,
            cleared_at INTEGER NOT NULL,
            UNIQUE (player_id, category, quest_id),
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_recent_quest_parties_quest
            ON recent_quest_parties(category, quest_id, id DESC);
    `)
}
