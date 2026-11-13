use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use std::collections::HashMap;
use std::sync::RwLock;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("Keyring operation failed: {0}")]
    Keyring(String),
    #[error("Lock error")]
    LockError,
}

pub trait SecretStore: Send + Sync {
    fn get_secret(&self, key: &str) -> Result<Option<String>, SecretError>;
    fn set_secret(&self, key: &str, value: &str) -> Result<(), SecretError>;
    fn delete_secret(&self, key: &str) -> Result<(), SecretError>;
}

/// Generates a 32-byte cryptographic random token, base64url encoded (43 chars).
pub fn generate_pairing_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Wrapper that redacts sensitive values in Debug and Display implementations.
#[derive(Clone, PartialEq, Eq)]
pub struct Sensitive<T>(pub T);

impl<T> std::fmt::Debug for Sensitive<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[REDACTED]")
    }
}

impl<T> std::fmt::Display for Sensitive<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[REDACTED]")
    }
}

/// In-memory implementation of SecretStore for testing
#[derive(Default)]
pub struct InMemorySecretStore {
    secrets: RwLock<HashMap<String, String>>,
}

impl InMemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for InMemorySecretStore {
    fn get_secret(&self, key: &str) -> Result<Option<String>, SecretError> {
        let guard = self.secrets.read().map_err(|_| SecretError::LockError)?;
        Ok(guard.get(key).cloned())
    }

    fn set_secret(&self, key: &str, value: &str) -> Result<(), SecretError> {
        let mut guard = self.secrets.write().map_err(|_| SecretError::LockError)?;
        guard.insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn delete_secret(&self, key: &str) -> Result<(), SecretError> {
        let mut guard = self.secrets.write().map_err(|_| SecretError::LockError)?;
        guard.remove(key);
        Ok(())
    }
}

/// Windows Credential Manager implementation via the `keyring` crate
pub struct WindowsSecretStore {
    service: String,
}

impl WindowsSecretStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }
}

impl SecretStore for WindowsSecretStore {
    fn get_secret(&self, key: &str) -> Result<Option<String>, SecretError> {
        let entry = keyring::Entry::new(&self.service, key)
            .map_err(|e| SecretError::Keyring(e.to_string()))?;
        match entry.get_password() {
            Ok(pwd) => Ok(Some(pwd)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretError::Keyring(e.to_string())),
        }
    }

    fn set_secret(&self, key: &str, value: &str) -> Result<(), SecretError> {
        let entry = keyring::Entry::new(&self.service, key)
            .map_err(|e| SecretError::Keyring(e.to_string()))?;
        entry
            .set_password(value)
            .map_err(|e| SecretError::Keyring(e.to_string()))?;
        Ok(())
    }

    fn delete_secret(&self, key: &str) -> Result<(), SecretError> {
        let entry = keyring::Entry::new(&self.service, key)
            .map_err(|e| SecretError::Keyring(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Keyring(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pairing_token_format() {
        let token = generate_pairing_token();
        assert_eq!(token.len(), 43); // 32 bytes in base64url unpadded is 43 chars
        assert!(!token.contains('+'));
        assert!(!token.contains('/'));
        assert!(!token.contains('='));
    }

    #[test]
    fn test_in_memory_secret_store() {
        let store = InMemorySecretStore::new();
        assert_eq!(store.get_secret("test-key").unwrap(), None);

        store.set_secret("test-key", "secret123").unwrap();
        assert_eq!(
            store.get_secret("test-key").unwrap(),
            Some("secret123".to_string())
        );

        store.delete_secret("test-key").unwrap();
        assert_eq!(store.get_secret("test-key").unwrap(), None);
    }

    #[test]
    fn test_sensitive_redaction_canary() {
        let secret = Sensitive("super_secret_token_12345");
        let debug_str = format!("{:?}", secret);
        let display_str = format!("{}", secret);
        assert_eq!(debug_str, "[REDACTED]");
        assert_eq!(display_str, "[REDACTED]");
        assert!(!debug_str.contains("super_secret_token"));
        assert!(!display_str.contains("super_secret_token"));
    }
}
