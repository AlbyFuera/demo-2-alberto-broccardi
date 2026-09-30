#!/bin/bash
# Collaudo end-to-end. Usa email nuove a ogni esecuzione.
set -u
cd "$(dirname "$0")" && mkdir -p .lavoro && cd .lavoro
rm -f n.txt c.txt c2.txt corpo.json dieta-piano.json dieta-attuale.json
# Contro l'istanza pubblicata: B=https://… scripts/collaudo.sh
B=${B:-http://localhost:8787}
ok=0; ko=0

T=$(date +%s)
EN="rossi+$T@studio.it"
EC="mario+$T@posta.it"
EA="altro+$T@studio.it"

# curl non codifica il + nella query string.
enc() { printf '%s' "$1" | sed 's/+/%2B/g; s/@/%40/g'; }
ENQ=$(enc "$EN")
ECQ=$(enc "$EC")

titolo() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# prova "descrizione" "atteso" — legge la risposta dalla variabile R
prova() {
  if printf '%s' "$R" | grep -q "$2"; then
    printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok+1))
  else
    printf '  \033[31m✗\033[0m %s\n     atteso: %s\n     avuto:  %s\n' \
      "$1" "$2" "$(printf '%s' "$R" | head -c 260)"; ko=$((ko+1))
  fi
}

# assente "descrizione" "non-atteso"
assente() {
  if printf '%s' "$R" | grep -q "$2"; then
    printf '  \033[31m✗\033[0m %s (trovato «%s»)\n' "$1" "$2"; ko=$((ko+1))
  else
    printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok+1))
  fi
}

# post <jar> <percorso> <file-json>
post() { R=$(curl -s -b "$1" -c "$1" -X POST "$B$2" -H 'content-type: application/json' -d "@$3"); }
get()  { R=$(curl -s -b "$1" "$B$2"); }
json() { printf '%s' "$1" > corpo.json; }

titolo "1 · Iscrizione"
json '{"email":"x@y.it","password":"corta","ruolo":"cliente"}'
R=$(curl -s -X POST $B/api/registrati -H 'content-type: application/json' -d @corpo.json)
prova "password troppo corta rifiutata" 'almeno 10'

json '{"email":"x@y.it","password":"unapasswordlunga","ruolo":"amministratore"}'
R=$(curl -s -X POST $B/api/registrati -H 'content-type: application/json' -d @corpo.json)
prova "ruolo inventato rifiutato" 'Scegli se sei'

json '{"email":"nonunaemail","password":"unapasswordlunga","ruolo":"cliente"}'
R=$(curl -s -X POST $B/api/registrati -H 'content-type: application/json' -d @corpo.json)
prova "email non valida rifiutata" 'non valido'

json "{\"email\":\"$EN\",\"password\":\"unapasswordlunga\",\"ruolo\":\"nutrizionista\"}"
R=$(curl -s -c n.txt -X POST $B/api/registrati -H 'content-type: application/json' -d @corpo.json)
prova "nutrizionista iscritto" '"pagina":"/studio"'

json "{\"email\":\"$EC\",\"password\":\"lamiapasswordmia\",\"ruolo\":\"cliente\"}"
R=$(curl -s -c c.txt -X POST $B/api/registrati -H 'content-type: application/json' -d @corpo.json)
prova "cliente iscritto" '"pagina":"/cliente"'

json "{\"email\":\"$EC\",\"password\":\"unaltrapassword\",\"ruolo\":\"cliente\"}"
R=$(curl -s -X POST $B/api/registrati -H 'content-type: application/json' -d @corpo.json)
prova "email già usata rifiutata" 'già un account'

titolo "2 · Ruoli e confini"
get c.txt /api/studio/cruscotto
prova "il cliente non entra nelle API dello studio" 'non è accessibile'
get n.txt /api/cliente/scheda
prova "il professionista non entra in quelle del cliente" 'non è accessibile'
R=$(curl -s $B/api/cliente/scheda)
prova "senza sessione: codice sessione-scaduta" 'sessione-scaduta'
R=$(curl -s -b c.txt -o /dev/null -w '%{redirect_url}' $B/studio)
prova "il cliente su /studio viene rimandato" '/cliente'
R=$(curl -s -b n.txt -o /dev/null -w '%{redirect_url}' $B/cliente)
prova "il professionista su /cliente viene rimandato" '/studio'

titolo "3 · Il cliente appena iscritto non vede niente"
get c.txt /api/cliente/stato
prova "nessun professionista collegato" '"professionista":null'
get c.txt /api/cliente/scheda
prova "la scheda spiega cosa fare" 'Aggiungilo con la sua email'

titolo "4 · Impostazioni del profilo"
json '{"nome":"Dott. Luca Rossi"}'
post n.txt /api/studio/impostazioni corpo.json
prova "il professionista mette il suo nome" '"ok":true'
json '{"nome":"Mario Bianchi","obiettivo":"Perdere 5 kg"}'
post c.txt /api/cliente/impostazioni corpo.json
prova "il cliente mette nome e obiettivo" '"ok":true'
json '{"nome":"X"}'
post c.txt /api/cliente/impostazioni corpo.json
prova "un nome di un carattere è rifiutato" 'almeno due caratteri'

titolo "5 · Collegamento su richiesta"
get c.txt '/api/cliente/cerca-studio?email=nessuno@dove.it'
prova "email sconosciuta: non trovato" '"trovato":false'
get c.txt "/api/cliente/cerca-studio?email=$ECQ"
prova "un cliente non è cercabile come studio" '"trovato":false'
get c.txt "/api/cliente/cerca-studio?email=$ENQ"
prova "studio trovato per email" 'Dott. Luca Rossi'

json "{\"email\":\"$EN\",\"messaggio\":\"Sono Mario\"}"
post c.txt /api/cliente/richiedi corpo.json
prova "richiesta inviata" '"ok":true'
get c.txt /api/cliente/scheda
prova "in attesa: la dieta resta negata" 'in attesa'
get n.txt /api/studio/cruscotto
prova "lo studio vede la richiesta" 'Sono Mario'

LINK=$(printf '%s' "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['richieste'][0]['linkId'])")
json "{\"link\":\"$LINK\",\"accetta\":true}"
post n.txt /api/studio/decidi corpo.json
prova "richiesta accettata" '"accettata":true'
post n.txt /api/studio/decidi corpo.json
prova "accettarla due volte non si può" 'già decisa'
get c.txt /api/cliente/scheda
prova "collegato ma senza dieta: lo dice" 'non ti ha ancora pubblicato'

get n.txt /api/studio/cruscotto
CLI=$(printf '%s' "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['clienti'][0]['id'])")

titolo "6 · Un altro studio non vede questo cliente"
json "{\"email\":\"$EA\",\"password\":\"unapasswordlunga\",\"ruolo\":\"nutrizionista\"}"
curl -s -c c2.txt -X POST $B/api/registrati -H 'content-type: application/json' -d @corpo.json > /dev/null
get c2.txt "/api/studio/cliente?cliente=$CLI"
prova "cliente di un altro studio: negato" 'Non segui questo cliente'

titolo "7 · Scrivere la dieta"
json "{\"cliente\":\"$CLI\",\"titolo\":\"Dieta di luglio\"}"
post n.txt /api/studio/nuova-dieta corpo.json
prova "dieta creata come bozza" '"ok":true'
DIETA=$(printf '%s' "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

json "{\"id\":\"$DIETA\"}"
post n.txt /api/studio/pubblica corpo.json
prova "una dieta vuota non si pubblica" 'è vuota'

python3 - "$DIETA" > dieta.json <<'PY'
import json, sys
pasti = [
  ("Colazione", "08:00", [("fette biscottate", 40, "g"), ("marmellata", 30, "g"),
                          ("latte scremato o parz. scremato", 200, "ml")]),
  ("Spuntino",  "10:30", [("mandorle", 15, "g")]),
  ("Pranzo",    "13:00", [("pasta", 100, "g"), ("petto di pollo", 150, "g"),
                          ("zucchine", None, "g"), ("olio extravergine", 10, "g")]),
  ("Cena",      "20:00", [("riso", 80, "g"), ("merluzzo", 180, "g"),
                          ("insalata mista", None, "g"), ("nduja", 20, "g")]),
]
giorni = [{"indice": i, "allenamento": i in (0, 2, 4), "pasti": [
    {"nome": n, "orario": o, "alimenti": [
        {"nome": a, "quantita": q, "unita": u, "libera": q is None} for a, q, u in al]}
    for n, o, al in pasti]} for i in range(7)]
print(json.dumps({"id": sys.argv[1], "dieta": {
    "titolo": "Dieta di luglio",
    "indicazioni": ["Le quantità si intendono a crudo.", "Almeno 2 litri d'acqua al giorno."],
    "obiettivi": {"kcal": 1900, "proteine": 130, "carboidrati": 190, "grassi": 60, "acqua": 2},
    "giorni": giorni}}))
PY

post n.txt /api/studio/salva-dieta dieta.json
prova "dieta salvata" '"ok":true'
prova "l'alimento sconosciuto viene segnalato" 'nduja'
prova "i valori nutrizionali sono calcolati" '"mediaKcal"'
prova "il totale è dichiarato parziale" '"parziale":true'

titolo "8 · Libreria degli alimenti"
json '{"nome":"sbagliato","proteine":60,"carboidrati":60,"grassi":30}'
post n.txt /api/studio/salva-alimento corpo.json
prova "somma oltre 100 g su 100 g: rifiutata" 'errore in uno dei tre'
json '{"nome":"sbagliato","proteine":600,"carboidrati":0,"grassi":0}'
post n.txt /api/studio/salva-alimento corpo.json
prova "valore fuori scala: rifiutato" 'tra 0 e 100'
json '{"nome":"nduja","proteine":14,"carboidrati":2,"grassi":40}'
post n.txt /api/studio/salva-alimento corpo.json
prova "nduja salvata nella libreria" '"ok":true'

post n.txt /api/studio/salva-dieta dieta.json
prova "ora il conto è completo" '"parziale":false'
prova "niente più da completare" '"daCompletare":\[\]'
get n.txt /api/studio/libreria
prova "l'alimento è nella libreria dello studio" 'nduja'
get c2.txt /api/studio/libreria
assente "e NON nella libreria dell'altro studio" 'nduja'

titolo "9 · Bozza e pubblicazione"
get c.txt /api/cliente/scheda
prova "la bozza il cliente non la vede" 'non ti ha ancora pubblicato'
json "{\"id\":\"$DIETA\"}"
post n.txt /api/studio/pubblica corpo.json
prova "pubblicata" '"ok":true'

get c.txt /api/cliente/scheda
SCHEDA="$R"
prova "il cliente la vede" 'Dieta di luglio'
prova "con il nome del professionista" 'Dott. Luca Rossi'
prova "con i valori calcolati" '"mediaKcal"'
prova "la spesa è aggregata per la settimana" '"ricorrenze"'
prova "le indicazioni ci sono" 'a crudo'
prova "gli obiettivi ci sono" '"kcal":1900'

PASTO=$(printf '%s' "$SCHEDA" | python3 -c "import json,sys; s=json.load(sys.stdin); print([p['id'] for p in s['giorni'][0]['pasti'] if p['nome']=='Pranzo'][0])")

titolo "9b · Lo studio vede in tempo reale i pasti segnati oggi"
# Oggi è escluso dall'aderenza: la scheda deve mostrarlo a parte.
OGGI=$(python3 -c "import datetime; print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'))")
COLAZ=$(printf '%s' "$SCHEDA" | python3 -c "import json,sys,datetime; s=json.load(sys.stdin); i=datetime.datetime.now(datetime.timezone.utc).weekday(); print([p['id'] for g in s['giorni'] if g['indice']==i for p in g['pasti'] if p['nome']=='Colazione'][0])")
get n.txt "/api/studio/cliente?cliente=$CLI"
prova "prima di segnare: oggi 0 fatti" '"oggi":{[^}]*"pastiFatti":0'
json "{\"giorno\":\"$OGGI\",\"pasto\":\"$COLAZ\",\"stato\":\"fatto\"}"
post c.txt /api/cliente/spunta corpo.json
prova "il cliente segna la colazione" '"stato":"fatto"'
get n.txt "/api/studio/cliente?cliente=$CLI"
prova "lo studio vede subito il pasto fatto" '"oggi":{[^}]*"pastiFatti":1'
prova "e quale pasto" "\"fatti\":\[\"$COLAZ\"\]"
get n.txt /api/studio/cruscotto
prova "anche nella lista clienti" '"oggi":{[^}]*"pastiFatti":1'
# Si toglie la spunta, per non falsare i controlli successivi.
json "{\"giorno\":\"$OGGI\",\"pasto\":\"$COLAZ\",\"stato\":null}"
post c.txt /api/cliente/spunta corpo.json
prova "la spunta si toglie" '"stato":null'

titolo "9c · Passi"
json '{"passi":""}'
post c.txt /api/cliente/passi corpo.json
prova "passi vuoti: rifiutati, non salvati come 0" 'non è valido'
json '{}'
post c.txt /api/cliente/passi corpo.json
prova "passi mancanti: rifiutati" 'non è valido'
json '{"passi":6500}'
post c.txt /api/cliente/passi corpo.json
prova "passi veri: salvati" '"passi":6500'

titolo "10 · Sostituzione per equivalenza"
get c.txt "/api/cliente/alternative?giorno=0&pasto=$PASTO&indice=1"
prova "proposte per il pollo" '"proposte"'
prova "il merluzzo è tra le proposte" 'merluzzo'
assente "nessuna proposta a pezzo" '"unita":"pz"'

json "{\"giorno\":0,\"pasto\":\"$PASTO\",\"indice\":1,\"alimento\":\"tonno al naturale\"}"
post c.txt /api/cliente/verifica corpo.json
prova "equivalenza calcolata" '"esito":"calcolata"'
prova "pareggiata sulle proteine" '"base":"proteine"'

json "{\"giorno\":0,\"pasto\":\"$PASTO\",\"indice\":1,\"alimento\":\"pizza margherita\"}"
post c.txt /api/cliente/verifica corpo.json
prova "alimento sconosciuto: non ne inventa i valori" '"esito":"sconosciuta"'
# Il cliente deve sempre ricevere una risposta.
json '{"domanda":"posso mangiare una pizza margherita al posto del pollo?"}'
post c.txt /api/cliente/chat corpo.json
prova "l'assistente risponde comunque" '"risposta"'
if printf '%s' "$R" | python3 -c "import json,sys; r=json.load(sys.stdin); sys.exit(0 if len(r.get('risposta') or '') > 20 else 1)"; then
  printf '  \033[32m✓\033[0m e la risposta non è mai vuota\n'; ok=$((ok+1))
else
  printf '  \033[31m✗\033[0m risposta vuota\n'; ko=$((ko+1))
fi

json "{\"giorno\":0,\"pasto\":\"$PASTO\",\"indice\":1,\"alimento\":\"tonno al naturale\"}"
post c.txt /api/cliente/applica corpo.json
prova "sostituzione applicata" '"ok":true'
prova "il giorno torna ricalcolato" '"kcal"'

get c.txt /api/cliente/scheda
prova "il cliente vede il piatto cambiato" 'tonno al naturale'
prova "e da cosa era stato cambiato" 'cambiatoDa'
get n.txt /api/studio/cruscotto
prova "lo studio riceve la notifica" 'petto di pollo'
prova "con la base del pareggio" '"base":"proteine"'

titolo "11 · La dieta del professionista non viene toccata"
get n.txt "/api/studio/dieta?dieta=$DIETA"
prova "nell'editor c'è ancora il pollo" 'petto di pollo'
assente "e non il tonno" 'tonno al naturale'

titolo "12 · Pasto saltato"
json "{\"giorno\":0,\"pasti\":[\"$PASTO\"]}"
post c.txt /api/cliente/saltato corpo.json
prova "dice quanto resterebbe scoperto" '"scoperto"'
prova "elenca i pasti rimanenti" '"rimanenti"'

titolo "13 · Il veto del professionista"
get n.txt /api/studio/cruscotto
VAR=$(printf '%s' "$R" | python3 -c "import json,sys; print([v['id'] for v in json.load(sys.stdin)['variazioni'] if v['stato']!='annullata'][0])")
json "{\"id\":\"$VAR\",\"nota\":\"Preferisco il pollo il lunedì.\"}"
post n.txt /api/studio/annulla-variazione corpo.json
prova "variazione annullata" '"ok":true'
get c.txt /api/cliente/scheda
prova "il piatto torna quello prescritto" 'petto di pollo'
prova "e il cliente legge il perché" 'Preferisco il pollo'
assente "il tonno non è più nel piatto" '"nome":"tonno al naturale"'

titolo "14 · Risposta a una domanda"
get n.txt /api/studio/cruscotto
DOM=$(printf '%s' "$R" | python3 -c "import json,sys; d=[q for q in json.load(sys.stdin)['domande'] if q['stato']=='aperta']; print(d[0]['id'] if d else '')")
json "{\"id\":\"$DOM\",\"risposta\":\"Una volta al mese va bene.\"}"
post n.txt /api/studio/rispondi corpo.json
prova "risposta inviata" '"ok":true'
get c.txt /api/cliente/scheda
prova "il cliente la vede" 'Una volta al mese'

titolo "15 · Ritiro e scollegamento"
json "{\"id\":\"$DIETA\"}"
post n.txt /api/studio/ritira corpo.json
prova "dieta ritirata" '"ok":true'
# D1 remoto può restituire una lettura vecchia: si riprova.
for i in 1 2 3 4 5; do
  get c.txt /api/cliente/scheda
  printf '%s' "$R" | grep -q 'non ti ha ancora pubblicato' && break
  sleep 1
done
prova "il cliente non la vede più" 'non ti ha ancora pubblicato'
json "{\"id\":\"$DIETA\"}"
post n.txt /api/studio/pubblica corpo.json
prova "ripubblicata" '"ok":true'

titolo "16 · Piano a sostituzione"
get n.txt "/api/studio/dieta?dieta=$DIETA"
# Da file: lo stdin di python è occupato dallo heredoc.
printf '%s' "$R" > dieta-attuale.json
python3 - "$DIETA" > dieta-piano.json <<'PY'
import json, sys
d = json.load(open('dieta-attuale.json'))['dieta']
# Regola di pareggio della dieta.
d['base'] = 'kcal'
for g in d['giorni']:
    for p in g['pasti']:
        if p['nome'] != 'Pranzo':
            continue
        for a in p['alimenti']:
            if 'pollo' in a['nome']:
                a['gruppo'] = 'fonte proteica'
                # Eccezione: si pareggia sulle proteine.
                a['base'] = 'proteine'
                a['alternative'] = [
                    {'nome': 'merluzzo'},
                    {'nome': 'tacchino'},
                    {'nome': 'uova', 'quantita': 2, 'unita': 'pz'},
                ]
            if a['nome'] == 'pasta':
                # Nessuna base propria: eredita quella della dieta.
                a['gruppo'] = 'fonte di carboidrati'
                a['alternative'] = [{'nome': 'riso'}, {'nome': 'patate'}]
print(json.dumps({'id': sys.argv[1], 'dieta': d}))
PY
post n.txt /api/studio/salva-dieta dieta-piano.json
prova "dieta con le sostituzioni salvata" '"ok":true'
prova "le alternative restano scritte nella dieta" '"alternative"'
prova "con la base scelta dal professionista" '"base":"proteine"'
prova "la regola di tutta la dieta resta scritta" '"base":"kcal"'

get c.txt /api/cliente/scheda
SCHEDA="$R"
prova "il cliente vede che quel posto ha delle scelte" '"piano"'
prova "e come si chiama quel posto" 'fonte proteica'
PASTO=$(printf '%s' "$SCHEDA" | python3 -c "import json,sys; s=json.load(sys.stdin); print([p['id'] for p in s['giorni'][0]['pasti'] if p['nome']=='Pranzo'][0])")

get c.txt "/api/cliente/alternative?giorno=0&pasto=$PASTO&indice=1"
prova "le alternative previste arrivano al cliente" '"opzioni"'
prova "il merluzzo è fra quelle ammesse" 'merluzzo'
prova "l'elenco non è libero: c'è un piano" '"libero":false'
prova "le porzioni sono isoproteiche" '"nomeBase":"isoproteica"'
prova "la porzione scritta a mano resta quella" '"fissata":true'

prova "l'eccezione dell'alimento è dichiarata come tale" '"regola":"alimento"'

# Senza base propria vale quella della dieta.
get c.txt "/api/cliente/alternative?giorno=0&pasto=$PASTO&indice=0"
prova "l'alimento senza eccezione segue la regola della dieta" '"nomeBase":"isocalorica"'
prova "e si sa da dove viene quella regola" '"regola":"dieta"'

# Il parametro base del cliente viene ignorato.
UNO=$(curl -s -b c.txt "$B/api/cliente/alternative?giorno=0&pasto=$PASTO&indice=0&base=proteine" | python3 -c "import json,sys; o=json.load(sys.stdin)['piano']['opzioni']; print([x['quantita'] for x in o if x['nome']=='riso'][0])")
DUE=$(curl -s -b c.txt "$B/api/cliente/alternative?giorno=0&pasto=$PASTO&indice=0&base=kcal" | python3 -c "import json,sys; o=json.load(sys.stdin)['piano']['opzioni']; print([x['quantita'] for x in o if x['nome']=='riso'][0])")
if [ "$UNO" = "$DUE" ]; then
  printf '  \033[32m✓\033[0m la base chiesta dal cliente non cambia la porzione (%s g in entrambi i casi)\n' "$UNO"; ok=$((ok+1))
else
  printf '  \033[31m✗\033[0m il cliente ha cambiato la porzione chiedendo un'\''altra base (%s vs %s)\n' "$UNO" "$DUE"; ko=$((ko+1))
fi

# 205 g: porzione isoproteica di merluzzo.
json "{\"giorno\":0,\"pasto\":\"$PASTO\",\"indice\":1,\"alimento\":\"merluzzo\",\"base\":\"kcal\"}"
post c.txt /api/cliente/applica corpo.json
prova "il cliente non può cambiare la regola di pareggio" '"quantita":"205g"'

titolo "17 · Dentro e fuori dal piano"
json "{\"giorno\":0,\"pasto\":\"$PASTO\",\"indice\":1,\"alimento\":\"merluzzo\"}"
post c.txt /api/cliente/verifica corpo.json
prova "una sostituzione ammessa è riconosciuta" '"nelPiano":true'
prova "e al cliente si dice che non gli costa niente" 'aderenza non cambia'

json "{\"giorno\":0,\"pasto\":\"$PASTO\",\"indice\":1,\"alimento\":\"salmone\"}"
post c.txt /api/cliente/verifica corpo.json
prova "una fuori dall'elenco è una deviazione" '"nelPiano":false'
prova "e glielo si dice prima che scelga" 'conterà a metà'

json "{\"giorno\":0,\"pasto\":\"$PASTO\",\"indice\":1,\"alimento\":\"merluzzo\"}"
post c.txt /api/cliente/applica corpo.json
prova "la scelta dentro il piano si applica" '"nelPiano":true'
get n.txt /api/studio/cruscotto
prova "e lo studio la riceve marcata come prevista" '"nelPiano":true'
get c.txt /api/cliente/dashboard
prova "l'aderenza dichiara i pasti con sostituzioni ammesse" 'pastiConSostituzioniAmmesse'

json "{\"giorno\":0,\"pasto\":\"$PASTO\",\"indice\":1,\"alimento\":\"uova\"}"
post c.txt /api/cliente/applica corpo.json
prova "le due uova restano due uova" '"quantita":"2 pz"'
prova "e si dichiara che la porzione l'ha scritta lui" '"fissataDalProfessionista":true'
get n.txt /api/studio/cruscotto
prova "lo studio vede la porzione scritta da lui, non un calcolo" '"aQuantita":"2 pz"'

titolo "18 · Automazione dei messaggi"
json "{\"cliente\":\"$CLI\",\"attiva\":false}"
post n.txt /api/studio/automazione corpo.json
prova "il professionista spegne le risposte automatiche" '"automazione":false'

json '{"domanda":"Dottore, posso saltare la cena stasera?"}'
post c.txt /api/cliente/chat corpo.json
prova "l'assistente non risponde più al posto suo" '"automazione":false'
prova "e il cliente sa a chi è arrivato" 'di persona'

get c.txt /api/cliente/messaggi
prova "il messaggio del cliente resta nel filo" 'saltare la cena'
prova "e il filo dice chi risponde" '"automazione":false'

get n.txt "/api/studio/conversazione?cliente=$CLI"
prova "lo studio legge quello che gli ha scritto" 'saltare la cena'

json "{\"cliente\":\"$CLI\",\"testo\":\"Meglio di no: fai la cena leggera che ti ho scritto.\"}"
post n.txt /api/studio/scrivi corpo.json
prova "il professionista risponde di persona" '"ok":true'
get c.txt /api/cliente/messaggi
prova "il cliente riceve la sua risposta" 'cena leggera'
prova "attribuita a lui e non all'assistente" '"autore":"studio"'

json "{\"cliente\":\"$CLI\",\"attiva\":true}"
post n.txt /api/studio/automazione corpo.json
prova "le risposte automatiche si riaccendono" '"automazione":true'
json '{"domanda":"cosa mangio adesso?"}'
post c.txt /api/cliente/chat corpo.json
prova "e l'assistente torna a rispondere" '"automazione":true'

titolo "19 · Password"
json '{"attuale":"sbagliata","nuova":"unanuovapassword"}'
post c.txt /api/cambia-password corpo.json
prova "password attuale sbagliata: lo dice" 'non è corretta'
assente "e NON butta fuori l'utente" 'sessione-scaduta'
json '{"attuale":"lamiapasswordmia","nuova":"lamiapasswordmia"}'
post c.txt /api/cambia-password corpo.json
prova "la stessa password è rifiutata" 'identica'
json '{"attuale":"lamiapasswordmia","nuova":"unanuovapassword"}'
post c.txt /api/cambia-password corpo.json
prova "password cambiata" '"ok":true'
json "{\"email\":\"$EC\",\"password\":\"lamiapasswordmia\"}"
R=$(curl -s -X POST $B/api/accedi -H 'content-type: application/json' -d @corpo.json)
prova "la vecchia non funziona più" 'non corretti'
json "{\"email\":\"$EC\",\"password\":\"unanuovapassword\"}"
R=$(curl -s -X POST $B/api/accedi -H 'content-type: application/json' -d @corpo.json)
prova "la nuova sì" '"pagina":"/cliente"'

titolo "20 · Limitazione dei tentativi"
# Email nuova, per non consumare i tentativi degli account sopra.
EV="vittima+$T@posta.it"
json "{\"email\":\"$EV\",\"password\":\"unapasswordlunga\",\"ruolo\":\"cliente\"}"
curl -s -X POST $B/api/registrati -H 'content-type: application/json' -d @corpo.json > /dev/null
json "{\"email\":\"$EV\",\"password\":\"sbagliatissima\"}"
bloccato=no
for i in $(seq 1 12); do
  R=$(curl -s -X POST $B/api/accedi -H 'content-type: application/json' -d @corpo.json)
  if printf '%s' "$R" | grep -q 'Troppi tentativi'; then bloccato=$i; break; fi
done
if [ "$bloccato" != "no" ] && [ "$bloccato" -ge 8 ] && [ "$bloccato" -le 10 ]; then
  printf '  \033[32m✓\033[0m il limite scatta al tentativo %s\n' "$bloccato"; ok=$((ok+1))
else
  printf '  \033[31m✗\033[0m il limite non è scattato dove atteso (%s)\n' "$bloccato"; ko=$((ko+1))
fi
prova "dice quanto aspettare" 'Riprova tra'
assente "e NON rivela se l'email esiste" 'non esiste'
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/accedi -H 'content-type: application/json' -d @corpo.json)
prova "risponde 429, non 401" '429'

titolo "21 · Sicurezza delle risposte"
R=$(curl -s -D - -o /dev/null $B/ | tr 'A-Z' 'a-z')
prova "content-security-policy presente" 'content-security-policy'
prova "nosniff presente" 'nosniff'
R=$(curl -s -D - -o /dev/null -b n.txt $B/api/chi-sono | tr 'A-Z' 'a-z')
prova "i dati non si mettono in cache" 'no-store'
get n.txt /api/studio/inventato
prova "endpoint inesistente: errore pulito" 'Endpoint sconosciuto'
R=$(curl -s -X DELETE -b n.txt $B/api/studio/cruscotto)
prova "metodo non ammesso" 'non ammesso'
R=$(curl -s -b n.txt -X POST $B/api/studio/salva-dieta -H 'content-type: application/json' -d 'non-json')
prova "corpo non valido: errore pulito" 'non valido'

printf '\n\033[1mRisultato: %d passati, %d falliti\033[0m\n' "$ok" "$ko"
[ "$ko" -eq 0 ]
