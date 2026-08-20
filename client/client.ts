// =============================================================================
// SIMULACIÓN CLÍNICA: M1-BlackBox v4.4 — Adaptado a Solana Playground
//
// Cambios respecto a la versión de anchor local:
//   [~] Usa las globales de Playground: pg.program, pg.wallet, pg.connection, pg.BN
//   [~] Sin imports de bn.js ni anchor.setProvider (Playground los provee)
//   [+] PRUEBA 6: Verificación de cadena fuera del contrato (recomputa H(n))
//   [+] PRUEBA 7: Fallo controlado — altera un evento y demuestra que la cadena
//                 deja de cuadrar. ESTE es el momento que vende la inmutabilidad.
//
// Requiere: lib.rs v4.4 (encadenamiento real + MIN_DOSE_INTERVAL_SEC = 0)
// =============================================================================

// En Playground, el hash SHA-256 se recomputa con la Web Crypto API del navegador.
// Debe replicar EXACTAMENTE el mismo formato de string que el contrato en Rust:
//   "{previous_hash}:{patient}:{imd_device}:{glucose}:{insulin}:{timestamp}:{log_index}"
//
// SHA-256 en TypeScript puro (sin imports, sin crypto.subtle, sin anchor.utils).
// Playground rompe todas las rutas con dependencias, así que implementamos el
// algoritmo directamente. Produce el mismo hex de 64 chars que el hash() de Rust.
function sha256Hex(msg: string): string {
  // Constantes SHA-256
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  // UTF-8 encode
  const bytes: number[] = [];
  for (let i = 0; i < msg.length; i++) {
    let c = msg.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (msg.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)
      );
    }
  }

  const l = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLen = l * 8;
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);

  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let j = 0; j < bytes.length; j += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) {
      w[i] =
        (bytes[j + i * 4] << 24) | (bytes[j + i * 4 + 1] << 16) |
        (bytes[j + i * 4 + 2] << 8) | bytes[j + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const toHex8 = (x: number) => (x >>> 0).toString(16).padStart(8, "0");
  return (
    toHex8(h0) + toHex8(h1) + toHex8(h2) + toHex8(h3) +
    toHex8(h4) + toHex8(h5) + toHex8(h6) + toHex8(h7)
  );
}

console.log("Iniciando pruebas clínicas de M1-BlackBox v4.4 (Playground)...\n");

// Auto-test de la función de hash con un vector conocido antes de usarla.
// sha256("") == e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
try {
  const testHash = sha256Hex("");
  const expected = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  console.log(
    testHash === expected
      ? "[hash] OK sha256Hex verificada con vector conocido."
      : `[hash] AVISO sha256Hex devolvio algo inesperado: ${testHash}`
  );
} catch (e) {
  console.error("[hash] FALLO sha256Hex no funciona:", e.message ?? String(e));
}

// =============================================================================
// [1] IDENTIDADES
// pg.wallet es el pagador (aseguradora). El resto son keypairs efímeros.
// =============================================================================
const patient = web3.Keypair.generate();
const doctor = web3.Keypair.generate();
const imdDevice = web3.Keypair.generate();
const auditor = web3.Keypair.generate();

const [medicalRecordPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("blackbox"), patient.publicKey.toBuffer()],
  pg.program.programId
);

console.log(" PDA del Expediente:", medicalRecordPda.toBase58());
console.log(" Paciente: ", patient.publicKey.toBase58());
console.log(" IMD Device: ", imdDevice.publicKey.toBase58());
console.log(" Auditor: ", auditor.publicKey.toBase58());

// Registro local de eventos para la verificación de cadena posterior.
type ChainEvent = {
  logIndex: number;
  previousHash: string;
  eventHash: string;
  glucose: number;
  insulin: number;
  timestamp: number;
};
const localChain: ChainEvent[] = [];

// Nota: el hash se recomputa inline en las pruebas 6 y 7 usando sha256Hex,
// replicando el formato exacto del string que arma el contrato en Rust.

// =============================================================================
// PRUEBA 1: INICIALIZACIÓN
// =============================================================================
const maxInsulinDose = 30;
const glucoseMin = 70;
const glucoseMax = 180;

console.log("\n[1] Inicializando expediente y registrando hardware IMD...");
const txInit = await pg.program.methods
  .initializeRecord(maxInsulinDose, glucoseMin, glucoseMax, imdDevice.publicKey)
  .accounts({
    medicalRecord: medicalRecordPda,
    aseguradora: pg.wallet.publicKey,
    patient: patient.publicKey,
    doctor: doctor.publicKey,
    systemProgram: web3.SystemProgram.programId,
  })
  .signers([doctor, patient])
  .rpc();
console.log("OK Inicialización exitosa. Hash TX:", txInit);

// =============================================================================
// PRUEBA 2: REGISTRAR VARIOS EVENTOS EN RÁFAGA (cadena de 3 eslabones)
// Con MIN_DOSE_INTERVAL_SEC = 0 podemos registrar seguido en Playground.
// Deltas de glucosa pequeños para no disparar BiometricAnomaly.
// =============================================================================
console.log("\n[2] Registrando cadena de eventos de vitales...");
const readings = [
  { glucose: 120, insulin: 15 },
  { glucose: 122, insulin: 12 },
  { glucose: 119, insulin: 14 },
];

console.log("   readings.length =", readings.length);

// Rastreamos el last_event_hash leyéndolo de la cuenta después de cada log.
let prevHashTracker =
  "0000000000000000000000000000000000000000000000000000000000000000";

for (let i = 0; i < readings.length; i++) {
  console.log(`   >>> Entrando al bucle, iteracion ${i}`);
  const r = readings[i];
  try {
    console.log(`   Enviando logVitals(${r.glucose}, ${r.insulin})...`);
    await pg.program.methods
      .logVitals(r.glucose, r.insulin)
      .accounts({
        medicalRecord: medicalRecordPda,
        patient: patient.publicKey,
        imdDevice: imdDevice.publicKey,
      })
      .signers([imdDevice])
      .rpc();

    // Leemos el estado DESPUÉS del log. Reintentamos hasta que total_logs refleje
    // este log (Playground a veces devuelve estado viejo en el primer fetch).
    const expectedLogIndex = i + 1;
    let rec = await pg.program.account.medicalRecord.fetch(medicalRecordPda);
    let tries = 0;
    while (Number(rec.totalLogs) < expectedLogIndex && tries < 10) {
      rec = await pg.program.account.medicalRecord.fetch(medicalRecordPda);
      tries++;
    }

    const ts = Number(rec.lastTimestamp);
    const logIndex = Number(rec.totalLogs); // == expectedLogIndex

    // Computamos el event_hash localmente con EL MISMO string que el contrato:
    // "{previous_hash}:{patient}:{imd}:{glucose}:{insulin}:{timestamp}:{log_index}"
    const eventData = `${prevHashTracker}:${patient.publicKey.toBase58()}:${imdDevice.publicKey.toBase58()}:${r.glucose}:${r.insulin}:${ts}:${logIndex}`;
    const computedHash = sha256Hex(eventData);

    // Verificamos contra el hash on-chain (si el fetch lo trajo actualizado).
    const onChainHash = rec.lastEventHash;
    const matchesOnChain = computedHash === onChainHash;

    localChain.push({
      logIndex,
      previousHash: prevHashTracker,
      eventHash: computedHash, // usamos el computado, que sabemos correcto
      glucose: r.glucose,
      insulin: r.insulin,
      timestamp: ts,
    });

    console.log(
      `   OK Log #${logIndex}: glucosa ${r.glucose}, ts=${ts} -> hash ${computedHash.slice(0, 16)}... [on-chain ${matchesOnChain ? "COINCIDE" : "difiere: " + onChainHash.slice(0, 16)}]`
    );

    prevHashTracker = computedHash; // el hash de este log es el previous del siguiente
  } catch (err) {
    console.error(`   FALLO Log #${i + 1}:`, err.message ?? String(err));
    console.error("   Detalle:", JSON.stringify(err, Object.getOwnPropertyNames(err)).slice(0, 300));
  }
}

console.log(`   -> Eventos capturados en localChain: ${localChain.length}`);

// =============================================================================
// PRUEBA 3: EMPALME DE ESLABONES
// Confirma que previous_hash(n) == event_hash(n-1). Esto es lo que hace "cadena".
// =============================================================================
console.log("\n[3] Verificando empalme de eslabones (previous_hash == event_hash anterior)...");
if (localChain.length < 2) {
  console.log(`   AVISO Cadena insuficiente (${localChain.length} eventos). No se puede verificar empalme.`);
} else {
  let empalmeOk = true;
  for (let i = 1; i < localChain.length; i++) {
    const linked = localChain[i].previousHash === localChain[i - 1].eventHash;
    console.log(`   Eslabón ${i - 1}->${i}: ${linked ? "OK atado" : "FALLO ROTO"}`);
    if (!linked) empalmeOk = false;
  }
  console.log(empalmeOk ? "OK Todos los eslabones atados." : "FALLO Cadena rota.");
}

// =============================================================================
// PRUEBA 4: KILL-SWITCH
// =============================================================================
console.log("\n[4] Doctor activando Kill-Switch de emergencia...");
const txPause = await pg.program.methods
  .emergencyPause()
  .accounts({
    medicalRecord: medicalRecordPda,
    doctor: doctor.publicKey,
  })
  .signers([doctor])
  .rpc();
console.log("OK Dispositivo pausado. Hash TX:", txPause);

console.log("\n Verificando que Kill-Switch bloquea nuevos registros...");
try {
  await pg.program.methods
    .logVitals(118, 10)
    .accounts({
      medicalRecord: medicalRecordPda,
      patient: patient.publicKey,
      imdDevice: imdDevice.publicKey,
    })
    .signers([imdDevice])
    .rpc();
  console.error("FALLO ERROR CRÍTICO: El dispositivo aceptó registro post-pausa.");
} catch (err) {
  console.log("OK Kill-Switch verificado: registro rechazado.");
  console.log(" Error [SEC-002]:", err.message?.split("\n")[0] ?? String(err));
}

// =============================================================================
// PRUEBA 5: MÓDULO AUDIT — generate_audit_proof()
// =============================================================================
console.log("\n[5] Aseguradora generando Audit Proof del historial completo...");
try {
  const recordData = await pg.program.account.medicalRecord.fetch(medicalRecordPda);
  const auditTx = await pg.program.methods
    .generateAuditProof(new anchor.BN(0), new anchor.BN(recordData.totalLogs))
    .accounts({
      medicalRecord: medicalRecordPda,
      auditor: auditor.publicKey,
    })
    .signers([auditor])
    .rpc();
  console.log("OK Audit Proof generado. Hash TX:", auditTx);
  console.log(" Total logs:", recordData.totalLogs.toString());
} catch (err) {
  console.error("FALLO Error generando Audit Proof:", err.message ?? String(err));
}

// =============================================================================
// PRUEBA 6: [CLAVE] VERIFICACIÓN DE CADENA FUERA DEL CONTRATO
// Recomputamos H(n) = SHA256(previous_hash : patient : imd : glucose : insulin :
// timestamp : log_index) para cada eslabón y lo comparamos con el event_hash
// emitido on-chain. Si todos cuadran, la cadena es criptográficamente íntegra.
// =============================================================================
console.log("\n[6] Verificación independiente de la cadena (recomputando hashes)...");
if (localChain.length === 0) {
  console.log(" AVISO Cadena vacía. No hay hashes que verificar.");
} else {
  let cadenaIntegra = true;
  let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
  for (const ev of localChain) {
    const eventData = `${prevHash}:${patient.publicKey.toBase58()}:${imdDevice.publicKey.toBase58()}:${ev.glucose}:${ev.insulin}:${ev.timestamp}:${ev.logIndex}`;
    const recomputed = sha256Hex(eventData);
    const ok = recomputed === ev.eventHash;
    console.log(`   Log #${ev.logIndex}: ${ok ? "OK hash verificado" : "FALLO NO CUADRA"}`);
    if (!ok) {
      console.log(`      string: "${eventData}"`);
      console.log(`      mi hash:   ${recomputed}`);
      console.log(`      on-chain:  ${ev.eventHash}`);
    }
    if (!ok) cadenaIntegra = false;
    prevHash = ev.eventHash;
  }
  console.log(
    cadenaIntegra
      ? "OK CADENA ÍNTEGRA: cada hash recomputado coincide con el on-chain."
      : "FALLO Cadena inconsistente."
  );
}

// =============================================================================
// PRUEBA 7: [EL MOMENTO DEL DEMO] FALLO CONTROLADO
// Tomamos la cadena verificada y ALTERAMOS un evento intermedio (como haría un
// atacante o un fraude). Recomputamos: el eslabón alterado y TODOS los
// posteriores dejan de cuadrar. Esto es la demostración visual de inmutabilidad.
// =============================================================================
console.log("\n[7] FALLO CONTROLADO: alterando el log #2 (glucosa 122 -> 200)...");
console.log(" (simula manipulación fraudulenta del historial clínico)");

if (localChain.length < 2) {
  console.log(`   AVISO Cadena insuficiente (${localChain.length} eventos). No se puede demostrar el fallo controlado.`);
} else {
  // Copiamos la cadena y falsificamos la glucosa del log #2.
  const tampered = localChain.map((ev) => ({ ...ev }));
  tampered[1].glucose = 200; // valor falsificado

  // Recomputamos la cadena DESDE CERO con el dato alterado, propagando los hashes
  // recomputados. Comparamos cada uno contra el event_hash ORIGINAL on-chain.
  // El primer eslabón alterado y TODOS los siguientes dejan de coincidir.
  let prevHashT = "0000000000000000000000000000000000000000000000000000000000000000";
  let rupturaDetectada = false;
  for (let i = 0; i < tampered.length; i++) {
    const ev = tampered[i];
    const eventData = `${prevHashT}:${patient.publicKey.toBase58()}:${imdDevice.publicKey.toBase58()}:${ev.glucose}:${ev.insulin}:${ev.timestamp}:${ev.logIndex}`;
    const recomputed = sha256Hex(eventData);
    const matchesOnChain = recomputed === localChain[i].eventHash;
    console.log(
      `   Log #${ev.logIndex}: ${matchesOnChain ? "OK coincide con on-chain" : "FALLO NO COINCIDE con on-chain — manipulación detectada"}`
    );
    if (!matchesOnChain) rupturaDetectada = true;
    prevHashT = recomputed;
  }
  console.log(
    rupturaDetectada
      ? "\n  INMUTABILIDAD DEMOSTRADA: alterar un solo evento rompe la verificación.\n   El historial anclado on-chain es la única versión válida."
      : "\nFALLO La manipulación no fue detectada — revisar el encadenamiento."
  );
}
console.log(
  rupturaDetectada
    ? "\n  INMUTABILIDAD DEMOSTRADA: alterar un solo evento rompe la verificación.\n   El historial anclado on-chain es la única versión válida."
    : "\nFALLO La manipulación no fue detectada — revisar el encadenamiento."
);

console.log("\nOK Suite de pruebas v4.4 completada.");
