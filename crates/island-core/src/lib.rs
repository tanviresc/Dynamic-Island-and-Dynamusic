use island_contract::Event;
use serde::{Deserialize, Serialize};

pub type Millis = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Priority {
    Low,
    Normal,
    High,
    Urgent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum Presentation {
    Hidden,
    Dot { color: String },
    Pill { event: Event },
    QueuePanel,
}

pub trait ActivityBehavior {
    fn priority(&self) -> Priority;
    fn presentation(&self) -> Presentation;
    fn next_deadline(&self) -> Option<Millis>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_core_baseline() {
        assert!(Priority::Urgent > Priority::Normal);
    }
}
