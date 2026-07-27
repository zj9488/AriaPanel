use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

pub struct LogBuffer {
    lines: Mutex<VecDeque<String>>,
    max_lines: usize,
}

impl LogBuffer {
    pub fn new(max_lines: usize) -> Arc<Self> {
        Arc::new(Self {
            lines: Mutex::new(VecDeque::with_capacity(max_lines)),
            max_lines,
        })
    }

    pub fn push(&self, line: String) {
        let mut guard = self.lines.lock().unwrap();
        if guard.len() >= self.max_lines {
            guard.pop_front();
        }
        guard.push_back(line);
    }

    pub fn snapshot(&self) -> Vec<String> {
        self.lines.lock().unwrap().iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_snapshot() {
        let buf = LogBuffer::new(200);
        buf.push("line1".into());
        buf.push("line2".into());
        assert_eq!(buf.snapshot(), vec!["line1", "line2"]);
    }

    #[test]
    fn evicts_oldest_when_full() {
        let buf = LogBuffer::new(3);
        buf.push("a".into());
        buf.push("b".into());
        buf.push("c".into());
        buf.push("d".into());
        assert_eq!(buf.snapshot(), vec!["b", "c", "d"]);
    }

    #[test]
    fn empty_buffer_returns_empty_snapshot() {
        let buf = LogBuffer::new(200);
        assert!(buf.snapshot().is_empty());
    }
}
