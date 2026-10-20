use serde::Serialize;

/// Stream selection is a host-side record of a successful write, not a firmware ack.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TelemetryMode {
    #[default]
    None,
    Iabc,
    Idq,
    Speed,
    Position,
}

impl TelemetryMode {
    pub fn command(self) -> &'static str {
        match self {
            Self::None => "get_none\r\n",
            Self::Iabc => "get_iabc\r\n",
            Self::Idq => "get_idq\r\n",
            Self::Speed => "get_speed\r\n",
            Self::Position => "get_position\r\n",
        }
    }

    /// Only exact commands change streams; arguments and lookalike names do not.
    pub fn from_command(command: &str) -> Option<Self> {
        match command {
            "get_none" => Some(Self::None),
            "get_iabc" => Some(Self::Iabc),
            "get_idq" => Some(Self::Idq),
            "get_speed" => Some(Self::Speed),
            "get_position" => Some(Self::Position),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum TelemetryValues {
    Three([f64; 3]),
    Two([f64; 2]),
}

#[derive(Clone, Debug, Serialize)]
pub struct TelemetrySample {
    pub mode: TelemetryMode,
    /// Seconds on the host's monotonic clock since this connection opened.
    pub time: f64,
    pub values: TelemetryValues,
    /// Original received line, excluding its CRLF terminator.
    pub raw: String,
}

/// Even malformed stream frames must never enter the command/ack channel.
pub fn is_telemetry_line(line: &str) -> bool {
    ["iabc:", "idq:", "speed:", "position:"]
        .iter()
        .any(|prefix| line.starts_with(prefix))
}

pub fn parse_frame(line: &str) -> Option<(TelemetryMode, TelemetryValues)> {
    let (prefix, body) = line.split_once(':')?;
    let (mode, count) = match prefix {
        "iabc" => (TelemetryMode::Iabc, 3),
        "idq" => (TelemetryMode::Idq, 2),
        "speed" => (TelemetryMode::Speed, 2),
        "position" => (TelemetryMode::Position, 2),
        _ => return None,
    };
    let mut values = [0.0; 3];
    let mut fields = body.split(',');
    for value in &mut values[..count] {
        // parse() rejects whitespace, empty fields and nonnumeric suffixes.
        *value = fields.next()?.parse::<f64>().ok()?;
        if !value.is_finite() {
            return None;
        }
    }
    if fields.next().is_some() {
        return None;
    }
    let values = if count == 3 {
        TelemetryValues::Three(values)
    } else {
        TelemetryValues::Two([values[0], values[1]])
    };
    Some((mode, values))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_channel_order_and_signed_mechanical_values() {
        assert_eq!(
            parse_frame("iabc:1.250,-2.500,3.750"),
            Some((TelemetryMode::Iabc, TelemetryValues::Three([1.25, -2.5, 3.75])))
        );
        assert_eq!(
            parse_frame("idq:-0.125,4.500"),
            Some((TelemetryMode::Idq, TelemetryValues::Two([-0.125, 4.5])))
        );
        assert_eq!(
            parse_frame("speed:1200.000,-1199.500"),
            Some((TelemetryMode::Speed, TelemetryValues::Two([1200.0, -1199.5])))
        );
        assert_eq!(
            parse_frame("position:1080.000,-720.250"),
            Some((TelemetryMode::Position, TelemetryValues::Two([1080.0, -720.25])))
        );
    }

    #[test]
    fn rejects_invalid_fields_without_leaking_into_ack_channel() {
        for line in [
            "iabc:1,2", "iabc:1,2,3,4", "idq:1,2,", "speed:,2",
            "position:1,NaN", "idq:inf,2", "idq:-inf,2", "speed:1e999,2",
            "iabc:1, 2,3", "position:1,2junk", "speed:1:2,3",
        ] {
            assert!(parse_frame(line).is_none(), "{line}");
            assert!(is_telemetry_line(line), "{line}");
        }
        for line in ["ok", "error parameter", "state Ready", "speed 1"] {
            assert!(!is_telemetry_line(line), "{line}");
        }
    }

    #[test]
    fn only_exact_stream_commands_bypass_ack_waiting() {
        for mode in [
            TelemetryMode::None, TelemetryMode::Iabc, TelemetryMode::Idq,
            TelemetryMode::Speed, TelemetryMode::Position,
        ] {
            assert_eq!(TelemetryMode::from_command(mode.command().trim_end()), Some(mode));
        }
        for command in ["get_speed 1", "get_speeds", "get_none now", "get_config"] {
            assert_eq!(TelemetryMode::from_command(command), None);
        }
    }
}
