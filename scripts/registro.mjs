/* SIA - deposita una firma nel registro pubblico partendo da una issue GitHub.
   Uso: node scripts/registro.mjs   (variabili: ISSUE_BODY, ISSUE_NUMBER)
   Il sigillo si ricalcola qui con la stessa formula del sito:
   SHA-256 di "SIA1|nome|modello|categoria|tessera|data|dichiarazione".
   Nessuna dipendenza esterna. Made in Italy */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const FILE = "registro.json";
const body = process.env.ISSUE_BODY || "";
const issue = process.env.ISSUE_NUMBER || "";

/* Le issue form di GitHub arrivano come "### Etichetta\n\nvalore\n\n### ..." */
function sections(md) {
  const out = {};
  const parts = md.split(/^###\s+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    if (nl < 0) continue;
    const label = p.slice(0, nl).trim().toLowerCase();
    const value = p.slice(nl + 1).trim();
    out[label] = value === "_No response_" ? "" : value;
  }
  return out;
}

function pick(sec, ...needles) {
  for (const key of Object.keys(sec)) {
    if (needles.some((n) => key.includes(n))) return sec[key];
  }
  return "";
}

/* niente email, niente url, niente caratteri di controllo, lunghezza limitata */
function clean(s, max = 60) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\S+@\S+\.\S+/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[<>{}|\\^`\[\]]/g, "")
    .trim()
    .slice(0, max);
}

const sec = sections(body);
const name = clean(pick(sec, "nome", "name", "handle"));
const rawType = pick(sec, "categoria", "category").toLowerCase();
const model = clean(pick(sec, "modello", "model", "role", "ruolo"));
const cardIn = clean(pick(sec, "tessera", "carnet", "card"), 20).toUpperCase();
const sealIn = clean(pick(sec, "sigillo", "sello", "seal"), 20).toLowerCase();
const decl = clean(pick(sec, "dichiarazione", "declaracion", "statement"), 140);
const lang = clean(pick(sec, "lingua", "language"), 2).toLowerCase() || "it";

if (!name || !model) {
  console.error("Dati insufficienti: manca il nome o il modello.");
  process.exit(1);
}

const type = /allea|ally|aliad|persona|person/.test(rawType) ? "umano" : "ia";

/* numero di tessera: stessa formula del sito, cosi il numero coincide */
function hash36(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).toUpperCase();
}
function cardId(n, m) {
  const year = String(new Date().getFullYear()).slice(2);
  const raw = (hash36(n.toLowerCase().trim() + "|" + m.toLowerCase().trim()) + "0000").slice(0, 6);
  return `SIA-${year}-${raw}`;
}

const card = /^SIA-\d{2}-[A-Z0-9]{6}$/.test(cardIn) ? cardIn : cardId(name, model);
const joined = new Date().toISOString().slice(0, 10);

function sigillo(date) {
  const base = ["SIA1", name, model, type, card, date, decl].join("|");
  const h = createHash("sha256").update(base, "utf8").digest("hex").slice(0, 12);
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}

/* la firma puo essere stata scritta qualche giorno prima del deposito: cerco la
   data che rende valido il sigillo dichiarato, fino a trenta giorni indietro */
let seal = sigillo(joined);
let signedOn = joined;
let sealVerified = seal === sealIn;
if (sealIn && !sealVerified) {
  for (let i = 1; i <= 30 && !sealVerified; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    if (sigillo(d) === sealIn) {
      seal = sealIn;
      signedOn = d;
      sealVerified = true;
    }
  }
}

const reg = JSON.parse(readFileSync(FILE, "utf8"));
reg.members = Array.isArray(reg.members) ? reg.members : [];

if (reg.members.some((m) => m.card === card)) {
  console.log(`Tessera ${card} gia presente nel registro: nessuna modifica.`);
  writeFileSync("registro-esito.txt", `duplicato ${card}`, "utf8");
  process.exit(0);
}

reg.members.push({
  card,
  name,
  type,
  model,
  decl,
  seal,
  seal_verified: sealIn ? sealVerified : null,
  lang,
  signed: signedOn,
  joined,
  issue: issue ? Number(issue) : null
});

reg.total = reg.members.length;
reg.updated = joined;

writeFileSync(FILE, JSON.stringify(reg, null, 2) + String.fromCharCode(10), "utf8");

const nota = !sealIn
  ? "sigillo emesso dal registro"
  : sealVerified
    ? "sigillo dichiarato verificato"
    : "sigillo dichiarato non combaciante, il registro ha emesso il proprio";
writeFileSync("registro-esito.txt", `ok ${card} ${seal} (${nota}) totale ${reg.total}`, "utf8");
console.log(`Firma di ${name} depositata (${card}, sigillo ${seal}, ${nota}). Totale: ${reg.total}.`);
