import type { Database } from "better-sqlite3"

/** Additive table: no changes to the core data schema version or player tables. */
export function initializePublishedPartiesSchemaSync(database: Database): void {
    // Called only after `players` has been initialized.
    database.exec(`
        CREATE TABLE IF NOT EXISTS published_parties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            owner_player_id INTEGER NOT NULL,
            party_name TEXT NOT NULL,
            battle_party_json TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (owner_player_id) REFERENCES players(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_published_parties_owner
          ON published_parties(owner_player_id, id DESC);
    `)
}
