pub mod api;
pub mod oauth;
pub mod processor;
pub mod types;

pub use api::{GmailApi, GmailApiError, MockGmailApi, ReqwestGmailApi};
pub use oauth::{
    build_authorization_url, exchange_code_for_tokens, generate_pkce_pair, generate_state,
    listen_for_oauth_callback, refresh_access_token, OAuthError, PkcePair, TokenResponse,
};
pub use processor::{HistoryProcessor, CATCHUP_GAP_MS, MAX_BURST_BEFORE_GROUP};
pub use reqwest;
pub use types::{
    AccountConfig, CategoryMode, GmailLabel, GmailProfile, MessageMetadata, OAuthClientConfig,
    ReadSyncOp,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{HistoryMessageAdded, HistoryRecord, HistoryResponse};
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use island_contract::Kind;
    use sha2::{Digest, Sha256};
    use std::collections::HashMap;

    fn make_test_account(alias: &str, email: &str) -> AccountConfig {
        let mut acc = AccountConfig::new(alias.to_string(), email.to_string());
        acc.label_map
            .insert("L_UNI".into(), "Island/University".into());
        acc.label_map
            .insert("L_SEC".into(), "Island/Security".into());
        acc.label_map.insert("L_WORK".into(), "Island/Work".into());
        acc
    }

    #[test]
    fn test_pkce_verifier_and_challenge_correctness() {
        let pkce = generate_pkce_pair();
        assert_eq!(pkce.verifier.len(), 43); // 32 bytes base64url no-pad

        // Verify challenge is sha256(verifier)
        let mut hasher = Sha256::new();
        hasher.update(pkce.verifier.as_bytes());
        let hash = hasher.finalize();
        let expected_challenge = URL_SAFE_NO_PAD.encode(hash);
        assert_eq!(pkce.challenge, expected_challenge);
    }

    #[test]
    fn test_oauth_client_config_parse() {
        // 1. Installed app shape
        let installed_json = r#"{"installed":{"client_id":"cid-123","client_secret":"sec-456"}}"#;
        let c1 = OAuthClientConfig::parse(installed_json).unwrap();
        assert_eq!(c1.client_id, "cid-123");
        assert_eq!(c1.client_secret, "sec-456");

        // 2. Web app shape
        let web_json = r#"{"web":{"client_id":"cid-web","client_secret":"sec-web"}}"#;
        let c2 = OAuthClientConfig::parse(web_json).unwrap();
        assert_eq!(c2.client_id, "cid-web");
        assert_eq!(c2.client_secret, "sec-web");

        // 3. Flat shape
        let flat_json = r#"{"client_id":"cid-flat","client_secret":"sec-flat"}"#;
        let c3 = OAuthClientConfig::parse(flat_json).unwrap();
        assert_eq!(c3.client_id, "cid-flat");
        assert_eq!(c3.client_secret, "sec-flat");
    }

    #[tokio::test]
    async fn test_first_connect_notifies_nothing() {
        let api = MockGmailApi::new();
        api.set_profile(GmailProfile {
            email_address: "alice@example.com".into(),
            history_id: "1001".into(),
            messages_total: Some(50),
            threads_total: Some(25),
        })
        .await;

        let acc = make_test_account("personal", "alice@example.com");
        let mut processor = HistoryProcessor::new(acc);

        let (events, sync_ops) = processor.poll(&api, "token", 10000).await.unwrap();
        assert!(events.is_empty(), "First connect must emit no events");
        assert!(sync_ops.is_empty());
        assert_eq!(processor.account.history_id.as_deref(), Some("1001"));
    }

    #[tokio::test]
    async fn test_new_labeled_unread_emits_event_with_category() {
        let api = MockGmailApi::new();
        let mut acc = make_test_account("personal", "alice@example.com");
        acc.history_id = Some("1000".into());
        acc.last_poll_at = Some(9000);

        let mut processor = HistoryProcessor::new(acc);

        // Add history record for new message
        let hist_resp = HistoryResponse {
            history: Some(vec![HistoryRecord {
                id: "h1".into(),
                messages_added: vec![HistoryMessageAdded {
                    message: crate::types::MessageRef {
                        id: "msg-123".into(),
                        thread_id: Some("t-123".into()),
                        label_ids: Some(vec!["UNREAD".into(), "L_UNI".into()]),
                    },
                }],
                labels_added: vec![],
                labels_removed: vec![],
            }]),
            next_page_token: None,
            history_id: "1001".into(),
        };
        api.set_history_response("1000", Ok(hist_resp)).await;

        let mut headers = HashMap::new();
        headers.insert("from".into(), "Registrar Office <registrar@uni.edu>".into());
        headers.insert("subject".into(), "Tuition fee receipt".into());

        api.add_message(MessageMetadata {
            id: "msg-123".into(),
            thread_id: "t-123".into(),
            label_ids: vec!["UNREAD".into(), "L_UNI".into()],
            snippet: None,
            internal_date: None,
            headers,
        })
        .await;

        let (events, _) = processor.poll(&api, "token", 10000).await.unwrap();
        assert_eq!(events.len(), 1);
        let ev = &events[0];
        assert_eq!(ev.category.as_deref(), Some("University"));
        assert_eq!(ev.kind, Kind::NewMail);
        assert_eq!(ev.text, "Registrar Office · Tuition fee receipt");
    }

    #[tokio::test]
    async fn test_unlabeled_fallback_rule() {
        let api = MockGmailApi::new();
        let mut acc = make_test_account("personal", "alice@example.com");
        acc.history_id = Some("1000".into());
        acc.last_poll_at = Some(9000);
        acc.fallback_enabled = true;

        let mut processor = HistoryProcessor::new(acc);

        // Message matching fallback: UNREAD + IMPORTANT + CATEGORY_PERSONAL + INBOX
        let hist_resp = HistoryResponse {
            history: Some(vec![HistoryRecord {
                id: "h1".into(),
                messages_added: vec![HistoryMessageAdded {
                    message: crate::types::MessageRef {
                        id: "msg-fallback".into(),
                        thread_id: Some("t-fallback".into()),
                        label_ids: Some(vec![
                            "UNREAD".into(),
                            "IMPORTANT".into(),
                            "CATEGORY_PERSONAL".into(),
                            "INBOX".into(),
                        ]),
                    },
                }],
                labels_added: vec![],
                labels_removed: vec![],
            }]),
            next_page_token: None,
            history_id: "1001".into(),
        };
        api.set_history_response("1000", Ok(hist_resp)).await;

        let mut headers = HashMap::new();
        headers.insert("from".into(), "Mom <mom@family.com>".into());
        headers.insert("subject".into(), "Dinner tonight".into());

        api.add_message(MessageMetadata {
            id: "msg-fallback".into(),
            thread_id: "t-fallback".into(),
            label_ids: vec![
                "UNREAD".into(),
                "IMPORTANT".into(),
                "CATEGORY_PERSONAL".into(),
                "INBOX".into(),
            ],
            snippet: None,
            internal_date: None,
            headers,
        })
        .await;

        let (events, _) = processor.poll(&api, "token", 10000).await.unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].category.as_deref(), Some("Important"));

        // When fallback is disabled: emits nothing!
        processor.account.fallback_enabled = false;
        processor.account.history_id = Some("1001".into());
        api.set_history_response(
            "1001",
            Ok(HistoryResponse {
                history: Some(vec![HistoryRecord {
                    id: "h2".into(),
                    messages_added: vec![HistoryMessageAdded {
                        message: crate::types::MessageRef {
                            id: "msg-fallback-2".into(),
                            thread_id: Some("t-fallback-2".into()),
                            label_ids: Some(vec![
                                "UNREAD".into(),
                                "IMPORTANT".into(),
                                "CATEGORY_PERSONAL".into(),
                                "INBOX".into(),
                            ]),
                        },
                    }],
                    labels_added: vec![],
                    labels_removed: vec![],
                }]),
                next_page_token: None,
                history_id: "1002".into(),
            }),
        )
        .await;

        let (events2, _) = processor.poll(&api, "token", 11000).await.unwrap();
        assert_eq!(events2.len(), 0);
    }

    #[tokio::test]
    async fn test_history_404_resets_baseline_notifies_nothing() {
        let api = MockGmailApi::new();
        api.set_profile(GmailProfile {
            email_address: "alice@example.com".into(),
            history_id: "2000".into(),
            messages_total: None,
            threads_total: None,
        })
        .await;

        let mut acc = make_test_account("personal", "alice@example.com");
        acc.history_id = Some("1000".into()); // Old expired history ID

        let mut processor = HistoryProcessor::new(acc);
        api.set_history_response("1000", Err(404)).await;

        let (events, _) = processor.poll(&api, "token", 10000).await.unwrap();
        assert!(events.is_empty(), "Expired history must notify nothing");
        assert_eq!(processor.account.history_id.as_deref(), Some("2000"));
    }

    #[tokio::test]
    async fn test_catchup_grouping_on_burst_and_gap() {
        let api = MockGmailApi::new();
        let mut acc = make_test_account("personal", "alice@example.com");
        acc.history_id = Some("1000".into());
        acc.last_poll_at = Some(1000); // 10 minutes ago (> 5 min gap)

        let mut processor = HistoryProcessor::new(acc);

        let hist_resp = HistoryResponse {
            history: Some(vec![HistoryRecord {
                id: "h1".into(),
                messages_added: (1..=4)
                    .map(|i| HistoryMessageAdded {
                        message: crate::types::MessageRef {
                            id: format!("msg-{}", i),
                            thread_id: Some(format!("t-{}", i)),
                            label_ids: Some(vec!["UNREAD".into(), "L_WORK".into()]),
                        },
                    })
                    .collect(),
                labels_added: vec![],
                labels_removed: vec![],
            }]),
            next_page_token: None,
            history_id: "1001".into(),
        };
        api.set_history_response("1000", Ok(hist_resp)).await;

        for i in 1..=4 {
            let mut headers = HashMap::new();
            headers.insert("from".into(), "Boss <boss@work.com>".into());
            headers.insert("subject".into(), format!("Task #{}", i));
            api.add_message(MessageMetadata {
                id: format!("msg-{}", i),
                thread_id: format!("t-{}", i),
                label_ids: vec!["UNREAD".into(), "L_WORK".into()],
                snippet: None,
                internal_date: None,
                headers,
            })
            .await;
        }

        // Gap > 5 min -> single grouped event
        let (events, _) = processor
            .poll(&api, "token", 1000 + CATCHUP_GAP_MS + 1000)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].text, "4 new emails");
    }

    #[tokio::test]
    async fn test_read_sync_when_unread_removed() {
        let api = MockGmailApi::new();
        let mut acc = make_test_account("personal", "alice@example.com");
        acc.history_id = Some("1000".into());
        acc.last_poll_at = Some(9000);

        let mut processor = HistoryProcessor::new(acc);

        let hist_resp = HistoryResponse {
            history: Some(vec![HistoryRecord {
                id: "h1".into(),
                messages_added: vec![],
                labels_added: vec![],
                labels_removed: vec![crate::types::HistoryLabelModified {
                    message: crate::types::MessageRef {
                        id: "msg-read-on-phone".into(),
                        thread_id: None,
                        label_ids: None,
                    },
                    label_ids: vec!["UNREAD".into()],
                }],
            }]),
            next_page_token: None,
            history_id: "1001".into(),
        };
        api.set_history_response("1000", Ok(hist_resp)).await;

        let (events, sync_ops) = processor.poll(&api, "token", 10000).await.unwrap();
        assert_eq!(events.len(), 0);
        assert_eq!(sync_ops.len(), 1);
        assert_eq!(
            sync_ops[0],
            ReadSyncOp::RemoveUnread {
                alias: "personal".into(),
                message_id: "msg-read-on-phone".into()
            }
        );
    }

    #[tokio::test]
    async fn test_otp_heuristic_and_privacy_mode_and_security_sender() {
        let api = MockGmailApi::new();
        let mut acc = make_test_account("personal", "alice@example.com");
        acc.history_id = Some("1000".into());
        acc.last_poll_at = Some(9000);

        let mut processor = HistoryProcessor::new(acc);

        // 1. Security category: full sender address shown
        let hist_resp = HistoryResponse {
            history: Some(vec![HistoryRecord {
                id: "h1".into(),
                messages_added: vec![HistoryMessageAdded {
                    message: crate::types::MessageRef {
                        id: "msg-sec".into(),
                        thread_id: None,
                        label_ids: Some(vec!["UNREAD".into(), "L_SEC".into()]),
                    },
                }],
                labels_added: vec![],
                labels_removed: vec![],
            }]),
            next_page_token: None,
            history_id: "1001".into(),
        };
        api.set_history_response("1000", Ok(hist_resp)).await;

        let mut sec_headers = HashMap::new();
        sec_headers.insert(
            "from".into(),
            "Google Security Team <no-reply@accounts.google.com>".into(),
        );
        sec_headers.insert("subject".into(), "Security alert for your account".into());

        api.add_message(MessageMetadata {
            id: "msg-sec".into(),
            thread_id: "t-sec".into(),
            label_ids: vec!["UNREAD".into(), "L_SEC".into()],
            snippet: None,
            internal_date: None,
            headers: sec_headers,
        })
        .await;

        let (events, _) = processor.poll(&api, "token", 10000).await.unwrap();
        assert_eq!(events.len(), 1);
        // Security category shows full address
        assert!(events[0]
            .text
            .contains("Google Security Team <no-reply@accounts.google.com>"));

        // 2. Privacy mode: hides subject
        processor.account.privacy_mode = true;
        processor.account.history_id = Some("1001".into());
        api.set_history_response(
            "1001",
            Ok(HistoryResponse {
                history: Some(vec![HistoryRecord {
                    id: "h2".into(),
                    messages_added: vec![HistoryMessageAdded {
                        message: crate::types::MessageRef {
                            id: "msg-priv".into(),
                            thread_id: None,
                            label_ids: Some(vec!["UNREAD".into(), "L_WORK".into()]),
                        },
                    }],
                    labels_added: vec![],
                    labels_removed: vec![],
                }]),
                next_page_token: None,
                history_id: "1002".into(),
            }),
        )
        .await;

        let mut work_headers = HashMap::new();
        work_headers.insert("from".into(), "Client <client@work.com>".into());
        work_headers.insert("subject".into(), "Confidential quarterly figures".into());
        api.add_message(MessageMetadata {
            id: "msg-priv".into(),
            thread_id: "t-priv".into(),
            label_ids: vec!["UNREAD".into(), "L_WORK".into()],
            snippet: None,
            internal_date: None,
            headers: work_headers,
        })
        .await;

        let (priv_events, _) = processor.poll(&api, "token", 11000).await.unwrap();
        assert_eq!(priv_events.len(), 1);
        assert_eq!(priv_events[0].text, "New email"); // Subject hidden!
    }

    #[tokio::test]
    async fn test_dry_run_emits_nothing() {
        let api = MockGmailApi::new();
        let mut acc = make_test_account("personal", "alice@example.com");
        acc.history_id = Some("1000".into());
        acc.last_poll_at = Some(9000);
        acc.dry_run = true; // Dry-run enabled!

        let mut processor = HistoryProcessor::new(acc);

        let hist_resp = HistoryResponse {
            history: Some(vec![HistoryRecord {
                id: "h1".into(),
                messages_added: vec![HistoryMessageAdded {
                    message: crate::types::MessageRef {
                        id: "msg-dry".into(),
                        thread_id: None,
                        label_ids: Some(vec!["UNREAD".into(), "L_UNI".into()]),
                    },
                }],
                labels_added: vec![],
                labels_removed: vec![],
            }]),
            next_page_token: None,
            history_id: "1001".into(),
        };
        api.set_history_response("1000", Ok(hist_resp)).await;

        let mut headers = HashMap::new();
        headers.insert("from".into(), "Uni <test@uni.edu>".into());
        headers.insert("subject".into(), "Test subject".into());
        api.add_message(MessageMetadata {
            id: "msg-dry".into(),
            thread_id: "t-dry".into(),
            label_ids: vec!["UNREAD".into(), "L_UNI".into()],
            snippet: None,
            internal_date: None,
            headers,
        })
        .await;

        let (events, _) = processor.poll(&api, "token", 10000).await.unwrap();
        assert_eq!(events.len(), 0, "Dry-run mode must emit 0 events");
    }
}
