use crate::command::{MotorConfigCommand, MotorState};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use strum_macros::{Display, EnumString};

/// 固件电机电气参数（Ohm / H / Wb）及磁链辨识机械速度（rpm）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MotorElectricalConfig {
    pub rs: f32,
    pub ld: f32,
    pub lq: f32,
    pub flux: f32,
    pub flux_speed: f32,
}

/// 解析固件 `get_config` 的 14 个必需数据 tag；最后的 `ok` 由事务层处理。
/// `ok` / `error ...` 等应答由后端处理；本解析器忽略无关行，
/// 但对可识别的配置行若字段缺失或无法解析会返回错误。
#[derive(Debug, Default)]
pub struct ConfigParser {
    state: Option<MotorState>,
    fault: Option<u8>,
    id: Option<u32>,
    protection: Option<ProtectionConfig>,
    motor: Option<MotorElectricalConfig>,
    /// d_kp, d_ki, q_kp, q_ki
    current_pi: Option<[f32; 4]>,
    speed_pi: Option<SpeedPIConfig>,
    speed_sweep: Option<SpeedSweepConfig>,
    position_pid: Option<PositionPIDConfig>,
    encoder: Option<EncoderConfig>,
    hfi: Option<HfiConfig>,
    observer_flux: Option<ObserverFluxConfig>,
    transition: Option<TransitionConfig>,
    backup: Option<BackupConfig>,
}

impl ConfigParser {
    /// 解析一行并更新自身。无法识别的行被忽略；可识别但格式非法的行返回错误。
    pub fn parse_line(&mut self, line: &str) -> Result<(), String> {
        let line = line.trim();
        if line.is_empty() {
            return Ok(());
        }
        let (tag, rest) = match line.split_once(char::is_whitespace) {
            Some((tag, rest)) => (tag, rest.trim()),
            None => (line, ""),
        };
        match tag {
            "state" => {
                let name = single_token(rest, "state")?;
                let state = MotorState::from_str(name)
                    .map_err(|_| format!("state: unknown motor state `{name}`"))?;
                self.state = Some(state);
            }
            "fault" => {
                self.fault = Some(parse_fault(single_token(rest, "fault")?)?);
            }
            "id" => {
                let value = single_token(rest, "id")?;
                self.id = Some(parse_u32(value, "id")?);
            }
            "protection" => {
                let pairs = kv_pairs(rest)?;
                let current_limit = parse_float(
                    kv(&pairs, "current_limit", "protection")?,
                    "protection.current_limit",
                )?;
                if current_limit <= 0.0 {
                    return Err("protection.current_limit: value must be greater than zero".to_string());
                }
                self.protection = Some(ProtectionConfig { current_limit });
            }
            "motor" => {
                let pairs = kv_pairs(rest)?;
                self.motor = Some(MotorElectricalConfig {
                    rs: parse_float(kv(&pairs, "rs", "motor")?, "motor.rs")?,
                    ld: parse_float(kv(&pairs, "ld", "motor")?, "motor.ld")?,
                    lq: parse_float(kv(&pairs, "lq", "motor")?, "motor.lq")?,
                    flux: parse_float(kv(&pairs, "flux", "motor")?, "motor.flux")?,
                    flux_speed: parse_float(kv(&pairs, "flux_speed", "motor")?, "motor.flux_speed")?,
                });
                let motor = self.motor.as_ref().expect("just parsed");
                if motor.flux < 0.0 {
                    return Err("motor.flux: value must not be negative".to_string());
                }
                validate_readback(&MotorConfigCommand::ConfigFluxSpeed(motor.flux_speed), "motor.flux_speed")?;
            }
            "current_pi" => {
                let pairs = kv_pairs(rest)?;
                self.current_pi = Some([
                    parse_float(kv(&pairs, "d_kp", "current_pi")?, "current_pi.d_kp")?,
                    parse_float(kv(&pairs, "d_ki", "current_pi")?, "current_pi.d_ki")?,
                    parse_float(kv(&pairs, "q_kp", "current_pi")?, "current_pi.q_kp")?,
                    parse_float(kv(&pairs, "q_ki", "current_pi")?, "current_pi.q_ki")?,
                ]);
            }
            "speed_pi" => {
                let pairs = kv_pairs(rest)?;
                self.speed_pi = Some(SpeedPIConfig {
                    kp: parse_float(kv(&pairs, "kp", "speed_pi")?, "speed_pi.kp")?,
                    ki: parse_float(kv(&pairs, "ki", "speed_pi")?, "speed_pi.ki")?,
                    output_max: parse_float(
                        kv(&pairs, "outputmax", "speed_pi")?,
                        "speed_pi.outputmax",
                    )?,
                });
            }
            "speed_sweep" => {
                let pairs = kv_pairs(rest)?;
                self.speed_sweep = Some(SpeedSweepConfig {
                    iq_amplitude: parse_float(
                        kv(&pairs, "iq_amplitude", "speed_sweep")?,
                        "speed_sweep.iq_amplitude",
                    )?,
                    speed_filter: parse_float(kv(&pairs, "speed_filter", "speed_sweep")?, "speed_sweep.speed_filter")?,
                    current_filter: parse_float(kv(&pairs, "current_filter", "speed_sweep")?, "speed_sweep.current_filter")?,
                    pll_frequency: parse_float(kv(&pairs, "pll_frequency", "speed_sweep")?, "speed_sweep.pll_frequency")?,
                });
                let sweep = self.speed_sweep.as_ref().expect("just parsed");
                validate_readback(&MotorConfigCommand::ConfigSpeedFilter(sweep.speed_filter), "speed_sweep.speed_filter")?;
                validate_readback(&MotorConfigCommand::ConfigCurrentFilter(sweep.current_filter), "speed_sweep.current_filter")?;
                validate_readback(&MotorConfigCommand::ConfigSpeedPll(sweep.pll_frequency), "speed_sweep.pll_frequency")?;
            }
            "position_pid" => {
                let pairs = kv_pairs(rest)?;
                self.position_pid = Some(PositionPIDConfig {
                    kp: parse_float(kv(&pairs, "kp", "position_pid")?, "position_pid.kp")?,
                    ki: parse_float(kv(&pairs, "ki", "position_pid")?, "position_pid.ki")?,
                    kd: parse_float(kv(&pairs, "kd", "position_pid")?, "position_pid.kd")?,
                    output_max: parse_float(
                        kv(&pairs, "outputmax", "position_pid")?,
                        "position_pid.outputmax",
                    )?,
                });
            }
            "encoder" => {
                let pairs = kv_pairs(rest)?;
                let pole_pairs =
                    parse_u32(kv(&pairs, "pole_pairs", "encoder")?, "encoder.pole_pairs")?;
                let direction_text = kv(&pairs, "direction", "encoder")?;
                let encoder_direction =
                    EncoderDirection::from_str(direction_text).map_err(|_| {
                        format!("encoder.direction: invalid direction `{direction_text}`")
                    })?;
                let encoder_offset =
                    parse_float(kv(&pairs, "offset", "encoder")?, "encoder.offset")?;
                let type_text = kv(&pairs, "type", "encoder")?;
                let encoder_type = EncoderType::from_str(type_text)
                    .map_err(|_| format!("encoder.type: invalid encoder type `{type_text}`"))?;
                self.encoder = Some(EncoderConfig {
                    pole_pairs,
                    encoder_direction,
                    encoder_offset,
                    encoder_type,
                });
            }
            "hfi" => {
                let pairs = kv_pairs(rest)?;
                self.hfi = Some(HfiConfig {
                    voltage: parse_float(kv(&pairs, "voltage", "hfi")?, "hfi.voltage")?,
                    current_filter: parse_float(kv(&pairs, "current_filter", "hfi")?, "hfi.current_filter")?,
                    kp: parse_float(kv(&pairs, "kp", "hfi")?, "hfi.kp")?,
                    ki: parse_float(kv(&pairs, "ki", "hfi")?, "hfi.ki")?,
                    speed_filter: parse_float(kv(&pairs, "speed_filter", "hfi")?, "hfi.speed_filter")?,
                });
                let hfi = self.hfi.as_ref().expect("just parsed");
                validate_readback(&MotorConfigCommand::ConfigHfi {
                    voltage: hfi.voltage, current_filter: hfi.current_filter,
                    kp: hfi.kp, ki: hfi.ki, speed_filter: hfi.speed_filter,
                }, "hfi")?;
            }
            "observer_flux" => {
                let pairs = kv_pairs(rest)?;
                self.observer_flux = Some(ObserverFluxConfig {
                    gamma: parse_float(kv(&pairs, "gamma", "observer_flux")?, "observer_flux.gamma")?,
                    kp: parse_float(kv(&pairs, "kp", "observer_flux")?, "observer_flux.kp")?,
                    ki: parse_float(kv(&pairs, "ki", "observer_flux")?, "observer_flux.ki")?,
                });
                let flux = self.observer_flux.as_ref().expect("just parsed");
                validate_readback(&MotorConfigCommand::ConfigObserverFlux {
                    gamma: flux.gamma, kp: flux.kp, ki: flux.ki,
                }, "observer_flux")?;
            }
            "transition" => {
                let pairs = kv_pairs(rest)?;
                self.transition = Some(TransitionConfig {
                    low: parse_float(kv(&pairs, "low", "transition")?, "transition.low")?,
                    high: parse_float(kv(&pairs, "high", "transition")?, "transition.high")?,
                });
                let transition = self.transition.as_ref().expect("just parsed");
                validate_readback(&MotorConfigCommand::ConfigObserverTransition {
                    low: transition.low, high: transition.high,
                }, "transition")?;
            }
            "backup" => {
                let pairs = kv_pairs(rest)?;
                let enabled = match kv(&pairs, "enabled", "backup")? {
                    "0" => false,
                    "1" => true,
                    value => return Err(format!("backup.enabled: expected 0 or 1, got `{value}`")),
                };
                self.backup = Some(BackupConfig { enabled });
            }
            // `ok`、`error ...`、校准行等与配置读取无关的行一律忽略。
            _ => {}
        }
        Ok(())
    }

    /// 将全部 14 个必需 tag 转换为 `MotorConfig`；不接受旧版缺字段快照。
    pub fn try_into_motor_config(&self) -> Result<MotorConfig, String> {
        let mut missing: Vec<&str> = Vec::new();
        if self.state.is_none() {
            missing.push("state");
        }
        if self.fault.is_none() { missing.push("fault"); }
        if self.hfi.is_none() { missing.push("hfi"); }
        if self.observer_flux.is_none() { missing.push("observer_flux"); }
        if self.transition.is_none() { missing.push("transition"); }
        if self.backup.is_none() { missing.push("backup"); }
        if self.id.is_none() {
            missing.push("id");
        }
        if self.protection.is_none() {
            missing.push("protection");
        }
        if self.motor.is_none() {
            missing.push("motor");
        }
        if self.current_pi.is_none() {
            missing.push("current_pi");
        }
        if self.speed_pi.is_none() {
            missing.push("speed_pi");
        }
        if self.speed_sweep.is_none() {
            missing.push("speed_sweep");
        }
        if self.position_pid.is_none() {
            missing.push("position_pid");
        }
        if self.encoder.is_none() {
            missing.push("encoder");
        }
        if !missing.is_empty() {
            return Err(format!(
                "incomplete motor config, missing: {}",
                missing.join(", ")
            ));
        }

        let current_pi = self.current_pi.expect("checked above");
        Ok(MotorConfig {
            state: self.state.expect("checked above"),
            fault: self.fault.expect("checked above"),
            hfi: self.hfi.clone().expect("checked above"),
            observer_flux: self.observer_flux.clone().expect("checked above"),
            transition: self.transition.clone().expect("checked above"),
            backup: self.backup.clone().expect("checked above"),
            id: self.id.expect("checked above"),
            protection: self.protection.clone().expect("checked above"),
            motor: self.motor.clone().expect("checked above"),
            position_pid: self.position_pid.clone().expect("checked above"),
            speed_pi: self.speed_pi.clone().expect("checked above"),
            speed_sweep: self.speed_sweep.clone().expect("checked above"),
            current_id_pi: CurrentPIConfig {
                kp: current_pi[0],
                ki: current_pi[1],
            },
            current_iq_pi: CurrentPIConfig {
                kp: current_pi[2],
                ki: current_pi[3],
            },
            encoder_config: self.encoder.clone().expect("checked above"),
        })
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

fn validate_readback(command: &MotorConfigCommand, field: &str) -> Result<(), String> {
    if command.to_string(&MotorState::Ready).is_some() {
        Ok(())
    } else {
        Err(format!("{field}: values outside firmware range"))
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

fn kv<'a>(pairs: &[(&'a str, &'a str)], key: &str, row: &str) -> Result<&'a str, String> {
    let mut found: Option<&str> = None;
    for (k, v) in pairs {
        if *k == key {
            if found.is_some() {
                return Err(format!("{row}: duplicate field `{key}`"));
            }
            found = Some(*v);
        }
    }
    found.ok_or_else(|| format!("{row}: missing field `{key}`"))
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

/// 速度环参数辨识使用的正弦 q 轴电流幅值（单位：A）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpeedSweepConfig {
    pub iq_amplitude: f32,
    pub speed_filter: f32,
    pub current_filter: f32,
    pub pll_frequency: f32,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CurrentPIConfig {
    pub kp: f32,
    pub ki: f32,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MotorConfig {
    pub state: MotorState,
    pub fault: u8,
    pub hfi: HfiConfig,
    pub observer_flux: ObserverFluxConfig,
    pub transition: TransitionConfig,
    pub backup: BackupConfig,
    pub id: u32,
    pub protection: ProtectionConfig,
    pub motor: MotorElectricalConfig,
    pub position_pid: PositionPIDConfig,
    pub speed_pi: SpeedPIConfig,
    pub speed_sweep: SpeedSweepConfig,
    pub current_id_pi: CurrentPIConfig,
    pub current_iq_pi: CurrentPIConfig,
    pub encoder_config: EncoderConfig,
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

    fn parse_sample() -> ConfigParser {
        let mut parser = ConfigParser::default();
        for line in SAMPLE {
            parser.parse_line(line).expect("sample line must parse");
        }
        parser
    }

    #[test]
    fn parses_full_sample_exactly() {
        let config = parse_sample()
            .try_into_motor_config()
            .expect("complete sample");

        assert_eq!(config.state, MotorState::Ready);
        assert_eq!(config.fault, 0);
        assert_eq!(config.motor.flux, 0.003);
        assert_eq!(config.motor.flux_speed, 1000.0);
        assert_eq!(config.speed_sweep.speed_filter, 100.0);
        assert_eq!(config.speed_sweep.current_filter, 200.0);
        assert_eq!(config.speed_sweep.pll_frequency, 50.0);
        assert_eq!(config.hfi, HfiConfig { voltage: 0.0, current_filter: 100.0, kp: 1.0, ki: 2.0, speed_filter: 50.0 });
        assert_eq!(config.observer_flux, ObserverFluxConfig { gamma: 1000.0, kp: 20.0, ki: 30.0 });
        assert_eq!(config.transition, TransitionConfig { low: 100.0, high: 200.0 });
        assert!(!config.backup.enabled);
        assert_eq!(config.id, 1);
        assert_eq!(config.protection.current_limit, 10.0);
        assert!((config.motor.rs - 0.1867275).abs() < 1e-9);
        assert!((config.motor.ld - 0.0004650604).abs() < 1e-12);
        assert!((config.motor.lq - 0.0002910778).abs() < 1e-12);
        assert!((config.current_id_pi.kp - 0.4650604).abs() < 1e-9);
        assert!((config.current_id_pi.ki - 186.7275).abs() < 1e-4);
        assert!((config.current_iq_pi.kp - 0.2910778).abs() < 1e-9);
        assert!((config.current_iq_pi.ki - 186.7275).abs() < 1e-4);
        assert!((config.speed_pi.kp - 0.03703183).abs() < 1e-10);
        assert!((config.speed_pi.ki - 0.8226405).abs() < 1e-9);
        assert!((config.speed_pi.output_max - 2.0).abs() < 1e-9);
        assert!((config.speed_sweep.iq_amplitude - 0.5).abs() < 1e-9);
        assert!((config.position_pid.kp - 3.0).abs() < 1e-9);
        assert!((config.position_pid.ki - 3.0).abs() < 1e-9);
        assert_eq!(config.position_pid.kd, 0.0);
        assert!((config.position_pid.output_max - 2000.0).abs() < 1e-9);
        assert_eq!(config.encoder_config.pole_pairs, 7);
        assert_eq!(
            config.encoder_config.encoder_direction,
            EncoderDirection::CCW
        );
        assert!((config.encoder_config.encoder_offset - 1.6083).abs() < 1e-9);
        assert_eq!(config.encoder_config.encoder_type, EncoderType::MT6701SPI);
    }

    #[test]
    fn accepts_full_width_uint32_id_and_scientific_floats() {
        let mut parser = ConfigParser::default();
        for line in SAMPLE {
            let substituted = match *line {
                "id 1" => "id 4294967295",
                "motor rs=0.1867275 ld=0.0004650604 lq=0.0002910778 flux=0.003 flux_speed=1000" => {
                    "motor rs=1.867275e-1 ld=4.650604e-4 lq=2.910778e-4 flux=3e-3 flux_speed=1e3"
                }
                other => other,
            };
            parser.parse_line(substituted).unwrap();
        }
        let config = parser.try_into_motor_config().unwrap();
        assert_eq!(config.id, u32::MAX);
        assert!((config.motor.rs - 0.1867275).abs() < 1e-9);
        assert!((config.motor.ld - 0.0004650604).abs() < 1e-12);
    }

    #[test]
    fn readback_allows_zero_pole_pairs_and_placeholder_encoder() {
        let mut parser = ConfigParser::default();
        for line in SAMPLE {
            let substituted = match *line {
                "encoder pole_pairs=7 direction=CCW offset=1.6083 type=MT6701_SPI" => {
                    "encoder pole_pairs=0 direction=None offset=0 type=None"
                }
                other => other,
            };
            parser.parse_line(substituted).unwrap();
        }
        let config = parser.try_into_motor_config().unwrap();
        assert_eq!(config.encoder_config.pole_pairs, 0);
        assert_eq!(
            config.encoder_config.encoder_direction,
            EncoderDirection::None
        );
        assert_eq!(config.encoder_config.encoder_type, EncoderType::None);
    }

    #[test]
    fn malformed_recognized_rows_are_rejected() {
        let mut parser = ConfigParser::default();
        // 缺少 lq 字段。
        assert!(parser.parse_line("motor rs=1 ld=2").is_err());
        // 非有限浮点。
        assert!(parser
            .parse_line("encoder pole_pairs=7 direction=CCW offset=inf type=MT6701_SPI")
            .is_err());
        assert!(parser
            .parse_line("speed_pi kp=1 ki=2 outputmax=NaN")
            .is_err());
        // 缺少/非有限扫频电流幅值。
        assert!(parser.parse_line("speed_sweep").is_err());
        assert!(parser.parse_line("speed_sweep iq_amplitude=NaN").is_err());
        // 非法方向/类型。
        assert!(parser
            .parse_line("encoder pole_pairs=7 direction=sideways offset=0 type=MT6701_SPI")
            .is_err());
        assert!(parser
            .parse_line("encoder pole_pairs=7 direction=CW offset=0 type=MT6702")
            .is_err());
        // 非法 uint32 / 状态。
        assert!(parser.parse_line("id 4294967296").is_err());
        assert!(parser.parse_line("id -1").is_err());
        assert!(parser.parse_line("state Running").is_err());
        // 缺少值的可识别行。
        assert!(parser.parse_line("state").is_err());
        assert!(parser.parse_line("current_pi d_kp=1").is_err());
    }

    #[test]
    fn protection_is_required_and_rejects_invalid_thresholds() {
        let mut parser = ConfigParser::default();
        for line in SAMPLE.iter().filter(|line| !line.starts_with("protection ")) {
            parser.parse_line(line).unwrap();
        }
        assert!(parser.try_into_motor_config().is_err());
        for value in ["0", "-1", "NaN", "inf", "-inf", "invalid"] {
            assert!(parser
                .parse_line(&format!("protection current_limit={value}"))
                .is_err());
            assert!(parser.try_into_motor_config().is_err());
        }
        assert!(parser.parse_line("protection").is_err());
        assert!(parser.parse_line("protection current_limit=1 current_limit=2").is_err());
        parser.parse_line("protection current_limit=0.01").unwrap();
        assert_eq!(parser.try_into_motor_config().unwrap().protection.current_limit, 0.01);
    }

    #[test]
    fn unrelated_lines_are_ignored() {
        let mut parser = ConfigParser::default();
        assert!(parser.parse_line("ok").is_ok());
        assert!(parser.parse_line("error state").is_ok());
        assert!(parser.parse_line("result alignment=ok").is_ok());
        assert!(parser.parse_line("").is_ok());
        assert!(parser.try_into_motor_config().is_err());
    }

    #[test]
    fn every_configuration_row_is_required() {
        for omitted in SAMPLE.iter().filter(|line| **line != "ok") {
            let mut parser = ConfigParser::default();
            for line in SAMPLE.iter().filter(|line| *line != omitted) {
                parser.parse_line(line).unwrap();
            }
            assert!(parser.try_into_motor_config().is_err());
        }
    }

    #[test]
    fn expanded_fields_are_required_and_reject_nonfinite_values() {
        for row in SAMPLE.iter().filter(|line| matches!(line.split_whitespace().next(),
            Some("motor" | "speed_sweep" | "hfi" | "observer_flux" | "transition"))) {
            let tokens: Vec<_> = row.split_whitespace().collect();
            for index in 1..tokens.len() {
                let omitted = tokens.iter().enumerate().filter_map(|(i, token)| (i != index).then_some(*token)).collect::<Vec<_>>().join(" ");
                assert!(ConfigParser::default().parse_line(&omitted).is_err(), "{omitted}");
                let key = tokens[index].split_once('=').unwrap().0;
                for invalid in ["NaN", "inf", "-inf"] {
                    let mut malformed = tokens.iter().map(|token| token.to_string()).collect::<Vec<_>>();
                    malformed[index] = format!("{key}={invalid}");
                    let malformed = malformed.join(" ");
                    assert!(ConfigParser::default().parse_line(&malformed).is_err(), "{malformed}");
                }
            }
        }
    }

    #[test]
    fn fault_masks_and_backup_boolean_are_strict() {
        for value in ["0", "1", "2", "3"] {
            let mut parser = parse_sample();
            parser.parse_line(&format!("fault {value}")).unwrap();
            assert_eq!(parser.try_into_motor_config().unwrap().fault, value.parse::<u8>().unwrap());
        }
        for row in ["fault 4", "fault 255", "fault -1", "fault 1 2", "backup enabled=true", "backup enabled=2", "backup enabled=1 enabled=0"] {
            assert!(ConfigParser::default().parse_line(row).is_err(), "{row}");
        }
        let mut parser = parse_sample();
        parser.parse_line("backup enabled=1").unwrap();
        assert!(parser.try_into_motor_config().unwrap().backup.enabled);
    }
}
