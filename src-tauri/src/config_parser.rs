use scan_fmt::scan_fmt;
use strum_macros::{Display, EnumString};

#[derive(Debug, Default)]
struct PositionPID {
    kp: Option<f32>,
    ki: Option<f32>,
    kd: Option<f32>,
    maxoutput: Option<f32>,
}

#[derive(Debug, Default)]
struct SpeedPI {
    kp: Option<f32>,
    ki: Option<f32>,
    maxoutput: Option<f32>,
}

#[derive(Debug, Default)]
struct IDQPI {
    id_kp: Option<f32>,
    id_ki: Option<f32>,
    iq_kp: Option<f32>,
    iq_ki: Option<f32>,
}

#[derive(Debug, Default)]
struct Encoder {
    pole_pairs: Option<u32>,
    encoder_direct: Option<i32>,
    encoder_offset: Option<f32>,
    encoder_type: Option<String>,
}

#[derive(Debug, Default)]
pub struct ConfigParser {
    id: Option<u8>,
    udc: Option<f32>,
    position_pid: PositionPID,
    speed_pi: SpeedPI,
    idq_filter_fc: Option<f32>,
    i_pi: IDQPI,
    encoder: Encoder,
}

impl ConfigParser {
    /// 解析一行并更新自己
    pub fn parse_line(&mut self, line: &str, section: &mut String) {
        let line = line.trim();

        // 判断 section 切换
        match line {
            "position_pid:" => {
                *section = "position_pid".to_string();
                return;
            }
            "speed_pi:" => {
                *section = "speed_pi".to_string();
                return;
            }
            "i_pi:" => {
                *section = "i_pi".to_string();
                return;
            }
            "encoder:" => {
                *section = "encoder".to_string();
                return;
            }
            _ => {}
        }

        // 按 section 解析
        match section.as_str() {
            "position_pid" => {
                if let Ok(kp) = scan_fmt!(line, "Kp: {}", f32) { self.position_pid.kp = Some(kp); }
                if let Ok(ki) = scan_fmt!(line, "Ki: {}", f32) { self.position_pid.ki = Some(ki); }
                if let Ok(kd) = scan_fmt!(line, "Kd: {}", f32) { self.position_pid.kd = Some(kd); }
                if let Ok(max) = scan_fmt!(line, "maxoutput: {}", f32) { self.position_pid.maxoutput = Some(max); }
            }
            "speed_pi" => {
                if let Ok(kp) = scan_fmt!(line, "Kp: {}", f32) { self.speed_pi.kp = Some(kp); }
                if let Ok(ki) = scan_fmt!(line, "Ki: {}", f32) { self.speed_pi.ki = Some(ki); }
                if let Ok(max) = scan_fmt!(line, "maxoutput: {}", f32) { self.speed_pi.maxoutput = Some(max); }
            }
            "i_pi" => {
                if let Ok(v) = scan_fmt!(line, "id_Kp: {}", f32) { self.i_pi.id_kp = Some(v); }
                if let Ok(v) = scan_fmt!(line, "id_Ki: {}", f32) { self.i_pi.id_ki = Some(v); }
                if let Ok(v) = scan_fmt!(line, "iq_Kp: {}", f32) { self.i_pi.iq_kp = Some(v); }
                if let Ok(v) = scan_fmt!(line, "iq_Ki: {}", f32) { self.i_pi.iq_ki = Some(v); }
            }
            "encoder" => {
                if let Ok(v) = scan_fmt!(line, "pole_pairs: {}", u32) { self.encoder.pole_pairs = Some(v); }
                if let Ok(v) = scan_fmt!(line, "encoder_direct: {}", i32) { self.encoder.encoder_direct = Some(v); }
                if let Ok(v) = scan_fmt!(line, "encoder_offset: {}", f32) { self.encoder.encoder_offset = Some(v); }
                if let Ok(v) = scan_fmt!(line, "encoder_type: {}", String) { self.encoder.encoder_type = Some(v); }
            }
            "" => {
                // 顶层字段
                if let Ok(v) = scan_fmt!(line, "id: {}", u8) { self.id = Some(v); }
                if let Ok(v) = scan_fmt!(line, "udc: {}", f32) { self.udc = Some(v); }
                if let Ok(v) = scan_fmt!(line, "idq_filter_fc: {}", f32) { self.idq_filter_fc = Some(v); }
            }
            _ => {}
        }
    }
    pub fn is_complete(&self) -> bool {
        self.id.is_some()
            && self.udc.is_some()
            && self.idq_filter_fc.is_some()
            // position_pid
            && self.position_pid.kp.is_some()
            && self.position_pid.ki.is_some()
            && self.position_pid.kd.is_some()
            && self.position_pid.maxoutput.is_some()
            // speed_pi
            && self.speed_pi.kp.is_some()
            && self.speed_pi.ki.is_some()
            && self.speed_pi.maxoutput.is_some()
            // current i_pi
            && self.i_pi.id_kp.is_some()
            && self.i_pi.id_ki.is_some()
            && self.i_pi.iq_kp.is_some()
            && self.i_pi.iq_ki.is_some()
            // encoder
            && self.encoder.pole_pairs.is_some()
            && self.encoder.encoder_direct.is_some()
            && self.encoder.encoder_offset.is_some()
            && self.encoder.encoder_type.is_some()
    }

    pub fn try_into_motor_config(&self) -> Result<MotorConfig, &'static str> {
        // 顶层字段
        let id = self.id.ok_or("id missing")?;
        let udc = self.udc.ok_or("udc missing")?;
        let fc = self.idq_filter_fc.ok_or("idq_filter_fc missing")?;

        // position_pid
        let position_pid = PositionPIDConfig {
            kp: self.position_pid.kp.ok_or("position_pid.kp missing")?,
            ki: self.position_pid.ki.ok_or("position_pid.ki missing")?,
            kd: self.position_pid.kd.ok_or("position_pid.kd missing")?,
            output_max: self.position_pid.maxoutput.ok_or("position_pid.maxoutput missing")?,
        };

        // speed_pi
        let speed_pi = SpeedPIConfig {
            kp: self.speed_pi.kp.ok_or("speed_pi.kp missing")?,
            ki: self.speed_pi.ki.ok_or("speed_pi.ki missing")?,
            output_max: self.speed_pi.maxoutput.ok_or("speed_pi.maxoutput missing")?,
        };

        // current_id_pi
        let current_id_pi = CurrentPIConfig {
            kp: self.i_pi.id_kp.ok_or("i_pi.id_kp missing")?,
            ki: self.i_pi.id_ki.ok_or("i_pi.id_ki missing")?,
        };

        // current_iq_pi
        let current_iq_pi = CurrentPIConfig {
            kp: self.i_pi.iq_kp.ok_or("i_pi.iq_kp missing")?,
            ki: self.i_pi.iq_ki.ok_or("i_pi.iq_ki missing")?,
        };

        // encoder
        let encoder_type_str = self.encoder.encoder_type.as_ref().ok_or("encoder.encoder_type missing")?;
        let encoder_type = encoder_type_str.parse::<EncoderType>().map_err(|_| "invalid encoder_type")?;
        let encoder_direction = match self.encoder.encoder_direct.ok_or("encoder.encoder_direct missing")? {
            1 => EncoderDirection::Same,
            -1 => EncoderDirection::Reverse,
            _ => return Err("invalid encoder_direct"),
        };
        let encoder_config = EncoderConfig {
            pole_pairs: self.encoder.pole_pairs.ok_or("encoder.pole_pairs missing")?,
            encoder_direction,
            encoder_offset: self.encoder.encoder_offset.ok_or("encoder.encoder_offset missing")?,
            encoder_type,
        };

        Ok(MotorConfig {
            id,
            udc,
            position_pid,
            speed_pi,
            current_id_pi,
            current_iq_pi,
            fc,
            encoder_config,
        })
    }
}


#[derive(Debug, Clone)]
pub struct PositionPIDConfig {
    pub kp: f32,
    pub ki: f32,
    pub kd: f32,
    pub output_max: f32,
}
#[derive(Debug, Clone)]
pub struct SpeedPIConfig {
    pub kp: f32,
    pub ki: f32,
    pub output_max: f32,
}
#[derive(Debug, Clone)]
pub struct CurrentPIConfig {
    pub kp: f32,
    pub ki: f32,
}

#[repr(i8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderDirection {
    Same = 1i8,
    Reverse = -1i8,
}
#[derive(Debug, Clone, Copy, Eq, PartialEq, EnumString, Display)]
pub enum EncoderType {
    #[strum(serialize = "MT6701")]
    MT6701,
}

#[derive(Debug, Clone)]
pub struct EncoderConfig {
    pub pole_pairs: u32,
    pub encoder_direction: EncoderDirection,
    pub encoder_offset: f32,
    pub encoder_type: EncoderType,
}
#[derive(Debug, Clone)]
pub struct MotorConfig {
    pub id: u8,
    pub udc: f32,
    pub position_pid: PositionPIDConfig,
    pub speed_pi: SpeedPIConfig,
    pub current_id_pi: CurrentPIConfig,
    pub current_iq_pi: CurrentPIConfig,
    pub fc: f32,
    pub encoder_config: EncoderConfig,
}