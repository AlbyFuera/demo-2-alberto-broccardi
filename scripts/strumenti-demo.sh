#!/bin/bash
# Prepara due account demo con una settimana di dati.
set -u
cd "$(dirname "$0")" && mkdir -p .lavoro && cd .lavoro
B=${B:-https://pianificatore-dieta.matteojeleriu.workers.dev}

EN="anna.verdi@nutrizione.it"
EC="giulia.rossi@posta.it"
: "${PW_N:?imposta PW_N, la password del nutrizionista demo}"
: "${PW_C:?imposta PW_C, la password del cliente demo}"

rm -f dn.txt dc.txt
j() { printf '%s' "$1" > c.json; }
pn() { curl -s -b dn.txt -c dn.txt -X POST "$B$1" -H 'content-type: application/json' -d @c.json; }
pc() { curl -s -b dc.txt -c dc.txt -X POST "$B$1" -H 'content-type: application/json' -d @c.json; }

echo "· creo il nutrizionista"
j "{\"email\":\"$EN\",\"password\":\"$PW_N\",\"ruolo\":\"nutrizionista\"}"
curl -s -c dn.txt -X POST "$B/api/registrati" -H 'content-type: application/json' -d @c.json > /dev/null
j '{"nome":"Dott.ssa Anna Verdi"}'; pn /api/studio/impostazioni > /dev/null

echo "· creo la cliente"
j "{\"email\":\"$EC\",\"password\":\"$PW_C\",\"ruolo\":\"cliente\"}"
curl -s -c dc.txt -X POST "$B/api/registrati" -H 'content-type: application/json' -d @c.json > /dev/null
j '{"nome":"Giulia Rossi","obiettivo":"Perdere 6 kg entro dicembre"}'; pc /api/cliente/impostazioni > /dev/null

echo "· collego i due"
j "{\"email\":\"$EN\",\"messaggio\":\"Buongiorno dottoressa, sono Giulia. Ci siamo viste giovedì.\"}"
pc /api/cliente/richiedi > /dev/null
LINK=$(curl -s -b dn.txt "$B/api/studio/cruscotto" | python3 -c "import json,sys; print(json.load(sys.stdin)['richieste'][0]['linkId'])")
j "{\"link\":\"$LINK\",\"accetta\":true}"; pn /api/studio/decidi > /dev/null
CLI=$(curl -s -b dn.txt "$B/api/studio/cruscotto" | python3 -c "import json,sys; print(json.load(sys.stdin)['clienti'][0]['id'])")

echo "· scrivo la dieta"
j "{\"cliente\":\"$CLI\",\"titolo\":\"Dieta di luglio\"}"
DIETA=$(pn /api/studio/nuova-dieta | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

python3 - "$DIETA" > dieta-demo.json <<'PY'
import json, sys

# Due schemi alternati, servono al cambio pasto.
A = [
  ("Colazione", "08:00", [("fette biscottate", 40, "g"), ("marmellata", 30, "g"),
                          ("latte scremato o parz. scremato", 200, "ml")]),
  ("Spuntino",  "10:30", [("mandorle", 15, "g"), ("mela", 1, "pz")]),
  ("Pranzo",    "13:00", [("pasta", 90, "g"), ("petto di pollo", 150, "g"),
                          ("zucchine", None, "g"), ("olio extravergine", 10, "g")]),
  ("Merenda",   "17:00", [("yogurt", 150, "g")]),
  ("Cena",      "20:00", [("riso", 70, "g"), ("merluzzo", 200, "g"),
                          ("insalata mista", None, "g"), ("olio extravergine", 10, "g")]),
]
B = [
  ("Colazione", "08:00", [("pane integrale", 50, "g"), ("miele", 20, "g"),
                          ("yogurt", 150, "g")]),
  ("Spuntino",  "10:30", [("noci", 15, "g"), ("banana", 1, "pz")]),
  ("Pranzo",    "13:00", [("riso", 85, "g"), ("tonno al naturale", 160, "g"),
                          ("broccoli", None, "g"), ("olio extravergine", 10, "g")]),
  ("Merenda",   "17:00", [("ricotta", 100, "g")]),
  ("Cena",      "20:00", [("patate", 250, "g"), ("orata", 200, "g"),
                          ("spinaci", None, "g"), ("olio extravergine", 10, "g")]),
]

# Piano a sostituzione su alcuni posti.
PIANO = {
    "petto di pollo": ("fonte proteica", "proteine",
                       [{"nome": "merluzzo"}, {"nome": "tacchino"},
                        {"nome": "uova", "quantita": 2, "unita": "pz"}]),
    "merluzzo":       ("fonte proteica", "proteine",
                       [{"nome": "orata"}, {"nome": "petto di pollo"}, {"nome": "tofu"}]),
    "pasta":          ("fonte di carboidrati", "carboidrati",
                       [{"nome": "riso"}, {"nome": "farro"}, {"nome": "patate"}]),
    "yogurt":         ("merenda proteica", "kcal",
                       [{"nome": "ricotta"}, {"nome": "fiocchi di latte"}]),
}

def alimento(a, q, u):
    voce = {"nome": a, "quantita": q, "unita": u, "libera": q is None}
    if a in PIANO:
        gruppo, base, alternative = PIANO[a]
        voce.update(gruppo=gruppo, base=base, alternative=alternative)
    return voce

giorni = [
    {"indice": i, "allenamento": i in (0, 2, 4),
     "pasti": [{"nome": n, "orario": o,
                "alimenti": [alimento(a, q, u) for a, q, u in al]}
               for n, o, al in (A if i % 2 == 0 else B)]}
    for i in range(7)
]

print(json.dumps({"id": sys.argv[1], "dieta": {
    "titolo": "Dieta di luglio",
    "indicazioni": [
        "Le quantità si intendono a crudo e a peso netto.",
        "Almeno due litri d'acqua al giorno, di più nei giorni di allenamento.",
        "Un pasto libero a settimana, preferibilmente la domenica.",
        "Verdura a volontà a pranzo e a cena.",
    ],
    "obiettivi": {"kcal": 1750, "proteine": 125, "carboidrati": 175,
                  "grassi": 58, "acqua": 2, "passi": 9000},
    "giorni": giorni}}))
PY
curl -s -b dn.txt -X POST "$B/api/studio/salva-dieta" -H 'content-type: application/json' -d @dieta-demo.json > /dev/null
j "{\"id\":\"$DIETA\"}"; pn /api/studio/pubblica > /dev/null

echo "· sei giorni di pasti spuntati e di passi"
# Storico all'indietro per serie e aderenza.
python3 - "$B" > riempi.sh <<'PY'
import datetime, sys
B = sys.argv[1]
oggi = datetime.date.today()
righe = []
# Sei giorni pieni, oggi a metà.
passi = {6: 9400, 5: 10200, 4: 8600, 3: 9800, 2: 11300, 1: 9100, 0: 6200}
for indietro in range(6, -1, -1):
    g = (oggi - datetime.timedelta(days=indietro)).isoformat()
    righe.append(f'GIORNI="$GIORNI {g}"')
    righe.append(f'PASSI_{indietro}={passi[indietro]}')
print('\n'.join(righe))
PY

GIORNI=""
. ./riempi.sh

# Gli id dei pasti vanno letti dalla dieta.
python3 - "$DIETA" > pasti.txt <<'PY'
import json, subprocess, sys
d = json.loads(subprocess.run(
    ['curl','-s','-b','dn.txt', f'{__import__("os").environ.get("B","https://pianificatore-dieta.matteojeleriu.workers.dev")}/api/studio/dieta?dieta={sys.argv[1]}'],
    capture_output=True, text=True).stdout)
for g in d['dieta']['giorni']:
    for p in g['pasti']:
        print(g['indice'], p['id'])
PY

python3 - "$B" "$DIETA" <<'PY'
import datetime, json, os, subprocess, sys
B, dieta = sys.argv[1], sys.argv[2]
oggi = datetime.date.today()

pasti = {}
for riga in open('pasti.txt'):
    i, pid = riga.split()
    pasti.setdefault(int(i), []).append(pid)

passi = {6: 9400, 5: 10200, 4: 8600, 3: 9800, 2: 11300, 1: 9100, 0: 6200}

def posta(percorso, corpo):
    subprocess.run(['curl','-s','-o','/dev/null','-b','dc.txt','-X','POST',
                    f'{B}{percorso}','-H','content-type: application/json',
                    '-d', json.dumps(corpo)])

for indietro in range(6, -1, -1):
    data = oggi - datetime.timedelta(days=indietro)
    g = data.isoformat()
    idx = data.weekday()
    posta('/api/cliente/passi', {'giorno': g, 'passi': passi[indietro]})

    # Oggi: solo i primi due pasti.
    # Cinque giorni fa: una cena saltata.
    elenco = pasti.get(idx, [])
    if indietro == 0:
        elenco = elenco[:2]
    for n, pid in enumerate(elenco):
        stato = 'saltato' if (indietro == 5 and n == len(pasti.get(idx, [])) - 1) else 'fatto'
        posta('/api/cliente/spunta', {'giorno': g, 'pasto': pid, 'stato': stato})
    print(f'  {g} ({["lun","mar","mer","gio","ven","sab","dom"][idx]}): '
          f'{len(elenco)} pasti, {passi[indietro]} passi')
PY

echo "· una sostituzione, così lo studio ha una notifica da guardare"
OGGI=$(curl -s -b dc.txt "$B/api/cliente/dashboard" | python3 -c "import json,sys; print(json.load(sys.stdin)['oggi']['indice'])")
PRANZO=$(curl -s -b dc.txt "$B/api/cliente/dashboard" | python3 -c "
import json,sys
for p in json.load(sys.stdin)['oggi']['pasti']:
    if p['nome'] == 'Pranzo': print(p['id']); break")
# Nei giorni dispari alla posizione 2 del pranzo c'è già il tonno: si propone il merluzzo.
if [ $((OGGI % 2)) -eq 1 ]; then NUOVO="merluzzo"; else NUOVO="tonno al naturale"; fi
j "{\"giorno\":$OGGI,\"pasto\":\"$PRANZO\",\"indice\":1,\"alimento\":\"$NUOVO\"}"
pc /api/cliente/applica > /dev/null

printf '\n\033[1mDue account pronti\033[0m\n'
printf '  nutrizionista  %s  /  %s\n' "$EN" "$PW_N"
printf '  cliente        %s  /  %s\n' "$EC" "$PW_C"
