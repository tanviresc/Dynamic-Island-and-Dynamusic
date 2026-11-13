use crate::api::{GmailApi, GmailApiError};
use crate::types::{AccountConfig, CategoryMode, ReadSyncOp};
use chrono::Utc;
use island_contract::{Event, Kind, Source, Surface, Target};
use regex::Regex;
use std::collections::{HashMap, HashSet};
use tracing::{debug, info};
use uuid::Uuid;

pub const CATCHUP_GAP_MS: i64 = 5 * 60 * 1000; // 5 minutes (§1.10.4)
pub const MAX_BURST_BEFORE_GROUP: usize = 3; // > 3 messages grouped (§1.10.4)

pub struct HistoryProcessor {
    pub account: AccountConfig,
    seen_message_ids: HashSet<String>,
    otp_regex: Regex,
}

impl HistoryProcessor {
    pub fn new(account: AccountConfig) -> Self {
        let otp_regex =
            Regex::new(r"(?i)(code|verification|otp|sign-in|security code|verify).*?\b(\d{4,8})\b")
                .unwrap();
        Self {
            account,
            seen_message_ids: HashSet::new(),
            otp_regex,
        }
    }

    pub async fn refresh_labels<A: GmailApi>(
        &mut self,
        api: &A,
        access_token: &str,
    ) -> Result<(), GmailApiError> {
        let labels = api.list_labels(access_token).await?;
        let mut map = HashMap::new();
        for l in labels {
            map.insert(l.id, l.name);
        }
        self.account.label_map = map;
        Ok(())
    }

    pub async fn poll<A: GmailApi>(
        &mut self,
        api: &A,
        access_token: &str,
        now: i64,
    ) -> Result<(Vec<Event>, Vec<ReadSyncOp>), GmailApiError> {
        // 1. First connect: baseline historyId, emit nothing old
        if self.account.history_id.is_none() {
            let profile = api.get_profile(access_token).await?;
            self.account.history_id = Some(profile.history_id);
            let _ = self.refresh_labels(api, access_token).await;
            self.account.last_poll_at = Some(now);
            info!(
                account = %self.account.alias,
                history_id = ?self.account.history_id,
                "Gmail first connect: baseline established, emitting no notifications for existing mail"
            );
            return Ok((Vec::new(), Vec::new()));
        }

        let start_history_id = self.account.history_id.as_ref().unwrap().clone();

        // 2. Query history
        let history_resp = match api.list_history(access_token, &start_history_id).await {
            Ok(h) => h,
            Err(GmailApiError::HistoryExpired) => {
                // History 404 expired (§1.10.4 & §7.3): reset to profile historyId, emit nothing old
                let profile = api.get_profile(access_token).await?;
                self.account.history_id = Some(profile.history_id);
                self.account.last_poll_at = Some(now);
                info!(
                    account = %self.account.alias,
                    new_history_id = ?self.account.history_id,
                    "Gmail history 404: reset to current historyId, emitting no old mail"
                );
                return Ok((Vec::new(), Vec::new()));
            }
            Err(e) => return Err(e),
        };

        // Advance history id
        self.account.history_id = Some(history_resp.history_id);

        let records = history_resp.history.unwrap_or_default();
        if records.is_empty() {
            self.account.last_poll_at = Some(now);
            return Ok((Vec::new(), Vec::new()));
        }

        // 3. Collect message additions and label modifications
        let mut candidate_ids = Vec::new();
        let mut read_sync_ops = Vec::new();

        for rec in records {
            // Check messages added
            for ma in rec.messages_added {
                if !self.seen_message_ids.contains(&ma.message.id) {
                    candidate_ids.push(ma.message.id);
                }
            }

            // Check labels added (e.g. filter applied Island label or mark unread)
            for la in rec.labels_added {
                if !self.seen_message_ids.contains(&la.message.id) {
                    candidate_ids.push(la.message.id);
                }
            }

            // Check labels removed: if UNREAD removed -> read sync! (§1.10.4)
            for lr in rec.labels_removed {
                if lr.label_ids.iter().any(|l| l == "UNREAD") {
                    read_sync_ops.push(ReadSyncOp::RemoveUnread {
                        alias: self.account.alias.clone(),
                        message_id: lr.message.id,
                    });
                }
            }
        }

        // Deduplicate candidate ids
        candidate_ids.sort();
        candidate_ids.dedup();

        if candidate_ids.is_empty() {
            self.account.last_poll_at = Some(now);
            return Ok((Vec::new(), read_sync_ops));
        }

        // 4. Fetch metadata & evaluate candidates
        let mut notifiable_items = Vec::new();

        for msg_id in candidate_ids {
            self.seen_message_ids.insert(msg_id.clone());

            let meta = match api.get_message_metadata(access_token, &msg_id).await {
                Ok(m) => m,
                Err(e) => {
                    debug!("Failed to fetch message metadata for {}: {:?}", msg_id, e);
                    continue;
                }
            };

            // Must be UNREAD
            if !meta.label_ids.contains(&"UNREAD".to_string()) {
                continue;
            }

            // Match label: check Island/* prefix
            let mut matched_category: Option<String> = None;
            for label_id in &meta.label_ids {
                if let Some(name) = self.account.label_map.get(label_id) {
                    if let Some(category) = name.strip_prefix("Island/") {
                        matched_category = Some(category.to_string());
                        break;
                    }
                }
            }

            // Fallback rule (§1.10.4): UNREAD + IMPORTANT + CATEGORY_PERSONAL + INBOX
            if matched_category.is_none() && self.account.fallback_enabled {
                let has_important = meta.label_ids.contains(&"IMPORTANT".to_string());
                let has_inbox = meta.label_ids.contains(&"INBOX".to_string());
                let has_personal = meta.label_ids.contains(&"CATEGORY_PERSONAL".to_string());

                if has_important && has_inbox && has_personal {
                    matched_category = Some("Important".to_string());
                }
            }

            let category = match matched_category {
                Some(c) => c,
                None => continue,
            };

            // Mode check per category
            let mode = self.account.get_mode(&category);
            if mode == CategoryMode::Off {
                continue;
            }

            notifiable_items.push((meta, category, mode));
        }

        if notifiable_items.is_empty() {
            self.account.last_poll_at = Some(now);
            return Ok((Vec::new(), read_sync_ops));
        }

        // 5. Catch-up grouping check (§1.10.4)
        // If last poll was > 5 min ago, or > 3 notifiable messages -> emit one grouped event
        let is_catchup_gap = self
            .account
            .last_poll_at
            .map(|last| now.saturating_sub(last) > CATCHUP_GAP_MS)
            .unwrap_or(false);

        let is_large_burst = notifiable_items.len() > MAX_BURST_BEFORE_GROUP;

        self.account.last_poll_at = Some(now);

        // Dry-run mode check (§1.10.4 & §7.4): logs what would notify, shows nothing
        if self.account.dry_run {
            for (_, category, _) in &notifiable_items {
                info!(
                    label = %category,
                    alias = %self.account.alias,
                    timestamp = %now,
                    "Gmail dry-run notification suppressed"
                );
            }
            return Ok((Vec::new(), read_sync_ops));
        }

        if is_catchup_gap || is_large_burst {
            let count = notifiable_items.len();
            let ev = Event {
                id: Uuid::new_v4(),
                source: Source::Gmail,
                surface: Surface::Background,
                kind: Kind::NewMail,
                title: format!("Gmail · {}", self.account.alias),
                text: format!("{} new emails", count),
                category: Some("Grouped".to_string()),
                account: Some(self.account.alias.clone()),
                target: Target::Url {
                    url: format!(
                        "https://mail.google.com/mail/u/?authuser={}",
                        self.account.email
                    ),
                },
                created_at: Utc::now(),
                dedupe_key: format!("gmail:{}:catchup:{}", self.account.alias, now),
            };
            return Ok((vec![ev], read_sync_ops));
        }

        // 6. Generate individual events
        let mut events = Vec::new();
        for (meta, category, _mode) in notifiable_items {
            let from_header = meta.headers.get("from").cloned().unwrap_or_default();
            let subject_header = meta.headers.get("subject").cloned().unwrap_or_default();

            // Sender parsing
            let sender = if category == "Security" {
                // Security shows full sender address (§1.10.4)
                from_header.clone()
            } else {
                // Display name or address
                extract_sender_display(&from_header)
            };

            // Privacy mode check
            let text = if self.account.privacy_mode {
                "New email".to_string()
            } else if subject_header.is_empty() {
                sender
            } else {
                format!("{} · {}", sender, subject_header)
            };

            // OTP heuristic check (§1.10.4): subject matches keywords + 4-8 digit number
            let is_otp = self.account.otp_popup_only && self.otp_regex.is_match(&subject_header);

            let dedupe_key = format!("gmail:{}:{}", self.account.alias, meta.id);
            let jump_url = format!(
                "https://mail.google.com/mail/u/?authuser={}#all/{}",
                self.account.email, meta.id
            );

            let ev = Event {
                id: Uuid::new_v4(),
                source: Source::Gmail,
                surface: Surface::Background,
                kind: Kind::NewMail,
                title: format!("Gmail · {}", self.account.alias),
                text,
                category: Some(if is_otp {
                    "Verification".to_string()
                } else {
                    category
                }),
                account: Some(self.account.alias.clone()),
                target: Target::Url { url: jump_url },
                created_at: Utc::now(),
                dedupe_key,
            };

            events.push(ev);
        }

        Ok((events, read_sync_ops))
    }
}

fn extract_sender_display(from: &str) -> String {
    let trimmed = from.trim();
    if let Some(idx) = trimmed.find('<') {
        let name = trimmed[..idx].trim().trim_matches('"').trim();
        if !name.is_empty() {
            return name.to_string();
        }
    }
    trimmed.to_string()
}
