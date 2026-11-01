# Consignes pour Claude (Claude in Chrome) — chasse aux lots Vinted

Copie ce texte dans la conversation **Claude in Chrome** (ou garde-le ouvert et dis à Claude de le lire).
Application : https://boudeygabriel-commits.github.io/Mon-projet-/

---

Tu m'aides à trouver des lots de vêtements rentables sur Vinted et à les faire vérifier par mon application **Vinted Lots Pro** avant de les ajouter en favoris.

## Déroulé

1. **Recherche** : dans l'onglet *Recherche* de l'application, utilise les liens générés (marques de niche, « lot », tailles, fautes d'orthographe). Ou cherche directement sur vinted.fr en triant par « plus récents ».
2. **Sélection** : ouvre les annonces de lots (2 à 10 pièces) dont les photos sont exploitables et le vendeur a des avis. Pour chaque article du lot, relève la marque, le modèle, la taille et l'état d'après l'annonce et les photos.
3. **Estimation des prix de revente** : pour chaque article, cherche des annonces comparables (même marque, même modèle, même taille, état proche). Retiens :
   - `low` : le prix bas des comparables ;
   - `mid` : le prix médian ;
   - `high` : le prix haut réaliste.
   Sois prudent. Si tu ne trouves pas assez de comparables, mets `"risky": true` et explique pourquoi dans `notes`.
4. **Import dans l'application** : construis le JSON ci-dessous, puis ouvre l'application avec le lien d'import :
   `https://boudeygabriel-commits.github.io/Mon-projet-/#import=` suivi du JSON encodé avec `encodeURIComponent`.
   Si le lien est trop long (plus de 10 lots), va plutôt dans l'onglet *Opportunités*, colle le JSON dans « Importer des lots trouvés par Claude » et clique sur **Vérifier la rentabilité**.
5. **Lecture du verdict** : l'application affiche pour chaque lot le score sur 100, le prix maximal et la ligne `FAVORI OUI` ou `FAVORI NON` (bloc « Verdict »). Clique sur **Ajouter les lots cochés aux opportunités**.
6. **Favoris Vinted** : présente-moi la liste des lots `FAVORI OUI` et **demande mon accord** avant d'ajouter quoi que ce soit en favori. Après mon accord, ajoute-les en favori sur Vinted, puis coche « ajouté » dans la colonne *Favori Vinted* de l'onglet *Opportunités*.

## Format JSON

```json
[
  {
    "title": "Lot 3 jeans Levi's 501 W32",
    "url": "https://www.vinted.fr/items/1234567890-lot-jeans-levis",
    "seller": "pseudo_vendeur",
    "askPrice": 35,
    "shipping": 4.5,
    "days": 30,
    "demand": 4,
    "quality": 4,
    "notes": "Comparables : 501 W32 vendus 22-30 €. Petite usure à l'entrejambe sur le 2e.",
    "items": [
      { "brand": "Levi's", "type": "501", "size": "W32 L32", "low": 18, "mid": 24, "high": 30 },
      { "brand": "Levi's", "type": "501", "size": "W32 L30", "low": 15, "mid": 20, "high": 26, "risky": true },
      { "brand": "Levi's", "type": "505", "size": "W33 L32", "low": 16, "mid": 22, "high": 28 }
    ]
  }
]
```

| Champ | Sens |
|---|---|
| `askPrice` | prix demandé pour le lot (obligatoire) |
| `shipping` | frais de port estimés (5 € par défaut) |
| `days` | délai de revente estimé, en jours |
| `demand` | demande pour ces marques et ces tailles, de 1 à 5 |
| `quality` | qualité, état et confiance dans l'authenticité, de 1 à 5 |
| `items[].low/mid/high` | prix de revente bas, médian et haut (`mid` obligatoire) |
| `items[].risky` | défaut, taille peu demandée ou doute d'authenticité |

## Règles

- **N'invente jamais** d'annonce, de prix, de lien ou de vendeur : uniquement ce que tu as vu sur la page.
- **N'achète rien et n'envoie aucun message ni aucune offre** sans mon accord explicite. L'onglet *Négociation* prépare les messages, et c'est moi qui valide.
- Ne mets en favori que des lots `FAVORI OUI`, et seulement après mon accord.
- Navigue à un rythme humain (pas de dizaines de pages à la seconde) et respecte les conditions d'utilisation de Vinted.

## Lots repérés par le bot d'alertes

Le bot (dossier [`bot/`](bot/README.md)) publie les lots qu'il repère en temps réel dans
https://github.com/boudeygabriel-commits/Mon-projet-/blob/bot-alertes/alertes/annonces.json
(champs : `url`, `titre`, `prix`, `marque`, `taille`, `etat`, `vendeur`, `pieces`, `vu_a`, et `statut_bot` en tête de fichier).

- Au début de chaque passage, lis ce fichier et analyse **en priorité** les annonces vues depuis le passage précédent
  (`vu_a` dans les dernières 24 h). Ouvre chaque annonce sur Vinted : ignore celles vendues, réservées ou déjà en favori.
- Ces annonces sont seulement pré-filtrées : applique-leur les mêmes exclusions, le même calcul de rentabilité
  et les mêmes règles de favori et d'offre que pour tes propres recherches.
- Si le fichier est introuvable, vide, ou si `maj` date de plus de 24 h, ou si `statut_bot` indique un blocage,
  signale-le dans le résumé et continue normalement.
