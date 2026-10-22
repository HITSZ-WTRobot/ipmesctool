use crate::command::MotorState;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use strum_macros::{Display, EnumString};

/// 固件 `get_config` 输出的三行电机电气参数（单位：Ohm / H）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MotorElectricalConfig {
    pub rs: f32,
    pub ld: f32,
    pub lq: f32,
}

/// 解析固件 `get_config` 的 8 行数据输出。
///
/// 固件格式（每行 CRLF，浮点为 `%.7g` 可变位数）：
/// ```text
/// state Ready
/// id 1
/// motor rs=0.1867275 ld=0.0004650604 lq=0.0002910778
/// current_pi d_kp=0.4650604 d_ki=186.7275 q_kp=0.2910778 q_ki=186.7275
/// speed_pi kp=0.03703183 ki=0.8226405 outputmax=2
/// speed_sweep iq_amplitude=0.5
/// position_pid kp=3 ki=3 kd=0 outputmax=2000
/// encoder pole_pairs=7 direction=CCW offset=1.6083 type=MT6701_SPI
/// ok
/// ```
/// `ok` / `error ...` 等应答由后端处理；本解析器忽略无关行，
/// 但对可识别的配置行若字段缺失或无法解析会返回错误。
#[derive(Debug, Default)]
pub struct ConfigParser {
    state: Option<MotorState>,
    id: Option<u32>,
    motor: Option<MotorElectricalConfig>,
    /// d_kp, d_ki, q_kp, q_ki
    current_pi: Option<[f32; 4]>,
    speed_pi: Option<SpeedPIConfig>,
    speed_sweep: Option<SpeedSweepConfig>,
    position_pid: Option<PositionPIDConfig>,
    encoder: Option<EncoderConfig>,
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
            "id" => {
                let value = single_token(rest, "id")?;
                self.id = Some(parse_u32(value, "id")?);
            }
            "motor" => {
                let pairs = kv_pairs(rest)?;
                self.motor = Some(MotorElectricalConfig {
                    rs: parse_float(kv(&pairs, "rs", "motor")?, "motor.rs")?,
                    ld: parse_float(kv(&pairs, "ld", "motor")?, "motor.ld")?,
                    lq: parse_float(kv(&pairs, "lq", "motor")?, "motor.lq")?,
                });
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
                });
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
            // `ok`、`error ...`、校准行等与配置读取无关的行一律忽略。
            _ => {}
        }
        Ok(())
    }

    /// 将已解析的全部 7 行转换为 `MotorConfig`；缺少字段时返回列出所有缺失字段的错误。
    pub fn try_into_motor_config(&self) -> Result<MotorConfig, String> {
        let mut missing: Vec<&str> = Vec::new();
        if self.state.is_none() {
            missing.push("state");
        }
        if self.id.is_none() {
            missing.push("id");
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
            id: self.id.expect("checked above"),
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
    pub id: u32,
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
        "id 1",
        "motor rs=0.1867275 ld=0.0004650604 lq=0.0002910778",
        "current_pi d_kp=0.4650604 d_ki=186.7275 q_kp=0.2910778 q_ki=186.7275",
        "speed_pi kp=0.03703183 ki=0.8226405 outputmax=2",
        "speed_sweep iq_amplitude=0.5",
        "position_pid kp=3 ki=3 kd=0 outputmax=2000",
        "encoder pole_pairs=7 direction=CCW offset=1.6083 type=MT6701_SPI",
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
        assert_eq!(config.id, 1);
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
                "motor rs=0.1867275 ld=0.0004650604 lq=0.0002910778" => {
                    "motor rs=1.867275e-1 ld=4.650604e-4 lq=2.910778e-4"
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
    fn unrelated_lines_are_ignored() {
        let mut parser = ConfigParser::default();
        assert!(parser.parse_line("ok").is_ok());
        assert!(parser.parse_line("error state").is_ok());
        assert!(parser.parse_line("result alignment=ok").is_ok());
        assert!(parser.parse_line("").is_ok());
        assert!(parser.try_into_motor_config().is_err());
    }

    #[test]
    fn partial_config_reports_all_missing_rows() {
        let mut parser = ConfigParser::default();
        parser.parse_line("state Ready").unwrap();
        parser.parse_line("id 1").unwrap();
        parser.parse_line("motor rs=1 ld=2 lq=3").unwrap();
        let err = parser.try_into_motor_config().unwrap_err();
        for missing in [
            "current_pi",
            "speed_pi",
            "speed_sweep",
            "position_pid",
            "encoder",
        ] {
            assert!(
                err.contains(missing),
                "error `{err}` should mention {missing}"
            );
        }
        assert!(
            !err.contains("state"),
            "state present, must not be reported missing"
        );
    }
}
