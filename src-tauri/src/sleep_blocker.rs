use std::process::{Child, Command, Stdio};

#[derive(Default)]
pub struct SleepBlocker {
    child: Option<Child>,
}

impl SleepBlocker {
    pub fn start(&mut self) -> bool {
        if cfg!(not(target_os = "macos")) || self.child.is_some() {
            return false;
        }

        match Command::new("/usr/bin/caffeinate")
            .arg("-dimsu")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => {
                self.child = Some(child);
                true
            }
            Err(_) => {
                self.child = None;
                false
            }
        }
    }

    pub fn stop(&mut self) -> bool {
        let Some(mut child) = self.child.take() else {
            return false;
        };

        let _ = child.kill();
        true
    }
}

impl Drop for SleepBlocker {
    fn drop(&mut self) {
        self.stop();
    }
}
