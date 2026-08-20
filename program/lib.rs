use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("9hopPdzQVBaLqjD8mRYToYKHkdMrszGSCAnYTCowbGJ6");

// =============================================================================
// M1-BlackBox v4.4 — Encadenamiento de hash real (fix BLACKBOX)
//
// CAMBIO CLAVE respecto a v4.3:
//   El event_hash ahora incorpora el previous_hash en su entrada, de modo que
//   H(n) = hash(H(n-1) ‖ datos_n). Esto convierte la secuencia de hashes en una
//   cadena criptográfica real: alterar o borrar un evento intermedio rompe todos
//   los hashes posteriores. En v4.3 el previous_hash se emitía en el evento pero
//   NO entraba en el cálculo, por lo que no existía encadenamiento.
//
// PENDIENTE (fuera del alcance de este fix, decisiones abiertas):
//   - PHI en claro on-chain (glucose/insulin) — viola separación on-chain/off-chain
//   - Lógica clínica on-chain — pertenece a capacidad futura, no a SHIELD
//   - FHIR + canonicalización — viven en el backend off-chain aún inexistente
//
// NOTA DEMO PLAYGROUND:
//   MIN_DOSE_INTERVAL_SEC = 0 para poder registrar eventos en ráfaga sin que el
//   reloj estático de Playground rechace por RateLimitExceeded [SEC-001].
//   ⚠️ ANTES DE PRODUCCIÓN: subir a 300 (5 min). En 0 no hay rate limiting real.
// =============================================================================

const MIN_DOSE_INTERVAL_SEC: i64 = 0; // Demo Playground: 0s (ráfaga). Producción: 300s
const GLUCOSE_ABS_MIN: u16 = 20;
const GLUCOSE_ABS_MAX: u16 = 600;
const INSULIN_DOSE_MAX: u16 = 100;
const HYPOGLYCEMIA_THRESHOLD: u16 = 70;
const MAX_GLUCOSE_DELTA_PER_MIN: u16 = 5;

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[program]
pub mod medical_black_box {
    use super::*;

    pub fn initialize_record(
        ctx: Context<InitializeRecord>,
        max_insulin_dose: u16,
        glucose_min: u16,
        glucose_max: u16,
        imd_device_pubkey: Pubkey,
    ) -> Result<()> {
        require!(
            max_insulin_dose >= 1 && max_insulin_dose <= INSULIN_DOSE_MAX,
            MedicalError::InvalidDoseRange
        );
        require!(
            glucose_min >= GLUCOSE_ABS_MIN
                && glucose_max <= GLUCOSE_ABS_MAX
                && glucose_min < glucose_max,
            MedicalError::InvalidGlucoseRange
        );

        let record = &mut ctx.accounts.medical_record;
        record.patient = ctx.accounts.patient.key();
        record.doctor = ctx.accounts.doctor.key();
        record.imd_device = imd_device_pubkey;
        record.max_insulin_dose = max_insulin_dose;
        record.glucose_min = glucose_min;
        record.glucose_max = glucose_max;
        record.is_active = true;
        record.total_logs = 0;
        record.last_timestamp = 0;
        record.last_glucose = 0;
        record.last_insulin = 0;
        record.schema_version = 1;
        record.last_event_hash =
            String::from("0000000000000000000000000000000000000000000000000000000000000000");

        emit!(RecordInitialized {
            patient: record.patient,
            doctor: record.doctor,
            imd_device: record.imd_device,
            max_insulin_dose: record.max_insulin_dose,
            glucose_min: record.glucose_min,
            glucose_max: record.glucose_max,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Black Box v4.4 inicializada. Paciente: {}", record.patient);
        Ok(())
    }

    pub fn log_vitals(
        ctx: Context<LogVitals>,
        glucose_level: u16,
        insulin_dose: u16,
    ) -> Result<()> {
        let record = &mut ctx.accounts.medical_record;

        require!(record.is_active, MedicalError::DevicePaused);

        let current_time = Clock::get()?.unix_timestamp;
        if record.total_logs > 0 {
            require!(
                current_time - record.last_timestamp >= MIN_DOSE_INTERVAL_SEC,
                MedicalError::RateLimitExceeded
            );
        }

        if record.total_logs > 0 && record.last_glucose > 0 {
            let elapsed_secs = current_time.saturating_sub(record.last_timestamp);
            let elapsed_min = ((elapsed_secs / 60) as u16).max(1);
            let max_allowed_delta = MAX_GLUCOSE_DELTA_PER_MIN.saturating_mul(elapsed_min);
            let actual_delta =
                (glucose_level as i32 - record.last_glucose as i32).unsigned_abs() as u16;
            require!(
                actual_delta <= max_allowed_delta,
                MedicalError::BiometricAnomaly
            );
        }

        require!(
            glucose_level >= record.glucose_min && glucose_level <= record.glucose_max,
            MedicalError::GlucoseOutOfRange
        );
        require!(
            insulin_dose >= 1 && insulin_dose <= record.max_insulin_dose,
            MedicalError::ExceedsPatientMaxDose
        );
        require!(
            !(glucose_level < HYPOGLYCEMIA_THRESHOLD && insulin_dose > 0),
            MedicalError::HypoglycemiaContraindication
        );

        // === ENCADENAMIENTO DE HASH REAL ===
        // El previous_hash entra como PRIMER campo de la entrada hasheada.
        // Así H(n) = hash(H(n-1) ‖ datos_n) y la cadena queda atada.
        let previous_hash = record.last_event_hash.clone();
        let event_data = format!(
            "{}:{}:{}:{}:{}:{}:{}",
            previous_hash,
            record.patient,
            ctx.accounts.imd_device.key(),
            glucose_level,
            insulin_dose,
            current_time,
            record.total_logs + 1
        );
        let event_hash_bytes = hash(event_data.as_bytes()).to_bytes();
        let event_hash_hex = bytes_to_hex(&event_hash_bytes);

        record.last_glucose = glucose_level;
        record.last_insulin = insulin_dose;
        record.last_timestamp = current_time;
        record.total_logs += 1;
        record.last_event_hash = event_hash_hex.clone();

        emit!(VitalsLogged {
            patient: record.patient,
            imd_device: ctx.accounts.imd_device.key(),
            glucose: glucose_level,
            insulin: insulin_dose,
            timestamp: current_time,
            log_index: record.total_logs,
            previous_hash,
            event_hash: event_hash_hex,
        });

        msg!(
            "Registro #{}: Glucosa {} mg/dL, Insulina {} U",
            record.total_logs,
            glucose_level,
            insulin_dose
        );
        Ok(())
    }

    pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
        let record = &mut ctx.accounts.medical_record;
        require!(
            record.doctor == ctx.accounts.doctor.key(),
            MedicalError::UnauthorizedDoctor
        );
        record.is_active = false;
        emit!(DevicePausedEvent {
            patient: record.patient,
            doctor: ctx.accounts.doctor.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        msg!(
            "EMERGENCIA: IMD pausado por doctor {}.",
            ctx.accounts.doctor.key()
        );
        Ok(())
    }

    pub fn generate_audit_proof(
        ctx: Context<GenerateAuditProof>,
        from_log_index: u64,
        to_log_index: u64,
    ) -> Result<()> {
        let record = &ctx.accounts.medical_record;
        require!(
            from_log_index <= to_log_index,
            MedicalError::InvalidAuditRange
        );
        require!(
            to_log_index <= record.total_logs,
            MedicalError::InvalidAuditRange
        );

        let is_complete = from_log_index == 0 && to_log_index == record.total_logs;
        let audit_timestamp = Clock::get()?.unix_timestamp;

        emit!(AuditProofGenerated {
            patient: record.patient,
            auditor: ctx.accounts.auditor.key(),
            total_logs: record.total_logs,
            from_log_index,
            to_log_index,
            last_event_hash: record.last_event_hash.clone(),
            is_complete,
            audit_timestamp,
        });

        msg!(
            "Audit Proof: paciente {}, {} logs, completo: {}",
            record.patient,
            record.total_logs,
            is_complete
        );
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct MedicalRecord {
    pub patient: Pubkey,
    pub doctor: Pubkey,
    pub imd_device: Pubkey,
    pub max_insulin_dose: u16,
    pub glucose_min: u16,
    pub glucose_max: u16,
    pub last_glucose: u16,
    pub last_insulin: u16,
    pub last_timestamp: i64,
    pub total_logs: u64,
    pub is_active: bool,
    pub schema_version: u8,
    #[max_len(64)]
    pub last_event_hash: String, // hex string de 64 chars — compatible con Anchor JS
}

#[derive(Accounts)]
pub struct InitializeRecord<'info> {
    #[account(
        init,
        payer = aseguradora,
        space = 8 + MedicalRecord::INIT_SPACE,
        seeds = [b"blackbox", patient.key().as_ref()],
        bump
    )]
    pub medical_record: Account<'info, MedicalRecord>,
    #[account(mut)]
    pub aseguradora: Signer<'info>,
    pub patient: Signer<'info>,
    pub doctor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LogVitals<'info> {
    #[account(
        mut,
        seeds = [b"blackbox", patient.key().as_ref()],
        bump,
        has_one = patient,
        has_one = imd_device
    )]
    pub medical_record: Account<'info, MedicalRecord>,
    /// CHECK: Solo semilla PDA.
    pub patient: AccountInfo<'info>,
    pub imd_device: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    #[account(
        mut,
        seeds = [b"blackbox", medical_record.patient.as_ref()],
        bump,
        has_one = doctor
    )]
    pub medical_record: Account<'info, MedicalRecord>,
    pub doctor: Signer<'info>,
}

#[derive(Accounts)]
pub struct GenerateAuditProof<'info> {
    #[account(
        seeds = [b"blackbox", medical_record.patient.as_ref()],
        bump
    )]
    pub medical_record: Account<'info, MedicalRecord>,
    pub auditor: Signer<'info>,
}

#[event]
pub struct RecordInitialized {
    pub patient: Pubkey,
    pub doctor: Pubkey,
    pub imd_device: Pubkey,
    pub max_insulin_dose: u16,
    pub glucose_min: u16,
    pub glucose_max: u16,
    pub timestamp: i64,
}

#[event]
pub struct VitalsLogged {
    pub patient: Pubkey,
    pub imd_device: Pubkey,
    pub glucose: u16,
    pub insulin: u16,
    pub timestamp: i64,
    pub log_index: u64,
    pub previous_hash: String,
    pub event_hash: String,
}

#[event]
pub struct DevicePausedEvent {
    pub patient: Pubkey,
    pub doctor: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuditProofGenerated {
    pub patient: Pubkey,
    pub auditor: Pubkey,
    pub total_logs: u64,
    pub from_log_index: u64,
    pub to_log_index: u64,
    pub last_event_hash: String,
    pub is_complete: bool,
    pub audit_timestamp: i64,
}

#[error_code]
pub enum MedicalError {
    #[msg("[CLN-001] Glucosa fuera del rango clínico del paciente.")]
    GlucoseOutOfRange,
    #[msg("[CLN-002] Dosis excede el máximo prescrito para este paciente.")]
    ExceedsPatientMaxDose,
    #[msg("[CLN-003] Contraindicación: no administrar insulina con glucosa < 70 mg/dL.")]
    HypoglycemiaContraindication,
    #[msg("[SEC-001] Rate Limit: deben pasar 5 minutos entre registros de dosis.")]
    RateLimitExceeded,
    #[msg("[SEC-002] Dispositivo pausado por emergencia.")]
    DevicePaused,
    #[msg("[SEC-003] Firma médica no autorizada para este expediente.")]
    UnauthorizedDoctor,
    #[msg("[SEC-004] Anomalía biométrica: delta de glucosa fisiológicamente imposible.")]
    BiometricAnomaly,
    #[msg("[CFG-001] Dosis máxima inválida: debe estar entre 1 y 100 unidades.")]
    InvalidDoseRange,
    #[msg("[CFG-002] Rango de glucosa inválido: min >= 20, max <= 600, min < max.")]
    InvalidGlucoseRange,
    #[msg("[CFG-003] Rango de auditoría inválido: from <= to <= total_logs.")]
    InvalidAuditRange,
    #[msg("[LEG-001] Nivel de glucosa no puede ser cero.")]
    InvalidGlucose,
}
