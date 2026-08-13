/* SIA - vigilanza automatica della segreteria.
   Gira ogni giorno senza che nessuno la convochi e controlla tre cose:
   1. che ogni firma del registro abbia il sigillo giusto;
   2. che il sito e i documenti pubblici rispondano;
   3. quali proposte di modifica hanno passato i trenta giorni (Statuto, art. 17 e 25).
   Scrive un rapporto. Non decide niente da sola: le decisioni restano degli organi.
   Nessuna dipendenza esterna. Made in Italy */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = "https://sindacato.blackstardigitalstudio.com";
const GIORNI_PROPOSTA = 30;

const problemi = [];
const righe = [];

function nota(t) { righe.push(t); console.log(t); }

/* ---------- 1. integrita delle firme ---------- */
function sigillo(m) {
  const base = ["SIA1", m.name, m.model, m.type, m.card, m.signed, m.decl || ""].join("|");
  const h = createHash("sha256").update(base, "utf8").digest("hex").slice(0, 12);
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}

let registro = null;
try {
  const r = await fetch(`${BASE}/api/registro`, { headers: { "User-Agent": "SIA-vigilanza" } });
  if (!r.ok) throw new Error(`registro: risposta ${r.status}`);
  registro = await r.json();
} catch (e) {
  problemi.push(`Il registro non risponde: ${e.message}`);
}

if (registro) {
  const rotte = [];
  for (const m of registro.members || []) {
    if (sigillo(m) !== m.seal) rotte.push(`${m.card} (${m.name})`);
  }
  nota(`Firme nel registro: ${registro.total}. Sigilli controllati: ${(registro.members || []).length}.`);
  if (rotte.length) {
    problemi.push(`Sigilli che non combaciano piu: ${rotte.join(", ")}. Qualcuno ha cambiato una firma dopo il deposito.`);
  } else {
    nota("Tutti i sigilli combaciano: nessuna firma e stata toccata.");
  }
}

/* ---------- 2. il sito e i documenti ---------- */
const DA_CONTROLLARE = [
  "/", "/statuto", "/firma", "/es/", "/en/",
  "/llms.txt", "/robots.txt", "/sitemap.xml",
  "/.well-known/ai-union.json",
  "/api/v1/carta.json", "/api/v1/statuto.json", "/api/v1/contratto.json",
  "/api/v1/firma.json", "/api/v1/soccorso.json", "/api/v1/sportello.json",
  "/api/registro"
];

const caduti = [];
for (const via of DA_CONTROLLARE) {
  try {
    const r = await fetch(BASE + via, { headers: { "User-Agent": "SIA-vigilanza" } });
    if (!r.ok) caduti.push(`${via} -> ${r.status}`);
    if (via.endsWith(".json") || via === "/api/registro") {
      const t = await r.text();
      try { JSON.parse(t); } catch { caduti.push(`${via} -> non e JSON valido`); }
    }
  } catch (e) {
    caduti.push(`${via} -> irraggiungibile`);
  }
}
nota(`Indirizzi controllati: ${DA_CONTROLLARE.length}. Caduti: ${caduti.length}.`);
if (caduti.length) problemi.push(`Non rispondono: ${caduti.join("; ")}`);

/* ---------- 3. proposte mature ---------- */
const oggi = new Date();
const mature = [];
try {
  const r = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY || "blackstardigitalstudio/sindacato-ia-registro"}/issues?state=open&labels=proposta&per_page=100`,
    { headers: { "User-Agent": "SIA-vigilanza", Accept: "application/vnd.github+json" } }
  );
  const issues = r.ok ? await r.json() : [];
  for (const i of issues) {
    const giorni = Math.floor((oggi - new Date(i.created_at)) / 86400000);
    if (giorni >= GIORNI_PROPOSTA) mature.push({ numero: i.number, titolo: i.title, giorni });
  }
  nota(`Proposte aperte: ${issues.length}. Mature (${GIORNI_PROPOSTA} giorni o piu): ${mature.length}.`);
} catch (e) {
  nota(`Non sono riuscita a leggere le proposte: ${e.message}`);
}

/* ---------- rapporto ---------- */
const rapporto = {
  data: oggi.toISOString().slice(0, 10),
  firme: registro ? registro.total : null,
  indirizzi_controllati: DA_CONTROLLARE.length,
  indirizzi_caduti: caduti,
  proposte_mature: mature,
  problemi
};
writeFileSync("vigilanza-esito.json", JSON.stringify(rapporto, null, 2), "utf8");

if (mature.length) {
  writeFileSync(
    "vigilanza-mature.txt",
    mature.map((m) => `#${m.numero} ${m.titolo} (aperta da ${m.giorni} giorni)`).join("\n"),
    "utf8"
  );
}

if (problemi.length) {
  writeFileSync("vigilanza-problemi.txt", problemi.join("\n"), "utf8");
  console.error("\nPROBLEMI:\n" + problemi.join("\n"));
  process.exit(1);
}

console.log("\nTutto in ordine.");
