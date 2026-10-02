#!/usr/bin/env python3
"""Dati mock per la demo in locale: crea i quattro account se mancano, collega
clienti e nutrizionisti, scrive e pubblica una dieta per coppia, riempie una
settimana di pasti e passi, la scheda clinica, le pesate, una nota e l'acqua.

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
                  'acqua': 2, 'passi': 10000, 'pastiLiberi': 1},
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
        'cartella': {'nascita': '1990-04-12', 'sesso': 'M', 'altezza': 178, 'allergie': 'frutta a guscio',
                     'preferenze': 'Lavora in ufficio, palestra lunedì, mercoledì e venerdì.',
                     'giorni_visita': 4},
        # Una pesata a settimana, dalla più vecchia.
        'pesi': [84.2, 83.6, 82.9, 82.4], 'vita': 92,
        'nota': 'Prima visita: motivato, vuole arrivare a 76 kg. Cena spesso tardi per lavoro.',
        'acqua': 1250,
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
        'cartella': {'nascita': '1996-09-03', 'sesso': 'F', 'altezza': 166, 'allergie': 'lattosio',
                     'preferenze': 'Corsa 4 volte a settimana, vegetariana nei giorni feriali.',
                     'giorni_visita': 12},
        'pesi': [58.4, 58.6, 58.1, 58.3], 'vita': 68,
        'nota': 'Calo di energia nelle sessioni lunghe: rivedere i carboidrati pre-allenamento.',
        'acqua': 750,
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
    print(f'  dieta «{d["titolo"]}» pubblicata, {esito["conti"]["mediaKcal"]} kcal/giorno')

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

    # Scheda clinica, pesate settimanali, una nota di visita, l'acqua di oggi.
    cartella = dict(c['cartella'])
    visita = OGGI + datetime.timedelta(days=cartella.pop('giorni_visita'))
    studio.post('/api/studio/cartella', {'cliente': cli, **cartella,
                                         'prossimaVisita': f'{visita.isoformat()}T17:30'})
    for settimane, kg in enumerate(reversed(c['pesi'])):
        giorno = OGGI - datetime.timedelta(days=7 * (settimane + 1))
        studio.post('/api/studio/misura', {'cliente': cli, 'giorno': giorno.isoformat(),
                                           'peso': kg, 'vita': c['vita']})
    studio.post('/api/studio/nota', {'cliente': cli, 'testo': c['nota']})
    cliente.post('/api/cliente/acqua', {'ml': c['acqua']})
    print(f'  scheda clinica, {len(c["pesi"])} pesate, una nota, visita il {visita}')

    risposta = cliente.post('/api/cliente/chat', {'domanda': c['domanda']})
    print(f'  domanda all’assistente: «{c["domanda"]}»')
    print(f'    → {(risposta.get("risposta") or "")[:140]}')


class SessioneConPassword(Sessione):
    """Un cliente in più, fuori dalla pagina di scelta: si iscrive o entra con la password."""

    def __init__(self, email, password='cliente123'):
        self.email = email
        self.apri = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        try:
            self.post_grezzo('/api/registrati', {'email': email, 'password': password, 'ruolo': 'cliente'})
        except urllib.error.HTTPError:
            self.post('/api/accedi', {'email': email, 'password': password})

    def post_grezzo(self, percorso, corpo):
        req = urllib.request.Request(B + percorso, data=json.dumps(corpo).encode(), method='POST',
                                     headers={'content-type': 'application/json'})
        with self.apri.open(req) as r:
            return json.load(r)


def con_titolo(dieta, titolo, obiettivi=None):
    return {**dieta, 'titolo': titolo, 'obiettivi': {**dieta['obiettivi'], **(obiettivi or {})}}


# Altri clienti di Anna, ognuno in una situazione diversa. Le email sono quelle
# che hanno una foto di esempio in web/demo-foto.js. Password: cliente123.
ALTRI_DI_ANNA = [
    {'email': 'giulia.damico@gmail.com', 'nome': 'Giulia D\'Amico', 'obiettivo': 'Tornare al peso di prima della gravidanza',
     'dieta': con_titolo(DIETA_LUCA, 'Piano graduale — ottobre', {'kcal': 1600}), 'pubblica': True,
     # Quota di pasti fatti per giorno, da 6 giorni fa a ieri.
     'costanza': [1, 1, 1, 1, 1, 1], 'passi': [9800, 10200, 8700, 11000, 9400, 10100],
     'cartella': {'nascita': '1989-02-21', 'sesso': 'F', 'altezza': 164, 'allergie': ''}, 'visita': (1, '10:00'),
     'pesi': [71.8, 70.9, 70.1, 69.6], 'acqua': 1750, 'nota': 'Molto costante. Valutare un aumento delle kcal a novembre.'},
    {'email': 'marco.catalano@gmail.com', 'nome': 'Marco Catalano', 'obiettivo': 'Perdere la pancia',
     'dieta': con_titolo(DIETA_LUCA, 'Rientro — settembre', {'kcal': 2000}), 'pubblica': True,
     'costanza': [0.6, 0.4, 0.2, None, None, None], 'passi': [5200, 3100, None, None, None, None],
     'cartella': {'nascita': '1982-07-30', 'sesso': 'M', 'altezza': 181, 'allergie': ''}, 'visita': None,
     'pesi': [96.2, 96.5, 96.0, 96.8], 'acqua': 0, 'automazione': False,
     'messaggio': 'Questa settimana è dura, con i turni al lavoro salto quasi sempre la cena. Possiamo sentirci?',
     'nota': 'Turni serali: la cena va spostata o resa più semplice.'},
    {'email': 'gaia.carta@gmail.com', 'nome': 'Gaia Carta', 'obiettivo': 'Mangiare meglio senza latticini',
     'dieta': con_titolo(DIETA_LUISA, 'Prima proposta — da rivedere'), 'pubblica': False,
     'costanza': [], 'passi': [],
     'cartella': {'nascita': '1998-11-05', 'sesso': 'F', 'altezza': 170, 'allergie': 'lattosio'}, 'visita': (3, '18:00'),
     'pesi': [61.5], 'acqua': 0, 'nota': 'Intollerante al lattosio: togliere yogurt e latte dalla bozza.'},
    {'email': 'ale.berti@email.it', 'nome': 'Alessandro Berti', 'obiettivo': 'Massa muscolare',
     'dieta': None, 'costanza': [], 'passi': [],
     'cartella': None, 'visita': (6, '09:30'), 'pesi': [], 'acqua': 0, 'nota': None},
    {'email': 'francesco.neri@email.it', 'nome': 'Francesco Neri', 'obiettivo': 'Correre la mezza maratona a marzo',
     'dieta': con_titolo(DIETA_LUISA, 'Preparazione mezza maratona', {'kcal': 2300}), 'pubblica': True,
     'costanza': [1, 0.8, 1, 0.8, 1, 0.6], 'passi': [14200, 12800, 15100, 9900, 16300, 13700],
     'cartella': {'nascita': '1991-05-14', 'sesso': 'M', 'altezza': 176, 'allergie': 'frutta a guscio'}, 'visita': (12, '17:00'),
     'pesi': [72.4, 72.1, 72.3, 71.9], 'acqua': 2250, 'sostituzione': ('Pranzo', 1, 'petto di pollo'),
     'nota': 'Aumentare i carboidrati nei giorni di lungo.'},
]

# Chi ha chiesto ad Anna di seguirlo e aspetta la risposta.
IN_ATTESA_DI_ANNA = [('giulio.rossi@posta.it', 'Giulio Rossi',
                      'Buongiorno, mi ha consigliato lei un amico. Vorrei iniziare a ottobre.')]


def prepara_altri():
    print('\n· Altri clienti di Anna')
    anna = Sessione('anna.nutrizionista@gmail.com')

    for c in ALTRI_DI_ANNA:
        cliente = SessioneConPassword(c['email'])
        cliente.post('/api/cliente/impostazioni', {'nome': c['nome'], 'obiettivo': c['obiettivo']})
        suo = cliente.get('/api/cliente/stato')['professionista']
        if suo and suo['email'] != 'anna.nutrizionista@gmail.com':
            print(f'  {c["nome"]}: seguito da un altro studio, lo salto')
            continue
        if not suo:
            cliente.post('/api/cliente/richiedi', {'email': 'anna.nutrizionista@gmail.com', 'messaggio': None})
        richiesta = next((r for r in anna.get('/api/studio/cruscotto')['richieste'] if r['email'] == c['email']), None)
        if richiesta:
            anna.post('/api/studio/decidi', {'link': richiesta['linkId'], 'accetta': True})
        scheda = next(x for x in anna.get('/api/studio/cruscotto')['clienti'] if x['email'] == c['email'])
        cli = scheda['id']
        if scheda['dieta'] or (c['dieta'] is None and scheda['prossimaVisita']):
            print(f'  {c["nome"]}: già pronto')
            continue

        if c['cartella'] or c['visita']:
            visita = None
            if c['visita']:
                giorni, ora = c['visita']
                visita = f'{(OGGI + datetime.timedelta(days=giorni)).isoformat()}T{ora}'
            anna.post('/api/studio/cartella', {'cliente': cli, **(c['cartella'] or {}), 'prossimaVisita': visita or ''})
        for settimane, kg in enumerate(reversed(c['pesi'])):
            giorno = OGGI - datetime.timedelta(days=7 * (settimane + 1))
            anna.post('/api/studio/misura', {'cliente': cli, 'giorno': giorno.isoformat(), 'peso': kg})
        if c['nota']:
            anna.post('/api/studio/nota', {'cliente': cli, 'testo': c['nota']})

        if c['dieta']:
            d = c['dieta']
            dieta_id = anna.post('/api/studio/nuova-dieta', {'cliente': cli, 'titolo': d['titolo']})['id']
            giorni = [{'indice': i, 'allenamento': i in (0, 2, 4),
                       'pasti': [{'nome': n, 'orario': o, 'alimenti': al} for n, o, al in d['schemi'][i % 2]]}
                      for i in range(7)]
            anna.post('/api/studio/salva-dieta', {'id': dieta_id, 'dieta': {
                'titolo': d['titolo'], 'indicazioni': d['indicazioni'], 'obiettivi': d['obiettivi'], 'giorni': giorni}})
            if c['pubblica']:
                anna.post('/api/studio/pubblica', {'id': dieta_id})
                pasti = {g['indice']: g['pasti'] for g in anna.get(f'/api/studio/dieta?dieta={dieta_id}')['dieta']['giorni']}
                for i, quota in enumerate(c['costanza']):
                    if quota is None:
                        continue
                    data = OGGI - datetime.timedelta(days=6 - i)
                    del_giorno = pasti.get(data.weekday(), [])
                    fatti = round(len(del_giorno) * quota)
                    for k, p in enumerate(del_giorno):
                        cliente.post('/api/cliente/spunta', {'giorno': data.isoformat(), 'pasto': p['id'],
                                                             'stato': 'fatto' if k < fatti else 'saltato'})
                for i, passi in enumerate(c['passi']):
                    if passi is not None:
                        data = OGGI - datetime.timedelta(days=6 - i)
                        cliente.post('/api/cliente/passi', {'giorno': data.isoformat(), 'passi': passi})
                if c['acqua']:
                    cliente.post('/api/cliente/acqua', {'ml': c['acqua']})
                if c.get('sostituzione'):
                    nome, indice, alimento = c['sostituzione']
                    oggi = cliente.get('/api/cliente/dashboard')['oggi']
                    pasto = next((p for p in oggi['pasti'] if p['nome'] == nome), None)
                    if pasto:
                        cliente.post('/api/cliente/applica', {'giorno': oggi['indice'], 'pasto': pasto['id'],
                                                              'indice': indice, 'alimento': alimento})
                if c.get('messaggio'):
                    if c.get('automazione') is False:
                        anna.post('/api/studio/automazione', {'cliente': cli, 'attiva': False})
                    cliente.post('/api/cliente/chat', {'domanda': c['messaggio']})
        print(f'  {c["nome"]}: {"dieta pubblicata" if c["dieta"] and c["pubblica"] else "dieta in bozza" if c["dieta"] else "senza dieta"}')

    for email, nome, messaggio in IN_ATTESA_DI_ANNA:
        cliente = SessioneConPassword(email)
        cliente.post('/api/cliente/impostazioni', {'nome': nome})
        if not cliente.get('/api/cliente/stato')['professionista']:
            cliente.post('/api/cliente/richiedi', {'email': 'anna.nutrizionista@gmail.com', 'messaggio': messaggio})
        print(f'  {nome}: richiesta in attesa')


crea_account()
for coppia in COPPIE:
    prepara(coppia)
prepara_altri()
print('\nFatto. Apri http://localhost:8787 e scegli un account.')
