# Bot d'alertes Vinted

Il surveille les nouvelles annonces de **lots** (marques, prix ≤ 80 €, neuf ou très bon état, 2 à 15 pièces),
t'alerte sur **Telegram** et/ou **Discord**, et transmet ses trouvailles à tes **tâches planifiées**
« Chasse aux lots Vinted » (13h40) et « Chasse lots marques Vinted » (20h56).

Le bot **n'achète rien**, ne fait aucune offre, n'envoie aucun message et ne contourne pas les protections de Vinted.
En cas de blocage, il ralentit (10 min à 1 h) puis reprend.

## Comment le couplage fonctionne

```
Bot (ton PC, toutes les ~2 min)
  ├─► alerte Telegram / Discord  → toi, en temps réel
  └─► alertes/annonces.json (branche GitHub « bot-alertes », toutes les 15 min)
          └─► tâches planifiées 13h40 et 20h56 : analysent ces lots EN PRIORITÉ
              (comparables, rentabilité, favori, offre), puis font leur recherche habituelle
```

## Installation (une fois)

1. Python 3.10 ou plus récent. Dans le dossier `bot` : `pip install -r requirements.txt`
2. Copie `.env.exemple` en `.env` et remplis :
   - **Telegram** : crée un bot avec @BotFather (`TELEGRAM_TOKEN`), envoie-lui un message, puis récupère ton
     identifiant avec @userinfobot (`TELEGRAM_CHAT_ID`) ;
   - et/ou **Discord** : URL de webhook d'un salon (`DISCORD_WEBHOOK`) ;
   - **GitHub** (indispensable pour le couplage) : github.com → Settings → Developer settings →
     Fine-grained tokens → accès au seul dépôt `Mon-projet-`, permission *Contents : Read and write* (`GITHUB_TOKEN`).
3. Test : `python vinted_alertes.py --test` (alerte de test + création de la branche `bot-alertes`).
4. Lancement : `python vinted_alertes.py` et laisse la fenêtre ouverte. Au 1er lancement, il mémorise
   les annonces déjà en ligne sans t'alerter, puis n'alerte que les nouvelles.

Pour qu'il démarre tout seul : Planificateur de tâches Windows (« À l'ouverture de session »), ou sur Mac / Linux
une ligne `@reboot cd /chemin/bot && python3 vinted_alertes.py >> bot.log 2>&1` dans `crontab -e`.

## Réglages

Tout est dans `criteres.json` : marques et fautes d'orthographe, prix max, nombre de pièces, états,
mots exclus, fréquence (`intervalle_secondes`, 120 par défaut ; ne descends pas sous 60).

## À savoir

- Les conditions d'utilisation de Vinted interdisent les outils automatisés. À ce rythme le risque est faible,
  mais pas nul : si Vinted bloque le bot de façon répétée, arrête-le.
- Les alertes sont **pré-filtrées**, pas analysées : la rentabilité est calculée par les tâches planifiées
  et par l'application *Vinted Lots Pro*.
