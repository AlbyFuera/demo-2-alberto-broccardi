#!/usr/bin/env python3
"""Dati mock per la demo in locale: crea i quattro account se mancano, collega
clienti e nutrizionisti, scrive e pubblica una dieta per coppia, riempie una
settimana di pasti e passi.

Entra con /api/demo/entra, quindi serve ACCOUNT_DEMO in .dev.vars e il server
avviato con `npx wrangler dev --local --port 8787`. Va lanciato una volta sola.
"""
import datetime
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request

B = os.environ.get('B', 'http://localhost:8787')
if not B.startswith(('http://localhost', 'http://127.0.0.1')):
    sys.exit('Solo in locale.')

# Stesso giorno del server (UTC).
OGGI = datetime.datetime.now(datetime.timezone.utc).date()


class Sessione:
    """Un browser con i suoi cookie, entrato come un account demo."""

    def __init__(self, email):
        self.email = email
        self.apri = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.post('/api/demo/entra', {'email': email})

    def _chiama(self, req):
        try:
            with self.apri.open(req) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            corpo = json.load(e)
            raise SystemExit(f'✗ {self.email} {req.full_url}: {corpo.get("errore", corpo)}')

    def post(self, percorso, corpo):
        return self._chiama(urllib.request.Request(
            B + percorso, data=json.dumps(corpo).encode(), method='POST',
            headers={'content-type': 'application/json'}))

    def get(self, percorso):
        return self._chiama(urllib.request.Request(B + percorso))


# Account di esempio, solo per il database locale. Vanno anche in ACCOUNT_DEMO.
ACCOUNT = [
    ('anna.nutrizionista@gmail.com', 'nutrizionista', 'nutrizionista'),
    ('andrea.nutrizionista@gmail.com', 'nutrizionista', 'nutrizionista'),
    ('luca.cliente@gmail.com', 'cliente123', 'cliente'),
    ('luisa.cliente@gmail.com', 'cliente123', 'cliente'),
]


def crea_account():
    for email, password, ruolo in ACCOUNT:
        req = urllib.request.Request(
            B + '/api/registrati', method='POST', headers={'content-type': 'application/json'},
            data=json.dumps({'email': email, 'password': password, 'ruolo': ruolo}).encode())
        try:
            urllib.request.urlopen(req).close()
            print(f'· creato {email}')
        except urllib.error.HTTPError as e:
            if 'già un account' not in json.load(e).get('errore', ''):
                raise


def voce(nome, quantita, unita='g', alternative=None):
    v = {'nome': nome, 'quantita': quantita, 'unita': unita, 'libera': quantita is None}
    if alternative:
        gruppo, base, opzioni = alternative
        v.update(gruppo=gruppo, base=base, alternative=[{'nome': o} for o in opzioni])
    return v


CARBO = ('fonte di carboidrati', 'carboidrati', ['riso', 'farro', 'pane integrale'])
PROTEINE = ('fonte proteica', 'proteine', ['petto di tacchino', 'merluzzo', 'tonno al naturale'])

# Anna → Luca: dimagrimento, due schemi alternati (servono al cambio pasto).
DIETA_LUCA = {
    'titolo': 'Piano dimagrimento — ottobre',
    'indicazioni': [
        'Le quantità si intendono a crudo e a peso netto.',
        'Almeno 2 litri d’acqua al giorno.',
        'Verdura a volontà a pranzo e a cena.',
        'Un pasto libero a settimana, il sabato sera.',
    ],
    'obiettivi': {'kcal': 1900, 'proteine': 140, 'carboidrati': 200, 'grassi': 60,
                  'acqua': 2, 'passi': 10000},
    'schemi': [
        [
            ('Colazione', '07:30', [voce('avena in fiocchi', 50), voce('latte scremato o parz. scremato', 200, 'ml'),
                                    voce('frutta fresca', 150)]),
            ('Spuntino', '10:30', [voce('frutta secca', 20)]),
            ('Pranzo', '13:00', [voce('pasta', 90, alternative=CARBO), voce('petto di pollo', 150, alternative=PROTEINE),
                                 voce('zucchine', None), voce('olio extravergine', 10)]),
            ('Merenda', '17:00', [voce('yogurt', 170)]),
            ('Cena', '20:00', [voce('merluzzo', 220), voce('patate', 250),
                               voce('insalata mista', None), voce('olio extravergine', 10)]),
        ],
        [
            ('Colazione', '07:30', [voce('pane integrale', 60), voce('prosciutto crudo', 40),
                                    voce('frutta fresca', 150)]),
            ('Spuntino', '10:30', [voce('gallette di riso', 30)]),
            ('Pranzo', '13:00', [voce('riso', 80), voce('tonno al naturale', 160),
                                 voce('broccoli', None), voce('olio extravergine', 10)]),
            ('Merenda', '17:00', [voce('fiocchi di latte', 150)]),
            ('Cena', '20:00', [voce('petto di tacchino', 180), voce('pane integrale', 60),
                               voce('spinaci', None), voce('olio extravergine', 10)]),
        ],
    ],
}

# Andrea → Luisa: mantenimento per sportiva, quattro pasti.
DIETA_LUISA = {
    'titolo': 'Mantenimento sportiva — autunno',
    'indicazioni': [
        'Le quantità si intendono a crudo.',
        'Nei giorni di allenamento aggiungi una banana prima della sessione.',
        'Almeno 2,5 litri d’acqua al giorno.',
    ],
    'obiettivi': {'kcal': 1700, 'proteine': 110, 'carboidrati': 200, 'grassi': 55,
                  'acqua': 2.5, 'passi': 8000},
    'schemi': [
        [
            ('Colazione', '08:00', [voce('yogurt', 150), voce('avena in fiocchi', 40), voce('frutta fresca', 120)]),
            ('Pranzo', '13:00', [voce('riso', 80, alternative=CARBO), voce('salmone', 150),
                                 voce('zucchine', None), voce('olio extravergine', 10)]),
            ('Merenda', '16:30', [voce('pane integrale', 40), voce('mozzarella light', 60)]),
            ('Cena', '20:00', [voce('lenticchie cotte', 200), voce('pane integrale', 50),
                               voce('insalata mista', None), voce('olio extravergine', 10)]),
        ],
        [
            ('Colazione', '08:00', [voce('fette biscottate', 40), voce('marmellata', 25),
                                    voce('latte scremato o parz. scremato', 200, 'ml')]),
            ('Pranzo', '13:00', [voce('pasta', 80, alternative=CARBO), voce('ceci cotti', 150),
                                 voce('pomodori', None), voce('olio extravergine', 10)]),
            ('Merenda', '16:30', [voce('frutta secca', 20), voce('frutta fresca', 150)]),
            ('Cena', '20:00', [voce('orata', 200), voce('patate', 200),
                               voce('spinaci', None), voce('olio extravergine', 10)]),
        ],
    ],
}

COPPIE = [
    {
        'studio': 'anna.nutrizionista@gmail.com', 'nome_studio': 'Dott.ssa Anna',
        'cliente': 'luca.cliente@gmail.com', 'nome_cliente': 'Luca',
        'obiettivo': 'Perdere 8 kg entro l’estate', 'dieta': DIETA_LUCA,
        'messaggio': 'Buongiorno dottoressa, sono Luca. Ci siamo visti lunedì in studio.',
        # Cliente costante: quasi tutto fatto.
        'saltati': {3: ['Merenda']}, 'senza_dati': [], 'oggi': 2,
        'passi': [10400, 11200, 9100, 12050, 10800, 9600, 4300],
        'sostituzione': ('Pranzo', 1, 'tonno al naturale'),
        'domanda': 'Posso mangiare una pizza sabato sera al posto della cena?',
    },
    {
        'studio': 'andrea.nutrizionista@gmail.com', 'nome_studio': 'Dott. Andrea',
        'cliente': 'luisa.cliente@gmail.com', 'nome_cliente': 'Luisa',
        'obiettivo': 'Più energia negli allenamenti', 'dieta': DIETA_LUISA,
        'messaggio': 'Ciao Andrea, sono Luisa, mi ha dato il tuo contatto la palestra.',
        # Cliente discontinua: giorni saltati e giorni senza segnare nulla.
        'saltati': {5: ['Merenda', 'Cena'], 2: ['Pranzo']}, 'senza_dati': [4, 1], 'oggi': 1,
        'passi': [7200, 5100, None, 8800, 6300, None, 2100],
        'sostituzione': None,
        'domanda': 'Posso prendere la creatina nei giorni di allenamento?',
    },
]


def prepara(c):
    print(f'\n· {c["nome_studio"]} → {c["nome_cliente"]}')
    studio, cliente = Sessione(c['studio']), Sessione(c['cliente'])

    studio.post('/api/studio/impostazioni', {'nome': c['nome_studio']})
    cliente.post('/api/cliente/impostazioni', {'nome': c['nome_cliente'], 'obiettivo': c['obiettivo']})

    # Collegamento: il cliente chiede, lo studio accetta. Se c'è già, si tiene.
    suo = cliente.get('/api/cliente/stato')['professionista']
    if suo and suo['email'] != c['studio']:
        raise SystemExit(f'✗ {c["cliente"]} è già seguito da {suo["email"]}: scollegalo prima.')
    if not suo:
        cliente.post('/api/cliente/richiedi', {'email': c['studio'], 'messaggio': c['messaggio']})
    richiesta = next((r for r in studio.get('/api/studio/cruscotto')['richieste'] if r['email'] == c['cliente']), None)
    if richiesta:
        studio.post('/api/studio/decidi', {'link': richiesta['linkId'], 'accetta': True})
    scheda = next(x for x in studio.get('/api/studio/cruscotto')['clienti'] if x['email'] == c['cliente'])
    cli = scheda['id']
    print('  collegati' if not suo else '  già collegati')

    if scheda['dieta']:
        print(f'  ha già una dieta («{scheda["dieta"]["titolo"]}»): la lascio com\'è e non aggiungo dati.')
        return

    # Dieta: sette giorni, schemi alternati, allenamento lun/mer/ven.
    d = c['dieta']
    dieta_id = studio.post('/api/studio/nuova-dieta', {'cliente': cli, 'titolo': d['titolo']})['id']
    giorni = [{'indice': i, 'allenamento': i in (0, 2, 4),
               'pasti': [{'nome': n, 'orario': o, 'alimenti': al}
                         for n, o, al in d['schemi'][i % 2]]}
              for i in range(7)]
    esito = studio.post('/api/studio/salva-dieta', {'id': dieta_id, 'dieta': {
        'titolo': d['titolo'], 'indicazioni': d['indicazioni'],
        'obiettivi': d['obiettivi'], 'giorni': giorni}})
    if esito.get('daCompletare'):
        print(f'  ! alimenti senza valori in libreria: {", ".join(esito["daCompletare"])}')
    studio.post('/api/studio/pubblica', {'id': dieta_id})
    print(f'  dieta «{d["titolo"]}» pubblicata, {esito.get("mediaKcal")} kcal/giorno')

    # Una settimana all'indietro: pasti segnati e passi.
    pasti = {g['indice']: g['pasti'] for g in studio.get(f'/api/studio/dieta?dieta={dieta_id}')['dieta']['giorni']}
    for indietro in range(6, -1, -1):
        data = OGGI - datetime.timedelta(days=indietro)
        del_giorno = pasti.get(data.weekday(), [])
        riga = f'  {data} '
        if indietro in c['senza_dati']:
            print(riga + 'nessun dato')
            continue
        if indietro == 0:
            del_giorno = del_giorno[:c['oggi']]
        saltati = c['saltati'].get(indietro, [])
        for p in del_giorno:
            stato = 'saltato' if p['nome'] in saltati else 'fatto'
            cliente.post('/api/cliente/spunta', {'giorno': data.isoformat(), 'pasto': p['id'], 'stato': stato})
        passi = c['passi'][6 - indietro]
        if passi is not None:
            cliente.post('/api/cliente/passi', {'giorno': data.isoformat(), 'passi': passi})
        print(riga + f'{len(del_giorno) - len(saltati)} fatti, {len(saltati)} saltati, {passi or "—"} passi')

    # Una sostituzione di oggi, così lo studio ha una variazione da guardare.
    if c['sostituzione']:
        nome, indice, alimento = c['sostituzione']
        oggi = cliente.get('/api/cliente/dashboard')['oggi']
        pasto = next(p for p in oggi['pasti'] if p['nome'] == nome)
        cliente.post('/api/cliente/applica', {'giorno': oggi['indice'], 'pasto': pasto['id'],
                                              'indice': indice, 'alimento': alimento})
        print(f'  sostituzione: {alimento} a {nome.lower()}')

    risposta = cliente.post('/api/cliente/chat', {'domanda': c['domanda']})
    print(f'  domanda all’assistente: «{c["domanda"]}»')
    print(f'    → {(risposta.get("risposta") or "")[:140]}')


crea_account()
for coppia in COPPIE:
    prepara(coppia)
print('\nFatto. Apri http://localhost:8787 e scegli un account.')
