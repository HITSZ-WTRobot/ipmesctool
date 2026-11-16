use crate::command::{MotorConfigCommand, MotorState};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use strum_macros::{Display, EnumString};

/// 固件电机电气参数（Ohm / H / Wb），由校准识别，只能读回。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MotorElectricalConfig {
    pub rs: f32,
    pub ld: f32,
    pub lq: f32,
    pub flux: f32,
}

/// 解析 `get_config` 的容错结果。
///
/// 电调固件版本变化很快：任何 tag/字段都可能缺席，也可能出现本工具不认识的
/// 取值。解析器按「写入单元」保存 `Option`，缺失或非法只影响该单元并记录
/// [`ConfigIssue`]，绝不填默认值，也不让整次读取失败。`ok` 回包边界由事务层
/// 负责。
#[derive(Debug, Default)]
pub struct ConfigParser {
    state: Option<MotorState>,
    fault: Option<u8>,
    id: Option<u32>,
    protection: Option<ProtectionConfig>,
    electrical: Option<MotorElectricalConfig>,
    flux_speed: Option<f32>,
    current_pi: Option<CurrentPiConfig>,
    speed_pi: Option<SpeedPIConfig>,
    position_pid: Option<PositionPIDConfig>,
    speed_sweep_current: Option<f32>,
    speed_filter: Option<f32>,
    current_filter: Option<f32>,
    speed_pll: Option<f32>,
    encoder: Option<EncoderConfig>,
    hfi: Option<HfiConfig>,
    observer_flux: Option<ObserverFluxConfig>,
    transition: Option<TransitionConfig>,
    backup: Option<BackupConfig>,
    issues: Vec<ConfigIssue>,
    recognized_rows: usize,
}

/// 单个配置单元的读回诊断；`unit` 与 `Capabilities` 的键一致。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConfigIssue {
    pub unit: String,
    pub field: String,
    pub kind: ConfigIssueKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConfigIssueKind {
    /// 固件没有上报该 tag/字段。
    Missing,
    /// 上报了但无法解析（新格式、串口截断、固件回归）。
    Malformed,
    /// 值可解析但超出本工具的可写范围；保留值，仅禁止写入。
    OutOfRange,
}

/// 一个可写单元的能力。`writable` 与写入路径共用 `validate_config_command`，
/// 范围校验只有一份实现。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Capability {
    pub available: bool,
    pub writable: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Capabilities {
    pub position_pid: Capability,
    pub speed_pi: Capability,
    pub current_pi: Capability,
    pub speed_sweep_current: Capability,
    pub flux_speed: Capability,
    pub speed_filter: Capability,
    pub current_filter: Capability,
    pub speed_pll: Capability,
    pub current_limit: Capability,
    pub motor_id: Capability,
    pub encoder_config: Capability,
    pub hfi: Capability,
    pub observer_flux: Capability,
    pub transition: Capability,
    pub backup: Capability,
}

impl ConfigParser {
    /// 解析一行并更新自身。无法识别的行被忽略；可识别但缺失/非法的字段只会
    /// 停用对应单元并记录 issue，不会使整次读取失败。
    pub fn parse_line(&mut self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let (tag, rest) = match line.split_once(char::is_whitespace) {
            Some((tag, rest)) => (tag, rest.trim()),
            None => (line, ""),
        };
        if !matches!(
            tag,
            "state"
                | "fault"
                | "id"
                | "protection"
                | "motor"
                | "current_pi"
                | "speed_pi"
                | "speed_sweep"
                | "position_pid"
                | "encoder"
                | "hfi"
                | "observer_flux"
                | "transition"
                | "backup"
        ) {
            // `ok`、`error ...`、校准行等与配置读取无关的行一律忽略。
            return;
        }
        self.recognized_rows += 1;
        match tag {
            "state" => match single_value(rest) {
                Ok(name) => match MotorState::from_str(name) {
                    Ok(state) => self.state = Some(state),
                    Err(_) => self.issue(
                        "state",
                        "state",
                        ConfigIssueKind::Malformed,
                        format!("state: unknown motor state `{name}`"),
                    ),
                },
                Err((kind, message)) => self.issue("state", "state", kind, message),
            },
            "fault" => match single_value(rest) {
                Ok(value) => match parse_fault(value) {
                    Ok(fault) => self.fault = Some(fault),
                    Err(message) => {
                        self.issue("fault", "fault", ConfigIssueKind::Malformed, message)
                    }
                },
                Err((kind, message)) => self.issue("fault", "fault", kind, message),
            },
            "id" => match single_value(rest) {
                Ok(value) => match parse_u32(value, "id") {
                    Ok(id) => self.id = Some(id),
                    Err(message) => {
                        self.issue("motor_id", "id", ConfigIssueKind::Malformed, message)
                    }
                },
                Err((kind, message)) => self.issue("motor_id", "id", kind, message),
            },
            "protection" => match kv_pairs(rest) {
                Err(message) => self.issue(
                    "current_limit",
                    "protection",
                    ConfigIssueKind::Malformed,
                    message,
                ),
                Ok(pairs) => {
                    let current_limit = self.f32_field(
                        &pairs,
                        "current_limit",
                        "current_limit",
                        "protection.current_limit",
                    );
                    if let Some(current_limit) = current_limit {
                        self.protection = Some(ProtectionConfig { current_limit });
                    }
                }
            },
            "motor" => match kv_pairs(rest) {
                Err(message) => {
                    self.issue(
                        "electrical",
                        "motor",
                        ConfigIssueKind::Malformed,
                        message.clone(),
                    );
                    self.issue(
                        "flux_speed",
                        "motor.flux_speed",
                        ConfigIssueKind::Malformed,
                        message,
                    );
                }
                Ok(pairs) => {
                    let rs = self.f32_field(&pairs, "electrical", "rs", "motor.rs");
                    let ld = self.f32_field(&pairs, "electrical", "ld", "motor.ld");
                    let lq = self.f32_field(&pairs, "electrical", "lq", "motor.lq");
                    let flux = self.f32_field(&pairs, "electrical", "flux", "motor.flux");
                    let flux_speed = self.f32_field(
                        &pairs,
                        "flux_speed",
                        "flux_speed",
                        "motor.flux_speed",
                    );
                    self.electrical = match (rs, ld, lq, flux) {
                        (Some(rs), Some(ld), Some(lq), Some(flux)) => {
                            if flux < 0.0 {
                                self.issue(
                                    "electrical",
                                    "motor.flux",
                                    ConfigIssueKind::OutOfRange,
                                    "motor.flux: value must not be negative".to_string(),
                                );
                                None
                            } else {
                                Some(MotorElectricalConfig { rs, ld, lq, flux })
                            }
                        }
                        _ => None,
                    };
                    self.flux_speed = flux_speed;
                }
            },
            "current_pi" => match kv_pairs(rest) {
                Err(message) => {
                    self.issue("current_pi", "current_pi", ConfigIssueKind::Malformed, message)
                }
                Ok(pairs) => {
                    let d_kp =
                        self.f32_field(&pairs, "current_pi", "d_kp", "current_pi.d_kp");
                    let d_ki =
                        self.f32_field(&pairs, "current_pi", "d_ki", "current_pi.d_ki");
                    let q_kp =
                        self.f32_field(&pairs, "current_pi", "q_kp", "current_pi.q_kp");
                    let q_ki =
                        self.f32_field(&pairs, "current_pi", "q_ki", "current_pi.q_ki");
                    if let (Some(d_kp), Some(d_ki), Some(q_kp), Some(q_ki)) =
                        (d_kp, d_ki, q_kp, q_ki)
                    {
                        self.current_pi = Some(CurrentPiConfig { d_kp, d_ki, q_kp, q_ki });
                    }
                }
            },
            "speed_pi" => match kv_pairs(rest) {
                Err(message) => {
                    self.issue("speed_pi", "speed_pi", ConfigIssueKind::Malformed, message)
                }
                Ok(pairs) => {
                    let kp = self.f32_field(&pairs, "speed_pi", "kp", "speed_pi.kp");
                    let ki = self.f32_field(&pairs, "speed_pi", "ki", "speed_pi.ki");
                    let output_max = self.f32_field(
                        &pairs,
                        "speed_pi",
                        "outputmax",
                        "speed_pi.outputmax",
                    );
                    if let (Some(kp), Some(ki), Some(output_max)) = (kp, ki, output_max) {
                        self.speed_pi = Some(SpeedPIConfig { kp, ki, output_max });
                    }
                }
            },
            "speed_sweep" => match kv_pairs(rest) {
                Err(message) => {
                    for unit in [
                        "speed_sweep_current",
                        "speed_filter",
                        "current_filter",
                        "speed_pll",
                    ] {
                        self.issue(unit, unit, ConfigIssueKind::Malformed, message.clone());
                    }
                }
                Ok(pairs) => {
                    self.speed_sweep_current = self.f32_field(
                        &pairs,
                        "speed_sweep_current",
                        "iq_amplitude",
                        "speed_sweep.iq_amplitude",
                    );
                    self.speed_filter = self.f32_field(
                        &pairs,
                        "speed_filter",
                        "speed_filter",
                        "speed_sweep.speed_filter",
                    );
                    self.current_filter = self.f32_field(
                        &pairs,
                        "current_filter",
                        "current_filter",
                        "speed_sweep.current_filter",
                    );
                    self.speed_pll = self.f32_field(
                        &pairs,
                        "speed_pll",
                        "pll_frequency",
                        "speed_sweep.pll_frequency",
                    );
                }
            },
            "position_pid" => match kv_pairs(rest) {
                Err(message) => self.issue(
                    "position_pid",
                    "position_pid",
                    ConfigIssueKind::Malformed,
                    message,
                ),
                Ok(pairs) => {
                    let kp = self.f32_field(&pairs, "position_pid", "kp", "position_pid.kp");
                    let ki = self.f32_field(&pairs, "position_pid", "ki", "position_pid.ki");
                    let kd = self.f32_field(&pairs, "position_pid", "kd", "position_pid.kd");
                    let output_max = self.f32_field(
                        &pairs,
                        "position_pid",
                        "outputmax",
                        "position_pid.outputmax",
                    );
                    if let (Some(kp), Some(ki), Some(kd), Some(output_max)) =
                        (kp, ki, kd, output_max)
                    {
                        self.position_pid = Some(PositionPIDConfig { kp, ki, kd, output_max });
                    }
                }
            },
            "encoder" => match kv_pairs(rest) {
                Err(message) => self.issue(
                    "encoder_config",
                    "encoder",
                    ConfigIssueKind::Malformed,
                    message,
                ),
                Ok(pairs) => {
                    let pole_pairs = self.u32_field(
                        &pairs,
                        "encoder_config",
                        "pole_pairs",
                        "encoder.pole_pairs",
                    );
                    let encoder_direction = self.enum_field::<EncoderDirection>(
                        &pairs,
                        "encoder_config",
                        "direction",
                        "encoder.direction",
                    );
                    let encoder_offset = self.f32_field(
                        &pairs,
                        "encoder_config",
                        "offset",
                        "encoder.offset",
                    );
                    let encoder_type = self.enum_field::<EncoderType>(
                        &pairs,
                        "encoder_config",
                        "type",
                        "encoder.type",
                    );
                    if let (Some(pole_pairs), Some(encoder_direction), Some(encoder_offset), Some(encoder_type)) =
                        (pole_pairs, encoder_direction, encoder_offset, encoder_type)
                    {
                        self.encoder = Some(EncoderConfig {
                            pole_pairs,
                            encoder_direction,
                            encoder_offset,
                            encoder_type,
                        });
                    }
                }
            },
            "hfi" => match kv_pairs(rest) {
                Err(message) => {
                    self.issue("hfi", "hfi", ConfigIssueKind::Malformed, message)
                }
                Ok(pairs) => {
                    let voltage = self.f32_field(&pairs, "hfi", "voltage", "hfi.voltage");
                    let current_filter = self.f32_field(
                        &pairs,
                        "hfi",
                        "current_filter",
                        "hfi.current_filter",
                    );
                    let kp = self.f32_field(&pairs, "hfi", "kp", "hfi.kp");
                    let ki = self.f32_field(&pairs, "hfi", "ki", "hfi.ki");
                    let speed_filter = self.f32_field(
                        &pairs,
                        "hfi",
                        "speed_filter",
                        "hfi.speed_filter",
                    );
                    if let (Some(voltage), Some(current_filter), Some(kp), Some(ki), Some(speed_filter)) =
                        (voltage, current_filter, kp, ki, speed_filter)
                    {
                        self.hfi = Some(HfiConfig {
                            voltage,
                            current_filter,
                            kp,
                            ki,
                            speed_filter,
                        });
                    }
                }
            },
            "observer_flux" => match kv_pairs(rest) {
                Err(message) => self.issue(
                    "observer_flux",
                    "observer_flux",
                    ConfigIssueKind::Malformed,
                    message,
                ),
                Ok(pairs) => {
                    let gamma = self.f32_field(
                        &pairs,
                        "observer_flux",
                        "gamma",
                        "observer_flux.gamma",
                    );
                    let kp = self.f32_field(&pairs, "observer_flux", "kp", "observer_flux.kp");
                    let ki = self.f32_field(&pairs, "observer_flux", "ki", "observer_flux.ki");
                    if let (Some(gamma), Some(kp), Some(ki)) = (gamma, kp, ki) {
                        self.observer_flux = Some(ObserverFluxConfig { gamma, kp, ki });
                    }
                }
            },
            "transition" => match kv_pairs(rest) {
                Err(message) => self.issue(
                    "transition",
                    "transition",
                    ConfigIssueKind::Malformed,
                    message,
                ),
                Ok(pairs) => {
                    let low = self.f32_field(&pairs, "transition", "low", "transition.low");
                    let high = self.f32_field(&pairs, "transition", "high", "transition.high");
                    if let (Some(low), Some(high)) = (low, high) {
                        self.transition = Some(TransitionConfig { low, high });
                    }
                }
            },
            "backup" => match kv_pairs(rest) {
                Err(message) => {
                    self.issue("backup", "backup", ConfigIssueKind::Malformed, message)
                }
                Ok(pairs) => match kv(&pairs, "enabled") {
                    Ok("0") => self.backup = Some(BackupConfig { enabled: false }),
                    Ok("1") => self.backup = Some(BackupConfig { enabled: true }),
                    Ok(value) => self.issue(
                        "backup",
                        "backup.enabled",
                        ConfigIssueKind::Malformed,
                        format!("backup.enabled: expected 0 or 1, got `{value}`"),
                    ),
                    Err(KvError::Missing) => self.missing("backup", "backup.enabled"),
                    Err(KvError::Duplicate) => self.issue(
                        "backup",
                        "backup.enabled",
                        ConfigIssueKind::Malformed,
                        "backup: duplicate field `enabled`".to_string(),
                    ),
                },
            },
            _ => unreachable!("tag filtered above"),
        }
    }

    /// 是否至少识别到一行已知配置。用于区分“旧固件缺字段”和“连到了别的串口设备”。
    pub fn has_known_rows(&self) -> bool {
        self.recognized_rows > 0
    }

    fn issue(
        &mut self,
        unit: &str,
        field: &str,
        kind: ConfigIssueKind,
        message: impl Into<String>,
    ) {
        self.issues.push(ConfigIssue {
            unit: unit.to_string(),
            field: field.to_string(),
            kind,
            message: message.into(),
        });
    }

    fn missing(&mut self, unit: &str, field: &str) {
        self.issue(
            unit,
            field,
            ConfigIssueKind::Missing,
            format!("{field}: firmware did not report this field"),
        );
    }

    fn f32_field(
        &mut self,
        pairs: &[(&str, &str)],
        unit: &str,
        key: &str,
        field: &str,
    ) -> Option<f32> {
        match kv(pairs, key) {
            Ok(value) => match parse_float(value, field) {
                Ok(value) => Some(value),
                Err(message) => {
                    self.issue(unit, field, ConfigIssueKind::Malformed, message);
                    None
                }
            },
            Err(KvError::Missing) => {
                self.missing(unit, field);
                None
            }
            Err(KvError::Duplicate) => {
                self.issue(
                    unit,
                    field,
                    ConfigIssueKind::Malformed,
                    format!("{field}: duplicate field"),
                );
                None
            }
        }
    }

    fn u32_field(
        &mut self,
        pairs: &[(&str, &str)],
        unit: &str,
        key: &str,
        field: &str,
    ) -> Option<u32> {
        match kv(pairs, key) {
            Ok(value) => match parse_u32(value, field) {
                Ok(value) => Some(value),
                Err(message) => {
                    self.issue(unit, field, ConfigIssueKind::Malformed, message);
                    None
                }
            },
            Err(KvError::Missing) => {
                self.missing(unit, field);
                None
            }
            Err(KvError::Duplicate) => {
                self.issue(
                    unit,
                    field,
                    ConfigIssueKind::Malformed,
                    format!("{field}: duplicate field"),
                );
                None
            }
        }
    }

    fn enum_field<T: FromStr>(
        &mut self,
        pairs: &[(&str, &str)],
        unit: &str,
        key: &str,
        field: &str,
    ) -> Option<T> {
        match kv(pairs, key) {
            Ok(value) => match T::from_str(value) {
                Ok(value) => Some(value),
                Err(_) => {
                    self.issue(
                        unit,
                        field,
                        ConfigIssueKind::Malformed,
                        format!("{field}: unrecognized value `{value}`"),
                    );
                    None
                }
            },
            Err(KvError::Missing) => {
                self.missing(unit, field);
                None
            }
            Err(KvError::Duplicate) => {
                self.issue(
                    unit,
                    field,
                    ConfigIssueKind::Malformed,
                    format!("{field}: duplicate field"),
                );
                None
            }
        }
    }

    /// 转换为部分快照。任何单元都可能为 `None`；`capabilities` 由同一份数据派生。
    pub fn into_motor_config(self) -> MotorConfig {
        let ConfigParser {
            state,
            fault,
            id,
            protection,
            electrical,
            flux_speed,
            current_pi,
            speed_pi,
            position_pid,
            speed_sweep_current,
            speed_filter,
            current_filter,
            speed_pll,
            encoder,
            hfi,
            observer_flux,
            transition,
            backup,
            issues,
            recognized_rows: _,
        } = self;

        let capability = |unit: &str, command: Option<MotorConfigCommand>| {
            capability(unit, command, &issues)
        };
        let capabilities = Capabilities {
            position_pid: capability(
                "position_pid",
                position_pid.as_ref().map(|v| MotorConfigCommand::ConfigPositionPid {
                    kp: v.kp,
                    ki: v.ki,
                    kd: v.kd,
                    output_max: v.output_max,
                }),
            ),
            speed_pi: capability(
                "speed_pi",
                speed_pi.as_ref().map(|v| MotorConfigCommand::ConfigSpeedPi {
                    kp: v.kp,
                    ki: v.ki,
                    output_max: v.output_max,
                }),
            ),
            current_pi: capability(
                "current_pi",
                current_pi.as_ref().map(|v| MotorConfigCommand::ConfigCurrentPi {
                    d_kp: v.d_kp,
                    d_ki: v.d_ki,
                    q_kp: v.q_kp,
                    q_ki: v.q_ki,
                }),
            ),
            speed_sweep_current: capability(
                "speed_sweep_current",
                speed_sweep_current.map(MotorConfigCommand::ConfigSpeedSweepCurrent),
            ),
            flux_speed: capability(
                "flux_speed",
                flux_speed.map(MotorConfigCommand::ConfigFluxSpeed),
            ),
            speed_filter: capability(
                "speed_filter",
                speed_filter.map(MotorConfigCommand::ConfigSpeedFilter),
            ),
            current_filter: capability(
                "current_filter",
                current_filter.map(MotorConfigCommand::ConfigCurrentFilter),
            ),
            speed_pll: capability(
                "speed_pll",
                speed_pll.map(MotorConfigCommand::ConfigSpeedPll),
            ),
            current_limit: capability(
                "current_limit",
                protection
                    .as_ref()
                    .map(|v| MotorConfigCommand::ConfigCurrentLimit(v.current_limit)),
            ),
            motor_id: capability("motor_id", id.map(MotorConfigCommand::ConfigId)),
            encoder_config: capability(
                "encoder_config",
                encoder.as_ref().map(|v| MotorConfigCommand::ConfigEncoder {
                    pole_pairs: v.pole_pairs,
                    encoder_direction: v.encoder_direction,
                    encoder_offset: v.encoder_offset,
                    encoder_type: v.encoder_type,
                }),
            ),
            hfi: capability(
                "hfi",
                hfi.as_ref().map(|v| MotorConfigCommand::ConfigHfi {
                    voltage: v.voltage,
                    current_filter: v.current_filter,
                    kp: v.kp,
                    ki: v.ki,
                    speed_filter: v.speed_filter,
                }),
            ),
            observer_flux: capability(
                "observer_flux",
                observer_flux.as_ref().map(|v| MotorConfigCommand::ConfigObserverFlux {
                    gamma: v.gamma,
                    kp: v.kp,
                    ki: v.ki,
                }),
            ),
            transition: capability(
                "transition",
                transition.as_ref().map(|v| MotorConfigCommand::ConfigObserverTransition {
                    low: v.low,
                    high: v.high,
                }),
            ),
            backup: capability(
                "backup",
                backup.as_ref().map(|v| MotorConfigCommand::ConfigBackup(v.enabled)),
            ),
        };

        MotorConfig {
            state,
            fault,
            id,
            protection,
            electrical,
            flux_speed,
            current_pi,
            speed_pi,
            position_pid,
            speed_sweep_current,
            speed_filter,
            current_filter,
            speed_pll,
            encoder_config: encoder,
            hfi,
            observer_flux,
            transition,
            backup,
            issues,
            capabilities,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KvError {
    Missing,
    Duplicate,
}

fn single_value(rest: &str) -> Result<&str, (ConfigIssueKind, String)> {
    let mut tokens = rest.split_whitespace();
    match (tokens.next(), tokens.next()) {
        (None, _) => Err((ConfigIssueKind::Missing, "missing value".to_string())),
        (Some(value), None) => Ok(value),
        (Some(_), Some(_)) => Err((
            ConfigIssueKind::Malformed,
            format!("expected exactly one value, got `{rest}`"),
        )),
    }
}

fn parse_float(value: &str, field: &str) -> Result<f32, String> {
    match value.parse::<f32>() {
        Ok(v) if v.is_finite() => Ok(v),
        Ok(_) => Err(format!("{field}: value must be finite, got `{value}`")),
        Err(_) => Err(format!("{field}: invalid float `{value}`")),
    }
}

fn parse_u32(value: &str, field: &str) -> Result<u32, String> {
    value
        .parse::<u32>()
        .map_err(|_| format!("{field}: invalid unsigned integer `{value}`"))
}

pub(crate) fn parse_fault(value: &str) -> Result<u8, String> {
    let fault = parse_u32(value, "fault")?;
    if fault & !3 != 0 {
        return Err(format!("fault: unknown fault bits `{value}`"));
    }
    Ok(fault as u8)
}

fn capability(unit: &str, command: Option<MotorConfigCommand>, issues: &[ConfigIssue]) -> Capability {
    match command {
        Some(command) => {
            if crate::motor::validate_config_command(&command).is_ok() {
                Capability {
                    available: true,
                    writable: true,
                    reason: None,
                }
            } else {
                Capability {
                    available: true,
                    writable: false,
                    reason: Some(format!("{unit}: 读回值不能直接回写，可编辑后保存新值")),
                }
            }
        }
        None => Capability {
            available: false,
            writable: false,
            reason: Some(
                issues
                    .iter()
                    .rev()
                    .find(|issue| issue.unit == unit)
                    .map(|issue| issue.message.clone())
                    .unwrap_or_else(|| format!("{unit}: 固件未上报该配置项")),
            ),
        },
    }
}

fn kv_pairs(rest: &str) -> Result<Vec<(&str, &str)>, String> {
    if rest.is_empty() {
        return Err("empty config row payload".to_string());
    }
    rest.split_whitespace()
        .map(|token| {
            token
                .split_once('=')
                .filter(|(key, _)| !key.is_empty())
                .ok_or_else(|| format!("malformed key=value token `{token}`"))
        })
        .collect()
}

fn kv<'a>(pairs: &[(&'a str, &'a str)], key: &str) -> Result<&'a str, KvError> {
    let mut found: Option<&str> = None;
    for (k, v) in pairs {
        if *k == key {
            if found.is_some() {
                return Err(KvError::Duplicate);
            }
            found = Some(*v);
        }
    }
    found.ok_or(KvError::Missing)
}

/// 每相电流绝对值的过流故障阈值（单位：A），不是电流指令限幅。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProtectionConfig {
    pub current_limit: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PositionPIDConfig {
    pub kp: f32,
    pub ki: f32,
    pub kd: f32,
    pub output_max: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpeedPIConfig {
    pub kp: f32,
    pub ki: f32,
    pub output_max: f32,
}

/// 电流环 d/q 轴独立增益（一个写入单元，4 个字段）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CurrentPiConfig {
    pub d_kp: f32,
    pub d_ki: f32,
    pub q_kp: f32,
    pub q_ki: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HfiConfig {
    pub voltage: f32,
    pub current_filter: f32,
    pub kp: f32,
    pub ki: f32,
    pub speed_filter: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ObserverFluxConfig {
    pub gamma: f32,
    pub kp: f32,
    pub ki: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransitionConfig {
    pub low: f32,
    pub high: f32,
}

/// 运行时备份开关；此命令不写 Flash。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackupConfig {
    pub enabled: bool,
}

/// 固件内部方向符号的正负映射；字符串与固件输出一致。
#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumString, Display, Serialize, Deserialize)]
pub enum EncoderDirection {
    CW,
    CCW,
    None,
}

impl EncoderDirection {
    /// `None` 仅用于读回未配置状态，不允许写入固件。
    pub fn is_writable(&self) -> bool {
        !matches!(self, EncoderDirection::None)
    }
}

/// 固件支持的编码器类型。
///
/// `EnumString`/`Display` 使用固件 CLI 字符串（`MT6701_IIC`/`MT6701_SPI`），
/// serde 序列化同样使用该字符串以匹配前端。
#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumString, Display, Serialize, Deserialize)]
pub enum EncoderType {
    AS5600,
    #[strum(serialize = "MT6701_IIC")]
    #[serde(rename = "MT6701_IIC")]
    MT6701IIC,
    #[strum(serialize = "MT6701_SPI")]
    #[serde(rename = "MT6701_SPI")]
    MT6701SPI,
    AS5047P,
    None,
    Unknown,
}

impl EncoderType {
    /// `None`/`Unknown` 仅用于读回，不允许写入固件。
    pub fn is_writable(&self) -> bool {
        !matches!(self, EncoderType::None | EncoderType::Unknown)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EncoderConfig {
    pub pole_pairs: u32,
    pub encoder_direction: EncoderDirection,
    pub encoder_offset: f32,
    pub encoder_type: EncoderType,
}

/// `get_config` 的部分快照。每个可写单元独立为 `Option`；缺失不等于默认值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MotorConfig {
    pub state: Option<MotorState>,
    pub fault: Option<u8>,
    pub id: Option<u32>,
    pub protection: Option<ProtectionConfig>,
    pub electrical: Option<MotorElectricalConfig>,
    pub flux_speed: Option<f32>,
    pub current_pi: Option<CurrentPiConfig>,
    pub speed_pi: Option<SpeedPIConfig>,
    pub position_pid: Option<PositionPIDConfig>,
    pub speed_sweep_current: Option<f32>,
    pub speed_filter: Option<f32>,
    pub current_filter: Option<f32>,
    pub speed_pll: Option<f32>,
    pub encoder_config: Option<EncoderConfig>,
    pub hfi: Option<HfiConfig>,
    pub observer_flux: Option<ObserverFluxConfig>,
    pub transition: Option<TransitionConfig>,
    pub backup: Option<BackupConfig>,
    pub issues: Vec<ConfigIssue>,
    pub capabilities: Capabilities,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 用户提供的固件 `get_config` 完整样本。
    const SAMPLE: &[&str] = &[
        "state Ready",
        "fault 0",
        "id 1",
        "protection current_limit=10",
        "motor rs=0.1867275 ld=0.0004650604 lq=0.0002910778 flux=0.003 flux_speed=1000",
        "current_pi d_kp=0.4650604 d_ki=186.7275 q_kp=0.2910778 q_ki=186.7275",
        "speed_pi kp=0.03703183 ki=0.8226405 outputmax=2",
        "speed_sweep iq_amplitude=0.5 speed_filter=100 current_filter=200 pll_frequency=50",
        "position_pid kp=3 ki=3 kd=0 outputmax=2000",
        "encoder pole_pairs=7 direction=CCW offset=1.6083 type=MT6701_SPI",
        "hfi voltage=0 current_filter=100 kp=1 ki=2 speed_filter=50",
        "observer_flux gamma=1000 kp=20 ki=30",
        "transition low=100 high=200",
        "backup enabled=0",
        "ok",
    ];

    fn parse_lines<S: AsRef<str>>(lines: &[S]) -> ConfigParser {
        let mut parser = ConfigParser::default();
        for line in lines {
            parser.parse_line(line.as_ref());
        }
        parser
    }

    fn parse_sample() -> ConfigParser {
        parse_lines(SAMPLE)
    }

    fn full_config() -> MotorConfig {
        parse_sample().into_motor_config()
    }

    #[test]
    fn parses_full_sample_exactly() {
        let config = full_config();

        assert!(config.issues.is_empty(), "{:?}", config.issues);
        assert_eq!(config.state, Some(MotorState::Ready));
        assert_eq!(config.fault, Some(0));
        let motor = config.electrical.expect("electrical");
        assert_eq!(motor.flux, 0.003);
        assert_eq!(config.flux_speed, Some(1000.0));
        assert_eq!(config.speed_filter, Some(100.0));
        assert_eq!(config.current_filter, Some(200.0));
        assert_eq!(config.speed_pll, Some(50.0));
        assert_eq!(config.speed_sweep_current, Some(0.5));
        assert_eq!(
            config.hfi,
            Some(HfiConfig { voltage: 0.0, current_filter: 100.0, kp: 1.0, ki: 2.0, speed_filter: 50.0 })
        );
        assert_eq!(
            config.observer_flux,
            Some(ObserverFluxConfig { gamma: 1000.0, kp: 20.0, ki: 30.0 })
        );
        assert_eq!(
            config.transition,
            Some(TransitionConfig { low: 100.0, high: 200.0 })
        );
        assert_eq!(config.backup, Some(BackupConfig { enabled: false }));
        assert_eq!(config.id, Some(1));
        assert_eq!(config.protection, Some(ProtectionConfig { current_limit: 10.0 }));
        assert!((motor.rs - 0.1867275).abs() < 1e-9);
        assert!((motor.ld - 0.0004650604).abs() < 1e-12);
        assert!((motor.lq - 0.0002910778).abs() < 1e-12);
        let current_pi = config.current_pi.expect("current pi");
        assert!((current_pi.d_kp - 0.4650604).abs() < 1e-9);
        assert!((current_pi.d_ki - 186.7275).abs() < 1e-4);
        assert!((current_pi.q_kp - 0.2910778).abs() < 1e-9);
        assert!((current_pi.q_ki - 186.7275).abs() < 1e-4);
        let speed_pi = config.speed_pi.expect("speed pi");
        assert!((speed_pi.kp - 0.03703183).abs() < 1e-10);
        assert!((speed_pi.ki - 0.8226405).abs() < 1e-9);
        assert!((speed_pi.output_max - 2.0).abs() < 1e-9);
        let position_pid = config.position_pid.expect("position pid");
        assert!((position_pid.kp - 3.0).abs() < 1e-9);
        assert!((position_pid.ki - 3.0).abs() < 1e-9);
        assert_eq!(position_pid.kd, 0.0);
        assert!((position_pid.output_max - 2000.0).abs() < 1e-9);
        let encoder = config.encoder_config.expect("encoder");
        assert_eq!(encoder.pole_pairs, 7);
        assert_eq!(encoder.encoder_direction, EncoderDirection::CCW);
        assert!((encoder.encoder_offset - 1.6083).abs() < 1e-9);
        assert_eq!(encoder.encoder_type, EncoderType::MT6701SPI);
    }

    /// 前端契约：缺失单元必须序列化为 `null`，能力表与 issue 的键名固定。
    #[test]
    fn serialized_partial_snapshot_matches_frontend_contract() {
        let mut parser = ConfigParser::default();
        parser.parse_line("state Ready");
        parser.parse_line("hfi voltage=1 current_filter=100 kp=1 ki=2 speed_filter=50");
        parser.parse_line("backup enabled=true");
        let value = serde_json::to_value(parser.into_motor_config()).unwrap();

        assert!(value["position_pid"].is_null());
        assert!(value["speed_filter"].is_null());
        assert!(value["electrical"].is_null());
        assert_eq!(value["state"], "Ready");
        assert!(value["fault"].is_null());
        assert_eq!(value["capabilities"]["hfi"]["available"], true);
        assert_eq!(value["capabilities"]["hfi"]["writable"], true);
        assert_eq!(value["capabilities"]["hfi"]["reason"], serde_json::Value::Null);
        assert_eq!(value["capabilities"]["speed_pi"]["available"], false);
        assert!(value["capabilities"]["speed_pi"]["reason"].is_string());
        assert_eq!(value["capabilities"]["backup"]["available"], false);
        assert!(value["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|issue| issue["unit"] == "backup" && issue["kind"] == "Malformed"));
    }

    #[test]
    fn full_sample_is_fully_available_and_writable() {
        let config = full_config();
        let capabilities = &config.capabilities;
        for (unit, capability) in [
            ("position_pid", &capabilities.position_pid),
            ("speed_pi", &capabilities.speed_pi),
            ("current_pi", &capabilities.current_pi),
            ("speed_sweep_current", &capabilities.speed_sweep_current),
            ("flux_speed", &capabilities.flux_speed),
            ("speed_filter", &capabilities.speed_filter),
            ("current_filter", &capabilities.current_filter),
            ("speed_pll", &capabilities.speed_pll),
            ("current_limit", &capabilities.current_limit),
            ("motor_id", &capabilities.motor_id),
            ("encoder_config", &capabilities.encoder_config),
            ("hfi", &capabilities.hfi),
            ("observer_flux", &capabilities.observer_flux),
            ("transition", &capabilities.transition),
            ("backup", &capabilities.backup),
        ] {
            assert!(capability.available, "{unit}");
            assert!(capability.writable, "{unit}");
            assert_eq!(capability.reason, None, "{unit}");
        }
    }

    #[test]
    fn accepts_full_width_uint32_id_and_scientific_floats() {
        let mut lines = SAMPLE.to_vec();
        lines[2] = "id 4294967295";
        lines[4] = "motor rs=1.867275e-1 ld=4.650604e-4 lq=2.910778e-4 flux=3e-3 flux_speed=1e3";
        let config = parse_lines(&lines).into_motor_config();
        assert_eq!(config.id, Some(u32::MAX));
        assert!(config.issues.is_empty());
        let motor = config.electrical.expect("electrical");
        assert!((motor.rs - 0.1867275).abs() < 1e-9);
        assert!((motor.ld - 0.0004650604).abs() < 1e-12);
        // 读回 ID 超过固件可写范围：保留值，只禁止写入。
        assert!(!config.capabilities.motor_id.writable);
    }

    #[test]
    fn readback_allows_zero_pole_pairs_and_placeholder_encoder() {
        let mut lines = SAMPLE.to_vec();
        lines[9] = "encoder pole_pairs=0 direction=None offset=0 type=None";
        let config = parse_lines(&lines).into_motor_config();
        let encoder = config.encoder_config.expect("encoder");
        assert_eq!(encoder.pole_pairs, 0);
        assert_eq!(encoder.encoder_direction, EncoderDirection::None);
        assert_eq!(encoder.encoder_type, EncoderType::None);
        assert!(config.capabilities.encoder_config.available);
        assert!(!config.capabilities.encoder_config.writable);
    }

    #[test]
    fn each_omitted_row_leaves_other_units_intact() {
        let full = full_config();
        for omitted in SAMPLE.iter().filter(|line| **line != "ok") {
            let lines: Vec<String> = SAMPLE
                .iter()
                .filter(|line| *line != omitted)
                .map(|line| line.to_string())
                .collect();
            let config = parse_lines(&lines).into_motor_config();
            let units = omitted.split_whitespace().next().unwrap();
            match units {
                "state" => assert_eq!(config.state, None),
                "fault" => assert_eq!(config.fault, None),
                "id" => {
                    assert_eq!(config.id, None);
                    assert!(!config.capabilities.motor_id.available);
                }
                "protection" => {
                    assert_eq!(config.protection, None);
                    assert!(!config.capabilities.current_limit.available);
                }
                "motor" => {
                    assert_eq!(config.electrical, None);
                    assert_eq!(config.flux_speed, None);
                    assert!(!config.capabilities.flux_speed.available);
                }
                "current_pi" => {
                    assert_eq!(config.current_pi, None);
                    assert!(!config.capabilities.current_pi.available);
                }
                "speed_pi" => {
                    assert_eq!(config.speed_pi, None);
                    assert!(!config.capabilities.speed_pi.available);
                }
                "speed_sweep" => {
                    assert_eq!(config.speed_sweep_current, None);
                    assert_eq!(config.speed_filter, None);
                    assert_eq!(config.current_filter, None);
                    assert_eq!(config.speed_pll, None);
                }
                "position_pid" => {
                    assert_eq!(config.position_pid, None);
                    assert!(!config.capabilities.position_pid.available);
                }
                "encoder" => {
                    assert_eq!(config.encoder_config, None);
                    assert!(!config.capabilities.encoder_config.available);
                }
                "hfi" => {
                    assert_eq!(config.hfi, None);
                    assert!(!config.capabilities.hfi.available);
                }
                "observer_flux" => {
                    assert_eq!(config.observer_flux, None);
                    assert!(!config.capabilities.observer_flux.available);
                }
                "transition" => {
                    assert_eq!(config.transition, None);
                    assert!(!config.capabilities.transition.available);
                }
                "backup" => {
                    assert_eq!(config.backup, None);
                    assert!(!config.capabilities.backup.available);
                }
                other => panic!("unexpected row {other}"),
            }
            // 未涉及的行仍然有效：以 speed_pi 作为代表。
            if units != "speed_pi" {
                assert_eq!(config.speed_pi, full.speed_pi);
            }
            if units != "state" {
                assert_eq!(config.state, full.state);
            }
        }
    }

    #[test]
    fn missing_fields_inside_a_row_only_disable_their_unit() {
        // 去掉 flux_speed：电气参数仍可显示，只有辨识速度不可用。
        let mut lines = SAMPLE.to_vec();
        lines[4] = "motor rs=0.1867275 ld=0.0004650604 lq=0.0002910778 flux=0.003";
        let config = parse_lines(&lines).into_motor_config();
        assert!(config.electrical.is_some());
        assert_eq!(config.flux_speed, None);
        assert!(!config.capabilities.flux_speed.available);
        assert!(config.capabilities.speed_filter.available);

        // 去掉任一 HFI 字段：整个 HFI 写入单元不可用（setter 需要全部字段）。
        for omitted in ["voltage", "current_filter", "kp", "ki", "speed_filter"] {
            let mut lines: Vec<String> =
                SAMPLE.iter().map(|line| line.to_string()).collect();
            let tokens: Vec<&str> = lines[10]
                .split_whitespace()
                .filter(|token| !token.starts_with(&format!("{omitted}=")))
                .collect();
            lines[10] = tokens.join(" ");
            let config = parse_lines(&lines).into_motor_config();
            assert_eq!(config.hfi, None, "{omitted}");
            assert!(!config.capabilities.hfi.available, "{omitted}");
        }
    }

    #[test]
    fn malformed_rows_are_isolated_and_recorded() {
        let mut parser = ConfigParser::default();
        for line in SAMPLE {
            parser.parse_line(line);
        }
        // 缺少 lq 字段：只废 electrical，其它配置不受影响。
        parser.parse_line("motor rs=1 ld=2");
        let config = parser.into_motor_config();
        assert_eq!(config.electrical, None);
        assert!(config.issues.iter().any(|issue| issue.unit == "electrical"));
        assert!(config.speed_pi.is_some());
        assert!(config.capabilities.speed_pi.available);

        // 非有限浮点。
        let mut parser = ConfigParser::default();
        parser.parse_line("encoder pole_pairs=7 direction=CCW offset=inf type=MT6701_SPI");
        let config = parser.into_motor_config();
        assert_eq!(config.encoder_config, None);
        assert_eq!(config.issues[0].kind, ConfigIssueKind::Malformed);

        // 未识别的编码器型号：只废编码器单元，不让整次读取失败。
        let mut parser = ConfigParser::default();
        parser.parse_line("encoder pole_pairs=7 direction=CW offset=0 type=MT6702");
        let config = parser.into_motor_config();
        assert_eq!(config.encoder_config, None);
        assert!(config.issues.iter().any(|issue| issue.unit == "encoder_config"));

        // 非法 token 只影响该行。
        let mut parser = ConfigParser::default();
        parser.parse_line("speed_pi kp=1 ki=2 outputmax=NaN");
        parser.parse_line("transition low=1");
        let config = parser.into_motor_config();
        assert_eq!(config.speed_pi, None);
        assert_eq!(config.transition, None);
        assert_eq!(config.issues.len(), 2);
        assert!(config
            .issues
            .iter()
            .any(|issue| issue.kind == ConfigIssueKind::Malformed));
    }

    #[test]
    fn unknown_values_do_not_poison_the_snapshot() {
        let mut lines = SAMPLE.to_vec();
        lines[0] = "state Running";
        lines[1] = "fault 8";
        let config = parse_lines(&lines).into_motor_config();
        assert_eq!(config.state, None);
        assert_eq!(config.fault, None);
        assert!(config.issues.iter().any(|issue| issue.unit == "state"));
        assert!(config.issues.iter().any(|issue| issue.unit == "fault"));
        // 其它单元照常可用。
        assert!(config.capabilities.position_pid.writable);
        assert!(config.capabilities.hfi.writable);
    }

    #[test]
    fn out_of_range_readback_keeps_the_value_but_disables_writing() {
        let mut lines = SAMPLE.to_vec();
        lines[4] = "motor rs=0.1 ld=0.1 lq=0.1 flux=0.003 flux_speed=5000";
        lines[10] = "hfi voltage=-1 current_filter=100 kp=1 ki=2 speed_filter=50";
        lines[12] = "transition low=200 high=100";
        let config = parse_lines(&lines).into_motor_config();
        assert_eq!(config.flux_speed, Some(5000.0));
        assert!(config.capabilities.flux_speed.available);
        assert!(!config.capabilities.flux_speed.writable);
        assert!(config.hfi.is_some());
        assert!(!config.capabilities.hfi.writable);
        assert!(config.transition.is_some());
        assert!(!config.capabilities.transition.writable);
        assert!(config.issues.is_empty());
    }

    #[test]
    fn unrelated_lines_are_ignored_and_device_identity_requires_one_known_row() {
        let mut parser = ConfigParser::default();
        parser.parse_line("ok");
        parser.parse_line("error state");
        parser.parse_line("result alignment=ok");
        parser.parse_line("");
        assert!(!parser.has_known_rows());
        assert!(parser.into_motor_config().issues.is_empty());

        let mut parser = ConfigParser::default();
        parser.parse_line("state Ready");
        assert!(parser.has_known_rows());
    }

    #[test]
    fn fault_masks_and_backup_boolean_are_strict_but_isolated() {
        for value in ["0", "1", "2", "3"] {
            let mut parser = parse_sample();
            parser.parse_line(&format!("fault {value}"));
            assert_eq!(
                parser.into_motor_config().fault,
                Some(value.parse::<u8>().unwrap())
            );
        }
        for row in [
            "fault 4",
            "fault 255",
            "fault -1",
            "fault 1 2",
            "backup enabled=true",
            "backup enabled=2",
            "backup enabled=1 enabled=0",
        ] {
            let mut parser = parse_sample();
            parser.parse_line(row);
            let config = parser.into_motor_config();
            assert!(!config.issues.is_empty(), "{row}");
        }
        let mut parser = parse_sample();
        parser.parse_line("backup enabled=1");
        assert_eq!(
            parser.into_motor_config().backup,
            Some(BackupConfig { enabled: true })
        );
    }

}
