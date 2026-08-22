# BlackBox M1 — MVP

Middleware de ciberseguridad clínica para dispositivos médicos implantables
(marcapasos, bombas de insulina, estimuladores), construido sobre Solana.

BlackBox M1 registra los eventos enviados a un dispositivo implantable en una
**cadena de hashes SHA-256 encadenada y anclada on-chain**, de modo que cualquier
manipulación del historial es criptográficamente detectable. El MVP demuestra el
flujo principal: registro de eventos, encadenamiento inmutable, kill-switch de
emergencia y generación de prueba de auditoría.

## Demo en vivo (Devnet)

- **Frontend (MVP navegable): https://blackbox-m1-six.vercel.app/
- **Program ID (Solana Devnet): BFrtEXNKjvtfdr6eqHnMVS2HKnJzFLBQpobBbrdPgUAa
- **Video de demostración: https://drive.google.com/file/d/1aPM6MuNGG9-Hc_PvYkU0MOMvivp-xpzo/view?usp=drive_link

## Módulos

- **SHIELD** — validación de origen de comandos (autenticación criptográfica por firma).
- **BLACKBOX** — cadena de hashes SHA-256 encadenada, anclada on-chain (registro inmutable).
- **AUDIT** — generación de prueba de auditoría del historial completo para aseguradoras/reguladores.

## Estructura del repositorio

```
blackbox-m1/
├── program/
│   └── lib.rs          # Programa Anchor (on-chain, Rust)
├── client/
│   └── client.ts       # Suite de pruebas del flujo principal
├── frontend/
│   └── index.html      # Frontend mínimo conectado a Devnet
└── README.md
```

## Cómo correr el programa on-chain (Solana Playground)

El programa está desplegado en **Solana Devnet**. Para reproducirlo:

1. Abre [beta.solpg.io](https://beta.solpg.io) y crea un proyecto **Anchor**.
2. Reemplaza `src/lib.rs` con el contenido de `program/lib.rs`.
3. **Build** y luego **Deploy** (requiere SOL de Devnet en la wallet de Playground).
4. Reemplaza el cliente con `client/client.ts` y pulsa **Run**.

La suite de pruebas ejecuta el flujo principal:

1. Inicialización del expediente + registro del dispositivo IMD.
2. Registro de una cadena de eventos de vitales (glucosa/insulina).
3. Verificación del empalme de eslabones (`previous_hash == event_hash` anterior).
4. Kill-switch de emergencia (pausa el dispositivo, rechaza registros posteriores).
5. Generación de prueba de auditoría (AUDIT).
6. Verificación independiente de la cadena (recomputo de hashes fuera del contrato).
7. **Fallo controlado**: se altera un evento y se demuestra que la verificación se rompe
   (inmutabilidad demostrada).

## Cómo correr el frontend

El frontend es una página HTML única, sin proceso de build. Requiere la extensión
[Phantom](https://phantom.app/) configurada en **Devnet**.

```bash
# Servirlo localmente:
cd frontend
npx serve .
# o simplemente abrir index.html en el navegador
```

Desplegado en Vercel para acceso navegable (ver link arriba).

## Stack

- **On-chain:** Solana, Anchor / Rust (Devnet)
- **Cliente:** TypeScript, @coral-xyz/anchor, @solana/web3.js
- **Frontend:** HTML + @solana/web3.js (vía CDN), Phantom wallet
- **Hashing:** SHA-256 con canonicalización determinista del evento

## Estado y alcance

Este MVP demuestra la **integración técnica funcional con Solana** y el mecanismo
central de inmutabilidad (cadena de hashes verificable). Fuera del alcance de este
MVP, en la siguiente fase: separación completa on-chain/off-chain de datos clínicos
(PHI), normalización FHIR de los payloads, e ingesta HL7 en el edge.
