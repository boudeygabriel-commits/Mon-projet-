#!/usr/bin/env python3
"""Bot d'alertes Vinted, couplé aux tâches planifiées « Chasse aux lots Vinted ».

Ce qu'il fait :
  1. Surveille les nouvelles annonces de lots (critères dans criteres.json).
  2. T'envoie une alerte Telegram et/ou Discord (photo, prix, lien).
  3. Publie les annonces repérées dans alertes/annonces.json sur la branche
     GitHub « bot-alertes ». Les tâches planifiées lisent ce fichier et
     analysent ces lots en priorité (rentabilité, favori, offre).

Ce qu'il ne fait PAS (volontairement) : acheter, payer, faire des offres,
envoyer des messages, ni contourner les protections anti-robot de Vinted.
En cas de blocage (403, captcha, 429), il ralentit puis réessaie plus tard.

Usage :
  python vinted_alertes.py              # boucle continue
  python vinted_alertes.py --une-fois   # un seul cycle (test)
  python vinted_alertes.py --test       # alerte + synchro de test, sans Vinted
Options : --sans-alerte, --sans-github, --alerter-existant
"""
from __future__ import annotations

import argparse
import base64
import json
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ICI = Path(__file__).resolve().parent
ETAT = ICI / "etat"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def maintenant() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
def charger_env() -> dict:
    env = {}
    f = ICI / ".env"
    if f.exists():
        for ligne in f.read_text(encoding="utf-8").splitlines():
            ligne = ligne.strip()
            if ligne and not ligne.startswith("#") and "=" in ligne:
                k, v = ligne.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    import os
    for k in ("TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID", "DISCORD_WEBHOOK",
              "GITHUB_TOKEN", "GITHUB_REPO", "GITHUB_BRANCHE"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    env.setdefault("GITHUB_REPO", "boudeygabriel-commits/Mon-projet-")
    env.setdefault("GITHUB_BRANCHE", "bot-alertes")
    return env


def charger_criteres() -> dict:
    return json.loads((ICI / "criteres.json").read_text(encoding="utf-8"))


def construire_recherches(c: dict) -> list[dict]:
    """Une recherche « lot <alias> » par alias de marque, plus les recherches génériques."""
    rech = []
    for marque, alias in c["marques"].items():
        for a in alias:
            if len(a) <= 4 and a not in ("fila", "nike"):
                continue  # alias trop courts (« lee », « boss ») : servent au filtrage seulement
            rech.append({"texte": f"lot {a}", "marque": marque})
    for t in c.get("recherches_sans_marque", []):
        rech.append({"texte": t, "marque": None})
    return rech


# --------------------------------------------------------------------------
# Filtrage
# --------------------------------------------------------------------------
RE_LOT = re.compile(r"\blots?\b", re.I)
RE_PIECES = re.compile(
    r"(?:\blot\s*(?:de\s*)?(\d{1,2})\b)|(?:\b(\d{1,2})\s*(?:pi[eè]ces?|articles?|v[eê]tements?|pcs|x)\b)",
    re.I)
RE_AGE = re.compile(r"\b\d{1,2}\s*(?:ans|mois)\b", re.I)


def nombre_pieces(titre: str) -> int | None:
    for m in RE_PIECES.finditer(titre):
        n = int(m.group(1) or m.group(2))
        if 1 <= n <= 60:
            return n
    return None


def contient(texte: str, mot: str) -> bool:
    return re.search(r"(?<![\w])" + re.escape(mot) + r"(?![\w])", texte, re.I) is not None


def trouver_marque(texte: str, c: dict) -> str | None:
    for marque, alias in c["marques"].items():
        if any(contient(texte, a) for a in alias):
            return marque
    return None


def montant(v) -> float | None:
    if isinstance(v, dict):
        v = v.get("amount")
    try:
        return round(float(str(v).replace(",", ".")), 2)
    except (TypeError, ValueError):
        return None


def normaliser(item: dict, recherche: dict, c: dict) -> dict:
    titre = item.get("title") or ""
    url = item.get("url") or f"{c['domaine']}/items/{item.get('id')}"
    if url.startswith("/"):
        url = c["domaine"] + url
    photo = item.get("photo") or {}
    user = item.get("user") or {}
    prix = montant(item.get("price"))
    total = montant(item.get("total_item_price"))
    texte = f"{titre} {item.get('brand_title') or ''}"
    return {
        "id": item.get("id"),
        "url": url,
        "titre": titre,
        "prix": prix,
        "prix_avec_frais": total if total and prix and total >= prix else None,
        "marque_annonce": item.get("brand_title") or None,
        "marque": trouver_marque(texte, c) or recherche.get("marque"),
        "taille": item.get("size_title") or None,
        "etat": item.get("status") or None,
        "vendeur": user.get("login"),
        "photo": photo.get("url") if isinstance(photo, dict) else None,
        "pieces": nombre_pieces(titre),
        "favoris": item.get("favourite_count"),
        "recherche": recherche["texte"],
        "vu_a": maintenant().isoformat(timespec="seconds"),
    }


def raison_rejet(a: dict, recherche: dict, c: dict) -> str | None:
    titre = a["titre"]
    if not RE_LOT.search(titre):
        return "pas un lot"
    if a["prix"] is None or a["prix"] > c["prix_max"]:
        return "prix"
    texte = f"{titre} {a['marque_annonce'] or ''}"
    if any(contient(texte, m) for m in c.get("mots_exclus", [])) or RE_AGE.search(titre):
        return "exclu (enfant, contrefaçon, abîmé…)"
    if a["pieces"] is not None and not (c["pieces_min"] <= a["pieces"] <= c["pieces_max"]):
        return "nombre de pièces"
    if recherche.get("marque") and not trouver_marque(texte, c):
        return "marque absente du titre"
    return None


# --------------------------------------------------------------------------
# Vinted
# --------------------------------------------------------------------------
class Bloque(Exception):
    pass


class Vinted:
    def __init__(self, c: dict):
        self.c = c
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9"})
        self.ok = False

    def cookies(self) -> None:
        r = self.s.get(self.c["domaine"] + "/", timeout=20)
        if r.status_code in (403, 429):
            raise Bloque(f"page d'accueil : HTTP {r.status_code}")
        r.raise_for_status()
        self.ok = True

    def chercher(self, texte: str) -> list[dict]:
        if not self.ok:
            self.cookies()
        params = [("search_text", texte), ("order", "newest_first"), ("per_page", "48"),
                  ("page", "1"), ("price_to", str(self.c["prix_max"])), ("currency", "EUR")]
        params += [("status_ids[]", k) for k in self.c["etats"]]
        for essai in range(2):
            r = self.s.get(self.c["domaine"] + "/api/v2/catalog/items", params=params,
                           headers={"Accept": "application/json, text/plain, */*"}, timeout=20)
            if r.status_code == 401 and essai == 0:
                self.ok = False
                self.cookies()
                continue
            if r.status_code in (403, 429) or "captcha" in r.text[:2000].lower():
                raise Bloque(f"recherche : HTTP {r.status_code}")
            r.raise_for_status()
            return r.json().get("items", [])
        return []


# --------------------------------------------------------------------------
# Alertes
# --------------------------------------------------------------------------
def texte_alerte(a: dict) -> str:
    l1 = f"🧺 {a['titre']}"
    prix = f"{a['prix']:.2f} €".replace(".", ",")
    if a.get("prix_avec_frais"):
        prix += f" ({a['prix_avec_frais']:.2f} € avec protection)".replace(".", ",")
    infos = [prix]
    if a.get("pieces"):
        infos.append(f"{a['pieces']} pièces ≈ {a['prix'] / a['pieces']:.1f} €/pièce".replace(".", ","))
    for k in ("marque", "taille", "etat"):
        if a.get(k):
            infos.append(a[k])
    if a.get("vendeur"):
        infos.append(f"vendeur {a['vendeur']}")
    return f"{l1}\n{' · '.join(infos)}\n{a['url']}"


def alerter(a: dict, env: dict) -> None:
    txt = texte_alerte(a)
    if env.get("TELEGRAM_TOKEN") and env.get("TELEGRAM_CHAT_ID"):
        base = f"https://api.telegram.org/bot{env['TELEGRAM_TOKEN']}"
        try:
            if a.get("photo"):
                r = requests.post(base + "/sendPhoto", timeout=20, data={
                    "chat_id": env["TELEGRAM_CHAT_ID"], "photo": a["photo"], "caption": txt[:1000]})
            else:
                r = requests.post(base + "/sendMessage", timeout=20, data={
                    "chat_id": env["TELEGRAM_CHAT_ID"], "text": txt})
            if not r.ok:
                log(f"Telegram : erreur {r.status_code} {r.text[:200]}")
        except requests.RequestException as e:
            log(f"Telegram injoignable : {e}")
    if env.get("DISCORD_WEBHOOK"):
        embed = {"title": a["titre"][:250], "url": a["url"], "description": txt.split("\n")[1][:2000]}
        if a.get("photo"):
            embed["thumbnail"] = {"url": a["photo"]}
        try:
            r = requests.post(env["DISCORD_WEBHOOK"], json={"embeds": [embed]}, timeout=20)
            if not r.ok:
                log(f"Discord : erreur {r.status_code} {r.text[:200]}")
        except requests.RequestException as e:
            log(f"Discord injoignable : {e}")
    if not any(env.get(k) for k in ("TELEGRAM_TOKEN", "DISCORD_WEBHOOK")):
        log("ALERTE " + txt.replace("\n", " | "))


# --------------------------------------------------------------------------
# État local + synchronisation GitHub (lue par les tâches planifiées)
# --------------------------------------------------------------------------
def lire_json(p: Path, defaut):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return defaut


def ecrire_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


def purger(annonces: list[dict], heures: int) -> list[dict]:
    limite = maintenant() - timedelta(hours=heures)
    garde = [a for a in annonces if datetime.fromisoformat(a["vu_a"]) >= limite]
    return garde[-400:]


class GitHub:
    API = "https://api.github.com"
    CHEMIN = "alertes/annonces.json"

    def __init__(self, env: dict):
        self.token = env.get("GITHUB_TOKEN")
        self.repo = env["GITHUB_REPO"]
        self.branche = env["GITHUB_BRANCHE"]
        self.h = {"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28"}
        self.branche_ok = False

    def actif(self) -> bool:
        return bool(self.token)

    def _branche(self) -> None:
        if self.branche_ok:
            return
        u = f"{self.API}/repos/{self.repo}/git/ref/heads/{self.branche}"
        r = requests.get(u, headers=self.h, timeout=20)
        if r.status_code == 404:
            info = requests.get(f"{self.API}/repos/{self.repo}", headers=self.h, timeout=20)
            info.raise_for_status()
            defaut = info.json()["default_branch"]
            ref = requests.get(f"{self.API}/repos/{self.repo}/git/ref/heads/{defaut}",
                               headers=self.h, timeout=20)
            ref.raise_for_status()
            r = requests.post(f"{self.API}/repos/{self.repo}/git/refs", headers=self.h, timeout=20,
                              json={"ref": f"refs/heads/{self.branche}",
                                    "sha": ref.json()["object"]["sha"]})
            r.raise_for_status()
            log(f"GitHub : branche {self.branche} créée")
        else:
            r.raise_for_status()
        self.branche_ok = True

    def publier(self, contenu: dict) -> bool:
        try:
            self._branche()
            u = f"{self.API}/repos/{self.repo}/contents/{self.CHEMIN}"
            r = requests.get(u, headers=self.h, params={"ref": self.branche}, timeout=20)
            sha = r.json().get("sha") if r.ok else None
            corps = {
                "message": f"Bot alertes : {len(contenu['annonces'])} annonces ({contenu['maj']})",
                "content": base64.b64encode(
                    json.dumps(contenu, ensure_ascii=False, indent=1).encode()).decode(),
                "branch": self.branche,
            }
            if sha:
                corps["sha"] = sha
            r = requests.put(u, headers=self.h, json=corps, timeout=30)
            if not r.ok:
                log(f"GitHub : erreur {r.status_code} {r.text[:200]}")
                return False
            return True
        except requests.RequestException as e:
            log(f"GitHub injoignable : {e}")
            return False


def contenu_partage(annonces: list[dict], statut: str) -> dict:
    return {
        "maj": maintenant().isoformat(timespec="seconds"),
        "statut_bot": statut,
        "info": "Lots repérés par le bot d'alertes (pré-filtrés, pas encore analysés). "
                "Les tâches planifiées doivent vérifier chaque annonce sur Vinted avant d'agir.",
        "annonces": sorted(annonces, key=lambda a: a["vu_a"], reverse=True),
    }


# --------------------------------------------------------------------------
# Boucle principale
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--une-fois", action="store_true", help="un seul cycle complet puis arrêt")
    ap.add_argument("--test", action="store_true", help="envoie une alerte et une synchro de test")
    ap.add_argument("--sans-alerte", action="store_true")
    ap.add_argument("--sans-github", action="store_true")
    ap.add_argument("--alerter-existant", action="store_true",
                    help="au 1er lancement, alerte aussi les annonces déjà en ligne")
    args = ap.parse_args()

    env, c = charger_env(), charger_criteres()
    gh = GitHub(env)
    if args.sans_github:
        gh.token = None
    vus_f, ann_f = ETAT / "vus.json", ETAT / "annonces.json"
    vus: list = lire_json(vus_f, [])
    vus_set = set(vus)
    annonces: list = purger(lire_json(ann_f, []), c["conservation_heures"])
    premier = not vus and not args.alerter_existant

    if args.test:
        a = {"id": 0, "url": c["domaine"], "titre": "TEST – Lot 5 jeans Levi's W32", "prix": 35.0,
             "prix_avec_frais": 37.45, "marque": "Levi's", "taille": "W32", "etat": "Très bon état",
             "vendeur": "test", "photo": None, "pieces": 5, "recherche": "test",
             "vu_a": maintenant().isoformat(timespec="seconds")}
        alerter(a, env)
        if gh.actif():
            log("Synchro GitHub de test : " + ("OK" if gh.publier(contenu_partage(annonces, "test")) else "échec"))
        return 0

    recherches = construire_recherches(c)
    random.shuffle(recherches)
    log(f"{len(recherches)} recherches en rotation · alertes : "
        f"{'Telegram ' if env.get('TELEGRAM_TOKEN') else ''}{'Discord ' if env.get('DISCORD_WEBHOOK') else ''}"
        f"{'' if env.get('TELEGRAM_TOKEN') or env.get('DISCORD_WEBHOOK') else 'console seulement'}"
        f" · synchro GitHub : {'oui' if gh.actif() else 'non'}")
    if premier:
        log("1er lancement : les annonces déjà en ligne sont mémorisées sans alerte.")

    vinted = Vinted(c)
    i, pause_blocage = 0, 0
    derniere_synchro, a_synchro, statut = 0.0, True, "actif"
    tour_complet = len(recherches) if args.une_fois else c["recherches_par_cycle"]

    while True:
        nouveaux = 0
        for _ in range(tour_complet):
            r = recherches[i % len(recherches)]
            i += 1
            try:
                items = vinted.chercher(r["texte"])
                pause_blocage, statut = 0, "actif"
            except Bloque as e:
                pause_blocage = min(max(pause_blocage * 2, 600), 3600)
                statut = f"bloqué par Vinted ({e}) – pause {pause_blocage // 60} min"
                log(statut)
                vinted = Vinted(c)
                a_synchro = True
                break
            except (requests.RequestException, ValueError) as e:
                log(f"« {r['texte']} » : erreur {e}")
                continue
            for item in items:
                iid = item.get("id")
                if iid is None or iid in vus_set:
                    continue
                vus_set.add(iid)
                vus.append(iid)
                a = normaliser(item, r, c)
                if raison_rejet(a, r, c):
                    continue
                if premier:
                    continue
                nouveaux += 1
                annonces.append(a)
                a_synchro = True
                if not args.sans_alerte:
                    alerter(a, env)
                    time.sleep(1)
            time.sleep(random.uniform(*c["pause_entre_recherches_secondes"]))

        if premier and i >= len(recherches):
            premier = False
            log("Mémorisation initiale terminée : alertes actives.")
        vus = vus[-8000:]
        vus_set = set(vus)
        annonces = purger(annonces, c["conservation_heures"])
        ecrire_json(vus_f, vus)
        ecrire_json(ann_f, annonces)
        if nouveaux:
            log(f"{nouveaux} nouveau(x) lot(s)")

        if gh.actif() and a_synchro and (args.une_fois or
                                         time.time() - derniere_synchro >= c["synchro_github_minutes"] * 60):
            if gh.publier(contenu_partage(annonces, statut)):
                derniere_synchro, a_synchro = time.time(), False
                log(f"GitHub : {len(annonces)} annonces publiées pour les tâches planifiées")

        if args.une_fois:
            return 0
        attente = pause_blocage or c["intervalle_secondes"] * random.uniform(0.8, 1.3)
        time.sleep(attente)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("Arrêt.")
