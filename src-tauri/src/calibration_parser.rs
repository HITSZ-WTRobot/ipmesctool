use crate::command::MotorState;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// 固件校准报告块的分隔线。
pub const CALIBRATION_SEPARATOR: &str = "================ CALIBRATION ================";

/// 校准生命周期状态，序列化为小写字符串（idle/running/success/failed）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CalibrationStatus {
    #[default]
    Idle,
    Running,
    Success,
    Failed,
}

/// 校准过程中上报给前端的完整状态快照。
///
/// - `results` 按固件顺序累积保存每个 `result ...` 行（去掉 `result ` 前缀后的负载文本）。
/// - `stage` 是当前进行中的阶段；`failed_stage` 仅在校准失败时给出。
/// - `motor_state` 来自报告中的 `state ...` 行。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CalibrationState {
    pub status: CalibrationStatus,
    pub stage: Option<String>,
    pub failed_stage: Option<String>,
    pub results: Vec<String>,
    pub motor_state: Option<MotorState>,
}

/// 解析固件校准命令的异步报告。
///
/// 固件先同步回 `ok`，随后由主循环发送分隔线包裹的状态块：
/// ```text
/// ================ CALIBRATION ================
/// state Calibration
/// calibration_status running
/// stage pole_pairs_alignment
/// ================ CALIBRATION ================
/// ```
/// 每个阶段变化/结束都会发送一个新的分隔块；只有成功或失败块的**结束分隔线**
/// 才意味着校准生命周期结束。中间的 `ok` 与阶段完成不会终止解析。
pub struct CalibrationParser {
    pub state: CalibrationState,
    in_block: bool,
    done: bool,
}

impl CalibrationParser {
    pub fn new() -> Self {
        Self {
            state: CalibrationState::default(),
            in_block: false,
            done: false,
        }
    }

    /// 解析一行，返回 `CalibrationState` 是否发生变化（分隔线返回 `false`）。
    ///
    /// 无法识别的行（`ok`、`error ...`、空行等）不视为失败。
    pub fn parse(&mut self, line: &str) -> Result<bool, String> {
        let line = line.trim();
        if line.is_empty() {
            return Ok(false);
        }
        if line == CALIBRATION_SEPARATOR {
            if self.in_block {
                self.in_block = false;
                // 仅在成功/失败块的结束分隔线后标记完成。
                if matches!(
                    self.state.status,
                    CalibrationStatus::Success | CalibrationStatus::Failed
                ) {
                    self.done = true;
                }
            } else {
                self.in_block = true;
            }
            return Ok(false);
        }

        let (tag, rest) = match line.split_once(char::is_whitespace) {
            Some((tag, rest)) => (tag, rest.trim()),
            None => (line, ""),
        };

        let changed = match tag {
            "calibration_status" => {
                let status = parse_status(rest)?;
                if self.state.status != status {
                    self.state.status = status;
                    true
                } else {
                    false
                }
            }
            "stage" => {
                let stage = single_token(rest, "stage")?.to_string();
                if self.state.stage.as_deref() != Some(stage.as_str()) {
                    self.state.stage = Some(stage);
                    true
                } else {
                    false
                }
            }
            "failed_stage" => {
                let stage = single_token(rest, "failed_stage")?.to_string();
                if self.state.failed_stage.as_deref() != Some(stage.as_str()) {
                    self.state.failed_stage = Some(stage);
                    true
                } else {
                    false
                }
            }
            "result" => {
                if rest.is_empty() {
                    return Err("result: missing payload".to_string());
                }
                self.state.results.push(rest.to_string());
                true
            }
            "state" => {
                let name = single_token(rest, "state")?;
                let state = MotorState::from_str(name)
                    .map_err(|_| format!("state: unknown motor state `{name}`"))?;
                if self.state.motor_state != Some(state) {
                    self.state.motor_state = Some(state);
                    true
                } else {
                    false
                }
            }
            // `ok`、`error ...` 及无关行不改变状态，也不算失败。
            _ => false,
        };
        Ok(changed)
    }

    /// 是否已在校准成功/失败块的结束分隔线之后完成。
    pub fn is_done(&self) -> bool {
        self.done
    }
}

fn parse_status(value: &str) -> Result<CalibrationStatus, String> {
    match value {
        "idle" => Ok(CalibrationStatus::Idle),
        "running" => Ok(CalibrationStatus::Running),
        "success" => Ok(CalibrationStatus::Success),
        "failed" => Ok(CalibrationStatus::Failed),
        other => Err(format!("calibration_status: unknown status `{other}`")),
    }
}

fn single_token<'a>(rest: &'a str, row: &str) -> Result<&'a str, String> {
    let mut tokens = rest.split_whitespace();
    let token = tokens
        .next()
        .ok_or_else(|| format!("{row}: missing value"))?;
    if tokens.next().is_some() {
        return Err(format!("{row}: expected exactly one value, got `{rest}`"));
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(parser: &mut CalibrationParser, lines: &[&str]) {
        for line in lines {
            parser.parse(line).expect("line must parse");
        }
    }

    const STARTUP: &[&str] = &[
        "ok",
        CALIBRATION_SEPARATOR,
        "state Calibration",
        "calibration_status running",
        "stage pole_pairs_alignment",
        CALIBRATION_SEPARATOR,
    ];

    #[test]
    fn startup_block_does_not_terminate() {
        let mut parser = CalibrationParser::new();
        feed(&mut parser, STARTUP);
        assert!(!parser.is_done());
        assert_eq!(parser.state.status, CalibrationStatus::Running);
        assert_eq!(parser.state.stage.as_deref(), Some("pole_pairs_alignment"));
        assert_eq!(parser.state.motor_state, Some(MotorState::Calibration));
    }

    #[test]
    fn stage_complete_line_does_not_terminate() {
        let mut parser = CalibrationParser::new();
        feed(&mut parser, STARTUP);
        parser.parse("state Calibration").unwrap();
        parser.parse("calibration_status running").unwrap();
        parser.parse("stage complete").unwrap();
        parser.parse(CALIBRATION_SEPARATOR).unwrap();
        assert!(
            !parser.is_done(),
            "stage complete must not finish calibration"
        );
        assert_eq!(parser.state.stage.as_deref(), Some("complete"));
    }

    #[test]
    fn success_is_decisive_only_after_closing_separator() {
        let mut parser = CalibrationParser::new();
        feed(&mut parser, STARTUP);

        // 中间阶段块：结果累积，不结束。
        feed(
            &mut parser,
            &[
                CALIBRATION_SEPARATOR,
                "result alignment=ok",
                "state Calibration",
                "calibration_status running",
                "stage pole_pairs_detection",
                CALIBRATION_SEPARATOR,
            ],
        );
        assert!(!parser.is_done());
        assert_eq!(parser.state.results, vec!["alignment=ok".to_string()]);
        assert_eq!(parser.state.stage.as_deref(), Some("pole_pairs_detection"));

        // 成功块：关闭分隔线之前不得标记完成。
        feed(
            &mut parser,
            &[
                CALIBRATION_SEPARATOR,
                "result speed_pi kp=1 ki=2",
                "state Ready",
                "calibration_status success",
            ],
        );
        assert!(
            !parser.is_done(),
            "success before closing separator must not finish"
        );
        assert_eq!(parser.state.status, CalibrationStatus::Success);

        parser.parse(CALIBRATION_SEPARATOR).unwrap();
        assert!(parser.is_done());
        assert_eq!(parser.state.motor_state, Some(MotorState::Ready));
        assert_eq!(
            parser.state.results,
            vec!["alignment=ok".to_string(), "speed_pi kp=1 ki=2".to_string()]
        );
    }

    #[test]
    fn failure_block_preserves_failed_stage_and_finishes() {
        let mut parser = CalibrationParser::new();
        feed(&mut parser, STARTUP);
        feed(
            &mut parser,
            &[
                CALIBRATION_SEPARATOR,
                "result resistance=1.23 ohm",
                "state Fault",
                "calibration_status failed",
                "failed_stage d_axis_inductance_identification",
                CALIBRATION_SEPARATOR,
            ],
        );
        assert!(parser.is_done());
        assert_eq!(parser.state.status, CalibrationStatus::Failed);
        assert_eq!(
            parser.state.failed_stage.as_deref(),
            Some("d_axis_inductance_identification")
        );
        assert_eq!(parser.state.motor_state, Some(MotorState::Fault));
        assert_eq!(
            parser.state.results,
            vec!["resistance=1.23 ohm".to_string()]
        );
    }

    #[test]
    fn failure_at_complete_keeps_last_stage_as_failed_stage() {
        let mut parser = CalibrationParser::new();
        feed(&mut parser, STARTUP);
        feed(
            &mut parser,
            &[
                CALIBRATION_SEPARATOR,
                "state Ready",
                "calibration_status failed",
                "failed_stage speed_sweep",
                CALIBRATION_SEPARATOR,
            ],
        );
        assert!(parser.is_done());
        assert_eq!(parser.state.status, CalibrationStatus::Failed);
        assert_eq!(parser.state.failed_stage.as_deref(), Some("speed_sweep"));
        assert_eq!(parser.state.motor_state, Some(MotorState::Ready));
    }

    #[test]
    fn unrelated_lines_and_errors_are_ignored() {
        let mut parser = CalibrationParser::new();
        for line in ["ok", "error internal", "", "some noise"] {
            assert!(parser.parse(line).is_ok(), "line `{line}` must not fail");
        }
        assert!(!parser.is_done());
        assert_eq!(parser.state.status, CalibrationStatus::Idle);
    }

    #[test]
    fn malformed_recognized_lines_fail() {
        let mut parser = CalibrationParser::new();
        assert!(parser.parse("calibration_status done").is_err());
        assert!(parser.parse("stage").is_err());
        assert!(parser.parse("state Running").is_err());
        assert!(parser.parse("result").is_err());
    }

    #[test]
    fn payload_change_flag_tracks_updates() {
        let mut parser = CalibrationParser::new();
        assert!(parser.parse("ok").unwrap() == false);
        assert!(parser.parse(CALIBRATION_SEPARATOR).unwrap() == false);
        assert!(parser.parse("calibration_status running").unwrap());
        // 重复行不产生变化。
        assert!(!parser.parse("calibration_status running").unwrap());
        assert!(parser.parse("result alignment=ok").unwrap());
    }
}
