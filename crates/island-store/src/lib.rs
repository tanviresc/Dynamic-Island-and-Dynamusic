use chrono::Utc;
use island_contract::{Kind, Source, Surface, Target};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Lock error")]
    LockError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotificationState {
    Pending,
    Displaying,
    Unread,
}

impl NotificationState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Displaying => "displaying",
            Self::Unread => "unread",
        }
    }
}

impl std::str::FromStr for NotificationState {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "displaying" => Ok(Self::Displaying),
            "unread" => Ok(Self::Unread),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredNotification {
    pub id: Uuid,
    pub source: Source,
    pub surface: Surface,
    pub kind: Kind,
    pub title: String,
    pub text: String,
    pub category: Option<String>,
    pub account: Option<String>,
    pub target: Target,
    pub group_key: Option<String>,
    pub group_count: u32,
    pub state: NotificationState,
    pub external_ref: Option<String>,
    pub created_at: i64,
    pub received_at: i64,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredGmailAccount {
    pub alias: String,
    pub email: String,
    pub history_id: Option<String>,
    pub last_poll_at: Option<i64>,
    pub label_map_json: Option<String>,
    pub status: Option<String>,
    pub config_json: Option<String>,
}

#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let conn = Connection::open(path)?;
        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        store.run_migrations()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        store.run_migrations()?;
        Ok(store)
    }

    fn run_migrations(&self) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        // Pragmas
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;",
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                surface TEXT NOT NULL,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                text TEXT NOT NULL,
                category TEXT,
                account TEXT,
                target_json TEXT NOT NULL,
                group_key TEXT,
                group_count INTEGER NOT NULL DEFAULT 1,
                state TEXT NOT NULL CHECK (state IN ('pending','displaying','unread')),
                external_ref TEXT,
                created_at INTEGER NOT NULL,
                received_at INTEGER NOT NULL,
                expires_at INTEGER
             );
             CREATE TABLE IF NOT EXISTS dedupe (
                key TEXT PRIMARY KEY,
                seen_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                source TEXT,
                surface TEXT,
                kind TEXT,
                category TEXT,
                created_at INTEGER,
                resolved_at INTEGER,
                resolution TEXT CHECK (resolution IN ('clicked','cleared','auto_read','external_read','expired','capped'))
             );
             CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS gmail_accounts (
                alias TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                history_id TEXT,
                last_poll_at INTEGER,
                label_map_json TEXT,
                status TEXT,
                config_json TEXT
             );
             CREATE TABLE IF NOT EXISTS paired_clients (
                origin TEXT PRIMARY KEY,
                client TEXT,
                paired_at INTEGER,
                last_seen_at INTEGER
             );",
        )?;

        // Ignore error if column already exists
        let _ = conn.execute("ALTER TABLE gmail_accounts ADD COLUMN config_json TEXT", []);

        Ok(())
    }

    pub fn save_notification(&self, item: &StoredNotification) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let target_json = serde_json::to_string(&item.target)?;

        let source_str = serde_json::to_string(&item.source)?;
        let surface_str = serde_json::to_string(&item.surface)?;
        let kind_str = serde_json::to_string(&item.kind)?;

        conn.execute(
            "INSERT OR REPLACE INTO notifications (
                id, source, surface, kind, title, text, category, account,
                target_json, group_key, group_count, state, external_ref,
                created_at, received_at, expires_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                item.id.to_string(),
                source_str.trim_matches('"'),
                surface_str.trim_matches('"'),
                kind_str.trim_matches('"'),
                item.title,
                item.text,
                item.category,
                item.account,
                target_json,
                item.group_key,
                item.group_count,
                item.state.as_str(),
                item.external_ref,
                item.created_at,
                item.received_at,
                item.expires_at,
            ],
        )?;

        Ok(())
    }

    pub fn update_notification_state(
        &self,
        id: Uuid,
        state: NotificationState,
    ) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        conn.execute(
            "UPDATE notifications SET state = ?1 WHERE id = ?2",
            params![state.as_str(), id.to_string()],
        )?;
        Ok(())
    }

    pub fn reset_in_flight_to_unread(&self) -> Result<usize, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let count = conn.execute(
            "UPDATE notifications SET state = 'unread' WHERE state IN ('pending', 'displaying')",
            [],
        )?;
        Ok(count)
    }

    pub fn get_unread_notifications(&self) -> Result<Vec<StoredNotification>, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT id, source, surface, kind, title, text, category, account,
                    target_json, group_key, group_count, state, external_ref,
                    created_at, received_at, expires_at
             FROM notifications
             WHERE state = 'unread'
             ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let id_str: String = row.get(0)?;
            let source_str: String = row.get(1)?;
            let surface_str: String = row.get(2)?;
            let kind_str: String = row.get(3)?;
            let title: String = row.get(4)?;
            let text: String = row.get(5)?;
            let category: Option<String> = row.get(6)?;
            let account: Option<String> = row.get(7)?;
            let target_json: String = row.get(8)?;
            let group_key: Option<String> = row.get(9)?;
            let group_count: u32 = row.get(10)?;
            let state_str: String = row.get(11)?;
            let external_ref: Option<String> = row.get(12)?;
            let created_at: i64 = row.get(13)?;
            let received_at: i64 = row.get(14)?;
            let expires_at: Option<i64> = row.get(15)?;

            let id = Uuid::parse_str(&id_str).unwrap_or_default();
            let source: Source = serde_json::from_str(&format!("\"{}\"", source_str)).unwrap();
            let surface: Surface = serde_json::from_str(&format!("\"{}\"", surface_str)).unwrap();
            let kind: Kind = serde_json::from_str(&format!("\"{}\"", kind_str)).unwrap();
            let target: Target = serde_json::from_str(&target_json).unwrap();
            let state =
                NotificationState::from_str(&state_str).unwrap_or(NotificationState::Unread);

            Ok(StoredNotification {
                id,
                source,
                surface,
                kind,
                title,
                text,
                category,
                account,
                target,
                group_key,
                group_count,
                state,
                external_ref,
                created_at,
                received_at,
                expires_at,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    pub fn remove_notification(&self, id: Uuid, resolution: &str) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let id_str = id.to_string();

        // Record into history
        conn.execute(
            "INSERT OR REPLACE INTO history (id, source, surface, kind, category, created_at, resolved_at, resolution)
             SELECT id, source, surface, kind, category, created_at, ?1, ?2
             FROM notifications WHERE id = ?3",
            params![Utc::now().timestamp_millis(), resolution, id_str],
        )?;

        // Delete from active notifications
        conn.execute("DELETE FROM notifications WHERE id = ?1", params![id_str])?;
        Ok(())
    }

    pub fn clear_all_unread(&self, resolution: &str) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let now = Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO history (id, source, surface, kind, category, created_at, resolved_at, resolution)
             SELECT id, source, surface, kind, category, created_at, ?1, ?2
             FROM notifications WHERE state = 'unread'",
            params![now, resolution],
        )?;

        conn.execute("DELETE FROM notifications WHERE state = 'unread'", [])?;
        Ok(())
    }

    // Dedupe
    pub fn is_dedupe_seen(&self, key: &str) -> Result<bool, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let exists: Option<i64> = conn
            .query_row(
                "SELECT seen_at FROM dedupe WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(exists.is_some())
    }

    pub fn record_dedupe(&self, key: &str, seen_at: i64) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        conn.execute(
            "INSERT OR REPLACE INTO dedupe (key, seen_at) VALUES (?1, ?2)",
            params![key, seen_at],
        )?;
        Ok(())
    }

    pub fn prune_dedupe_older_than(&self, timestamp: i64) -> Result<usize, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let count = conn.execute("DELETE FROM dedupe WHERE seen_at < ?1", params![timestamp])?;
        Ok(count)
    }

    // Settings
    pub fn get_setting_json(&self, key: &str) -> Result<Option<String>, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let val: Option<String> = conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(val)
    }

    pub fn set_setting_json(&self, key: &str, value_json: &str) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value_json) VALUES (?1, ?2)",
            params![key, value_json],
        )?;
        Ok(())
    }

    // Paired Origins
    pub fn is_origin_paired(&self, origin: &str) -> Result<bool, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let exists: Option<String> = conn
            .query_row(
                "SELECT origin FROM paired_clients WHERE origin = ?1",
                params![origin],
                |r| r.get(0),
            )
            .optional()?;
        Ok(exists.is_some())
    }

    pub fn add_paired_origin(&self, origin: &str, client: &str) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO paired_clients (origin, client, paired_at, last_seen_at) VALUES (?1, ?2, ?3, ?4)",
            params![origin, client, now, now],
        )?;
        Ok(())
    }

    // Gmail Accounts
    pub fn get_gmail_accounts(&self) -> Result<Vec<StoredGmailAccount>, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT alias, email, history_id, last_poll_at, label_map_json, status, config_json FROM gmail_accounts",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(StoredGmailAccount {
                alias: row.get(0)?,
                email: row.get(1)?,
                history_id: row.get(2)?,
                last_poll_at: row.get(3)?,
                label_map_json: row.get(4)?,
                status: row.get(5)?,
                config_json: row.get(6)?,
            })
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn save_gmail_account(&self, acc: &StoredGmailAccount) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        conn.execute(
            "INSERT OR REPLACE INTO gmail_accounts (alias, email, history_id, last_poll_at, label_map_json, status, config_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                acc.alias,
                acc.email,
                acc.history_id,
                acc.last_poll_at,
                acc.label_map_json,
                acc.status,
                acc.config_json,
            ],
        )?;
        Ok(())
    }

    pub fn delete_gmail_account(&self, alias: &str) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;
        conn.execute(
            "DELETE FROM gmail_accounts WHERE alias = ?1",
            params![alias],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_crud() {
        let store = Store::open_in_memory().unwrap();

        let id = Uuid::new_v4();
        let item = StoredNotification {
            id,
            source: Source::Claude,
            surface: Surface::Web,
            kind: Kind::Done,
            title: "Task Finished".to_string(),
            text: "All done".to_string(),
            category: None,
            account: None,
            target: Target::BrowserTab {
                tab_id: 1,
                window_id: 1,
                url: None,
            },
            group_key: None,
            group_count: 1,
            state: NotificationState::Unread,
            external_ref: None,
            created_at: 1000,
            received_at: 1005,
            expires_at: None,
        };

        store.save_notification(&item).unwrap();
        let unread = store.get_unread_notifications().unwrap();
        assert_eq!(unread.len(), 1);
        assert_eq!(unread[0].title, "Task Finished");

        store.remove_notification(id, "clicked").unwrap();
        let unread_after = store.get_unread_notifications().unwrap();
        assert_eq!(unread_after.len(), 0);
    }

    #[test]
    fn test_dedupe_store() {
        let store = Store::open_in_memory().unwrap();
        assert!(!store.is_dedupe_seen("key1").unwrap());

        store.record_dedupe("key1", 500).unwrap();
        assert!(store.is_dedupe_seen("key1").unwrap());

        store.prune_dedupe_older_than(600).unwrap();
        assert!(!store.is_dedupe_seen("key1").unwrap());
    }

    #[test]
    fn test_paired_origins() {
        let store = Store::open_in_memory().unwrap();
        let origin = "chrome-extension://abcdefghijklmnop";
        assert!(!store.is_origin_paired(origin).unwrap());

        store.add_paired_origin(origin, "chrome-ext").unwrap();
        assert!(store.is_origin_paired(origin).unwrap());
    }

    #[test]
    fn test_gmail_accounts() {
        let store = Store::open_in_memory().unwrap();
        let list = store.get_gmail_accounts().unwrap();
        assert_eq!(list.len(), 0);

        let acc = StoredGmailAccount {
            alias: "Work".to_string(),
            email: "work@example.com".to_string(),
            history_id: Some("12345".to_string()),
            last_poll_at: Some(1000),
            label_map_json: None,
            status: Some("Connected".to_string()),
            config_json: Some("{}".to_string()),
        };
        store.save_gmail_account(&acc).unwrap();

        let list2 = store.get_gmail_accounts().unwrap();
        assert_eq!(list2.len(), 1);
        assert_eq!(list2[0].alias, "Work");
        assert_eq!(list2[0].email, "work@example.com");

        store.delete_gmail_account("Work").unwrap();
        let list3 = store.get_gmail_accounts().unwrap();
        assert_eq!(list3.len(), 0);
    }

    #[test]
    fn test_crash_recovery_resets_in_flight() {
        let store = Store::open_in_memory().unwrap();
        let id1 = Uuid::new_v4();
        let id2 = Uuid::new_v4();

        let mut item1 = StoredNotification {
            id: id1,
            source: Source::Claude,
            surface: Surface::Web,
            kind: Kind::Done,
            title: "Task 1".to_string(),
            text: "Done".to_string(),
            category: None,
            account: None,
            target: Target::Url {
                url: "https://claude.ai".to_string(),
            },
            group_key: None,
            group_count: 1,
            state: NotificationState::Displaying,
            external_ref: None,
            created_at: 1000,
            received_at: 1000,
            expires_at: None,
        };
        store.save_notification(&item1).unwrap();

        item1.id = id2;
        item1.state = NotificationState::Pending;
        store.save_notification(&item1).unwrap();

        // Before recovery: get_unread returns 0 because items are displaying/pending
        assert_eq!(store.get_unread_notifications().unwrap().len(), 0);

        // Crash recovery runs on startup
        let recovered = store.reset_in_flight_to_unread().unwrap();
        assert_eq!(recovered, 2);

        // After recovery: both items safely in unread queue
        let unread = store.get_unread_notifications().unwrap();
        assert_eq!(unread.len(), 2);
    }
}
