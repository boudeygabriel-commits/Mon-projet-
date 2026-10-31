# Vinted Lots Pro

Outil personnel (100 % local, sans serveur) pour piloter une activité d'achat-revente de lots de vêtements sur Vinted.

## Utilisation

Ouvre `index.html` dans un navigateur (ordinateur ou téléphone). Pour l'avoir sur ton téléphone, active
**GitHub Pages** sur ce dépôt (Settings → Pages → branche) et ouvre l'URL fournie.
Les données sont enregistrées dans le navigateur : pense à faire **Réglages → Exporter (JSON)** régulièrement.

## Modules

| Onglet | Ce qu'il fait |
|---|---|
| **Tableau de bord** | CA, bénéfice avant/après charges du mois, progression vers l'objectif (phases 1-2-3), stock immobilisé, délai moyen de vente, graphique 6 mois, performance par marque et par taille, prochaines actions recommandées. |
| **Analyser un lot** | Coût total (prix + protection acheteur + livraison), coût par article, 3 scénarios (pessimiste / réaliste / optimiste), ROI, **prix maximal à ne pas dépasser**, **score /100** (marge 30, demande 25, rapidité 20, qualité 15, risque 10). |
| **Opportunités** | Tes lots favoris classés par score (top 10 ⭐), statuts (à étudier → négociation → offre → acheté), détection des doublons. « Acheté » ventile le coût réel sur chaque article du stock. |
| **Négociation** | Offre d'ouverture, prix cible, prix max, et 5 messages prêts à copier. Rien n'est envoyé automatiquement. |
| **Stock & ventes** | Suivi des articles, prix affiché, ventes, jours en stock, alerte stock dormant, bénéfice net par article. Export CSV. |
| **Annonces** | Génère titre + description optimisés (marque, modèle, coupe, taille, mesures, mots-clés). |
| **Recherche** | Génère des liens de recherche Vinted (plus récents d'abord, prix max) combinant marques de niche, « lot », tailles et **fautes d'orthographe courantes** pour repérer les annonces mal référencées. |
| **Réglages** | Taux URSSAF (12,3 % par défaut, vente de marchandises en micro-entreprise), versement libératoire, protection acheteur, emballage, scénarios, ROI minimal, objectif et budget mensuels. |

## Utiliser Claude pour chercher des lots

Avec **Claude in Chrome** sur ton ordinateur, Claude peut parcourir Vinted, relever les lots et les envoyer à l'application pour vérification :

1. Donne à Claude les consignes de [`CLAUDE_VINTED.md`](CLAUDE_VINTED.md).
2. Claude ouvre un **lien d'import** (`…/Mon-projet-/#import=<JSON>`) ou colle le JSON dans *Opportunités → Importer des lots trouvés par Claude*.
3. L'application calcule le score, le prix max et affiche `FAVORI OUI / NON` pour chaque lot.
4. Claude te présente les lots `FAVORI OUI` et ne les met en favori sur Vinted qu'avec ton accord ; coche ensuite « ajouté » dans la colonne *Favori Vinted*.

## Méthode de calcul

- Coût d'achat = prix + 0,70 € + 5 % (protection acheteur, modifiable) + livraison.
- Scénario = taux d'articles vendus × prix (bas / moyen / haut) − coût − emballage ; charges = % du CA.
- Prix max = prix tel que le bénéfice net réaliste atteigne à la fois le ROI minimal et le bénéfice minimal par article.

## Limites (volontaires)

- L'outil ne se connecte pas à ton compte Vinted et n'aspire aucune donnée (conditions d'utilisation de Vinted) : tu saisis les annonces et les prix constatés sur les articles **vendus**.
- Les taux de charges sont des valeurs par défaut à vérifier sur urssaf.fr. Les objectifs de bénéfice ne sont pas des revenus garantis.
- Au-delà de ventes occasionnelles, l'achat pour revendre est une activité professionnelle : déclare-la (micro-entreprise) et utilise un compte Vinted Pro.
